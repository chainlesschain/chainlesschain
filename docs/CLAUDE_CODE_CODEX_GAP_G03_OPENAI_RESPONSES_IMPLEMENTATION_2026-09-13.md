# Claude Code / Codex 差距优化：G03 OpenAI Responses 主链实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 前置批次：[G03 模型能力 Profile 基础层](./CLAUDE_CODE_CODEX_GAP_G03_MODEL_PROFILE_IMPLEMENTATION_2026-09-13.md)<br>
> 范围：为版本化 profile 明确要求 Responses 的精确 OpenAI 官方目标接入原生请求、工具回合、reasoning 连续性、流式事件和 usage 归一化。本文记录源码与 fake-provider 合同，不声称真实账号、模型或跨平台运行认证。

## 1. 交付结果

模型能力 profile 的 `runtimeProtocol` 现在参与真实请求选择：

| 目标                                                                    | 运行协议           | 边界                                             |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------ |
| `provider=openai`、精确官方 `/v1`、目录明确要求 Responses 的精确模型 ID | `openai-responses` | 当前目录仅为已审阅目标启用，不按前缀推断未来快照 |
| OpenAI 官方目录中的 Chat Completions 模型                               | `chat-completions` | 保持既有请求和流式 reducer                       |
| 第三方 OpenAI-compatible endpoint                                       | `chat-completions` | 不把官方模型规格或协议要求强加给代理网关         |
| 其他 provider                                                           | 原有协议           | Anthropic、Ollama、DeepSeek、Gemini 等路径不变   |

能力目录版本更新为 `2026-09-13`，profile 仍固定 `runtimeVerified:false`。协议选择代表本地静态合同已实现，不代表 endpoint 可达、账号有 entitlement 或真实工具调用成功。

主要实现：

- [Responses 转换与 reducer](../packages/cli/src/lib/openai-responses.js)
- [Agent provider 主链](../packages/cli/src/runtime/agent-core.js)
- [版本化能力 profile](../packages/cli/src/lib/model-capabilities.js)
- [精确模型目录](../packages/cli/src/lib/model-context-catalog.js)
- [Responses 合同测试](../packages/cli/__tests__/unit/agent-core-openai-responses.test.js)

## 2. 请求与工具连续性

适配器把内部消息投影为 Responses input items：

- system/user/assistant 消息保持各自角色；
- Chat Completions 工具声明扁平化为 Responses `function` tool；
- assistant `tool_calls` 转为 `function_call`；
- `role=tool` 结果转为带同一 `call_id` 的 `function_call_output`；
- 图片块从 `image_url` 转为 `input_image`，不改变其他 provider 的图片转换；
- 请求使用 `max_output_tokens`，不误用 `max_tokens`。

请求固定 `store:false`，并请求 `reasoning.encrypted_content`。provider 返回的 reasoning item 只保留继续无状态工具回合所需的受限字段，随下一次同 provider 请求回放；它不会被解析成权限、审批或工具参数。reasoning summary 可以投影给已有 `onThinking`/终态展示通道，但加密 reasoning 内容不向用户展开。

`thinking` 未开启时不新增 reasoning 配置；开启后才发送 `{effort, summary:"auto"}`。这保留默认成本语义，也让显式 reasoning 配置进入 Responses 主链。

## 3. 流式、终态与用量

Responses SSE reducer 处理：

- `response.output_text.delta` 与 refusal delta；
- `response.reasoning_summary_text.delta`；
- `response.output_item.added/done`；
- `response.function_call_arguments.delta/done`；
- `response.completed`、`response.incomplete`、`response.failed` 与 `error`。

完成结果归一化回既有 `{message, usage, providerReceipt?}` 合同。`input_tokens_details.cached_tokens` 从总 input 中分离，避免缓存 token 被按普通 input 重复计价；`output_tokens` 仍包含 provider 报告的 reasoning 消耗。当前没有把 `output_tokens_details.reasoning_tokens` 扩展成全项目新的独立 usage 维度，避免未经全链升级就让严格 usage ledger 漂移。

`incomplete` 或连接中断后的安全文本会标记 `_truncated`，半截工具调用被删除；provider 明确失败和用户 Abort 继续失败退出。官方 OpenAI 的 `X-Client-Request-Id` 与 provider 返回 ID 仍沿用现有 trace-only receipt，不能据此推断幂等提交。

## 4. 本地验证

当前定向回归：

| 检查                                                                       | 结果                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Responses 请求、转换、流式、本地工具两轮、治理投影、CLI 诊断及既有韧性回归 | 7 files，164 passed                                           |
| 定向 ESLint                                                                | 0 errors；`agent-core.js` 保留 22 个既有 unused-vars warnings |

关键反例包括：

- 自定义 endpoint 使用同名模型也不能获得官方 Responses 选择；
- reasoning/function call/function output 在第二次请求中保持同一 `call_id`；
- 不完整 function call 不会进入执行器；
- provider failed 不能变成空成功；
- 用户 Abort 不能变成 partial success；
- 网络中断只保留已经展示的安全文本；
- cached input token 与普通 input 分开归账；
- 请求仍先经过现有 authenticated evolution ingress。

测试没有读取真实 API key，没有访问付费模型，也没有生成精确 SHA 的 GitHub Actions Linux/Windows/macOS 证据。

## 5. 保留边界

- 仅接入版本化目录明确选择的首条官方 Responses 路径；不承诺所有 OpenAI 模型、快照、内置工具或第三方网关均支持。
- 尚未对真实目标执行 reasoning + tool、流式取消、压缩后继续、模型切换和 usage 回读旅程。
- Responses 采用 `store:false` 的显式 input item 回放，未使用 `previous_response_id`；服务端存储型会话不是本批合同。
- reasoning token 当前包含在 `output_tokens`，独立明细尚未贯通所有成本、预算、团队和持久 usage ledger。
- 中文、代码、大工具 schema 的 token 预算误差基准仍未交付。
- profile 继续输出 `runtimeVerified:false`；只有目标账号、真实 provider 与同一候选 SHA 的验收才能改变运行认证状态。

因此，本批关闭了 G03 的“主链仍只有 Chat Completions”源码缺口，但真实模型认证、独立 reasoning usage 明细和预算误差测量仍未完成，不能把 G03 整体标为 production-complete。
