# 临时 worktree 消费者生命周期修复

日期：2026-10-29。第三十九批，承接[上游故障映射](./cli-ide-upstream-regression-progress-2026-10-29.md)。Astra 完成真实故障复现、初始实现及五场景进程回归；主代理复查、补充并纳入保留测试。直接修改 `main`，Microsoft 暂缓。

| 项目                  | 当前完成情况                   | 证据与边界                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原缺陷真实复现        | **确认**                       | 实际 `SubAgentContext.run → isolateTask → executeTool(run_shell)`；后台子进程先读取 checkout 并 READY。shell cwd 位于外部目录时，父子任务已返回 completed、消费者仍存活，但临时 worktree 被成功删除；随后消费者读取同一绝对路径得到 `ENOENT`。 |
| Windows 掩盖条件      | **保留两个对照**               | shell cwd 仍占用 checkout 时，原清理返回 `EBUSY` 并保留文件；不能把操作系统锁偶然保护解释成生命周期正确。原主仓 worktree 路径集合不变；HEAD 因并行主线提交变化，未声称完整 registry 字节相同。                                                 |
| host scope 限制       | **实现及本地验收完成**         | `isolateTask` 的 awaited callback 进入宿主 AsyncLocalStorage 限制；晚到异步后代仍继承限制。它是能力边界，不是进程租约。                                                                                                                        |
| 后台 shell / 子任务   | **派发前拒绝**                 | `run_in_background=true`、显式或 agent 文件默认 `background=true` 返回 `CC_EPHEMERAL_WORKTREE_CONSUMER_UNOWNED`；没有 Broker launch、后台登记或 child 构造。更换 shell cwd 不能绕过。                                                          |
| 延后调度 / 技能子进程 | **派发前拒绝**                 | 临时 scope 内禁止创建 wakeup / cron / monitor，以及 materialize 后实际 isolation 的技能 child；在持久 store / child 创建前返回明确错误，并释放技能 lease。查询 / cancel 和原有直接 handler 禁止规则保留。                                      |
| 同步子任务与普通宿主  | **原行为保留**                 | 同步子任务等到结果才返回；普通非 worktree 后台 shell 仍可 running、后续读取成功并正常退出；普通宿主仍能创建 schedule。                                                                                                                         |
| 前台取消与清理        | **限定真实旅程通过**           | 父取消时 foreground 消费者仍存活，callback 尚未结束，checkout 仍在；文件握手允许消费者读完退出后才清理。没有把取消信号或 kill 请求发送成功当作进程已退出。                                                                                     |
| 定向回归              | **7 文件、148 项通过，退出 0** | Node 22.22：原目录清理、subagent、取消、普通后台回归及新增路由 / 真实进程测试。新增两个文件在 Node 22.12 上 13/13 通过；五场景真实进程也独立保留。来源前后摘要稳定。                                                                           |
| 源码出口审计          | **82 候选、零问题通过**        | 仅更新 Agent Core 的准确字节摘要及本批受限 launch 路由说明；没有增加模型出口、排除 scanner 或放宽付费准入。`paidReady=false`、`runtimeCoverageVerified=false`。                                                                                |
| 发行与整体后台验收    | **仍未完成**                   | 本批未发布；准确新提交三系统 CI、任意 shell 自行 detach / daemon、完整后代树、全崩溃窗口与 CLI / 双 IDE 仍待验收。真实交付保持 34/45。                                                                                                         |

首次保留测试中有一项把既有不允许直接执行的 handler 当作可执行 inline 技能，得到预期之外的旧 handler 拒绝；已修正测试口径并保留原失败，未修改运行时来放行。最终 148 项包含正确的旧 handler 拒绝回归。

本批选择在临时 checkout 内明确拒绝尚无生命周期所有者的异步工作。前台任务仍可能因不合作而延迟结束；未引入无限等候的新 lease 系统，也未证明取消立即终止进程。保留的进程夹具使用真实 Git / Broker / shell，并把 `_runCore` 替换为确定性无模型任务，不能替代完整模型旅程。

[证据清单](./cli/evidence/worktree-consumer-lifetime-2026-10-29/review.json)保存原故障、`EBUSY` 对照、实际清理结果、真实进程回归、修复后两版 Node 测试、源码摘要和来源审计；没有付费模型或外部服务调用。
