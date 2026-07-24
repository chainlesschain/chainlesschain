"""Typed ChainlessChain Agent Protocol v1 events.

The wire contract is shared with ``packages/agent-sdk/src/protocol.ts``.
Parsing is intentionally forward compatible:

* known outer event shapes become frozen dataclasses;
* additive/unknown fields remain available through ``event.raw`` and
  ``event.to_dict()``;
* unknown event types become :class:`UnknownAgentEvent` instead of being
  discarded.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple, Type, Union

PROTOCOL_VERSION = 1
MIN_PROTOCOL_VERSION = 1
PROTOCOL_FEATURES: Tuple[str, ...] = ("event_seq", "tool_use_id", "trace_id")

JsonObject = Dict[str, Any]


class ProtocolDecodeError(ValueError):
    """Raised when a JSON value is not an agent protocol event."""


def _as_string(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _as_bool(value: Any) -> Optional[bool]:
    return value if isinstance(value, bool) else None


def _as_int(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _as_mapping(value: Any) -> Optional[Mapping[str, Any]]:
    return value if isinstance(value, Mapping) else None


def _string_tuple(value: Any) -> Tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return ()
    return tuple(item for item in value if isinstance(item, str))


def _sequence_tuple(value: Any) -> Tuple[Any, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return ()
    return tuple(value)


def _freeze_raw(value: Mapping[str, Any]) -> Mapping[str, Any]:
    # Freeze recursively: a top-level proxy alone would still let a caller
    # mutate nested payload lists/dicts through event.raw.
    return MappingProxyType(
        {str(key): _freeze_value(item) for key, item in value.items()}
    )


def _freeze_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {str(key): _freeze_value(item) for key, item in value.items()}
        )
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return tuple(_freeze_value(item) for item in value)
    return copy.deepcopy(value)


def _thaw_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _thaw_value(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw_value(item) for item in value]
    return copy.deepcopy(value)


@dataclass(frozen=True, kw_only=True)
class AgentEvent:
    """Base class for every CLI → client stream event."""

    raw: Mapping[str, Any] = field(repr=False, compare=False)
    seq: Optional[int] = None
    trace_id: Optional[str] = None

    @property
    def type(self) -> str:
        value = self.raw.get("type")
        return value if isinstance(value, str) else ""

    def to_dict(self) -> JsonObject:
        """Return a mutable deep copy of the original wire object."""

        return _thaw_value(self.raw)


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cache_read_input_tokens: Optional[int] = None
    cache_creation_input_tokens: Optional[int] = None


@dataclass(frozen=True, kw_only=True)
class SystemInitEvent(AgentEvent):
    session_id: str
    subtype: str = "init"
    model: Optional[str] = None
    provider: Optional[str] = None
    permission_mode: Optional[str] = None
    tools: Tuple[str, ...] = ()
    slash_commands: Tuple[str, ...] = ()
    input_format: Optional[str] = None
    additional_directories: Tuple[str, ...] = ()
    resumed_messages: Optional[int] = None


@dataclass(frozen=True, kw_only=True)
class SystemEndEvent(AgentEvent):
    subtype: str = "end"
    turns: Optional[int] = None


@dataclass(frozen=True, kw_only=True)
class NegotiatedCapabilitiesEvent(AgentEvent):
    session_id: str
    protocol_version: Optional[int]
    features: Tuple[str, ...]
    downgraded: bool
    ok: bool
    subtype: str = "negotiated"
    disabled_features: Tuple[str, ...] = ()
    reason: Optional[str] = None


@dataclass(frozen=True)
class TextDelta:
    text: str
    type: str = "text_delta"


@dataclass(frozen=True)
class ThinkingDelta:
    thinking: str
    type: str = "thinking_delta"


@dataclass(frozen=True)
class UnknownContentDelta:
    """An additive content delta that this SDK version does not understand."""

    delta_type: str
    raw: Mapping[str, Any] = field(repr=False, compare=False)


ContentDelta = Union[TextDelta, ThinkingDelta, UnknownContentDelta]


@dataclass(frozen=True, kw_only=True)
class ContentDeltaEvent(AgentEvent):
    delta: Optional[ContentDelta] = None
    content_event_type: Optional[str] = None

    @property
    def text_delta(self) -> Optional[str]:
        return self.delta.text if isinstance(self.delta, TextDelta) else None

    @property
    def thinking_delta(self) -> Optional[str]:
        return self.delta.thinking if isinstance(self.delta, ThinkingDelta) else None


@dataclass(frozen=True, kw_only=True)
class ToolUseEvent(AgentEvent):
    tool: str
    id: Optional[str] = None
    plan_item_id: Optional[str] = None
    turn: Optional[int] = None
    args: Optional[Mapping[str, Any]] = None


@dataclass(frozen=True, kw_only=True)
class ToolResultEvent(AgentEvent):
    tool: str
    id: Optional[str] = None
    plan_item_id: Optional[str] = None
    turn: Optional[int] = None
    is_error: Optional[bool] = None
    error: Optional[str] = None
    result: Any = None


@dataclass(frozen=True, kw_only=True)
class TokenUsageEvent(AgentEvent):
    # The CLI's compatibility fixtures intentionally include a missing-usage
    # case, so the runtime representation is tolerant even though the TS
    # compile-time interface marks this field required.
    usage: Optional[TokenUsage] = None


@dataclass(frozen=True, kw_only=True)
class ApprovalRequestEvent(AgentEvent):
    id: str
    session_id: Optional[str] = None
    tool: Optional[str] = None
    command: Optional[str] = None
    risk: Optional[str] = None
    rule: Optional[str] = None
    reason: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class ApprovalResolvedEvent(AgentEvent):
    id: str
    approved: bool
    via: str
    session_id: Optional[str] = None


@dataclass(frozen=True)
class QuestionMetadata:
    kind: Optional[str] = None
    server: Optional[str] = None
    request_id: Optional[Union[str, int]] = None
    requested_schema: Any = None
    raw: Mapping[str, Any] = field(
        default_factory=lambda: MappingProxyType({}),
        repr=False,
        compare=False,
    )


@dataclass(frozen=True, kw_only=True)
class QuestionRequestEvent(AgentEvent):
    id: str
    question: str
    options: Tuple[Any, ...] = ()
    has_options: bool = False
    multi_select: Optional[bool] = None
    session_id: Optional[str] = None
    metadata: Optional[QuestionMetadata] = None

    @property
    def is_mcp_elicitation(self) -> bool:
        return self.metadata is not None and self.metadata.kind == "mcp_elicitation"


@dataclass(frozen=True, kw_only=True)
class QuestionResolvedEvent(AgentEvent):
    id: str
    answer: Any = None
    via: Optional[str] = None
    session_id: Optional[str] = None


@dataclass(frozen=True)
class PlanItem:
    id: Optional[str] = None
    title: Optional[str] = None
    tool: Optional[str] = None
    impact: Optional[str] = None
    status: Optional[str] = None
    turn: Optional[int] = None
    tool_use_id: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


@dataclass(frozen=True)
class PlanRisk:
    level: Optional[str] = None
    total_score: Optional[float] = None


@dataclass(frozen=True)
class PlanExecutionLock:
    plan_id: str
    permission_mode: str
    approved_item_ids: Tuple[str, ...]
    allowed_tools: Tuple[str, ...]
    created_at: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class PlanUpdateEvent(AgentEvent):
    active: Optional[bool] = None
    state: Optional[str] = None
    plan_id: Optional[str] = None
    plan_version: Optional[int] = None
    previous_plan_id: Optional[str] = None
    items: Tuple[PlanItem, ...] = ()
    risk: Optional[PlanRisk] = None
    execution_lock: Optional[PlanExecutionLock] = None


@dataclass(frozen=True, kw_only=True)
class CompactionEvent(AgentEvent):
    stats: Optional[Mapping[str, Any]] = None


@dataclass(frozen=True, kw_only=True)
class StreamRetryEvent(AgentEvent):
    attempt: Optional[int] = None
    message: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class IterationWarningEvent(AgentEvent):
    message: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class IterationBudgetExhaustedEvent(AgentEvent):
    budget: Optional[int] = None


@dataclass(frozen=True, kw_only=True)
class RawEvent(AgentEvent):
    subtype: Optional[str] = None
    text: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class ResultEvent(AgentEvent):
    subtype: str
    is_error: bool
    result: Optional[str] = None
    error: Optional[str] = None
    session_id: Optional[str] = None
    num_turns: Optional[int] = None
    duration_ms: Optional[int] = None
    tool_calls: Optional[int] = None
    usage: Optional[TokenUsage] = None
    denials: Tuple[Any, ...] = ()
    turn: Optional[int] = None


@dataclass(frozen=True, kw_only=True)
class UserEchoEvent(AgentEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class FeedbackAckEvent(AgentEvent):
    pass


@dataclass(frozen=True, kw_only=True)
class ResumeAckEvent(AgentEvent):
    pass


@dataclass(frozen=True)
class SlashCommandError:
    code: str
    message: str


@dataclass(frozen=True, kw_only=True)
class SlashCommandResultEvent(AgentEvent):
    request_id: str
    command: str
    ok: bool
    text: Optional[str] = None
    error: Optional[SlashCommandError] = None
    session_id: Optional[str] = None


@dataclass(frozen=True, kw_only=True)
class UnknownAgentEvent(AgentEvent):
    """Forward-compatible wrapper that preserves an unrecognized event."""

    event_type: str


KnownAgentEvent = Union[
    SystemInitEvent,
    SystemEndEvent,
    NegotiatedCapabilitiesEvent,
    ContentDeltaEvent,
    ToolUseEvent,
    ToolResultEvent,
    TokenUsageEvent,
    ApprovalRequestEvent,
    ApprovalResolvedEvent,
    QuestionRequestEvent,
    QuestionResolvedEvent,
    PlanUpdateEvent,
    CompactionEvent,
    StreamRetryEvent,
    IterationWarningEvent,
    IterationBudgetExhaustedEvent,
    RawEvent,
    ResultEvent,
    UserEchoEvent,
    FeedbackAckEvent,
    ResumeAckEvent,
    SlashCommandResultEvent,
]
AgentStreamEvent = Union[KnownAgentEvent, UnknownAgentEvent]

# Public exhaustiveness inventory used by examples/CI consumers. Add a class
# here whenever the TypeScript AgentStreamEvent union gains a class.
KNOWN_EVENT_CLASSES: Tuple[Type[AgentEvent], ...] = (
    SystemInitEvent,
    SystemEndEvent,
    NegotiatedCapabilitiesEvent,
    ContentDeltaEvent,
    ToolUseEvent,
    ToolResultEvent,
    TokenUsageEvent,
    ApprovalRequestEvent,
    ApprovalResolvedEvent,
    QuestionRequestEvent,
    QuestionResolvedEvent,
    PlanUpdateEvent,
    CompactionEvent,
    StreamRetryEvent,
    IterationWarningEvent,
    IterationBudgetExhaustedEvent,
    RawEvent,
    ResultEvent,
    UserEchoEvent,
    FeedbackAckEvent,
    ResumeAckEvent,
    SlashCommandResultEvent,
)


def _common(raw: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "raw": raw,
        "seq": _as_int(raw.get("seq")),
        "trace_id": _as_string(raw.get("trace_id")),
    }


def _token_usage(value: Any) -> Optional[TokenUsage]:
    usage = _as_mapping(value)
    if usage is None:
        return None
    return TokenUsage(
        input_tokens=_as_int(usage.get("input_tokens")),
        output_tokens=_as_int(usage.get("output_tokens")),
        cache_read_input_tokens=_as_int(usage.get("cache_read_input_tokens")),
        cache_creation_input_tokens=_as_int(usage.get("cache_creation_input_tokens")),
    )


def _question_metadata(value: Any) -> Optional[QuestionMetadata]:
    metadata = _as_mapping(value)
    if metadata is None:
        return None
    request_id = metadata.get("requestId")
    if not isinstance(request_id, (str, int)) or isinstance(request_id, bool):
        request_id = None
    return QuestionMetadata(
        kind=_as_string(metadata.get("kind")),
        server=_as_string(metadata.get("server")),
        request_id=request_id,
        requested_schema=_thaw_value(metadata.get("requestedSchema")),
        raw=_freeze_raw(metadata),
    )


def _plan_item(value: Any) -> Optional[PlanItem]:
    item = _as_mapping(value)
    if item is None:
        return None
    return PlanItem(
        id=_as_string(item.get("id")),
        title=_as_string(item.get("title")),
        tool=_as_string(item.get("tool")),
        impact=_as_string(item.get("impact")),
        status=_as_string(item.get("status")),
        turn=_as_int(item.get("turn")),
        tool_use_id=_as_string(item.get("tool_use_id")),
        started_at=_as_string(item.get("started_at")),
        completed_at=_as_string(item.get("completed_at")),
        error=_as_string(item.get("error")),
    )


def _plan_lock(value: Any) -> Optional[PlanExecutionLock]:
    lock = _as_mapping(value)
    if lock is None:
        return None
    plan_id = _as_string(lock.get("planId"))
    permission_mode = _as_string(lock.get("permissionMode"))
    if plan_id is None or permission_mode is None:
        return None
    return PlanExecutionLock(
        plan_id=plan_id,
        permission_mode=permission_mode,
        approved_item_ids=_string_tuple(lock.get("approvedItemIds")),
        allowed_tools=_string_tuple(lock.get("allowedTools")),
        created_at=_as_string(lock.get("createdAt")),
    )


def _unknown(raw: Mapping[str, Any], event_type: str) -> UnknownAgentEvent:
    return UnknownAgentEvent(event_type=event_type, **_common(raw))


def parse_event(value: Mapping[str, Any]) -> AgentStreamEvent:
    """Parse one decoded JSON object into a typed protocol event.

    Unknown ``type`` values are successful parses represented by
    :class:`UnknownAgentEvent`. Only values that are not event objects at all
    raise :class:`ProtocolDecodeError`.
    """

    if not isinstance(value, Mapping):
        raise ProtocolDecodeError("agent event must be a JSON object")
    event_type = value.get("type")
    if not isinstance(event_type, str) or not event_type:
        raise ProtocolDecodeError("agent event requires a non-empty string 'type'")

    raw = _freeze_raw(value)
    common = _common(raw)

    if event_type == "system":
        subtype = _as_string(raw.get("subtype"))
        if subtype == "init":
            session_id = _as_string(raw.get("session_id"))
            if session_id is None:
                return _unknown(raw, event_type)
            return SystemInitEvent(
                session_id=session_id,
                model=_as_string(raw.get("model")),
                provider=_as_string(raw.get("provider")),
                permission_mode=_as_string(raw.get("permission_mode")),
                tools=_string_tuple(raw.get("tools")),
                slash_commands=_string_tuple(raw.get("slash_commands")),
                input_format=_as_string(raw.get("input_format")),
                additional_directories=_string_tuple(raw.get("additional_directories")),
                resumed_messages=_as_int(raw.get("resumed_messages")),
                **common,
            )
        if subtype == "end":
            return SystemEndEvent(turns=_as_int(raw.get("turns")), **common)
        if subtype == "negotiated":
            session_id = _as_string(raw.get("session_id"))
            downgraded = _as_bool(raw.get("downgraded"))
            ok = _as_bool(raw.get("ok"))
            if session_id is None or downgraded is None or ok is None:
                return _unknown(raw, event_type)
            protocol_version = raw.get("protocol_version")
            if protocol_version is not None:
                protocol_version = _as_int(protocol_version)
            return NegotiatedCapabilitiesEvent(
                session_id=session_id,
                protocol_version=protocol_version,
                features=_string_tuple(raw.get("features")),
                downgraded=downgraded,
                disabled_features=_string_tuple(raw.get("disabled_features")),
                ok=ok,
                reason=_as_string(raw.get("reason")),
                **common,
            )
        return _unknown(raw, event_type)

    if event_type == "stream_event":
        inner = _as_mapping(raw.get("event"))
        inner_type = _as_string(inner.get("type")) if inner is not None else None
        delta: Optional[ContentDelta] = None
        delta_raw = _as_mapping(inner.get("delta")) if inner is not None else None
        if delta_raw is not None:
            delta_type = _as_string(delta_raw.get("type")) or ""
            if delta_type == "text_delta" and isinstance(delta_raw.get("text"), str):
                delta = TextDelta(text=delta_raw["text"])
            elif delta_type == "thinking_delta" and isinstance(
                delta_raw.get("thinking"), str
            ):
                delta = ThinkingDelta(thinking=delta_raw["thinking"])
            else:
                delta = UnknownContentDelta(
                    delta_type=delta_type,
                    raw=_freeze_raw(delta_raw),
                )
        return ContentDeltaEvent(
            delta=delta,
            content_event_type=inner_type,
            **common,
        )

    if event_type == "tool_use":
        tool = _as_string(raw.get("tool"))
        if tool is None:
            return _unknown(raw, event_type)
        args = _as_mapping(raw.get("args"))
        return ToolUseEvent(
            tool=tool,
            id=_as_string(raw.get("id")),
            plan_item_id=_as_string(raw.get("plan_item_id")),
            turn=_as_int(raw.get("turn")),
            args=_freeze_raw(args) if args is not None else None,
            **common,
        )

    if event_type == "tool_result":
        tool = _as_string(raw.get("tool"))
        if tool is None:
            return _unknown(raw, event_type)
        return ToolResultEvent(
            tool=tool,
            id=_as_string(raw.get("id")),
            plan_item_id=_as_string(raw.get("plan_item_id")),
            turn=_as_int(raw.get("turn")),
            is_error=_as_bool(raw.get("is_error")),
            error=_as_string(raw.get("error")),
            result=_thaw_value(raw.get("result")),
            **common,
        )

    if event_type == "token_usage":
        return TokenUsageEvent(usage=_token_usage(raw.get("usage")), **common)

    if event_type == "approval_request":
        request_id = _as_string(raw.get("id"))
        if request_id is None:
            return _unknown(raw, event_type)
        return ApprovalRequestEvent(
            id=request_id,
            session_id=_as_string(raw.get("session_id")),
            tool=_as_string(raw.get("tool")),
            command=_as_string(raw.get("command")),
            risk=_as_string(raw.get("risk")),
            rule=_as_string(raw.get("rule")),
            reason=_as_string(raw.get("reason")),
            **common,
        )

    if event_type == "approval_resolved":
        request_id = _as_string(raw.get("id"))
        approved = _as_bool(raw.get("approved"))
        via = _as_string(raw.get("via"))
        if request_id is None or approved is None or via is None:
            return _unknown(raw, event_type)
        return ApprovalResolvedEvent(
            id=request_id,
            approved=approved,
            via=via,
            session_id=_as_string(raw.get("session_id")),
            **common,
        )

    if event_type == "question_request":
        request_id = _as_string(raw.get("id"))
        question = _as_string(raw.get("question"))
        if request_id is None or question is None:
            return _unknown(raw, event_type)
        return QuestionRequestEvent(
            id=request_id,
            question=question,
            options=_sequence_tuple(raw.get("options")),
            has_options=isinstance(raw.get("options"), Sequence)
            and not isinstance(raw.get("options"), (str, bytes, bytearray)),
            multi_select=_as_bool(raw.get("multiSelect")),
            session_id=_as_string(raw.get("session_id")),
            metadata=_question_metadata(raw.get("metadata")),
            **common,
        )

    if event_type == "question_resolved":
        request_id = _as_string(raw.get("id"))
        if request_id is None:
            return _unknown(raw, event_type)
        return QuestionResolvedEvent(
            id=request_id,
            answer=_thaw_value(raw.get("answer")),
            via=_as_string(raw.get("via")),
            session_id=_as_string(raw.get("session_id")),
            **common,
        )

    if event_type == "plan_update":
        items = tuple(
            item
            for item in (
                _plan_item(value) for value in _sequence_tuple(raw.get("items"))
            )
            if item is not None
        )
        risk_raw = _as_mapping(raw.get("risk"))
        risk = (
            PlanRisk(
                level=_as_string(risk_raw.get("level")),
                total_score=_as_number(risk_raw.get("totalScore")),
            )
            if risk_raw is not None
            else None
        )
        return PlanUpdateEvent(
            active=_as_bool(raw.get("active")),
            state=_as_string(raw.get("state")),
            plan_id=_as_string(raw.get("plan_id")),
            plan_version=_as_int(raw.get("plan_version")),
            previous_plan_id=_as_string(raw.get("previous_plan_id")),
            items=items,
            risk=risk,
            execution_lock=_plan_lock(raw.get("execution_lock")),
            **common,
        )

    if event_type == "compaction":
        stats = _as_mapping(raw.get("stats"))
        return CompactionEvent(
            stats=_freeze_raw(stats) if stats is not None else None,
            **common,
        )

    if event_type == "stream_retry":
        return StreamRetryEvent(
            attempt=_as_int(raw.get("attempt")),
            message=_as_string(raw.get("message")),
            **common,
        )

    if event_type == "iteration_warning":
        return IterationWarningEvent(
            message=_as_string(raw.get("message")),
            **common,
        )

    if event_type == "iteration_budget_exhausted":
        return IterationBudgetExhaustedEvent(
            budget=_as_int(raw.get("budget")),
            **common,
        )

    if event_type == "raw":
        return RawEvent(
            subtype=_as_string(raw.get("subtype")),
            text=_as_string(raw.get("text")),
            **common,
        )

    if event_type == "result":
        subtype = _as_string(raw.get("subtype"))
        is_error = _as_bool(raw.get("is_error"))
        if subtype is None or is_error is None:
            return _unknown(raw, event_type)
        return ResultEvent(
            subtype=subtype,
            is_error=is_error,
            result=_as_string(raw.get("result")),
            error=_as_string(raw.get("error")),
            session_id=_as_string(raw.get("session_id")),
            num_turns=_as_int(raw.get("num_turns")),
            duration_ms=_as_int(raw.get("duration_ms")),
            tool_calls=_as_int(raw.get("tool_calls")),
            usage=_token_usage(raw.get("usage")),
            denials=_sequence_tuple(raw.get("denials")),
            turn=_as_int(raw.get("turn")),
            **common,
        )

    if event_type == "user":
        return UserEchoEvent(**common)
    if event_type == "feedback_ack":
        return FeedbackAckEvent(**common)
    if event_type == "resume_ack":
        return ResumeAckEvent(**common)

    if event_type == "slash_command_result":
        request_id = _as_string(raw.get("request_id"))
        command = _as_string(raw.get("command"))
        ok = _as_bool(raw.get("ok"))
        if request_id is None or command is None or ok is None:
            return _unknown(raw, event_type)
        error_raw = _as_mapping(raw.get("error"))
        error: Optional[SlashCommandError] = None
        if error_raw is not None:
            code = _as_string(error_raw.get("code"))
            message = _as_string(error_raw.get("message"))
            if code is not None and message is not None:
                error = SlashCommandError(code=code, message=message)
        return SlashCommandResultEvent(
            request_id=request_id,
            command=command,
            ok=ok,
            text=_as_string(raw.get("text")),
            error=error,
            session_id=_as_string(raw.get("session_id")),
            **common,
        )

    return _unknown(raw, event_type)


def parse_event_json(line: str) -> AgentStreamEvent:
    """Decode and parse one complete JSON line."""

    try:
        value = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolDecodeError(f"invalid JSON event: {exc.msg}") from exc
    return parse_event(value)


def is_mcp_elicitation(event: AgentEvent) -> bool:
    return isinstance(event, QuestionRequestEvent) and event.is_mcp_elicitation
