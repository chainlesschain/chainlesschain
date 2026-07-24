# ChainlessChain Agent SDK for Python

`chainlesschain-agent-sdk` is the zero-runtime-dependency Python client for
the same Agent Protocol v1 used by `@chainlesschain/agent-sdk`. It starts one
`cc agent` subprocess, frames its NDJSON stream safely, exposes frozen typed
events, and performs approval, question, and MCP elicitation round trips.

Python 3.10 or newer is required.

## Basic session

```python
import asyncio

from chainlesschain_agent_sdk import (
    AgentSession,
    AgentSessionOptions,
    ElicitationResponse,
    ResultEvent,
    UnknownAgentEvent,
)


async def main() -> None:
    session = AgentSession(
        AgentSessionOptions(
            cwd=".",
            session_id="ci-fix-1042",  # declare new sessions that must be resumable
            permission_mode="acceptEdits",
        ),
        on_approval=lambda request: request.tool == "run_shell",
        on_question=lambda request: None,  # cancel in non-interactive hosts
        on_elicitation=lambda request: ElicitationResponse("decline"),
    )
    await session.start()
    await session.send("Run the focused tests and fix failures.")

    async for event in session:
        # Every wire object is yielded. A newer CLI type is never discarded.
        if isinstance(event, UnknownAgentEvent):
            print("unknown event preserved:", event.to_dict())
        elif isinstance(event, ResultEvent):
            print(event.subtype, event.result)
            await session.end()

    await session.wait()


asyncio.run(main())
```

`SystemInitEvent.session_id` is the authoritative live ID. Persist it and
resume later with `AgentSessionOptions(resume=that_id)`. Anonymous stream
sessions are not persisted by CLI design; use `session_id` when creating a
session that must be resumable. `resume` takes precedence over `session_id`,
matching the TypeScript SDK.

## Event and callback guarantees

- The 22 classes in `KNOWN_EVENT_CLASSES` mirror the TypeScript
  `AgentStreamEvent` union. Nested token usage, deltas, questions, and plan
  records are dataclasses too.
- Every event retains its original object in the read-only `raw` mapping;
  `to_dict()` returns a deep mutable copy, including unknown additive fields.
- Unknown outer `type` values are delivered as `UnknownAgentEvent` through
  both `on_event` and async iteration.
- NDJSON decoding carries split lines and split UTF-8 code points across
  chunks, accepts CRLF, and flushes a final line without a newline.
- Approval callback errors answer `approve:false` (fail closed). Question
  callback errors answer `null`. MCP elicitation accepts only an explicit
  `ElicitationResponse("accept", content)` (or equivalent mapping); all other
  outcomes cancel.
- `stderr` is diagnostics only. It is available through `on_stderr` and is
  never parsed as protocol data.

Callbacks may be synchronous functions or coroutines. Keep them bounded:
the CLI also applies its own interaction timeouts.

## CI consumer

[`examples/ci_gate.py`](examples/ci_gate.py) is an executable consumer with an
explicit handler for every current event class. It journals every raw event
_before_ dispatch and preserves unknown events in the same artifact:

```bash
python examples/ci_gate.py \
  --prompt "Run unit tests and fix only the failing implementation" \
  --provider openai \
  --session-id "ci-${GITHUB_RUN_ID}" \
  --output agent-events.ndjson
```

The script denies approvals unless a tool is explicitly repeated with
`--approve-tool`. [`examples/github-actions.yml`](examples/github-actions.yml)
is a manual-dispatch GitHub Actions template with read-only repository
permissions and a short-lived event artifact. Raw events can contain prompts,
tool output, and model responses, so do not publish that artifact publicly.

The same script has a hermetic replay mode used by this repository's CI:

```bash
python examples/ci_gate.py \
  --replay ../agent-sdk/__fixtures__/protocol/*.ndjson \
  --output protocol-events.ndjson
```

## Conformance and tests

Python tests read the canonical fixtures in
`packages/agent-sdk/__fixtures__/protocol/` directly; there is no copied Python
fixture set to drift from TypeScript and Java consumers.

```bash
cd packages/agent-sdk-python
PYTHONPATH=src python -m unittest discover -s tests -v
```

The language-neutral contract remains
[`packages/agent-sdk/docs/PROTOCOL.md`](../agent-sdk/docs/PROTOCOL.md).
