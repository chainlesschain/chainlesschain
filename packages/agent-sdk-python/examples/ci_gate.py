#!/usr/bin/env python3
"""CI-safe Agent SDK consumer with exhaustive, lossless event handling."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional, Sequence, TextIO, Type

from chainlesschain_agent_sdk import (
    KNOWN_EVENT_CLASSES,
    AgentEvent,
    AgentSession,
    AgentSessionOptions,
    ApprovalRequestEvent,
    ApprovalResolvedEvent,
    CompactionEvent,
    ContentDeltaEvent,
    ElicitationResponse,
    FeedbackAckEvent,
    IterationBudgetExhaustedEvent,
    IterationWarningEvent,
    NdjsonDecoder,
    NegotiatedCapabilitiesEvent,
    PlanUpdateEvent,
    QuestionRequestEvent,
    QuestionResolvedEvent,
    RawEvent,
    ResultEvent,
    ResumeAckEvent,
    SlashCommandResultEvent,
    StreamRetryEvent,
    SystemEndEvent,
    SystemInitEvent,
    TokenUsageEvent,
    ToolResultEvent,
    ToolUseEvent,
    UnknownAgentEvent,
    UserEchoEvent,
    parse_event,
)


class CiEventConsumer:
    """Append every event to a journal, then run an exhaustive typed handler."""

    def __init__(self, journal: TextIO, *, console: TextIO = sys.stdout) -> None:
        self.journal = journal
        self.console = console
        self.total = 0
        self.unknown = 0
        self.last_result: Optional[ResultEvent] = None

    def consume(self, event: AgentEvent) -> None:
        # Journal first. Even if a newly added SDK class lacks a handler, its
        # wire object is already preserved and the CI job fails loudly.
        self.journal.write(
            json.dumps(event.to_dict(), ensure_ascii=False, separators=(",", ":"))
            + "\n"
        )
        self.journal.flush()
        self.total += 1

        handler = EVENT_HANDLERS.get(type(event))
        if handler is None:
            raise RuntimeError(
                f"no CI handler for SDK event class {type(event).__name__}"
            )
        handler(self, event)

    def log(self, text: str) -> None:
        print(text, file=self.console, flush=True)


Handler = Callable[[CiEventConsumer, Any], None]


def _system_init(consumer: CiEventConsumer, event: SystemInitEvent) -> None:
    consumer.log(
        f"[agent:init] session={event.session_id} "
        f"provider={event.provider or '-'} model={event.model or '-'}"
    )


def _system_end(consumer: CiEventConsumer, event: SystemEndEvent) -> None:
    consumer.log(f"[agent:end] turns={event.turns if event.turns is not None else '-'}")


def _negotiated(consumer: CiEventConsumer, event: NegotiatedCapabilitiesEvent) -> None:
    consumer.log(
        f"[agent:protocol] ok={event.ok} version={event.protocol_version} "
        f"features={','.join(event.features)}"
    )


def _content_delta(consumer: CiEventConsumer, event: ContentDeltaEvent) -> None:
    if event.text_delta is not None:
        consumer.log(f"[agent:text] {event.text_delta}")
    elif event.thinking_delta is not None:
        consumer.log("[agent:thinking] delta received")
    else:
        consumer.log("[agent:stream] additive content event preserved")


def _tool_use(consumer: CiEventConsumer, event: ToolUseEvent) -> None:
    consumer.log(f"[agent:tool] start {event.tool} id={event.id or '-'}")


def _tool_result(consumer: CiEventConsumer, event: ToolResultEvent) -> None:
    consumer.log(
        f"[agent:tool] end {event.tool} id={event.id or '-'} "
        f"error={event.is_error is True}"
    )


def _usage(consumer: CiEventConsumer, event: TokenUsageEvent) -> None:
    output = event.usage.output_tokens if event.usage is not None else None
    consumer.log(f"[agent:usage] output_tokens={output if output is not None else '-'}")


def _approval_request(consumer: CiEventConsumer, event: ApprovalRequestEvent) -> None:
    consumer.log(f"[agent:approval] requested id={event.id} tool={event.tool or '-'}")


def _approval_resolved(consumer: CiEventConsumer, event: ApprovalResolvedEvent) -> None:
    consumer.log(
        f"[agent:approval] resolved id={event.id} approved={event.approved} "
        f"via={event.via}"
    )


def _question_request(consumer: CiEventConsumer, event: QuestionRequestEvent) -> None:
    kind = "mcp-elicitation" if event.is_mcp_elicitation else "question"
    consumer.log(f"[agent:{kind}] requested id={event.id}")


def _question_resolved(consumer: CiEventConsumer, event: QuestionResolvedEvent) -> None:
    consumer.log(f"[agent:question] resolved id={event.id} via={event.via or '-'}")


def _plan(consumer: CiEventConsumer, event: PlanUpdateEvent) -> None:
    consumer.log(
        f"[agent:plan] active={event.active} state={event.state or '-'} "
        f"items={len(event.items)}"
    )


def _compaction(consumer: CiEventConsumer, event: CompactionEvent) -> None:
    consumer.log("[agent:compaction] event preserved")


def _retry(consumer: CiEventConsumer, event: StreamRetryEvent) -> None:
    consumer.log(
        f"[agent:retry] attempt={event.attempt if event.attempt is not None else '-'} "
        f"{event.message or ''}".rstrip()
    )


def _iteration_warning(consumer: CiEventConsumer, event: IterationWarningEvent) -> None:
    consumer.log(f"[agent:warning] {event.message or 'iteration limit approaching'}")


def _iteration_exhausted(
    consumer: CiEventConsumer, event: IterationBudgetExhaustedEvent
) -> None:
    consumer.log(
        f"[agent:budget] exhausted={event.budget if event.budget is not None else '-'}"
    )


def _raw(consumer: CiEventConsumer, event: RawEvent) -> None:
    consumer.log(
        f"[agent:raw] subtype={event.subtype or '-'} {event.text or ''}".rstrip()
    )


def _result(consumer: CiEventConsumer, event: ResultEvent) -> None:
    consumer.last_result = event
    consumer.log(f"[agent:result] subtype={event.subtype} error={event.is_error}")


def _user_echo(consumer: CiEventConsumer, event: UserEchoEvent) -> None:
    consumer.log("[agent:user] accepted input echoed")


def _feedback_ack(consumer: CiEventConsumer, event: FeedbackAckEvent) -> None:
    consumer.log("[agent:feedback] acknowledged")


def _resume_ack(consumer: CiEventConsumer, event: ResumeAckEvent) -> None:
    consumer.log("[agent:assist-resume] acknowledged")


def _slash_result(consumer: CiEventConsumer, event: SlashCommandResultEvent) -> None:
    consumer.log(
        f"[agent:slash] request={event.request_id} command={event.command} ok={event.ok}"
    )


def _unknown(consumer: CiEventConsumer, event: UnknownAgentEvent) -> None:
    consumer.unknown += 1
    consumer.log(
        f"[agent:unknown] type={event.event_type} preserved in the event journal"
    )


# One explicit entry for every class in the TypeScript AgentStreamEvent union,
# plus the mandatory forward-compatible unknown wrapper.
EVENT_HANDLERS: Dict[Type[AgentEvent], Handler] = {
    SystemInitEvent: _system_init,
    SystemEndEvent: _system_end,
    NegotiatedCapabilitiesEvent: _negotiated,
    ContentDeltaEvent: _content_delta,
    ToolUseEvent: _tool_use,
    ToolResultEvent: _tool_result,
    TokenUsageEvent: _usage,
    ApprovalRequestEvent: _approval_request,
    ApprovalResolvedEvent: _approval_resolved,
    QuestionRequestEvent: _question_request,
    QuestionResolvedEvent: _question_resolved,
    PlanUpdateEvent: _plan,
    CompactionEvent: _compaction,
    StreamRetryEvent: _retry,
    IterationWarningEvent: _iteration_warning,
    IterationBudgetExhaustedEvent: _iteration_exhausted,
    RawEvent: _raw,
    ResultEvent: _result,
    UserEchoEvent: _user_echo,
    FeedbackAckEvent: _feedback_ack,
    ResumeAckEvent: _resume_ack,
    SlashCommandResultEvent: _slash_result,
    UnknownAgentEvent: _unknown,
}
HANDLED_EVENT_CLASSES = frozenset(EVENT_HANDLERS)


def assert_exhaustive_handlers() -> None:
    expected = frozenset(KNOWN_EVENT_CLASSES) | {UnknownAgentEvent}
    if HANDLED_EVENT_CLASSES != expected:
        missing = sorted(cls.__name__ for cls in expected - HANDLED_EVENT_CLASSES)
        stale = sorted(cls.__name__ for cls in HANDLED_EVENT_CLASSES - expected)
        raise RuntimeError(
            f"CI event handlers drifted; missing={missing}, stale={stale}"
        )


def replay_files(paths: Iterable[Path], consumer: CiEventConsumer) -> None:
    for path in paths:
        decoder = NdjsonDecoder()
        with path.open("rb") as stream:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                for value in decoder.feed(chunk):
                    consumer.consume(parse_event(value))
        for value in decoder.flush():
            consumer.consume(parse_event(value))


async def run_live(args: argparse.Namespace, consumer: CiEventConsumer) -> int:
    approved_tools = frozenset(args.approve_tool)

    async def approve(event: ApprovalRequestEvent) -> bool:
        return event.tool is not None and event.tool in approved_tools

    def report_error(error: BaseException) -> None:
        print(f"[agent:sdk-error] {error}", file=sys.stderr, flush=True)

    session = AgentSession(
        AgentSessionOptions(
            cli_path=args.cli,
            cwd=args.cwd,
            resume=args.resume,
            session_id=args.session_id,
            permission_mode=args.permission_mode,
            model=args.model,
            provider=args.provider,
        ),
        on_approval=approve,
        on_question=lambda _event: None,
        on_elicitation=lambda _event: ElicitationResponse("decline"),
        on_error=report_error,
        on_stderr=lambda text: print(text, end="", file=sys.stderr, flush=True),
    )
    await session.start()
    try:
        await session.send(args.prompt)

        async def consume_until_exit() -> None:
            async for event in session:
                consumer.consume(event)
                if isinstance(event, ResultEvent):
                    await session.end()

        await asyncio.wait_for(consume_until_exit(), timeout=args.timeout)
        code = await session.wait(timeout=10)
    except asyncio.TimeoutError:
        print("[agent:timeout] killing the agent process", file=sys.stderr)
        await session.kill()
        await session.wait()
        return 124
    finally:
        if session.running:
            await session.kill()
            await session.wait()

    if consumer.last_result is None:
        print(
            f"[agent:error] process exited with {code} before a result",
            file=sys.stderr,
        )
        return code if code != 0 else 2
    return 1 if consumer.last_result.is_error else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prompt", help="live agent prompt")
    mode.add_argument(
        "--replay",
        nargs="+",
        type=Path,
        help="replay one or more canonical NDJSON fixtures",
    )
    parser.add_argument("--output", type=Path, default=Path("agent-events.ndjson"))
    parser.add_argument("--cli", default="cc", help="cc binary or CLI .js path")
    parser.add_argument("--cwd", default=".")
    parser.add_argument("--resume")
    parser.add_argument("--session-id")
    parser.add_argument(
        "--permission-mode",
        default="default",
        choices=("default", "plan", "acceptEdits", "bypassPermissions", "auto"),
    )
    parser.add_argument("--model")
    parser.add_argument("--provider")
    parser.add_argument(
        "--approve-tool",
        action="append",
        default=[],
        help="exact tool name allowed in CI; repeat as needed (default: deny all)",
    )
    parser.add_argument("--timeout", type=float, default=1200.0)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    assert_exhaustive_handlers()
    args = build_parser().parse_args(argv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as journal:
        consumer = CiEventConsumer(journal)
        if args.replay:
            replay_files(args.replay, consumer)
            consumer.log(
                f"[agent:replay] events={consumer.total} unknown={consumer.unknown} "
                f"journal={args.output}"
            )
            return 0
        return asyncio.run(run_live(args, consumer))


if __name__ == "__main__":
    raise SystemExit(main())
