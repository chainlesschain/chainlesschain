from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from typing import Any, Mapping

from chainlesschain_agent_sdk import (
    AppServerClient,
    AppServerClientOptions,
    AppServerPilotClient,
)


FAKE_APP_SERVER = Path(__file__).with_name("fake_app_server.py")


class FakeTransport:
    def __init__(self) -> None:
        self.running = False
        self.pending_request_count = 0
        self.starts = 0
        self.calls = []

    async def start(self) -> Mapping[str, Any]:
        self.running = True
        self.starts += 1
        return {"protocolVersion": 1, "features": ["context_memory_kernel"]}

    async def request(self, method: str, params: Mapping[str, Any]) -> Any:
        self.calls.append((method, dict(params)))
        return {"method": method, "params": dict(params)}

    async def close(self) -> None:
        self.running = False


class AppServerPilotClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_physical_rollout_selection_only_changes_server_argv(self) -> None:
        client = AppServerClient(
            AppServerClientOptions(
                storage_backend="sqlite",
                state_path="C:/state/rollouts.sqlite",
                server_queue_cap=64,
            )
        )
        self.assertEqual(
            client._server_args(),
            [
                "serve",
                "--app-server",
                "--app-server-store",
                "sqlite",
                "--app-server-state-path",
                "C:/state/rollouts.sqlite",
                "--app-server-queue-cap",
                "64",
            ],
        )
        with self.assertRaisesRegex(ValueError, "mutually exclusive"):
            AppServerClientOptions(
                state_directory="C:/state",
                state_path="C:/state/rollouts.sqlite",
            )

    async def test_fixed_context_memory_capabilities_initialize_once(self) -> None:
        transport = FakeTransport()
        pilot = AppServerPilotClient(transport=transport)
        results = await asyncio.gather(
            pilot.context_plan({}),  # type: ignore[arg-type]
            pilot.context_compact({}),  # type: ignore[arg-type]
            pilot.memory_recall({}),  # type: ignore[arg-type]
            pilot.memory_propose({}),  # type: ignore[arg-type]
            pilot.memory_decide({}),  # type: ignore[arg-type]
            pilot.memory_delete({}),  # type: ignore[arg-type]
            pilot.memory_reconcile({"operationId": "operation-1"}),
        )
        self.assertEqual(transport.starts, 1)
        self.assertEqual(
            [result["method"] for result in results],
            [
                "context/plan",
                "context/compact",
                "memory/recall",
                "memory/propose",
                "memory/decide",
                "memory/delete",
                "memory/reconcile",
            ],
        )
        self.assertFalse(hasattr(pilot, "request"))
        self.assertTrue(pilot.status.initialized)
        await pilot.close()
        self.assertFalse(pilot.status.initialized)

    async def test_real_stdio_transport_is_bounded_and_dispatches_notifications(self) -> None:
        notifications = []
        notified = asyncio.Event()

        async def on_notification(message):
            notifications.append(message)
            notified.set()

        client = AppServerClient(
            AppServerClientOptions(
                cli_path=str(FAKE_APP_SERVER),
                request_timeout_seconds=5.0,
                max_pending_requests=4,
            ),
            on_notification=on_notification,
        )
        capabilities = await client.start()
        self.assertEqual(capabilities["protocolVersion"], 1)
        result = await client.request("memory/reconcile", {"operationId": "operation-1"})
        self.assertEqual(result["method"], "memory/reconcile")
        await asyncio.wait_for(notified.wait(), timeout=2.0)
        self.assertEqual(notifications[0]["method"], "context/event")
        await client.close()
        self.assertFalse(client.running)


if __name__ == "__main__":
    unittest.main()
