# Claude Code / Codex 差距优化：G03 模型能力 Profile 基础层实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 前置批次：[G01/G02 实施记录](./CLAUDE_CODE_CODEX_GAP_IMPLEMENTATION_2026-09-12.md)、[G06 中文词法召回](./CLAUDE_CODE_CODEX_GAP_G06_IMPLEMENTATION_2026-09-12.md)<br>
> 范围：G03 的版本化能力 profile、只读诊断和上下文预算绑定。**不包含原生 OpenAI Responses 传输，也不构成最新模型运行认证。**
> 后续实施：[G03 OpenAI Responses 主链](./CLAUDE_CODE_CODEX_GAP_G03_OPENAI_RESPONSES_IMPLEMENTATION_2026-09-13.md)。本文件保留基础层交付时点边界。

## 1. 本批结果

| 交付项         | 已实现                                                                                                   | 保留边界                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 版本化能力目录 | 将旧窗口表原值迁移到兼容目录，增加 provider 归属、目录版本、来源和稳定 digest                            | 旧目录值仍是规划估算；没有通过运行时探测自动认证                              |
| 官方模型元数据 | 对精确的 OpenAI 官方 `/v1` endpoint 和精确模型 ID 提供已审阅的窗口/最大输出元数据                        | 自定义网关、别名、未来快照和其他 provider 不继承官方声明                      |
| 输出预算一致性 | canonical planner 与 Anthropic 请求体复用同一输出预算解析器                                              | OpenAI/Ollama 未显式配置时仍不合成请求 cap，只保留规划预留                    |
| 失败关闭       | 显式请求 cap 或 Anthropic 实际 cap 大于等于上下文窗口时，在 memory runtime、文件和 provider 请求之前拒绝 | 未显式设置 cap 的兼容 provider 继续使用保守规划预留并按小窗口夹紧             |
| 只读诊断       | 新增 `cc llm capabilities` 文本/JSON 输出；不读取 keychain/API key、不联网、不写配置                     | 输出固定标记 `runtimeVerified:false`，不表示账号权限、endpoint 连通或模型可用 |
| 命令分发       | 能力诊断走快速只读入口；即使显式设置 OTLP endpoint 也不初始化遥测队列                                    | 其他命令原有遥测策略不变                                                      |

主要实现：

- [模型能力解析](../packages/cli/src/lib/model-capabilities.js)
- [兼容目录与来源](../packages/cli/src/lib/model-context-catalog.js)
- [canonical provider 规划](../packages/cli/src/lib/context-memory-kernel/provider-context.js)
- [Agent 请求主链](../packages/cli/src/runtime/agent-core.js)
- [LLM 诊断命令](../packages/cli/src/commands/llm.js)

## 2. Profile 合同

能力 profile 使用 `chainlesschain.model-capability-profile/v1`，至少公开以下可审计字段：

- `catalogVersion`、`profileId` 与内容 `digest`；
- 精确的 `provider`、`model` 和当前 `runtimeProtocol`；
- `contextWindowTokens`、`windowSource`、`windowAssumed`；
- 实际请求 cap、规划预留及其来源；
- 文档标称最大输出、来源 URL、限制说明；
- 固定的 `runtimeVerified:false`。

endpoint、凭据和临时主机状态不会进入输出或 digest。只有精确的 `https://api.openai.com/v1` 可以使用本批记录的 OpenAI 官方元数据；带端口、尾斜杠、额外路径、查询、fragment、userinfo、相似域名或 HTTP 的地址均按自定义 endpoint 处理。这样可以避免把代理网关、兼容服务或别名误认证成官方模型。

本批只记录审阅过的精确模型 ID，没有用前缀推断未审阅快照。相关官方来源为 [GPT-4o 模型页](https://developers.openai.com/api/docs/models/gpt-4o)、[GPT-6 Astra 模型页](https://developers.openai.com/api/docs/models/gpt-6-astra) 和 [Responses 迁移说明](https://developers.openai.com/api/docs/guides/migrate-to-responses)。这些页面提供静态规格与协议要求，不证明当前账号有权限，也不证明本项目已完成相应协议往返。

## 3. 使用方式

```powershell
# 读取当前保存的 provider/model/base URL；不解析凭据
cc llm capabilities

# 输出机器可读的静态 profile
cc llm capabilities --provider openai --model gpt-4o --json

# 操作者覆盖仅用于本次诊断与规划投影，不写回配置
cc llm capabilities --provider openai --model gpt-6-astra --context-window 1050000 --max-output-tokens 128000 --json
```

文本输出明确区分“请求 cap”和“规划预留”。后者可能只是兼容路径的保守估算，不能当作已发送给 provider 的参数。无效整数、非 HTTP(S) URL 或损坏配置会失败退出，并避免回显输入中的敏感内容。

## 4. 规划与请求绑定

Anthropic 默认与显式输出上限现在由同一纯函数同时提供给 canonical planner 和实际 `max_tokens` 请求字段。Sonnet、Opus、Haiku 的现有默认值与显式夹紧行为保持不变；小于 256 的有效请求 cap 可以发送，但规划器仍保留 256 token 的保守最小预留。

OpenAI、Ollama 及其他 Chat Completions 兼容路径在未显式配置输出 cap 时，不新增 `max_tokens` 或 `num_predict` 字段；规划器使用 4096 token 的兼容预留。profile digest 被写入 canonical plan 的 `modelProfile`，因此模型、窗口或输出覆盖变化会产生不同规划身份。

若实际请求 cap 已占满或超过整个窗口，命令以 `CC_MODEL_OUTPUT_BUDGET_EXCEEDS_WINDOW` 在任何 memory runtime 创建、状态文件写入或网络请求之前失败。这是本地配置一致性检查，不是 provider 规格验证。

## 5. 本地验证

| 检查                                                            | 结果                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| 能力解析、真实 CLI 只读隔离、planner/request 绑定及既有相关回归 | 10 files，194 passed                                            |
| 命令生成物                                                      | manifest、help index、shell completions、CLI reference 均无漂移 |
| 目标 ESLint                                                     | 0 errors；`agent-core.js` 保留 22 个既有 unused-vars warnings   |
| Prettier / diff                                                 | 本批文件已格式化，`git diff --check` 通过                       |

测试使用 fake provider、隔离用户状态和拒绝网络/子进程的 preload。没有读取真实凭据、没有付费模型请求、没有创建测试 authority，也没有执行 npm 发布。根据仓库发布规则，本地结果不能替代精确 release commit 的 GitHub Actions Linux/Windows/macOS 矩阵。

## 6. G03 仍未完成的部分

本批没有把 `gpt-6-astra` 加入默认推荐模型，也没有把模型名直接送入现有 Chat Completions 工具链。profile 会明确报告当前协议以及 Responses 缺口，避免静默宣称支持。

后续仍需独立实现并验收：

- 原生 Responses request/input items、function call output 和状态连续性；
- reasoning items 的保留与无状态重放；
- 流式文本/工具事件、取消、重试和提交结果不明处理；
- usage、cached token 与 reasoning token 的统一归账；
- 压缩后继续、模型切换及治理 ingress 全链保持；
- 中文、代码和大工具 schema 的 token 预算误差基准；
- 对每个实际支持模型执行真实 reasoning + tool 往返。

在这些目标环境证据完成前，G03 只能标记为“基础层已完成、原生协议与真实模型验收未完成”。
