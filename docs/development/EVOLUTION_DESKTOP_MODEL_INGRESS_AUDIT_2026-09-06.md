# Desktop model ingress audit

Audited revision: `b59ecdd02e`, branch `feature/evolution-gap-closure`.
Roadmap owner: `EVO-P0-4`. Status: repository work remains.

## Confirmed call chains

| Entry / component                                                                                                        | Observed implementation                                                                                                | Missing evidence or implementation                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop `onReady()` → `loadDesktopEvolutionDependencies()`                                                               | Verifies deployment through the CLI loader; extracts evolvable Skill/Prompt/Hook dependencies and marketplace host     | Does not return a model ingress composition factory. This loader alone does not prove direct Desktop LLM governance                                 |
| Bootstrap `llmManager` initializer                                                                                       | Passes persisted LLM settings, token tracker, response cache and compressor into `new LLMManager(managerConfig)`       | No host-owned model composition is passed into the manager                                                                                          |
| `llm:query` → `LLMManager.query()`                                                                                       | Calls `client.chat` with conversation history or `client.generate` with the prompt                                     | User/context evidence, model projection and response completion are absent from this call chain                                                     |
| `llm:chat` → `chatWithMessages()`; `chat()` alias                                                                        | May return a cache hit; otherwise compresses messages and calls `client.chat`                                          | Need to project final compressed messages, govern any semantic compression request, and authenticate cached-result lineage                          |
| `chatWithMessages()` fallback                                                                                            | Any exception can trigger a second provider call when an override model is selected                                    | Governance refusal must be terminal; each allowed provider attempt needs its own confirmed model projection                                         |
| `chatWithMessagesStream()`; `chatStream()` alias                                                                         | Compresses, calls `client.chatStream`, and may retry with the default model                                            | Same projection and terminal-error requirements; additionally preserve stream cancellation and prevent success publication before response evidence |
| `llm:query-stream` → `queryStream()`                                                                                     | Calls `client.chatStream` or `client.generateStream` directly                                                          | Plain-prompt and conversation branches both need coverage                                                                                           |
| `chatWithWebSearch`, `chatWithImageProcess`, `chatWithKnowledgeBase`, `chatWithFunctionCalling`, `chatWithMultipleTools` | Delegate to a separate `toolsClient`; `volcengine-tools.js` owns `_callAPI` / `_callStreamAPI` and tool-loop execution | A wrapper covering only `this.client` would miss these requests, tool definitions and subsequent tool-result messages                               |

Sources: `desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js`,
`desktop-app-vue/src/main/bootstrap/core-initializer.js`,
`desktop-app-vue/src/main/llm/llm-ipc-core.js`,
`desktop-app-vue/src/main/llm/llm-manager.js`,
`desktop-app-vue/src/main/llm/volcengine-tools.js`.

## Required implementation and acceptance

1. Pass a construction-time host factory from the authenticated deployment to the actual bootstrap manager and its singleton. Renderer options, persisted provider configuration and model callbacks must not select or replace the authority. Validate composition, tenant and Run binding before any provider call.
2. Bind the final provider payload, including system/context messages, post-compression content and tool definitions, to durable model projection. Preserve supported provider protocol shapes and multimodal transport. Cover both the normal client and the separate tools client; inspect client-internal retries and model requests as well.
3. Persist source evidence before provider dispatch. Persist response evidence before successful history/cache/event publication and Run completion. Define cached-result replay evidence explicitly. Streams must await teardown and cannot claim to retract already emitted tokens.
4. Admit fallback only after a provider failure, never after evidence/projection refusal. Verify each subsequent request. Preserve existing usage accounting and cancellation; do not hide duplicate provider effects.
5. Run actual bootstrap/IPC-to-provider tests for query, chat, both streaming families, cache, compression, fallback and tools. Assert secret/PII removal from final requests, no provider call after source rejection, no successful result/cache/history after response rejection, no cross-Run substitution and durable reopen. Existing manager tests are compatibility evidence, not proof of this missing governance.

This audit does not establish coverage of every Desktop subsystem or every model provider. Direct client construction outside LLMManager and helper-model calls still require inventory. The existing CLI/Graph/legacy-WebSocket evidence does not cover these native Desktop calls. Production authority deployment and target-environment drills remain separate acceptance requirements after repository implementation.
