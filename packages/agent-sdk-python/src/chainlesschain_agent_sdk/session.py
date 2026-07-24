"""Async subprocess client for ``cc agent`` stream-json sessions."""

from __future__ import annotations

import asyncio
import inspect
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Dict,
    Iterable,
    List,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
    Union,
)

from .ndjson import NdjsonDecodeError, NdjsonDecoder, encode_ndjson
from .protocol import (
    AgentStreamEvent,
    ApprovalRequestEvent,
    QuestionRequestEvent,
    ResultEvent,
    SystemInitEvent,
    parse_event,
)

MaybeAwaitable = Union[Any, Awaitable[Any]]
ApprovalCallback = Callable[[ApprovalRequestEvent], Union[bool, Awaitable[bool]]]
QuestionCallback = Callable[[QuestionRequestEvent], MaybeAwaitable]
EventCallback = Callable[[AgentStreamEvent], MaybeAwaitable]
ErrorCallback = Callable[[BaseException], MaybeAwaitable]
StderrCallback = Callable[[str], MaybeAwaitable]


class AgentSessionError(RuntimeError):
    """Base class for session lifecycle errors."""


class SessionNotRunningError(AgentSessionError):
    """Raised when an input is written before start or after exit."""


class SessionExitedError(AgentSessionError):
    """Raised when a result was requested but the subprocess exited first."""

    def __init__(self, exit_code: Optional[int], stderr_tail: str = "") -> None:
        message = f"agent exited (code {exit_code}) before a result"
        if stderr_tail.strip():
            message += f": {stderr_tail.strip()[-1000:]}"
        super().__init__(message)
        self.exit_code = exit_code
        self.stderr_tail = stderr_tail


@dataclass(frozen=True)
class ElicitationResponse:
    """Host decision for an MCP elicitation request."""

    action: str
    content: Any = None

    def __post_init__(self) -> None:
        if self.action not in {"accept", "decline", "cancel"}:
            raise ValueError("elicitation action must be accept, decline, or cancel")


@dataclass(frozen=True)
class AgentSessionOptions:
    cli_path: str = "cc"
    cwd: Optional[Union[str, os.PathLike[str]]] = None
    env: Optional[Mapping[str, Optional[str]]] = None
    resume: Optional[str] = None
    session_id: Optional[str] = None
    fork_session: bool = False
    permission_mode: str = "default"
    model: Optional[str] = None
    provider: Optional[str] = None
    include_partial_messages: bool = True
    extra_args: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.cli_path:
            raise ValueError("cli_path must not be empty")
        if self.permission_mode not in {
            "default",
            "plan",
            "acceptEdits",
            "bypassPermissions",
            "auto",
        }:
            raise ValueError(f"unsupported permission mode: {self.permission_mode}")
        if any(not isinstance(arg, str) for arg in self.extra_args):
            raise TypeError("extra_args must contain only strings")


def build_agent_args(
    options: AgentSessionOptions,
    *,
    interactive_approvals: bool = False,
) -> List[str]:
    """Map SDK options to the TypeScript SDK's canonical CLI arguments."""

    args = [
        "agent",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
    ]
    if options.include_partial_messages:
        args.append("--include-partial-messages")
    if interactive_approvals:
        args.append("--interactive-approvals")
    if options.resume:
        args.extend(("--resume", options.resume))
    elif options.session_id:
        args.extend(("--session", options.session_id))
    if options.fork_session:
        args.append("--fork-session")
    if options.permission_mode != "default":
        args.extend(("--permission-mode", options.permission_mode))
    if options.model:
        args.extend(("--model", options.model))
    if options.provider:
        args.extend(("--provider", options.provider))
    args.extend(options.extra_args)
    return args


def build_spawn_command(
    cli_path: str,
    args: Sequence[str],
    *,
    platform: Optional[str] = None,
) -> Tuple[str, List[str]]:
    """Build a cross-platform executable + argv pair.

    ``.py`` paths are a useful supported embedding/test seam. ``.js`` CLI
    entrypoints run through Node. On Windows, command shims use ``cmd.exe`` in
    the same way as the TypeScript SDK.
    """

    platform = platform or sys.platform
    suffix = Path(cli_path).suffix.lower()
    if suffix == ".py":
        return sys.executable, [cli_path, *args]
    if suffix in {".js", ".mjs", ".cjs"}:
        node = shutil.which("node") or "node"
        return node, [cli_path, *args]
    if platform == "win32":
        return "cmd.exe", ["/d", "/s", "/c", cli_path, *args]
    return cli_path, list(args)


_QUEUE_END = object()


class AgentSession:
    """One long-lived, duplex ``cc agent`` subprocess.

    Events are delivered to both ``on_event`` and ``async for event in
    session``. The queue is unbounded by design: protocol events, especially
    unknown future events, are never silently shed.
    """

    def __init__(
        self,
        options: Optional[AgentSessionOptions] = None,
        *,
        on_event: Optional[EventCallback] = None,
        on_approval: Optional[ApprovalCallback] = None,
        on_question: Optional[QuestionCallback] = None,
        on_elicitation: Optional[QuestionCallback] = None,
        on_error: Optional[ErrorCallback] = None,
        on_stderr: Optional[StderrCallback] = None,
    ) -> None:
        self.options = options or AgentSessionOptions()
        self.on_event = on_event
        self.on_approval = on_approval
        self.on_question = on_question
        self.on_elicitation = on_elicitation
        self.on_error = on_error
        self.on_stderr = on_stderr

        self._process: Optional[asyncio.subprocess.Process] = None
        self._stdout_task: Optional[asyncio.Task[None]] = None
        self._stderr_task: Optional[asyncio.Task[None]] = None
        self._wait_task: Optional[asyncio.Task[int]] = None
        self._callback_tasks: Set[asyncio.Task[Any]] = set()
        self._write_lock = asyncio.Lock()
        self._events: asyncio.Queue[Any] = asyncio.Queue()
        self._results: asyncio.Queue[Any] = asyncio.Queue()
        self._session_id: Optional[str] = None
        self._exit_code: Optional[int] = None
        self._stderr_tail = ""
        self._started = False
        self._finished = False

    @property
    def session_id(self) -> Optional[str]:
        return self._session_id

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid if self._process is not None else None

    @property
    def running(self) -> bool:
        return (
            self._process is not None
            and self._process.returncode is None
            and not self._finished
        )

    @property
    def exit_code(self) -> Optional[int]:
        return self._exit_code

    async def __aenter__(self) -> "AgentSession":
        await self.start()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    def __aiter__(self) -> AsyncIterator[AgentStreamEvent]:
        return self.events()

    async def start(self) -> "AgentSession":
        if self._started:
            raise AgentSessionError("AgentSession already started")
        self._started = True

        args = build_agent_args(
            self.options,
            interactive_approvals=self.on_approval is not None,
        )
        command, full_args = build_spawn_command(self.options.cli_path, args)
        env = os.environ.copy()
        for key, value in (self.options.env or {}).items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        if sys.platform == "win32":
            env["NoDefaultCurrentDirectoryInExePath"] = "1"
        if self.on_question is not None or self.on_elicitation is not None:
            env["CC_INTERACTIVE_QUESTIONS"] = "1"

        try:
            self._process = await asyncio.create_subprocess_exec(
                command,
                *full_args,
                cwd=os.fspath(self.options.cwd) if self.options.cwd else None,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except BaseException:
            self._started = False
            raise

        self._stdout_task = asyncio.create_task(
            self._pump_stdout(), name="chainlesschain-agent-stdout"
        )
        self._stderr_task = asyncio.create_task(
            self._pump_stderr(), name="chainlesschain-agent-stderr"
        )
        self._wait_task = asyncio.create_task(
            self._watch_exit(), name="chainlesschain-agent-exit"
        )
        return self

    async def events(self) -> AsyncIterator[AgentStreamEvent]:
        """Yield every decoded event, including :class:`UnknownAgentEvent`."""

        while True:
            item = await self._events.get()
            if item is _QUEUE_END:
                # Keep the terminal marker available for a late consumer.
                self._events.put_nowait(_QUEUE_END)
                break
            yield item

    async def next_result(self) -> ResultEvent:
        item = await self._results.get()
        if item is _QUEUE_END:
            self._results.put_nowait(_QUEUE_END)
            raise SessionExitedError(self._exit_code, self._stderr_tail)
        return item

    async def send(
        self,
        text: str,
        *,
        images: Iterable[str] = (),
        llm: Optional[Mapping[str, Any]] = None,
    ) -> None:
        event: Dict[str, Any] = {"type": "user", "text": text}
        image_list = list(images)
        if image_list:
            event["images"] = image_list
        if llm is not None:
            event["llm"] = dict(llm)
        await self.write(event)

    async def interrupt(self) -> None:
        await self.write({"type": "interrupt"})

    async def compact(self) -> None:
        await self.write({"type": "compact"})

    async def respond_approval(self, request_id: str, approve: bool) -> None:
        await self.write(
            {"type": "approval", "id": request_id, "approve": bool(approve)}
        )

    async def answer_question(self, request_id: str, answer: Any) -> None:
        await self.write({"type": "answer", "id": request_id, "answer": answer})

    async def plan_control(
        self,
        action: str,
        *,
        review: Optional[Mapping[str, Any]] = None,
        snapshot: Optional[str] = None,
    ) -> None:
        if action not in {"enter", "approve", "reject", "revise", "regenerate"}:
            raise ValueError("invalid plan action")
        event: Dict[str, Any] = {"type": "plan", "action": action}
        if review is not None:
            event["review"] = dict(review)
        if snapshot is not None:
            event["snapshot"] = snapshot
        await self.write(event)

    async def feedback(
        self,
        kind: str,
        *,
        turn_id: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> None:
        if kind not in {"positive", "negative", "correction"}:
            raise ValueError("invalid feedback kind")
        event: Dict[str, Any] = {"type": "feedback", "kind": kind}
        if turn_id is not None:
            event["turn_id"] = turn_id
        if comment is not None:
            event["comment"] = comment
        await self.write(event)

    async def resume_assist(self, action: str, *, token: Optional[str] = None) -> None:
        if action not in {"completed", "skip"}:
            raise ValueError("invalid resume action")
        event: Dict[str, Any] = {"type": "resume", "action": action}
        if token is not None:
            event["token"] = token
        await self.write(event)

    async def slash_command(
        self, request_id: str, command: str, args: str = ""
    ) -> None:
        await self.write(
            {
                "type": "slash_command",
                "request_id": request_id,
                "command": command,
                "args": args,
            }
        )

    async def write(self, event: Mapping[str, Any]) -> None:
        process = self._process
        if (
            process is None
            or process.returncode is not None
            or process.stdin is None
            or process.stdin.is_closing()
        ):
            raise SessionNotRunningError("agent session is not running")
        payload = encode_ndjson(dict(event))
        async with self._write_lock:
            try:
                process.stdin.write(payload)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as exc:
                raise SessionNotRunningError("agent stdin is closed") from exc

    async def end(self) -> None:
        process = self._process
        if process is None or process.stdin is None or process.stdin.is_closing():
            return
        process.stdin.close()
        try:
            await process.stdin.wait_closed()
        except (AttributeError, BrokenPipeError, ConnectionResetError):
            pass

    async def wait(self, timeout: Optional[float] = None) -> int:
        if self._wait_task is None:
            raise AgentSessionError("AgentSession has not been started")
        waiter = asyncio.shield(self._wait_task)
        if timeout is not None:
            return await asyncio.wait_for(waiter, timeout)
        return await waiter

    async def close(self, timeout: float = 10.0) -> int:
        if not self._started:
            return self._exit_code if self._exit_code is not None else 0
        await self.end()
        try:
            return await self.wait(timeout)
        except asyncio.TimeoutError:
            await self.kill()
            return await self.wait()

    async def kill(self) -> None:
        process = self._process
        if process is None or process.returncode is not None:
            return
        if sys.platform == "win32" and process.pid:
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
        else:
            process.kill()

    async def _pump_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        loop = asyncio.get_running_loop()

        def decoder_error(error: NdjsonDecodeError) -> None:
            loop.create_task(self._notify_error(error))

        decoder = NdjsonDecoder(on_error=decoder_error)
        try:
            while True:
                chunk = await process.stdout.read(64 * 1024)
                if not chunk:
                    break
                for value in decoder.feed(chunk):
                    await self._dispatch(value)
            for value in decoder.flush():
                await self._dispatch(value)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._notify_error(exc)

    async def _pump_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        try:
            while True:
                chunk = await process.stderr.read(16 * 1024)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace")
                self._stderr_tail = (self._stderr_tail + text)[-64 * 1024 :]
                if self.on_stderr is not None:
                    try:
                        await _maybe_await(self.on_stderr(text))
                    except Exception as exc:
                        await self._notify_error(exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._notify_error(exc)

    async def _dispatch(self, value: Any) -> None:
        try:
            event = parse_event(value)
        except Exception as exc:
            await self._notify_error(exc)
            return

        if isinstance(event, SystemInitEvent):
            self._session_id = event.session_id

        # Queue first: a broken host callback cannot make an event disappear.
        self._events.put_nowait(event)
        if isinstance(event, ResultEvent):
            self._results.put_nowait(event)

        if self.on_event is not None:
            try:
                await _maybe_await(self.on_event(event))
            except Exception as exc:
                await self._notify_error(exc)

        if isinstance(event, ApprovalRequestEvent) and self.on_approval is not None:
            self._spawn_callback(self._handle_approval(event))
        elif isinstance(event, QuestionRequestEvent):
            if event.is_mcp_elicitation and self.on_elicitation is not None:
                self._spawn_callback(self._handle_elicitation(event))
            elif not event.is_mcp_elicitation and self.on_question is not None:
                self._spawn_callback(self._handle_question(event))

    def _spawn_callback(self, awaitable: Awaitable[Any]) -> None:
        task = asyncio.create_task(awaitable)
        self._callback_tasks.add(task)
        task.add_done_callback(self._callback_tasks.discard)

    async def _handle_approval(self, event: ApprovalRequestEvent) -> None:
        approve = False
        try:
            assert self.on_approval is not None
            approve = (await _maybe_await(self.on_approval(event))) is True
        except Exception as exc:
            # Fail closed, matching the TypeScript SDK and CLI timeout path.
            await self._notify_error(exc)
            approve = False
        try:
            await self.respond_approval(event.id, approve)
        except SessionNotRunningError:
            pass

    async def _handle_question(self, event: QuestionRequestEvent) -> None:
        answer: Any = None
        try:
            assert self.on_question is not None
            answer = await _maybe_await(self.on_question(event))
        except Exception as exc:
            await self._notify_error(exc)
            answer = None
        try:
            await self.answer_question(event.id, answer)
        except SessionNotRunningError:
            pass

    async def _handle_elicitation(self, event: QuestionRequestEvent) -> None:
        answer: Any = None
        try:
            assert self.on_elicitation is not None
            response = await _maybe_await(self.on_elicitation(event))
            if isinstance(response, ElicitationResponse):
                if response.action == "accept":
                    answer = response.content if response.content is not None else {}
            elif isinstance(response, Mapping) and response.get("action") == "accept":
                answer = response.get("content", {})
        except Exception as exc:
            await self._notify_error(exc)
            answer = None
        try:
            await self.answer_question(event.id, answer)
        except SessionNotRunningError:
            pass

    async def _watch_exit(self) -> int:
        assert self._process is not None
        code = await self._process.wait()
        pumps = [
            task for task in (self._stdout_task, self._stderr_task) if task is not None
        ]
        if pumps:
            await asyncio.gather(*pumps, return_exceptions=True)
        for task in tuple(self._callback_tasks):
            if not task.done():
                task.cancel()
        if self._callback_tasks:
            await asyncio.gather(*self._callback_tasks, return_exceptions=True)
        self._exit_code = code
        self._finished = True
        self._events.put_nowait(_QUEUE_END)
        self._results.put_nowait(_QUEUE_END)
        return code

    async def _notify_error(self, error: BaseException) -> None:
        if self.on_error is None:
            return
        try:
            await _maybe_await(self.on_error(error))
        except Exception:
            # Error observers are diagnostics only and must never break the
            # protocol pump.
            pass


async def _maybe_await(value: MaybeAwaitable) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value
