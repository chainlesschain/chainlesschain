# Direct model entry governance audit (2026-09-08)

The CLI stream command and the WebSocket QuickAsk/stream routes previously sent
input directly to provider adapters even when a host configured an evolution
composition factory. The deployment loader also excluded the stream command.

The three chat.intent routes had the same omission. They now pass the host
factory into intent understanding, streamed understanding and LLM-based followup
classification. Governed classification failures propagate instead of being
reported as rule fallback. Pure rule classification makes no model request.
Governed intent deadlines abort model transport and bound waits for authority.
An unconfigured intent invocation now keeps only its pure-rule local fallback;
it never invokes a provider adapter. The classifier prompt now uses valid JSON
for its confidence example.

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
and content. CLI model-bearing calls without an authenticated composition fail
closed with `CC_AGENT_EVOLUTION_INGRESS_FAILED` before selecting or invoking a
provider. OpenAI messages retain the projected structure; Anthropic QuickAsk
retains its existing system-message conversion.

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

### CLI default-deny follow-up (2026-09-11)

The shared CLI model-turn seam now rejects an absent authenticated composition
factory before request preparation or transport. The same pre-transport reject
is enforced for `cc ask`, chat intent model analysis, Agent/Cowork runtime
model calls, Chat REPL startup, CLI Hub ask/repl/run-skill, WebSocket Personal
Data Hub ask/run-skill, and resolver draining. Rule-only intent classification
remains available locally; it is not a model fallback. Focused regression suites
assert that an injected `fetch` is never called on these rejection paths.

`AgentRouter.dispatch()` now also requires an authenticated ingress before
backend selection. With one, opaque external CLI backends are removed from the
candidate set; without one, dispatch fails before a pool or provider is
started. The legacy `backend/ai-service` LLM factory and every public method
on its provider-client base class now likewise raise
`CC_AGENT_EVOLUTION_INGRESS_FAILED` before an SDK is constructed or invoked;
there are no other in-repository constructors for those clients. UniApp now
uses the same terminal guard before standard LLM manager, legacy provider,
backend facade, multimodal, or streaming transport; its five focused
zero-transport regressions pass. iOS OpenAI/Ollama/Anthropic chat/stream and
Ollama embedding are likewise static default-deny, pending Xcode verification.
This does not close the repository-wide audit: native Android and iOS release
validation, other backend model services, and application-defined SDK workers
remain outside this CLI/Desktop/backend closure until their actual model egress
is either connected to a governed ingress or denied before transport. Plugin
`network:http` is no longer an exception: generic plugin network requests now
default-deny before `fetch` and model work must use the governed `plugin.llm`
bridge.

### Desktop registered-egress inventory and default deny (2026-09-11 follow-up)

The Desktop main process now has an executable inventory at
`src/main/evolution/__tests__/model-egress-inventory.test.js`. It registers the
known content-bearing built-in provider, multimodal, image, speech, video, RAG,
project-AI, document-engine, Cowork, and plugin entry files. Each entry must
retain an explicit governed ingress function or an explicit
`CC_AGENT_EVOLUTION_INGRESS_FAILED` fail-closed guard; deleting either causes
the focused test to fail.

The two common low-level text paths are now also default-deny. An unbound
client passed to `prepareDesktopModelRequest()` or
`runDesktopOllamaRequest()` receives `CC_AGENT_EVOLUTION_INGRESS_FAILED` before
provider transport. The normal `LLMManager` boot path binds its branded Desktop
ingress host before creating a provider client; a raw client instantiated
outside that path can no longer silently fall back to direct egress. Focused
validation is:

```powershell
cd desktop-app-vue
..\node_modules\.bin\vitest.cmd run src\main\evolution\__tests__\model-egress-inventory.test.js src\main\evolution\__tests__\desktop-evolution-deployment.test.js
..\node_modules\.bin\vitest.cmd run tests\unit\llm\llm-ipc-governance.test.js
```

This is a repository guard for registered built-in Desktop paths, not proof of
governance for application-defined plugins using arbitrary custom endpoints,
independently started SDK workers, or an externally provisioned production
authority. Those remain final-entry and deployment acceptance work.

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

### Plugin network API is default-denied

`src/main/plugins/plugin-api.js` routes the plugin `llm:query` and
`llm:stream` permissions through the Desktop `LLMManager`; they therefore use
the normal governed client when the Desktop host is configured. The separately
permission-checked `network:http` API now rejects every request before `fetch`:
known OpenAI, Anthropic, Gemini, Mistral, Volcengine, and local Ollama families
are identified explicitly, and unknown HTTPS/localhost endpoints are rejected
by the same terminal guard. Generic request bodies cannot be classified or given
an EvolutionRun evidence projection, so the repository intentionally exposes no
direct plugin network egress until a dedicated authenticated,
evidence-producing bridge exists. Plugins must use `plugin.llm` for model work;
an unknown provider is no longer a repository-side direct-provider escape hatch.

### Legacy FunctionCaller HTTP tools are default-denied (2026-09-12 follow-up)

`FunctionCaller` registers three older general-purpose network tools by
default: `http_client`, `api_requester`, and `web_crawler`. The first two
accepted arbitrary URLs, headers, and request bodies; the crawler accepted an
arbitrary URL and headers. None has a branded model-input projection or an
EvolutionRun response-evidence lifecycle, so each could be pointed at an
unknown provider outside the `plugin.llm` and Desktop `LLMManager` bridges.
All three now throw `CC_AGENT_EVOLUTION_INGRESS_FAILED` before `http.request`
or `fetch`. The Desktop egress inventory registers their three source files,
and focused regressions assert arbitrary model-shaped URLs/bodies cause zero
network calls. This intentionally retires these legacy direct-network surfaces
pending a dedicated governed bridge; it does not restrict the separately
capability-bound Cowork network broker.

### Desktop regression execution note (2026-09-12)

The complete Desktop Vitest command can overcommit this Windows host when it
starts the real libp2p, CLI-server and temporary-database journeys alongside
the rest of the suite. One parallel run consequently reported timeouts and
loopback `ECONNREFUSED` in eleven unrelated files. Re-running that exact
failure set with one worker and file parallelism disabled completed with **11
files and 449 tests passed** in 1060.60 seconds. The focused legacy HTTP
closure and Desktop egress-inventory tests also pass. This is local execution
evidence only; a clean commit's CI matrix remains the release authority.

### UniApp bootstrap and health-probe closure (2026-09-12 follow-up)

The first UniApp pass protected content-bearing chat, OCR, ASR/TTS, embedding,
and RAG request helpers, but a repository-wide scan found several independently
callable bootstrap and probe methods that could still select a runtime, start a
local model worker, or open a direct model-related HTTP connection. `LLMManager`
now rejects initialization, mode discovery, and WebLLM engine loading before a
backend health probe or `CreateMLCEngine`; the legacy `LLMService` rejects its
Ollama health/model-list calls; and `AIBackendService` rejects its health probe.

`OCRService` now rejects initialization, auto discovery, Tesseract worker
creation, Baidu token acquisition, and batch recognition before a worker,
filesystem read, or request. `EmbeddingsService` preserves its deterministic
TF-IDF-only initialization but rejects every other initialization, discovery,
and transformers runtime load before a model can be selected or downloaded.
`KnowledgeRAGService` rejects module bootstrap and backend health probing; its
default background bootstrap consumes that expected terminal denial and leaves
the service explicitly unavailable rather than creating an unhandled promise
rejection or reporting a fallback as usable.

`mobile-app-uniapp/tests/unit/model-egress-guard.test.js` now exercises these
paths with request/fetch and runtime-worker spies: **15 tests pass**, including
zero `uni.request`, zero `fetch`, zero Tesseract `createWorker`, and zero WebLLM
`CreateMLCEngine` calls. The Knowledge RAG assertion is source-contract based
because the current root test environment lacks the UniApp-only `crypto-js`
dependency needed to import its database module; it verifies both bootstrap and
health methods place the terminal guard as their first executable statement.
This closes the identified UniApp default-model-entry gaps, but does not replace
clean CI, device integration, or an authenticated production Evolution ingress.

### iOS system Vision and Speech closure (2026-09-12 follow-up)

The iOS provider audit initially covered LLM, embedding, image-generation,
generic HTTP, and TTS exits. A subsequent framework-level scan found separate
system-model paths through `Vision` and `SFSpeechRecognizer`: the Audio,
Document, and Image engines; the direct Vision tool handler; QR/barcode skill
tools; and the two live voice input services. System frameworks may select
on-device or service-backed implementations, but neither form supplies the
required Evolution projection/evidence lifecycle. They therefore cannot be
treated as an implicit local, governed ingress.

Audio/document/image engine dispatch now rejects only model-bearing tasks
(transcription/TTS/summarization; OCR/structure/translation; OCR/detection/
classification/description) before task dispatch. The direct Vision OCR,
classification, face, and barcode methods reject before reading an image; the
QR/barcode `ToolExecutor`s return the terminal code before loading a file; and
both live voice `startListening()` paths reject before authorization, microphone
setup, or creation of a speech-recognition task. Pure image transforms, pixel
analysis, local file operations, audio formatting, and playback remain outside
this closure.

`tests/unit/evolution-ios-model-egress-static.test.cjs` now passes **4/4**. Its
new contract asserts the engine task fences, every direct Vision/Speech entry,
and the two scanner executors place `CC_AGENT_EVOLUTION_INGRESS_FAILED` before
media loading or framework execution. This is source-level proof only until the
macOS target workflow compiles and tests the changed sources.

### Android file-browser ML Kit closure (2026-09-12 follow-up)

The Android file-browser module also contained two direct ML Kit consumers not
owned by `feature-ai`: `TextRecognizer` reads a caller-selected image before
sending it to the text recognizer, and `FileClassifier` can read an image and
send it to the image-labeling client. On-device execution does not provide an
authenticated Evolution projection or response-evidence lifecycle; a
service-backed implementation has the same missing boundary.

Both their single-item and batch public entry points now throw
`CC_AGENT_EVOLUTION_INGRESS_FAILED` before URI enumeration, image loading, or
ML Kit client use. The `feature-file-browser` unit contract invokes the two
single-item APIs with a mocked `ContentResolver` and asserts the terminal code
plus zero `openInputStream` calls; the repository-level static contract also
asserts every public entry places the terminal guard before its first content
or batch-work statement. This keeps the legacy feature source available for a
future governed bridge without allowing it to become a direct model-input path.

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
