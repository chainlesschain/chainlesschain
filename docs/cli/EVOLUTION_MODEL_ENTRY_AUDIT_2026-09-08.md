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

The CLI hub ask and hub repl commands accept a signed deployment factory and
construct a scoped AnalysisEngine with a governed LLM wrapper. The cached full
Hub and its original model client are not rebound. The wrapper preserves locality,
model identity and skipCache options, projects the actual fact-containing
messages, and retains response evidence before returning an answer. The existing
AnalysisEngine cloud-consent gate runs first. Five real composition/AnalysisEngine
cases and three command registration cases pass, together with 100 existing
Hub command/client and deployment-loader checks.
The scoped wrapper pins the exposed model name, locality and chat function.
It rechecks them at metadata access and before/after asynchronous preparation
and transport; changes require reopening the invocation. This prevents a
Desktop adapter's dynamic provider switch from retaining a stale local label.
Six real Hub cases and three identity-change cases pass.

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

The direct provider adapters cancel unfinished response bodies and release their
reader locks on completion markers, consumer return and parse failure. EOF also
flushes the final buffered line. Eight regression cases exercise these paths
with actual ReadableStream objects; the combined governance/provider/session
stream suites pass 70 tests.

## Validation

- `cc ui` now loads authenticated deployment dependencies and passes its host
  composition factory through command registration into the UI runtime. The
  existing runtime then forwards it to the WebSocket server. Eighty-two loader,
  registration and factory regressions pass; the UI server startup test also
  checks the exact factory received by server construction. This closes a launch
  path that previously omitted governance despite supporting it downstream.

- Governed WebSocket resolver draining creates fresh embedding and LLM stages,
  preserving resolver thresholds without modifying the cached resolver. Embedding
  requests use the projected profile (excluding chat-only provenance metadata),
  validate finite nonempty vectors and retain evidence before similarity is used.
  Seven real-composition tests drive the SDK resolver and its actual stages through
  successful merging, embedding/model source and response rejection, wrong Run and
  invalid vectors. Refusals record queue errors without completion or merging.
  Sixteen protocol/wiring regressions pass. The LLM arbitration prompt now contains
  a valid JSON example. This remains within prepared PDH 0.4.60.

- CLI `hub run-skill` and WebSocket `personal-data-hub.run-skill` now use
  scoped governed model clients. A per-invocation failure latch surfaces model
  errors even when the SDK's optional commentary layer catches them. Five real
  composition cases exercise success, source/response refusal, wrong Run and
  model identity changes through the SDK commentary layer. Command/dispatcher
  regression suites pass 33 tests. The SDK interests prompt uses a valid JSON
  example so strict projection can process legitimate skill requests.
  A separate real-composition test exercises InterestsSkill's actual prompt and
  JSON response parsing, with redaction and durable completion. PDH 0.4.60 and
  its CLI pin are prepared for child-first publishing after the exact-commit
  release gates; USR_VERSION 82 invalidates the Android bundle cache on rebuild.

- Hub WebSocket `personal-data-hub.ask` now receives the host factory through
  the real message dispatcher and selects an invocation-scoped analysis Hub.
  Four dispatcher tests cover host authority versus client fields, explicit cloud
  consent, initialization/model rejection without fallback, and unconfigured
  operation. These tests mock Hub loading; the six real-composition AnalysisEngine
  cases separately validate the model boundary. The existing protocol suite adds
  nine passing regressions.

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

### Legacy image-generation IPC (2026-09-09 follow-up)

`src/main/image-gen/image-gen-ipc.js` still exposes text generation,
image-to-image, variation, and upscaling handlers. Its `ImageGenManager` is not
supplied an authenticated Desktop model-ingress capability, so all four
content-bearing public methods now fail closed before cache lookup, provider
selection, or fallback. The exported `SDClient` (`txt2img`, `img2img`,
`upscale`) and `DALLEClient` (`generate`, `createVariation`, `edit`) retain the
same pre-`fetch` gate. Status, model selection, progress, and interruption are
control-plane calls and do not carry user model content. This preserves the
legacy surface for a future governed bridge without treating it as a usable
direct model path today.

### Volcengine private knowledge-base upload (2026-09-09 follow-up)

`VolcengineToolsClient` correctly projects `/chat/completions` when it is bound
to the Desktop model host, but `setupKnowledgeBase()` is a separate raw-document
upload to `/knowledge_base/{id}/documents`, not a model request. The model host
cannot attest that upload's source/evidence lineage, so the method now returns
`CC_AGENT_EVOLUTION_INGRESS_FAILED` before it reaches transport. Its regression
uses a canary-bearing document and asserts that the injected `fetch` is never
called. A future implementation must use a dedicated governed evidence-ingress
bridge; it must not reuse the chat-only model capability.

Other background model consumers and Desktop Hub overrides still require
separate tracing. The minimal Hub deliberately has a
non-inference sentinel and does not need a model wrapper.
The Desktop Hub adapters inspected here delegate to LLMManager.chat rather than
calling a provider directly. The full Hub retains its original resolver for
unconfigured operation; governed WebSocket drain requests use scoped stages.
The concrete drain triggers are WebSocket `personal-data-hub.resolver-drain`
and Desktop IPC `personal-data-hub:resolver-drain`; SDK workers can also invoke
the resolver. WebSocket and Desktop IPC draining/skill execution now use
per-invocation scoped wrappers. The embedded Desktop WebShell forwards a
main-process-only capability to the CLI WebSocket server, so its Hub handlers
also receive the signed composition factory. Desktop retains the deployment
factory inside its opaque branded ingress host, so the renderer cannot obtain
or replace model authority; a missing or invalid host fails closed.
The bundled Agent SDK does not call the Hub/resolver itself: its executable
surfaces spawn `cc agent` or `cc serve --app-server`, both of which are signed
deployment-loader command names, while its background surface only attaches to
an existing local transport. Application-defined independently started SDK
workers are still outside this Desktop/WS wiring and require their own
final-entry audit.

CLI-owned background paths preserve this same boundary: interactive background
dispatch, Agenda, and Routine each launch the `agent` command; the detached
background worker replays the authenticated Agent argv through the canonical
CLI entrypoint and inherits the deployment environment. Generic background
shell tasks are not model consumers themselves; if they invoke `cc`, that
child re-enters the normal command loader. This does not certify arbitrary
third-party commands or SDK code that calls a provider directly.
The EVO-P0-4 roadmap status remains partial. Production authority provisioning,
KMS/PKI, independent witness deployment, privacy/deletion drills, and
distribution-level calibration remain separate acceptance requirements.

These changes are subsequent to the published CLI 0.166.36 and IDE releases.
