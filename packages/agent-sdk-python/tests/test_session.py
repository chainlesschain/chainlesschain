from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path

from chainlesschain_agent_sdk import (
    AgentSession,
    AgentSessionOptions,
    ElicitationResponse,
    ResultEvent,
    SessionExitedError,
    SystemInitEvent,
    UnknownAgentEvent,
    build_agent_args,
    build_spawn_command,
)


FAKE_CLI = Path(__file__).with_name("fake_agent_cli.py")


class SessionHelpersTests(unittest.TestCase):
    def test_build_agent_args_matches_typescript_semantics(self) -> None:
        options = AgentSessionOptions(
            resume="old",
            session_id="new",
            fork_session=True,
            permission_mode="acceptEdits",
            model="m",
            provider="p",
            include_partial_messages=False,
            extra_args=("--trace-id", "tr-1"),
        )
        self.assertEqual(
            build_agent_args(options, interactive_approvals=True),
            [
                "agent",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--interactive-approvals",
                "--resume",
                "old",
                "--fork-session",
                "--permission-mode",
                "acceptEdits",
                "--model",
                "m",
                "--provider",
                "p",
                "--trace-id",
                "tr-1",
            ],
        )
        self.assertNotIn("--session", build_agent_args(options))

    def test_build_spawn_command_wraps_scripts_and_windows_shims(self) -> None:
        command, args = build_spawn_command("fake.py", ["agent"], platform="linux")
        self.assertEqual(command, sys.executable)
        self.assertEqual(args, ["fake.py", "agent"])
        command, args = build_spawn_command("cc", ["agent"], platform="win32")
        self.assertEqual(command, "cmd.exe")
        self.assertEqual(args, ["/d", "/s", "/c", "cc", "agent"])


class AgentSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_subprocess_callbacks_unknown_passthrough_and_final_flush(
        self,
    ) -> None:
        callback_events = []
        errors = []
        stderr = []

        async def question(_event):
            raise RuntimeError("headless question callback failed")

        session = AgentSession(
            AgentSessionOptions(
                cli_path=str(FAKE_CLI),
                session_id="declared-session",
                permission_mode="acceptEdits",
            ),
            on_event=callback_events.append,
            on_approval=lambda _event: True,
            on_question=question,
            on_elicitation=lambda _event: ElicitationResponse(
                "accept", {"channel": "stable"}
            ),
            on_error=errors.append,
            on_stderr=stderr.append,
        )
        await session.start()
        await session.send("run tests", images=("shot.png",))

        iterated = [event async for event in session]
        code = await session.wait()
        self.assertEqual(code, 0)
        self.assertEqual(iterated, callback_events)
        self.assertEqual(session.session_id, "fake-session")
        self.assertIn("fake stderr trace", "".join(stderr))
        self.assertTrue(
            any("question callback failed" in str(error) for error in errors)
        )

        unknown = next(
            event for event in iterated if isinstance(event, UnknownAgentEvent)
        )
        self.assertEqual(
            unknown.to_dict(),
            {
                "type": "future_agent_event",
                "payload": {"kept": True},
                "seq": 2,
            },
        )

        init = next(event for event in iterated if isinstance(event, SystemInitEvent))
        self.assertEqual(init.raw["interactive_questions"], "1")
        self.assertIn("--interactive-approvals", init.raw["argv"])
        self.assertIn("--session", init.raw["argv"])
        self.assertIn("declared-session", init.raw["argv"])

        result = next(event for event in iterated if isinstance(event, ResultEvent))
        responses = json.loads(result.result)
        self.assertEqual(
            responses,
            [
                {"type": "user", "text": "run tests", "images": ["shot.png"]},
                {"type": "approval", "id": "approval-1", "approve": True},
                {"type": "answer", "id": "question-1", "answer": None},
                {
                    "type": "answer",
                    "id": "mcp-1",
                    "answer": {"channel": "stable"},
                },
            ],
        )

    async def test_approval_callback_failure_denies_and_elicitation_declines(
        self,
    ) -> None:
        async def approval(_event):
            raise RuntimeError("approval UI failed")

        session = AgentSession(
            AgentSessionOptions(cli_path=str(FAKE_CLI)),
            on_approval=approval,
            on_question=lambda _event: "a",
            on_elicitation=lambda _event: ElicitationResponse("decline"),
        )
        await session.start()
        pending = asyncio.create_task(session.next_result())
        await session.send("run")
        result = await pending
        await session.wait()
        responses = json.loads(result.result)
        self.assertEqual(
            responses[1],
            {"type": "approval", "id": "approval-1", "approve": False},
        )
        self.assertEqual(
            responses[2],
            {"type": "answer", "id": "question-1", "answer": "a"},
        )
        self.assertEqual(
            responses[3],
            {"type": "answer", "id": "mcp-1", "answer": None},
        )

    async def test_next_result_rejects_when_process_exits_first(self) -> None:
        session = AgentSession(
            AgentSessionOptions(
                cli_path=str(FAKE_CLI),
                extra_args=("--fake-exit-no-result",),
            )
        )
        await session.start()
        with self.assertRaises(SessionExitedError) as caught:
            await session.next_result()
        self.assertEqual(caught.exception.exit_code, 3)
        self.assertIn("fake stderr trace", caught.exception.stderr_tail)


if __name__ == "__main__":
    unittest.main()
