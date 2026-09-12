# Claude Code / Codex 差距优化：G08 非阻塞澄清实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 范围：在保留默认阻塞行为的前提下，为可选偏好和补充信息增加 `deferred` 问题模式，打通 Headless、WebSocket、App Server、VS Code 与 Desktop 宿主。本批不把问题回答当作授权，不承诺断线后恢复仍未回答的问题。

## 1. 交付结果

`ask_user_question` 现在显式区分：

| 模式               | 允许的目的                                               | 工具返回                                   | 权限含义                                              |
| ------------------ | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `blocking`（默认） | `decision`、`authorization`、`preference`、`information` | 等待带绑定答案、取消或超时                 | 仍不替代工具审批；需要方案分支时必须使用该模式        |
| `deferred`         | 仅 `preference`、`information`                           | 立即返回 `status: pending` 和 `questionId` | 固定 `authorization: false`，只能继续与答案无关的工作 |

将 `authorization` 或默认 `decision` 标成 `deferred` 会返回稳定错误 `deferred_question_requires_non_authoritative_purpose`，不会创建问题。宿主不支持带外答案时返回 `deferred_questions_not_supported`，不会悄悄退化成已授权。

主要实现：

- [工具合同与执行器](../packages/cli/src/runtime/coding-agent-contract-shared.cjs)
- [Headless 问题注册和带外结算](../packages/cli/src/runtime/headless-stream.js)
- [WebSocket interaction adapter](../packages/cli/src/lib/interaction-adapter.js)
- [一次性延迟答案上下文](../packages/cli/src/lib/deferred-question-context.js)
- [App Server Agent Kernel 桥](../packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js)
- [App Server 请求与终态投影](../packages/cli/src/lib/app-server/server.js)
- [Canonical Agent Protocol](../packages/agent-protocol/schema/cc-agent-protocol.schema.json)
- [VS Code 问题 UI](../packages/vscode-extension/src/app-server-question-review.js)
- [Desktop App Server 宿主](../desktop-app-vue/src/main/ai-engine/code-agent/app-server-pilot.js)

## 2. 非阻塞与权限边界

### 2.1 同一 Agent loop 可以继续

Headless 与 WebSocket 宿主注册 `deferred` 问题后立即向工具返回 pending receipt；问题继续保存在按 ID 索引的 pending Map 中。用户答案仍通过原有带外通道结算，所以不会占用普通用户 turn 队列，也不会把两个并发问题的答案串在一起。

答案到达后进入 session-scoped `DeferredQuestionContext`。下一次 provider 调用最多消费 8 个答案，消费后立即删除；队列最多保留 32 个答案，单个问题和答案分别限制为 2,048 与 16,384 字符。未回答问题的超时只结束该问题，不阻断正在进行的独立工作。

### 2.2 答案保持用户权限

`prepareCall` 新增 `userContext`，延迟答案以临时 `role=user` 消息注入，而不是提升成 system 指令。同时注入受信 system fence，明确这些答案：

- 只是用户提供的信息；
- 不能授予工具权限、批准发布或替代阻塞决策；
- `stale=true` 时只作参考，执行依赖分支或副作用前必须重新确认。

Headless 使用外层 turn 计数、WebSocket 使用宿主 context revision。问题提出后若宿主已经进入下一修订，答案会标记 `stale:true`。本批没有让 stale 答案自动撤销既有计划或审批；审批仍由独立的 approval binding 和权限账本裁决。

## 3. App Server 与宿主一致性

Canonical Agent Protocol 增加协商特性 `deferred_questions`、Server Request `question/answer`，以及 `question/requested`、`question/resolved` 通知。App Server 客户端必须回显：

```json
{
  "questionId": "q-1",
  "binding": {
    "sessionId": "thread-1",
    "turnId": "turn-1",
    "toolUseId": "tool-1",
    "sequence": 1
  },
  "answer": "blue"
}
```

服务端用完整 interaction binding 校验响应；错 questionId、跨 turn 或跨 tool answer 都会拒绝。缺少 App Server 问题处理器时，SDK 回显原绑定并返回 `answer:null`，语义是取消，不会生成 approval decision。

App Server 只在客户端成功协商 `deferred_questions` 后给真实 Headless 会话开启交互问题通道；未协商该 feature 的旧客户端不会收到 `question/answer` 请求或问题通知。客户端输入中的同名运行参数会被服务端协商结果覆盖，不能自行扩权。

VS Code 对阻塞问题保持焦点，对可选问题不锁定焦点；后台 tab 只有真正阻塞的问题才显示“等待审批”状态。可选问题卡在普通 turn 完成后仍保留，直到回答、超时或 session 关闭。Desktop pilot 提供同一 `answerQuestion` 宿主回调；未配置时同样取消。

## 4. 本地验证

| 检查                                             | 结果                        |
| ------------------------------------------------ | --------------------------- |
| CLI 核心、Headless、WebSocket 与 App Server 回归 | 8 files，235 passed         |
| Canonical Agent Protocol                         | 生成一致；19 passed         |
| Agent SDK App Server client                      | 构建通过；1 file，15 passed |
| VS Code pilot、问题 UI、vendored SDK 一致性      | 同步检查通过；5 passed      |
| Desktop App Server pilot                         | 1 file，11 passed           |
| 定向 ESLint / Prettier / `git diff --check`      | 0 error；格式与空白检查通过 |

覆盖的关键反例包括：

- 用户尚未回答配色时，延迟注册已经返回且独立工作继续；
- 延迟答案只在后续 provider call 注入一次；
- context revision 前进后答案标记 stale；
- authorization/decision 不允许 deferred；
- App Server 错 binding 被拒绝，答案不能进入 Agent 上下文；
- 未协商 `deferred_questions` 的旧客户端保持原行为，不接收新请求；
- 没有问题处理器时取消，不产生授权；
- 原阻塞问答、取消、超时、多选、乱序答案和跨 turn binding 拒绝保持通过。

这些均为本地合同测试和伪宿主验证，没有调用付费模型，也不是当前 SHA 的 GitHub Actions 三平台证明。

## 5. 保留边界

- pending 问题与尚未消费的延迟答案目前是进程内状态；断线/重启会取消或清理，尚无持久恢复 receipt。
- Terminal REPL 没有并发输入面，继续支持阻塞问题；请求 `deferred` 时会明确报告宿主不支持。
- 答案在同一进程的下一次 provider call 注入；如果当前 turn 已完成且没有新 turn，不会为了可选答案自动启动付费模型调用。
- `stale` 是保守提示，不是计划 revision、审批 grant 或文件快照的自动 CAS；依赖答案的计划失效仍需后续接入统一 revision authority。
- App Server 和协议生成物已打通合同，但尚未执行精确 SHA 的 Linux/Windows/macOS 真实 IDE/App Server 矩阵。

因此，本批完成了 G08 的非阻塞语义、权限隔离和主要宿主接线；断线持久恢复、统一计划修订失效和真实三平台终态旅程仍保留为后续验收项，不能把 G08 整体标为生产完成。
