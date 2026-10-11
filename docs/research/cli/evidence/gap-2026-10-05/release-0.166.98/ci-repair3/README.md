# Windows SDK 临时根失败、真实复现与共享 CI 修复

准确 d62 候选的 [Kernel CI 38132488081](https://github.com/chainlesschain/chainlesschain/actions/runs/38132488081)、Windows job 114449508229、attempt 1：前序 Kernel 112/112、writer、CLI migration/recovery 25/25 及 Desktop/Protocol 检查通过；TypeScript SDK 82/83，真实会话首次 result.is_error=true。原断言没有附上错误正文，不能据 CI 原件确定底层原因，完整 API/log 保留。

同一 SDK 源码在真实 8.3 短路径 TEMP 下初始化成功，首次任务于同一断言点失败，旁录显示 Context/Memory authority directory resolves elsewhere。真实 junction 则更早由 Session Core 拒绝，两者不混同。规范 TEMP 下原 E2E 1/1，通过文本、审批、实际文件写入和持久化 resume。原 180 秒期限、断言和 SDK 树均未改变。最初短路径探针驱动失败、canonical 外部 120 秒中断也保留；后仅将诊断外部预算改为 240 秒，并非改测试期限。

修复提交 `7f681d660da1f446e5e0c540c5ef10ea529d5a2e` 在共享 setup-node-deps action 的 Windows 环境中先 realpathSync.native(tmpdir())，只向 GITHUB_ENV 写入 TEMP/TMP。原 Node 片段在真实短路径上导出同一物理目录，应用该环境后原 SDK 九文件 **83/83**。SDK 0.2.14 的完整 Git 树及两个生产 guard 未改，可继续按完整源码树复用规则审查。此机器没有 pwsh；本机验证的是原 Node 片段和其环境效果，最终 hosted shell 仍待 Actions。

共享 action 的既有发行注释要求后台断线重连三 OS 复验；该 workflow 补 PR head 固定检出和 HEAD 比较，Kernel/Memory Index 补 action 路径触发。发行回读增加这组三 OS，成为 **七门：71/5/19/10/3/3/3**；不可变修复提交上的 helper **27/27**。公开 npm 回读每次使用独立时间目录，失败重读不覆盖原件。此前两个 d62 duplicate 检查均保留，没有取消请求。

[manifest](./manifest.json) 保存 117 份 gzip 双摘要原件和准确 Git 源码。历史 [retest-ready2](../retest-ready2/README.md) 的 f534/d62、Windows/Linux 43/43 与 skipped run 属于该历史准备，不能转移为后续付费执行身份。新的准确发行提交仍须完整七门，OIDC 子包 → CLI → IDE 及公开回读后再进行显式火山复测。本轮零模型调用、未发行或合并；正式 **36+9 / NOT_RUN / observed=0 / $99**、独立人工、账单/硬额度、实际 GUI/辅助技术、native/durable 与 8h/24h/SLO 仍开放。
