"""One valid wire sample for every typed output event class."""

EVENT_SAMPLES = (
    (
        "SystemInitEvent",
        {
            "type": "system",
            "subtype": "init",
            "session_id": "sess-1",
            "model": "m",
        },
    ),
    ("SystemEndEvent", {"type": "system", "subtype": "end", "turns": 2}),
    (
        "NegotiatedCapabilitiesEvent",
        {
            "type": "system",
            "subtype": "negotiated",
            "session_id": "sess-1",
            "protocol_version": 1,
            "features": ["event_seq"],
            "downgraded": True,
            "ok": True,
        },
    ),
    (
        "ContentDeltaEvent",
        {
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "hello"},
            },
        },
    ),
    ("ToolUseEvent", {"type": "tool_use", "tool": "read_file", "args": {}}),
    (
        "ToolResultEvent",
        {"type": "tool_result", "tool": "read_file", "is_error": False},
    ),
    (
        "TokenUsageEvent",
        {"type": "token_usage", "usage": {"input_tokens": 3}},
    ),
    (
        "ApprovalRequestEvent",
        {
            "type": "approval_request",
            "id": "a-1",
            "tool": None,
            "command": None,
            "risk": None,
            "rule": None,
            "reason": None,
        },
    ),
    (
        "ApprovalResolvedEvent",
        {
            "type": "approval_resolved",
            "id": "a-1",
            "approved": False,
            "via": "user",
        },
    ),
    (
        "QuestionRequestEvent",
        {"type": "question_request", "id": "q-1", "question": "Pick?"},
    ),
    (
        "QuestionResolvedEvent",
        {"type": "question_resolved", "id": "q-1", "answer": "a"},
    ),
    ("PlanUpdateEvent", {"type": "plan_update", "active": True}),
    ("CompactionEvent", {"type": "compaction", "stats": {"saved": 4}}),
    (
        "StreamRetryEvent",
        {"type": "stream_retry", "attempt": 2, "message": "retrying"},
    ),
    (
        "IterationWarningEvent",
        {"type": "iteration_warning", "message": "near limit"},
    ),
    (
        "IterationBudgetExhaustedEvent",
        {"type": "iteration_budget_exhausted", "budget": 50},
    ),
    ("RawEvent", {"type": "raw", "subtype": "provider_fallback", "text": "x"}),
    (
        "ResultEvent",
        {"type": "result", "subtype": "success", "is_error": False},
    ),
    ("UserEchoEvent", {"type": "user", "message": {"role": "user"}}),
    ("FeedbackAckEvent", {"type": "feedback_ack", "turn_id": "t-1"}),
    ("ResumeAckEvent", {"type": "resume_ack", "token": "r-1"}),
    (
        "SlashCommandResultEvent",
        {
            "type": "slash_command_result",
            "request_id": "sc-1",
            "command": "status",
            "ok": True,
        },
    ),
)
