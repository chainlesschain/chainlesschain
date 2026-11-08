# 最终模型输入诊断首批实施（2026-11-08）

本批推进[差距复核第 2 项](../plans/cli-ide-codex-claude-gap-review-2026-11-08.md)，实现可选的 runtime 诊断回调，关联最终逻辑输入、规划摘要、签名投影和传输正文。完整 CLI / IDE 可查询诊断与独立任务归因仍待完成。

代码提交：`2ba726cd9c40cf640d6950dac27c088039d0cece`。分支：`feature/model-input-diagnostics-20261108`，承接 Codex 兼容分支；独立工作区仍位于 `.worktrees/cli-ide-gap-20261108`。未发布软件包。

**实现**

可信宿主可向 `chatWithTools` / 内置 `agentLoop` 提供 `onModelInputDiagnostic(event)`。回调会被等待，写入失败阻止后续派发；目前没有新增 CLI 开关或 IDE 面板。

- 每个逻辑请求生成独立 requestId，并关联内置 Agent 的 model-usage callId；并发、重试尝试和未启用诊断的嵌套调用各有明确边界。
- `logical-input` 对最终 `{messages, tools}` 生成快照，报告摘要、大小、角色和计数。文件可见性追踪使用同一快照。
- 规划信息复用 kernel 的 plan.digest、选中数量和既有裁剪原因；未规划时明确 covered:false。保留真实 sha256: 前缀摘要。
- ingress 用私有 WeakMap 给真正验签、持久化读回成功后的请求对象登记冻结回执，维持原 `{messages, tools}` 结构；拷贝、代理或伪造对象无法取得回执。
- 默认投影诊断仅输出 manifest / projection / ruleset 摘要，不导出 tenant、run、event、evidence 原始身份。
- 每次 fetch 在异步记录前捕获正文及取消信号。普通路径记录同一个实际交给 fetch 的字符串；正式预算路径分别标记 adapter-body 与重新序列化后的 governed-fetch-body。
- 正式预算 authority 的 markDispatched 与 fetch 之间仍没有 await。原有 paidReady:false 保留。

`body-prepared` 只表示准备好的正文，providerAcceptanceVerified:false；正文摘要与接收端一致由本地 HTTP 测试证明。它本身不能证明服务端已接收请求、模型已理解输入、任务验收通过或账单准确。usage 缺失仍为 unknown，所有诊断 billingVerified:false。

默认记录不含源码、消息正文、工具描述、路径、凭据、图片或思考内容。非字符串流式请求体不被消费，明确标记 bodyCovered:false。完整逻辑输入与正文的摘要不同，是因为 provider 会转换协议结构；两者通过 requestId / attempt 关联，不能混称为同一个摘要。

**验证**

| 范围                           | 本地结果                        | 证据                                                                                                             |
| ------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 诊断、模型 profile、usage 边界 | 3 文件 61 项通过                | [最终报告](./evidence/model-input-20261108/input-diagnostic-tests-r3.json)                                       |
| 文件读取、范围与压缩恢复       | 2 文件 68 项通过                | [报告](./evidence/model-input-20261108/input-diagnostic-read-guard-tests.json)                                   |
| 真实签名回执及双 provider HTTP | 5 项通过，274 项未选中          | [报告](./evidence/model-input-20261108/input-diagnostic-real-receipt-tests.json)                                 |
| 完整正式预算 authority         | node:test 60 项通过             | 命令 node --test packages/cli/test-node/formal-budget-authority.test.mjs；包括进程终止、未知用量、取消和预算保留 |
| 提交检查                       | ESLint、Prettier、diff 检查通过 | git 提交钩子；三系统准确提交 CI 尚未完成                                                                         |

普通诊断测试明确使用 sentinel ingress，投影 covered:false；真实签名测试另用真实 durable composition、验签器、生产 chatWithTools 和 HTTP loopback。前者覆盖 canonical 规划与正文，后者覆盖真实回执与正文；尚未证明同一次请求同时绑定真实规划、签名回执和正文。

初次两份失败报告也保留：第一次未显式启用 canonical 规划，第二次错误地把 sentinel 期望成可信回执；测试配置及 fixture 范围已更正，真实签名验证由独立真实组合测试承担。没有修改生产验签或绕过失败条件。

**剩余工作**

继续补同一请求的完整三阶段证据、投影脱敏与裁剪逐来源归因、流式和真实重试场景，以及 CLI / 双 IDE 的可查询持久化入口。自定义 adapter、子进程或直接使用任意 fetch 的路径尚无覆盖承诺。独立模型任务验收及模型/宿主/工具/验收环境的失败归因仍待推进。

本批没有把来源 token 估算改成实测 usage，也没有调整任务历史成绩、付费准入或发布状态。
