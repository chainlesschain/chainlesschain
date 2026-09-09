# 113 Desktop 受治理模型入口设计

> 状态：Desktop 基础入口、Personal Data Hub resolver/Skill IPC 与内嵌 Web Shell 源码已落地；CLI/Hub 共享治理入口已随 `0.166.38` 发布，Desktop native 生产部署待验收
>
> 核对基线：本地 `main@a238e6c245`；GitHub `main@1895749692` / Gitee `main@3806866d80`（2026-09-09）
>
> 发布边界：`chainlesschain@0.166.38` 已包含 CLI/Hub 受治理模型入口；这仍不得解释为已公开 Desktop 安装包或目标环境 Workbench 已完成生产部署。

## 1. 背景与目标

Desktop 历史上存在多条直接调用模型或 opaque AI backend 的路径。它们分散在普通对话、流式响应、函数工具循环、图像/音频/视频、embedding、reranker、项目创建、文档生成和旧 RAG 客户端中。只在主聊天入口记录治理事件，会让相同用户内容经辅助模型、fallback 或旧 HTTP client 绕过证据投影和账本。

本模块建立一个宿主拥有的模型入口，目标是：

- 每次允许的模型请求在网络发送前进入唯一 `EvolutionRun`。
- 用户输入、工具请求/结果、模型终态与缓存回放保持同一 Run lineage。
- OpenAI、Anthropic、Gemini、Ollama 和多模态请求使用各自 wire protocol，同时共享治理不变量。
- 未迁移的 opaque backend 在接触网络 client 前失败闭合，不静默降级到另一条直连路径。
- renderer、IPC payload、provider 配置和运行时 fallback 都不能替换宿主 authority。

非目标：

- 不把健康检查、模型列表、模型构建等无用户内容的控制面误记为推理。
- 不在本模块中提供生产 KMS/HSM、PKI、身份、策略、witness 或 grader。
- 不承诺所有失败的远程功能已有受治理替代；部分旧入口当前按设计直接拒绝。

### 1.1 `0.166.38` 的跨表面扩展

Desktop ingress 的“宿主拥有 authority、单次调用固定模型身份、终态先落账再报告成功”不变量现复用于 CLI direct stream、intent service、legacy/canonical WebSocket chat 与 Personal Data Hub。共享的 `governed-model-turn` 负责固定 provider/model/tenant/task/ingress，Hub 专用适配器分别覆盖 analysis、Skill commentary 和 resolver/embedding 选择；UI 启动必须显式转交认证后的 deployment composition。

这些适配器不会把治理变成可选观测。未配置可信部署、Run 身份不匹配、provider stream 缺少合法终止、回调尝试更换模型，或证据/终态持久化失败时，调用在成功返回前关闭。可选 Skill 说明与 intent fallback 只能处理自身业务结果，不能吞掉治理错误。`0.166.38` 的 npm 制品包含这些 CLI/Hub 路径；Desktop Electron 的 native 分发、真实 provider、KMS/PKI 和目标环境 authority 仍按独立验收处理。

### 1.2 `8c1772ba6c` / `1fd9e684f2` 的 Desktop Hub 与 Web Shell 接线

Desktop 主进程现在将 `desktopModelIngressHost` 注入 Personal Data Hub IPC 注册闭包。`personal-data-hub:resolver-drain` 通过 `runDesktopGovernedHubResolverDrain()` 创建新的 resolver、embedding 与 LLM stage；`personal-data-hub:run-skill` 通过 `runDesktopGovernedHubSkill()` 为单次 Skill 调用创建 governed LLM。两者复用 opaque host 背后的签名 composition factory，但 renderer 只能发出业务参数，不能读取、替换或转发 factory authority。

实现不会修改缓存 Hub 或其原始模型 client，避免一次 IPC 的权限泄漏到后续请求。真实 Desktop 启动路径显式传入 branded host；无部署宿主的兼容调用仍保留 `null` 路径，不应被解释为生产治理资格。新增回归测试覆盖 host 仅停留在主进程闭包，以及无部署配置时不凭空生成 authority。

内嵌 Web Shell 启动时从同一 opaque host 派生 main-process-only composition factory，并经 `ws-cli-loader` 传给 CLI WebSocket server；客户端消息不能提交或替换 factory。CLI-owned interactive background、Agenda、Routine、detached worker 以及 Desktop Coding Agent 的 `cc serve` bridge 均通过 canonical CLI loader 继承部署环境；`22b23a0335` 的回归测试固定 Coding Agent 环境继承且不序列化 raw factory。自行启动的 SDK worker、任意第三方命令或直接 provider client 仍不在该证明范围内。以上均是晚于 `0.166.38@de8ec4e5c8` 的源码增量，尚未进入已公开 Desktop native 制品。

### 1.3 `a238e6c245` 的遗留 ImageGen 内容入口闭合

ImageGen 的 15 个 Desktop IPC 覆盖文生图、图生图、变体与超分。状态读取、模型选择、进度与中断属于控制面；任何携带用户文本或图像的内容入口现在在读取缓存、选择 provider 或执行 fallback 前先验证受治理 ingress。缺失或拒绝时返回 `CC_AGENT_EVOLUTION_INGRESS_FAILED`，不会调用 manager provider 或底层 `SDClient`/`DALLEClient` 的 `fetch`。这关闭的是已识别的遗留 Desktop IPC 绕过面，不扩大为所有未来第三方 SDK 或目标部署 authority 已验收的声明。

## 2. 架构

```text
Renderer / IPC / Desktop service
                │
                ▼
        LLMManager / provider client
                │
                ▼
   branded DesktopModelIngressHost
                │ creates one Run per workflow
                ▼
 AgentEvolutionRuntimeComposition
      ├─ evidence projection / redaction
      ├─ EvolutionRun + ArtifactStore
      ├─ signed Ledger + witness
      ├─ tool request/result lineage
      └─ response/cache receipt binding
                │ admission succeeds
                ▼
 OpenAI / Anthropic / Gemini / Ollama

Legacy media / embedding / reranker / project / document / RAG
                │ no trusted bridge
                └──────────────► fail before network I/O
```

`desktop-model-ingress.js` 以 `WeakMap` 保存 host/client 绑定，以 `AsyncLocalStorage` 保存活动 workflow。宿主工厂必须返回 branded composition，且 `runId`、`taskId`、tenant 与 ingress 必须精确匹配。已绑定 client 的 authority 不允许被另一 host 替换。

## 3. 请求生命周期

### 3.1 普通与流式请求

1. 捕获 provider 最终 wire payload，而不是较早的 UI 输入草稿。
2. 创建 `desktop-model-*` Run，持久化 `run-started` 与 UserPrompt。
3. 调用 `prepareModelRequest()` 生成带来源说明的投影消息与工具定义。
4. 只有投影成功后才能向 provider 发出 HTTP 请求。
5. 流式响应必须以合法终止帧结束；终止后出现新内容、残缺 tool call 或异常 JSON 均失败。
6. `response-complete` 与 Desktop result 写入同一 ingress，随后完成 Run。

任何证据写入、readback 或终态结算失败统一转换为 `CC_AGENT_EVOLUTION_INGRESS_FAILED`，调用方不得把它吞掉并切换到未治理 fallback。

### 3.2 函数工具循环

一个用户请求中的多轮模型调用与工具执行共用同一 Run：

- 工具定义名称必须唯一；每批调用在产生副作用前完整校验。
- tool call ID 不得重复，参数必须是 JSON object，调用只能命中声明过的函数。
- `tool-executing`、`tool-result` 或 `tool-error` 在继续下一轮模型请求前进入 ingress。
- 默认最多 8 轮，可配置范围为 1–16；耗尽上限时失败闭合。
- nested summary 等中间模型步骤复用当前 Run，不能另开一个脱离父 lineage 的 Run。

### 3.3 多模态请求

图片块不被强制转成文本。`desktop-multimodal-model-*` Run 先把 opaque image transport 写成摘要绑定 commitment，经认证 readback 后才恢复 provider 所需的原始块。返回的 messages/tools 必须与当前 tenant 和 Run 绑定。

外部 DALL·E、Stable Diffusion、LLaVA、Whisper、浏览器视觉、视频生成和 bundled media handler 在没有受治理多模态桥时于 fetch/client 调用前拒绝，避免通过“辅助功能”泄露 prompt、图片或音频。

## 4. Provider 协议适配

| Provider          | 投影与终态要求                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- |
| OpenAI-compatible | 投影 `messages`/`tools`，SSE 必须收到终态，完整记录 assistant/tool calls                  |
| Anthropic         | 来源说明合并到 `system`，保留投影后的 message 顺序与完整终态                              |
| Gemini            | `systemInstruction` 与 `contents.parts` 仅接受 text part；流结束必须带 `finishReason`     |
| Ollama            | 拒绝 opaque `context` token，要求显式 conversation messages；NDJSON 必须出现 `done: true` |

切换 provider 时先 staging 新 client，再替换活动引用；budget listener 与并发 Run 隔离。IPC reconfiguration 不得丢失已建立的 model authority。

## 5. 响应缓存

响应缓存只接受认证 receipt 回放：

- cache key 绑定 tenant、provider、model、connection、messages 与完整 request options。
- `AbortSignal` 等不可序列化或不透明 options 使请求不可缓存，但不绕过模型 admission。
- cache hit 必须先验证 receipt 与 request key，再恢复绑定的 Desktop result。
- cache miss 的 provider response 必须与 Run 中记录的结果完全一致，随后才能创建 cache receipt。
- nested model step 不单独读写 response-cache receipt，避免把中间结果当成用户终态。

普通 TTL 命中、旧裸缓存值或调用方提供的 `wasCached` 标记都不能替代 receipt。

## 6. 旧入口处置矩阵

| 类别                                               | 当前处置                           | 用户可见结果                            |
| -------------------------------------------------- | ---------------------------------- | --------------------------------------- |
| LLMManager 对话、query、stream、工具循环           | 接入受治理 Run                     | 正常执行；治理/证据失败则明确终止       |
| OpenAI / Anthropic / Gemini / Ollama               | provider 原生协议桥接              | 请求投影与终态统一入账                  |
| embedding / reranker                               | 已识别直连路径发送前拒绝           | RAG 不会把治理拒绝伪装成普通降级        |
| 图像 / 语音 / 视频                                 | 有多模态桥的请求接入；其余直连拒绝 | 不会静默把媒体发往旧 provider           |
| 项目 AI / create stream                            | opaque backend 发送前拒绝          | 本地受治理路径或确定性 fallback 可继续  |
| Task Planner / Word / PPT / PDF / Excel / Document | 旧 `/api/chat/stream` 发送前拒绝   | 保留规则/默认结构等本地 fallback        |
| legacy RAG index/query/update                      | HTTP client 前拒绝                 | 本地 `ProjectRAGManager` 不受影响       |
| Volcengine health check                            | 不再发模型调用                     | 仅检查本地配置完整性；不产生 token/费用 |

## 7. Ledger witness 的 trust epoch

长账本追加会反复验证历史 witness。源码新增可选 `verifier.getTrustEpoch()`：

- 只有受信 verifier 在一次读取前后返回相同、非空且有界的 epoch，才复用该 epoch 内的逐记录验签结果。
- epoch 改变时重新验证完整 history，以使撤销或 trust-root 变化生效。
- 未实现该端口、epoch 过长或读取期间变化时继续失败闭合。
- epoch 不从 witness 文件或调用方 payload 读取，避免攻击者选择缓存域。

1,000-event 仓库演练把 witness signature verification 从约 2,017,022 次降至 1,002 次，同时保留旧 segment 和 witness 篡改拒绝。该优化不解决完整 history JSON 每次 append 的 parse/serialize/fsync 线性成本；生产仍需认证的 epoch/revocation snapshot，并评估不可变分段或认证压缩。

## 8. 安全不变量

- 网络发送必须发生在 admission 与投影之后。
- 客户端不能传入或替换 ingress、composition factory、tenant、receipt verifier 或 active writer。
- 治理错误不得被 cache、关键词 rerank、规则 fallback 或 provider fallback 吞掉。
- tool side effect 必须位于对应 `tool-executing` 与 terminal result/error 事件之间。
- 响应缓存只能重放与当前请求精确绑定的认证结果。
- 健康检查不得以“探测”为名触发真实模型推理。
- 测试 factory、HMAC key 与 isolated local profile 不等于生产 authority。

## 9. 运维与排障

`CC_AGENT_EVOLUTION_INGRESS_FAILED` 表示治理链、证据持久化、投影或终态结算失败。运维应保留原始 cause，检查 deployment descriptor、tenant identity、ArtifactStore、Ledger/witness、policy 与 provider wire response；不得改回 direct HTTP。

旧媒体、项目、文档或 RAG 功能提示“requires a governed model ingress”时，表示该远程路径已主动关闭。可使用已有本地/确定性 fallback，或等待目标部署提供受治理 bridge。

Volcengine 健康检查只验证 `apiKey`、`baseUrl` 与 `model` 是否配置，不代表远端服务、余额或模型权限已验证。需要产生真实请求的连通性测试必须显式执行，并可能产生费用。

## 10. 验证范围与未完成项

当前回归覆盖 host branding、并发 Run/summary 隔离、四类 provider、流式终态、工具调用、cache receipt、媒体与 embedding 阻断、reranker、项目、文档、planner、legacy RAG 和 trust-epoch witness。关键测试位于：

- `desktop-app-vue/src/main/evolution/__tests__/desktop-evolution-deployment.test.js`
- `desktop-app-vue/src/main/llm/__tests__/openai-client.test.js`
- `desktop-app-vue/src/main/llm/__tests__/ollama-client.test.js`
- `desktop-app-vue/tests/unit/rag/embeddings-service.test.js`
- `desktop-app-vue/tests/unit/rag/reranker.test.js`
- `desktop-app-vue/tests/unit/project/project-ai-ingress-governance.test.js`
- `desktop-app-vue/tests/unit/document/document-backend-ingress-governance.test.js`
- `packages/cli/__tests__/unit/evolution-file-witness.test.js`

仍需目标环境完成：

- 生产签名 deployment descriptor、KMS/HSM、PKI、identity/policy 与跨主机 witness。
- Desktop 安装、升级、回滚和真实 provider/media/RAG journey 的 fresh-main 资格验收。
- 为当前失败闭合的旧功能提供统一受治理远程 bridge。
- Ledger 分段/压缩、掉电注入、生产量级和真实撤销延迟基线。

## 11. 相关文档

- [模块 112：受治理的 Skill 自进化](./112-governed-skill-evolution-design.md)
- [模块 110：Agent Platform 发布与证据边界](./110-agent-platform-release-boundaries.md)
- [用户指南：Desktop 模型治理](../../../docs-site/docs/chainlesschain/desktop-model-governance.md)
- [自进化差距分析](../../AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)
