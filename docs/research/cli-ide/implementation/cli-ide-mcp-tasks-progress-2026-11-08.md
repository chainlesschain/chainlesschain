# MCP Tasks 实验性协议入口实施记录（2026-11-08）

本批推进[差距复核第 4 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)。代码提交：677b9c35e968426fefdcf3697cac5769428f4229；独立分支：feature/mcp-tasks-20261108。此前静态检索未找到标准方法的结论属于历史检查，本批已新增明确的协议实现，尚未完成整项验收。

**实现及边界**

依据 [MCP 2025-11-25 Tasks 官方规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)，Tasks 属于实验性能力。本批实现服务端请求方入口；没有宣告客户端支持接收任务化 sampling / elicitation，也未自动将现有工具调用转为后台任务。

- canonical MCPClient 新增 callToolTask、getTask、getTaskResult、listTasks、cancelTask。复用既有 stdio / HTTP / WebSocket 请求传输，本批新增实际协议旅程使用 Windows HTTP 回环服务。
- 创建要求协商的协议版本和服务器能力匹配，并校验工具 execution.taskSupport；普通调用遇到 required 会在派发前拒绝。调用方传入普通 options.task 不能绕过显式接口。
- 受理响应只返回任务信息，不能结算普通工具成功。普通工具收到意外任务响应时保留 dispatched / outcomeUnknown；任务创建遇到响应断连、HTTP 404、无效受理对象和 idle 超时均不重发调用。
- 私有进程内表绑定服务器名、taskId、原连接对象、实际 endpoint / protocol / session / 有效 headers。headers 和其他身份快照不对外输出。换连接或凭据后拒绝用旧绑定查询；列表可以建立本连接内的任务绑定，但不能覆盖旧连接身份。
- 任务结果沿用安全 JSON、大小、深度及节点预算，额外检查 content、isError 和关联 taskId。input_required 可以调用 getTaskResult，不要求先观察到 completed。
- 列表每页最多 256 项、游标最多 65536 字符；拒绝重复 taskId，整页通过检查后才写入。进程内最多 1024 个绑定，并发创建先预留名额，列表不能占用创建中的预留名额。
- 已观察到的终态不可回退；最终结果成功读回后也禁止再次接受 working / input_required。取消回执丢失保留未知结果；收到 cancelled 不证明远端副作用已经停止。
- recovery-guarded 宿主 facade 明确拒绝五个任务 API 以及内部任务请求入口，错误为 CC_MCP_TASK_DURABLE_ADMISSION_REQUIRED、dispatched:false。这样可以防止任务创建或取消绕过原调用账本及发送授权。显式创建仍保留原有 dispatchAdmission 保护。

**验证**

最终代码在 Windows、Node.js 24.12.0 上执行 12 个相关测试文件，236 / 236 通过。范围包含新增 HTTP 回环 Tasks 旅程，以及既有普通 MCP 客户端、能力发现、HTTP 404 防重放、发送授权、取消、idle 进度、工具元数据 / 结果预算和持久账本恢复回归。不是跨平台成绩，也没有访问真实第三方任务服务或付费模型。

[最终原始报告](./evidence/mcp-tasks-20261108/mcp-tasks-final-regression-tests.json)与[清单及 SHA-256](./evidence/mcp-tasks-20261108/manifest.json)归档保存。首次测试报告也保留：38 项中 3 项因为测试误写重连注册方法名而失败，修正后再验证；该报告不作为产品缺陷或最终通过成绩。

新增测试覆盖创建响应丢失、已发 404、异常受理对象、创建 idle 超时、取消回执丢失、身份变化、查询在途凭据变化、错误关联 ID、终态回退、重复列表、1023 个已有绑定时并发创建，以及宿主全部任务入口零派发。236 项是最终一次执行结果，不与较早 38 / 81 / 155 项报告累计。

Astra 两轮只读审核指出并推动修复了未知结果标记、连接绑定、重复 ID、终态和并发名额问题，最终未发现阻断本批提交的问题。提交钩子 ESLint / Prettier / diff 检查通过。

**尚未完成**

本批只有受保护的实验性协议入口，没有 durable task ledger。绑定随进程结束丢失，断开重连不会自动继承旧任务。任务受理持久化、崩溃窗口恢复、鉴权身份的持久化保密绑定、TTL / 过期验收、结果入会话的去重、持续 progress token、自动轮询调度及模型继续执行仍需实现和验证。完整 stdio / WebSocket Tasks 旅程、CLI / 双 IDE / 桌面原生任务界面和真实服务端验收也未完成。

因此第 4 项和整项目标保持未完成。尚未取得本提交准确 SHA 的完整三系统 Actions 回执，未合并或发布。
