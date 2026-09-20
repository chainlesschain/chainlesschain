# 第一百九十二次工程实施：Follow-up Intent IPC 授权与上下文边界

## 本批目标

加固 ChatPanel 实际使用的三个 Follow-up Intent IPC。旧入口在没有 sender、身份和用途校验的情况下接受无界输入与任务/对话上下文，必要时直接调用模型，并返回分类器完整结果；普通日志还记录用户输入、分类结果、模型响应和 caught Error。

## 实施结果

- 单条分类、批量分类和统计读取在分类器/模型访问前分别绑定实际主窗口、main frame、可信 origin、当前 actor DID/tenant 与固定用途。
- 请求只允许 own plain data，拒绝 Proxy、accessor、未知顶层字段、原型键、稀疏/扩展数组、非有限数字及不支持的值。
- 单条输入限 8 KiB；批量限 32 条、合计 64 KiB。上下文顶层只允许 currentTask、taskPlan、conversationHistory，整体限 64 KiB、深度 6、节点 512、单集合 100 项、单字符串 8 KiB。
- conversationHistory 只接纳最近 5 条 system/user/assistant role/content，单条正文限 4 KiB；currentTask/taskPlan 只接纳受总边界约束的 plain data。
- 分类结果只返回 intent、0–1 confidence、2 KiB reason、固定 method、有限 latency 和可选 4 KiB extractedInfo；规则 scores、provider 扩展和批量输入副本不再返回。
- 失败回执固定化，单条分类保留固定 CLARIFICATION fallback；失败正文和 caught Error 不跨边界。
- 分类核心四处动态诊断改为固定事件，JSON 解析失败不再把原始模型响应拼入异常。
- renderer helper 的分类日志不再包含用户输入、reason 或 caught Error，降级结果使用固定错误码。

## 回归与门禁

- Follow-up Intent/Phase/授权定向回归：5 test files、141 tests passed。
- 完整主 LLM 回归：49 test files、644 tests passed、15 skipped。
- 固定 renderer IPC capability 验证通过：1,226 exact、156 denied。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- `authorizeFollowupIntentPurpose` 仍需生产 operator policy/RBAC 注入并验证身份切换与撤销。
- currentTask/taskPlan 的 nested key 仍为有界 plain data，尚未收紧为版本化业务 schema 或绑定真实任务 owner。
- reason/extractedInfo 仍可能包含用户或模型派生正文，尚缺内容分类与字段级最小披露策略。
- 模型调用成本、单 actor 速率/配额和真实 Electron/provider E2E 仍待完成。
