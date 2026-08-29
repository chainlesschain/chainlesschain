"""Bounded JSON-RPC App Server transport and fixed Context/Memory capabilities."""

from __future__ import annotations

import asyncio
import inspect
import json
import os
from dataclasses import dataclass
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    Literal,
    Mapping,
    Optional,
    Protocol,
    Sequence,
    Tuple,
    Union,
)

from .generated_app_protocol import (
    CC_AGENT_PROTOCOL_FEATURES,
    CC_AGENT_PROTOCOL_MIN_VERSION,
    CC_AGENT_PROTOCOL_VERSION,
    ContextCompactRequest,
    ContextCompactionReceipt,
    ContextPlan,
    ContextPlanRequest,
    MemoryDecisionRequest,
    MemoryDeletionReceipt,
    MemoryDeletionRequest,
    MemoryMutationReceipt,
    MemoryProposalRequest,
    MemoryRecallRequest,
    MemoryRecallResult,
    MemoryReconcileRequest,
    validate_protocol_message,
)
from .session import build_spawn_command

JsonMapping = Mapping[str, Any]
MaybeAwaitable = Union[Any, Awaitable[Any]]
ServerRequestCallback = Callable[[JsonMapping], MaybeAwaitable]
NotificationCallback = Callable[[JsonMapping], MaybeAwaitable]


class AppServerRpcError(RuntimeError):
    """A stable JSON-RPC error returned by the App Server or local transport."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


@dataclass(frozen=True)
class AppServerClientOptions:
    cli_path: str = "cc"
    cwd: Optional[Union[str, os.PathLike[str]]] = None
    env: Optional[Mapping[str, Optional[str]]] = None
    client_name: str = "chainlesschain-agent-sdk-python"
    client_version: str = "1"
    features: Optional[Tuple[str, ...]] = None
    storage_backend: Optional[Literal["jsonl", "sqlite"]] = None
    state_directory: Optional[str] = None
    state_path: Optional[str] = None
    server_queue_cap: Optional[int] = None
    max_pending_requests: int = 256
    max_line_length: int = 8 * 1024 * 1024
    request_timeout_seconds: float = 120.0

    def __post_init__(self) -> None:
        if not self.cli_path:
            raise ValueError("cli_path must not be empty")
        if self.storage_backend not in (None, "jsonl", "sqlite"):
            raise ValueError("storage_backend must be 'jsonl' or 'sqlite'")
        if self.state_directory and self.state_path:
            raise ValueError("state_directory and state_path are mutually exclusive")
        if self.max_pending_requests < 1:
            raise ValueError("max_pending_requests must be positive")
        if self.max_line_length < 1024:
            raise ValueError("max_line_length must be at least 1024")
        if self.request_timeout_seconds <= 0:
            raise ValueError("request_timeout_seconds must be positive")


class AppServerTransport(Protocol):
    @property
    def running(self) -> bool: ...

    @property
    def pending_request_count(self) -> int: ...

    async def start(self) -> Any: ...

    async def request(self, method: str, params: JsonMapping) -> Any: ...

    async def close(self) -> None: ...


async def _maybe_await(value: MaybeAwaitable) -> Any:
    return await value if inspect.isawaitable(value) else value


class AppServerClient:
    """Typed, bounded stdio client for ``cc serve --app-server``."""

    def __init__(
        self,
        options: Optional[AppServerClientOptions] = None,
        *,
        on_server_request: Optional[ServerRequestCallback] = None,
        on_notification: Optional[NotificationCallback] = None,
    ) -> None:
        self.options = options or AppServerClientOptions()
        self.on_server_request = on_server_request
        self.on_notification = on_notification
        self._process: Optional[asyncio.subprocess.Process] = None
        self._stdout_task: Optional[asyncio.Task[None]] = None
        self._stderr_task: Optional[asyncio.Task[None]] = None
        self._pending: Dict[str, asyncio.Future[Any]] = {}
        self._next_request_id = 0
        self._closing = False
        self.stderr_tail = ""

    @property
    def running(self) -> bool:
        return self._process is not None and not self._closing

    @property
    def pending_request_count(self) -> int:
        return len(self._pending)

    async def start(self) -> Any:
        if self._process is not None:
            raise RuntimeError("AppServerClient already started")
        args = self._server_args()
        command, full_args = build_spawn_command(self.options.cli_path, args)
        environment = dict(os.environ)
        for key, value in (self.options.env or {}).items():
            if value is None:
                environment.pop(key, None)
            else:
                environment[key] = value
        if os.name == "nt":
            environment["NoDefaultCurrentDirectoryInExePath"] = "1"
        self._process = await asyncio.create_subprocess_exec(
            command,
            *full_args,
            cwd=self.options.cwd,
            env=environment,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._closing = False
        self._stdout_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())
        return await self.request(
            "initialize",
            {
                "protocolVersion": CC_AGENT_PROTOCOL_VERSION,
                "minimumProtocolVersion": CC_AGENT_PROTOCOL_MIN_VERSION,
                "client": {"name": self.options.client_name, "version": self.options.client_version},
                "features": list(self.options.features or tuple(CC_AGENT_PROTOCOL_FEATURES)),
            },
        )

    def _server_args(self) -> list[str]:
        args = ["serve", "--app-server"]
        if self.options.storage_backend:
            args.extend(("--app-server-store", self.options.storage_backend))
        if self.options.state_directory:
            args.extend(("--app-server-state-dir", self.options.state_directory))
        if self.options.state_path:
            args.extend(("--app-server-state-path", self.options.state_path))
        if self.options.server_queue_cap is not None:
            args.extend(("--app-server-queue-cap", str(self.options.server_queue_cap)))
        return args

    async def request(self, method: str, params: JsonMapping) -> Any:
        process = self._process
        if process is None or self._closing or process.stdin is None:
            raise RuntimeError("AppServerClient is not running")
        if len(self._pending) >= self.options.max_pending_requests:
            raise AppServerRpcError(-32001, "App Server client request queue is overloaded")
        self._next_request_id += 1
        request_id = str(self._next_request_id)
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)})
            return await asyncio.wait_for(
                asyncio.shield(future), timeout=self.options.request_timeout_seconds
            )
        except asyncio.TimeoutError as error:
            raise AppServerRpcError(-32010, f"App Server request timed out: {method}") from error
        finally:
            self._pending.pop(request_id, None)

    async def close(self) -> None:
        process = self._process
        if process is None:
            return
        self._closing = True
        if process.stdin is not None:
            process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
        for task in (self._stdout_task, self._stderr_task):
            if task is not None and not task.done():
                task.cancel()
        self._reject_pending(RuntimeError("App Server connection closed"))
        self._process = None

    async def _write(self, message: JsonMapping) -> None:
        process = self._process
        if process is None or process.stdin is None or process.stdin.is_closing():
            raise RuntimeError("App Server stdin is closed")
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(encoded) > self.options.max_line_length:
            raise ValueError("App Server request exceeds max_line_length")
        process.stdin.write(encoded)
        await process.stdin.drain()

    async def _read_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                if len(line) > self.options.max_line_length:
                    raise ValueError("App Server response exceeds max_line_length")
                value = json.loads(line.decode("utf-8"))
                valid, errors = validate_protocol_message(value)
                if not valid:
                    raise ValueError(f"Invalid App Server protocol message: {'; '.join(errors)}")
                await self._dispatch(value)
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            self._reject_pending(error)

    async def _read_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            self.stderr_tail = (self.stderr_tail + line.decode("utf-8", errors="replace"))[-8192:]

    async def _dispatch(self, message: JsonMapping) -> None:
        if "method" in message and "id" in message:
            try:
                result = (
                    await _maybe_await(self.on_server_request(message))
                    if self.on_server_request
                    else {"kind": "decline", "reason": "No App Server request handler is configured"}
                )
                await self._write({"jsonrpc": "2.0", "id": message["id"], "result": result})
            except BaseException as error:
                await self._write(
                    {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": str(error)}}
                )
            return
        if "method" in message:
            if self.on_notification:
                await _maybe_await(self.on_notification(message))
            return
        request_id = str(message.get("id"))
        pending = self._pending.get(request_id)
        if pending is None or pending.done():
            return
        if "error" in message:
            error = message["error"]
            pending.set_exception(AppServerRpcError(error["code"], error["message"], error.get("data")))
        else:
            pending.set_result(message.get("result"))

    def _reject_pending(self, error: BaseException) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(error)


@dataclass(frozen=True)
class AppServerPilotStatus:
    running: bool
    initialized: bool
    pending_request_count: int
    capabilities: Any
    last_error: Optional[str]


class AppServerPilotClient:
    """Capability-shaped client with no generic public request method."""

    def __init__(
        self,
        options: Optional[AppServerClientOptions] = None,
        *,
        transport: Optional[AppServerTransport] = None,
    ) -> None:
        self._transport = transport or AppServerClient(options)
        self._capabilities: Any = None
        self._last_error: Optional[str] = None
        self._start_lock = asyncio.Lock()

    @property
    def status(self) -> AppServerPilotStatus:
        return AppServerPilotStatus(
            running=self._transport.running,
            initialized=self._capabilities is not None,
            pending_request_count=self._transport.pending_request_count,
            capabilities=self._capabilities,
            last_error=self._last_error,
        )

    async def start(self) -> Any:
        async with self._start_lock:
            if self._capabilities is not None and self._transport.running:
                return self._capabilities
            try:
                self._capabilities = await self._transport.start()
                self._last_error = None
                return self._capabilities
            except BaseException as error:
                self._last_error = str(error)
                self._capabilities = None
                await self._transport.close()
                raise

    async def close(self) -> None:
        await self._transport.close()
        self._capabilities = None

    async def _call(self, method: str, params: JsonMapping) -> Any:
        await self.start()
        return await self._transport.request(method, params)

    async def context_plan(self, params: ContextPlanRequest) -> ContextPlan:
        return await self._call("context/plan", params)

    async def context_compact(self, params: ContextCompactRequest) -> ContextCompactionReceipt:
        return await self._call("context/compact", params)

    async def memory_recall(self, params: MemoryRecallRequest) -> MemoryRecallResult:
        return await self._call("memory/recall", params)

    async def memory_propose(self, params: MemoryProposalRequest) -> MemoryMutationReceipt:
        return await self._call("memory/propose", params)

    async def memory_decide(self, params: MemoryDecisionRequest) -> MemoryMutationReceipt:
        return await self._call("memory/decide", params)

    async def memory_delete(self, params: MemoryDeletionRequest) -> MemoryDeletionReceipt:
        return await self._call("memory/delete", params)

    async def memory_reconcile(self, params: MemoryReconcileRequest) -> Any:
        return await self._call("memory/reconcile", params)
