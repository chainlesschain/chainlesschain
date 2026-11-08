# canonical Memory 派发前撤权与授权接线修复

日期：2026-11-08。承接[差距评审](../plans/cli-ide-codex-claude-gap-review-2026-10-27.md)4.3、4.8、4.10及[组合查询测量](./cli-ide-memory-compound-progress-2026-11-08.md)。完整目标尚未完成。

## 问题与实际修复

canonical已启用时，真实agentLoop在`context.plan.created`或`model-usage-started`暂停后，另一个实际runtime完成delete/supersede，恢复时仍会把旧正文发送到chatFn或fetch。直接adapter在异步ingress及`onProviderCallStart`期间也存在同类窗口。显式空scope数组恢复了默认授权，子代理`memory:false`没有约束canonical recall。初轮16项真实磁盘回归中14项失败、2项对照通过；各失败都保存了旧正文进入请求的合成标记。

本轮把host-owned派发约束集中到共享模块：捕获原Memory revision、已选记忆到期时间及默认provider sink，跨计划/用量事件保留能力，在每次实际请求或流式重试前复核。多个authority按稳定顺序获取锁，同key去重但拒绝不同revision；锁内同步复核所有继承约束、scope关闭及取消，再启动原有fetch，随后释放锁，HTTP响应Promise保持盒装以免长期持锁。自定义chatFn入口也受版本守卫约束；任意自定义raw网络仍不属于完整OS出口隔离证明。

仅异步检查版本仍会留下间隙。复审实际复现了内scope在外validator等待时关闭、validator返回到物理fetch之间关闭两种竞态；同步叶节点检查修复它们。请求启动后若同步异常或锁清理失败，保留原错/cause并禁止重放；正常异步HTTP失败继续遵循原有传输策略。disabled Memory保留普通路径，子scope不能移除父约束。host能力及authority路径不进入序列化plan证据。

显式空scope现在拒绝，符合Kernel至少1项的既有合同；未改为默认授权。子代理在loop override之后再次应用`memory:false`。预算自身取消信号也传到Memory验证和锁等待，在锁仍被另一个port持有时就能结束请求，释放后不会迟发。已预留预算仍保守记录unknown，不重置或重放。

## 验证

- 最终Node22.20：19文件 **402/402**，其中33项新增派发/继承/跨进程/TTL/重试回归，无跳过。
- 最终Node24.12及真实SQLite ABI137：预算authority、传输和Memory预算交互 **106/106**；3项新增交互包含在106中，无跳过。
- 跨进程实际删除被revision锁挡住；物理请求启动后即使HTTP仍pending，删除也能完成。旧revision拒绝再次派发。
- 锁定Web Panel生产构建成功；静态出口审计89个候选全部分类，源码分类仅更新已审查的3个文件摘要，不授予财务/OS准入。
- [原始失败、最终结果、源码快照及离线校验](../../cli/evidence/memory-admission-2026-11-08/README.md)。新增原生预算用例接入CLI CI既有三系统步骤；准确新提交云端结果仍待核对。

## 已完成测量与剩余边界

[完整性能归档](../../cli/evidence/memory-final-2026-11-08/README.md)分别保存两个已完成身份：`727c64962`的600查询、600重建/损坏、600取消及300轮混合；`698b87d79`的900个五条件首次冷查询/续页。后者100K三场景p95为484.842/516.613/499.743ms。共享开发工作站的观测、完整样本和批准的SLO分别记账；这些结果不能移用为本轮新增派发修复提交的整套性能或发行成绩。

真实语义候选源及独立相关性评测、REPL旧system注入来源治理和历史迁移、完整跨入口恢复、三系统准确提交门禁及安装升级仍未全部完成。现有词法样例、人工semantic score、列表/GUI结果不代替真实语义质量；本轮不改变历史真实任务数、未知账单、正式冻结`NOT_RUN`或`paidReady:false`。

## Release integration follow-up (CLI 0.166.145 candidate)

The integrated branch combines the admission repair with the independently merged model-input diagnostics and MCP Tasks changes. Diagnostics wrap the existing admitted dispatch; both ordinary and governed transports recheck Memory after asynchronous diagnostic observers. Five integration cases cover deletion/supersession from logical/body observers and a successful admitted request; a sixth case covers revocation at the governed final-body observer before durable dispatch admission.

Current Windows validation: the original 19-file related selection now passes 407 tests; the Memory-budget selection passes 4 tests. The related provider-scope/tool boundary selection, diagnostic persistence, task requester/journal/runtime and changelog/artifact checks also passed. These are local engineering checks; exact merged-source GitHub matrices and package publication/readback remain pending.

The two original evidence archives verify unchanged. Their source snapshots and earlier performance results remain bound to the original recorded revisions; they are not retargeted to this integrated candidate. The failed immutable CLI .144 tag is retained, and no .145 tag or public publication is created by the preparation commit.
