# Protocol cross-language fixtures

Shared, platform-neutral fixtures that lock the **stream-json event → UI
message** mapping across the two IDE consumers of Agent Protocol v1:

- **TypeScript** — `packages/vscode-extension/src/chat/chat-events.js`
  (`mapAgentEvent`), asserted by
  `packages/agent-sdk/__tests__/protocol-fixtures.test.ts`.
- **Java** — `packages/jetbrains-plugin/.../ChatEvents.java`
  (`mapAgentEvent`), asserted by
  `packages/jetbrains-plugin/src/test/java/.../ProtocolFixturesTest.java`.

Both sides read **these same files directly** (never copied, never
per-side edited) and MUST produce byte-identical projections. A drift in
either panel's mapping fails one side's test loudly — the same twin-fixture
discipline as `packages/vscode-extension/src/__fixtures__/managed-cli/`.

The contract is the protocol document
(`packages/agent-sdk/docs/PROTOCOL.md`), not either SDK. When the protocol
changes, update a fixture + `expected.json` in the same commit and both
tests keep the two panels honest.

## Files

- `*.ndjson` — one JSON event object per line, exactly as the CLI emits on
  stdout (`cc agent --output-format stream-json`). Grouped by area:
  - `session-lifecycle.ndjson` — `system/init` (full + minimal) and every
    `result` subtype (`success` / `error` / `blocked` / `interrupted`),
    including error text-fallback ordering (`error` → `result` → literal
    `"turn failed"`), plus `system/end` (UI-silent).
  - `assistant-stream.ndjson` — partial-message `stream_event` text /
    thinking deltas, the `sawDelta` suppression of a repeated `result`
    text, then a delta-free `result` (state reset), then unknown
    `content_block_delta` sub-types (forward-compat, UI-silent).
  - `tools.ndjson` — `tool_use` / `tool_result` with and without the
    additive `id`, the benign `ask_user_question` degrade path
    (`user_not_reachable` / `user_timeout` → not a failure), 80-char
    argument-summary truncation, and an empty-summary tool.
  - `interaction.ndjson` — `approval_request` / `approval_resolved` and
    `question_request` / `question_resolved` (answered vs. timed-out).
  - `misc.ndjson` — `token_usage`, `plan_update`, `compaction`,
    `iteration_warning`, `iteration_budget_exhausted` (info line),
    `stream_retry` (info line — a reconnect loop must not look like a
    silent stall), `cost_budget_exhausted` (info line with the $ figures),
    budget-stop `result` subtypes (`error_max_turns` / `error_max_budget` —
    the stop REASON renders instead of repainting already-streamed text),
    `session_error`, `raw` (provider fallback), and several **UI-silent** /
    **unknown** forward-compat events (`user`, `feedback_ack`, `resume_ack`,
    and a fabricated `totally_new_event_v9`).
- `expected.json` — for each `*.ndjson` file, the ordered array of expected
  projections (one per non-blank line). `_doc` describes the state rule.

## Projection

`mapAgentEvent(evt, state)` returns a UI message map (or `null`). Because
some human-readable strings legitimately differ between the two panels (the
benign `tool_result` note wording), the tests compare a **stable
projection** of that map, not the whole map. The projection is:

| UI `kind`      | Projected keys |
| -------------- | -------------- |
| _null_ (silent/unknown) | `{ kind: null }` |
| `init`         | `kind, model, provider, sessionId` |
| `delta`        | `kind, text` |
| `thinking`     | `kind, text` |
| `tool`         | `kind, tool, summary` |
| `tool_done`    | `kind, tool, isError, hasNote` (`note != null`) |
| `turn_end`     | `kind, isError, text` (may be `null`), `hasUsage` (`usage != null`) |
| `approval`     | `kind, id, tool, command, risk, rule, reason` |
| `approval_done`| `kind, id, approved, via` |
| `question`     | `kind, id, question, multiSelect, hasOptions` (`options != null`) |
| `plan`         | `kind, active, state` |
| `usage`        | `kind` |
| `info`         | `kind, text` |
| `error`        | `kind, text` |

**Turn state.** Each `*.ndjson` file is processed with ONE fresh
`createTurnState()`, feeding events top-to-bottom. A text/thinking delta
sets `sawDelta`, so the following `result` in the same turn projects
`text: null` (the panels don't repeat streamed text); a `result` resets
`sawDelta`, so a later delta-free `result` projects its own text.

## Additive protocol-v1 fields

Some fixtures carry the additive `seq` (every line) and tool-call `id`
(`tool_use` / `tool_result`) fields introduced in protocol v1 (see
`docs/PROTOCOL.md` §1.2.1). They do **not** affect the UI projection —
they are correlation/ordering metadata a consumer MAY use — so the tests
that cover them assert on the raw events (CLI side), while these mapping
fixtures simply prove the panels ignore the extra fields gracefully.

## Updating

Do not edit an `*.ndjson` case without updating `expected.json` and
confirming BOTH `protocol-fixtures.test.ts` and `ProtocolFixturesTest`
pass. Adding a case = append to the `*.ndjson` file and to that file's
array in `expected.json` (same index/order).
