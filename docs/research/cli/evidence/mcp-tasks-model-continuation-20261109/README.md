# Durable MCP model continuation — 2026-11-09

Core implementation: `29243cd1b8c7c45e58abaa3c8b78976e102d90d6`. A subsequent queue guard uses a private Symbol and defers auto-wake while a user draft/multiline input is pending. The final candidate is bound by source digests in the receipt; these are not a multi-OS release gate.

- [receipt.json](receipt.json): final Windows synthetic journey and source/artifact bindings.
- [synthetic.json](synthetic.json): three separate-process scenarios using the unmodified official Everything 2.2.1 server, production REPL/readline, real Windows DPAPI, canonical delivery and model-call ledger. The model is a loopback substitute, not a real provider.
- [regression-tests.xml](regression-tests.xml): **755/755 in 46 files**, including legacy transports/configuration, canonical session/continuation checks and REPL recovery. Counts overlap earlier subset runs.
- [session-regression-tests.xml](session-regression-tests.xml): **72/72 in 8 files** for session host contracts, input durability, pagination/history, export and egress inventory/closure. Host contracts do not replace real IDE journeys.
- [openai-http429.json](openai-http429.json): one actual OpenAI Responses request using the existing configured gpt-6.1-sol connection. HTTP 429, no valid usage or answer, no retry. Its source is the core commit above, independently verified against that commit.

The successful synthetic journey has one real user request, one external reference and one model substitute answer. Restart does not dispatch another model request. Killing before physical model dispatch or after its response but before publication leaves `started`, with no invented user/answer or automatic replay. The canonical start/settlement binds the original delivery event and message digest. A single assistant event publishes the answer and its consumption binding; transcript verification rejects orphan, duplicate, foreign or false-source markers. Reference/answer adjacency survives resume only with commitments from the same verified transcript.

The real-provider attempt proves the admitted outgoing context and conservative failure handling. It does **not** prove successful real-model consumption. Independent readback confirms one unknown model call, a started continuation, one real user message, one external reference and zero model answers. HTTP 429 is not a billing receipt; unknown usage/cost is not converted to zero. The 256 output parameter and $0.05 public-price estimate stop are not a verified financial ceiling. `billingVerified:false`, `outputUpperBoundVerified:false`, `paidReady:false`.

Earlier Volcengine configuration and probe-format preflights stopped before provider dispatch. They are not extra live model attempts. No 45-task campaign was rerun. The successful protocol probe was not substituted for the failed real-provider result.

Reproduce the synthetic acceptance from the repository root after the isolated reference installation described in [the reference acceptance](../mcp-tasks-reference-stateless-20261109/README.md):

```powershell
node packages/cli/scripts/probe-mcp-task-model-continuation.mjs .tmp/mcp-everything-2.2.1 .tmp/new-mcp-continuation-evidence
```

The optional `--confirm-live` mode uses the currently configured official OpenAI or Volcengine endpoint and allows one model request. The observed live failure is retained; do not automatically repeat it to improve a pass count. The script never overwrites an evidence directory, installs packages, changes provider configuration or archives keys, raw requests/results or vaults. Private failure diagnostics in `.tmp` are excluded here. Public server identity is byte-matched with all 59 files in [the original package verification](../mcp-tasks-reference-stateless-20261109/reference-package.json).

The terminal uses stdin TTY emulation to select the actual readline path. No OS PTY, real screen reader, dual-IDE/desktop, external production service, actual server expiry/revocation, modern input-required continuation, Linux/macOS secret store or rollback acceptance is claimed. Real-model successful continuation remains open. [Implementation](../../../cli-ide/implementation/cli-ide-mcp-continuation-authority-progress-2026-11-09.md); [PR #571](https://github.com/chainlesschain/chainlesschain/pull/571).
