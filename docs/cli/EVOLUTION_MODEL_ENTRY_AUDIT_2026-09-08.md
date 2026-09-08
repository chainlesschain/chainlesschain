# Direct model entry governance audit (2026-09-08)

The CLI stream command and the WebSocket QuickAsk/stream routes previously sent
input directly to provider adapters even when a host configured an evolution
composition factory. The deployment loader also excluded the stream command.

The three chat.intent routes had the same omission. They now pass the host
factory into intent understanding, streamed understanding and LLM-based followup
classification. Governed classification failures propagate instead of being
reported as rule fallback. Pure rule classification makes no model request.
Governed intent deadlines abort model transport and bound waits for authority;
unconfigured intent calls retain their existing fallback behavior. The classifier
prompt now uses valid JSON for its confidence example.

Legacy WebSocket chat sessions now receive the same host factory through the
actual session-create path. Each message creates a separate bound Run and
projects the complete conversation history. Assistant history and successful
completion events are added only after response evidence and Run completion.
Five real-composition cases cover two-turn history, source/response refusal,
wrong Run and truncated output; 61 session creation/routing regressions pass.

This change connects cc stream, llm.chat, and stream.run to the existing
branded composition and ingress. Each request receives a host-generated Run ID,
checks Run and tenant binding, records the client input, and prepares the actual
provider messages through the model projection boundary. The factory receives
only invocation metadata, not API keys or prompt text.

The CLI deployment loader accepts an authenticated descriptor for stream and
exposes the existing composition factory to that module. Both lazy and eager
command registration already forward loaded dependencies.

Ollama governed streaming uses /api/chat to preserve projected message roles
and content. Unconfigured CLI/provider streaming keeps its existing
/api/generate behavior. OpenAI messages retain the projected structure;
Anthropic QuickAsk retains its existing system-message conversion.

Response evidence and durable Run completion precede a successful terminal
result. Token deltas may already have reached the client when response evidence
is rejected; clients must inspect the terminal error. Governed streams reject
missing completion markers, malformed payloads, and explicit provider errors.
QuickAsk socket closure aborts its provider request. Cancelling source iteration
does not record a completed Run.

## Validation

- Real composition tests cover CLI text and NDJSON output, WebSocket streaming,
  and QuickAsk: redaction before transport, source/response evidence rejection,
  wrong-Run rejection, successful durable completion, and truncated streams.
- Provider-level tests cover Ollama/OpenAI/Anthropic completion, cancellation,
  error frames and malformed payloads; factory validation rejects accessors,
  proxies and unbranded compositions.
- Signed deployment-loader and existing streaming/chat protocol regressions
  remain part of the validation scope. GitHub CI on the final commit is required
  before release.

## Remaining scope

This covers direct streams, QuickAsk, intent routes and legacy chat sessions.
It does not establish that every model entry in the repository has been audited;
the repository-wide final-entry audit remains open.
The EVO-P0-4 roadmap status remains partial. Production authority provisioning,
KMS/PKI, independent witness deployment, privacy/deletion drills, and
distribution-level calibration remain separate acceptance requirements.

These changes are subsequent to the published CLI 0.166.36 and IDE releases.
