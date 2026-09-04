# ChainlessChain Agent SDK for Python

[![PyPI version](https://img.shields.io/pypi/v/chainlesschain-agent-sdk.svg)](https://pypi.org/project/chainlesschain-agent-sdk/)
[![Python versions](https://img.shields.io/pypi/pyversions/chainlesschain-agent-sdk.svg)](https://pypi.org/project/chainlesschain-agent-sdk/)

`chainlesschain-agent-sdk` is the zero-runtime-dependency Python client for
the same Agent Protocol v1 used by `@chainlesschain/agent-sdk`. It starts one
`cc agent` subprocess, frames its NDJSON stream safely, exposes frozen typed
events, and performs approval, question, and MCP elicitation round trips.

Version `0.2.8` is the current release candidate for
[PyPI](https://pypi.org/project/chainlesschain-agent-sdk/). Python 3.10 or
newer is required. It adds the bounded App Server pilot client and generated
Context/Memory protocol validators while preserving lossless unknown-event
delivery and the zero-runtime-dependency package boundary.

## Install

Install the SDK and a compatible `cc` CLI:

```bash
python -m pip install "chainlesschain-agent-sdk==0.2.8"
npm install --global "chainlesschain@0.166.12"
```

The Python distribution has no runtime dependencies. The CLI is installed
separately because `AgentSession` controls it as a subprocess:

```bash
python -c "import chainlesschain_agent_sdk as sdk; print(sdk.__version__)"
cc --version
```

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
        on_approval=lambda request: (
            {"kind": "acceptOnce"}
            if request.tool == "run_shell"
            else {"kind": "decline", "reason": "Tool is not allow-listed"}
        ),
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

Approval callbacks may still return booleans for source compatibility. Direct
`respond_approval(id, bool)` calls retain the legacy boolean wire; structured
decisions echo the request binding and can express scoped turn/session grants.

`SystemInitEvent.session_id` is the authoritative live ID. Persist it and
resume later with `AgentSessionOptions(resume=that_id)`. Anonymous stream
sessions are not persisted by CLI design; use `session_id` when creating a
session that must be resumable. `resume` takes precedence over `session_id`,
matching the TypeScript SDK.

## App Server physical storage

The bounded App Server client can select JSONL or SQLite without changing its
fixed RPC capabilities:

```python
from chainlesschain_agent_sdk import AppServerClientOptions, AppServerPilotClient

pilot = AppServerPilotClient(
    AppServerClientOptions(
        storage_backend="sqlite",
        state_path="/var/lib/cc/rollouts.sqlite",
    )
)
```

`state_directory` and `state_path` are mutually exclusive. JSONL remains the
default, and the storage choice does not alter Thread/Turn/Item messages.

## Event and callback guarantees

- The generated `AgentStreamEventPayload` is the authoritative closed wire
  union. `KNOWN_EVENT_CLASSES` is discovered from the open runtime class
  hierarchy and exists only for ergonomic dataclass dispatch; it no longer
  mirrors or redefines the schema discriminator inventory.
- Every event retains its original object in the read-only `raw` mapping;
  `to_dict()` returns a deep mutable copy, including unknown additive fields.
- Unknown outer `type` values are delivered as `UnknownAgentEvent` through
  both `on_event` and async iteration.
- `CC_AGENT_STREAM_EVENT_TYPES` and `validate_agent_stream_event` expose the
  canonical known discriminator inventory without changing that lossless
  unknown-event behavior.
- `AgentStreamEventPayload`, `CanonicalAgentStreamEvent`, and
  `validate_canonical_agent_stream_event` expose the generated strict contract
  for hosts that must reject a malformed payload with a known discriminator.
- NDJSON decoding carries split lines and split UTF-8 code points across
  chunks, accepts CRLF, and flushes a final line without a newline.
- Approval callback errors answer `approve:false` (fail closed). Question
  callbacks automatically echo the opaque runtime `binding` on both normal
  and `null` answers, so stale/cross-turn answers remain fail closed. MCP
  elicitation accepts only an explicit
  `ElicitationResponse("accept", content)` (or equivalent mapping); all other
  outcomes cancel. URL requests expose `metadata.url` / `metadata.url_host`;
  the host must show the full HTTPS URL and obtain explicit consent before
  opening it. URL completion and non-interactive fallback arrive as typed
  `ElicitationCompleteEvent` / `ElicitationDeferredEvent` objects.
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
[`packages/agent-sdk/docs/PROTOCOL.md`](https://github.com/chainlesschain/chainlesschain/blob/main/packages/agent-sdk/docs/PROTOCOL.md).
