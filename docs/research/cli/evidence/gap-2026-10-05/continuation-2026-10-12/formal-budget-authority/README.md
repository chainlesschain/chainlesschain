# 正式预算生产模块、入口拒启动与独立审阅

状态：**模块修补和正式 CLI 拒启动已完成；NOT_PAID_READY**。本增量在独立预算分支，发行候选 r100 的 6a8 提交未改；不是正式样本、账单或新发行。

三个生产模块提供真实 SQLite 持久原子预留、initial/一次 remediation 共享原任务额度、未知责任额跨重启保留、整数原币种/USD 向上计价，以及持有凭据的 JSON/SSE transport。缺 native SQLite、账户/输入上界/FX/历史证据均拒绝，不采用 sql.js 或内存回退。仍沿用火山18任务+9首次旅程、OpenAI18任务、任务$2/首次$3与原共享$99。

Astra 保留六个原反例及一个补充结算反例，修补凭据等待后合同/FX期限复核、重复/非有限 JSON、error envelope、SSE完成顺序、输出/多模态请求越界、重复结算异常等问题。最终模块 Node22.12/22.22各 **60/60**，独立复验 **13/13=11 transport/storage+2直接结算 API**；均无网络/付费。数据库跨进程竞争、三处真实 kill、写失败及损坏库均使用实际 native SQLite。

正式非dry-run命令在任务setup前拒启动，有效任务binding的真实launcher也在spawn前拒绝，包括内部_argv路径；formal child环境不再转发provider key。四个launcher/window/ordinary-timeout测试文件最终两Node各 **81/81**、源哈希前后稳定。首轮Node22.12 **63pass/18fail**被当前managed sandbox的用户目录祖先lstat权限拦住，原件保留；仅将验证子进程TEMP/TMP/TMPDIR改到可写工作区后重验，未更改产品路径校验。

这些守卫证明正式 CLI 拒启动。createFormalBudgetTransport尚无生产调用方；首次旅程、IDE、Agent/Chat/probe/hub/advisor/compaction/WS及实际OS隔离仍需接线或明确禁止。两个不同数据库路径仍可重用同一历史，路径独占创建不证明lineage唯一；外部fencing/防回滚和真实账户证据仍阻断付费准入。完整入口库存已归档。交接rev2的一条历史“仍需独立审查”文字不能覆盖实际13项模块复核结果；整体集成及三系统CI仍未完成。

6a8发行FullTest的原Windows job在CLI独立依赖安装阶段三次AWS ETARGET，正式测试全部skipped；缺失包现可公开下载，支持上游发布/传播窗口，不能证明具体runner缓存。原PR checkout为14039，tree与6a8逐字相同但commit身份不同。另一会话将原run进入attempt2，actor只证明账号；原attempt1总体cancelled、Windows仍failure。另补exact-head完整FullTest run38294563150，head已回读为6a8，实际checkout及完整成绩尚待验证。最新37-run快照仍有32运行/排队，不构成发行通过；不同run的局部矩阵不拼接。

正式仍 **NOT_RUN / 0/36 / 0/9 / $99**。本增量没有付费调用、公开版本、标签或发行；CLI0.166.100/VS0.37.144/JB0.4.162仍待自己的完整准确门、OIDC及公开回读。

[结构化结论](./summary.json)、[原字节双摘要清单](./manifest.json)。原件以Base64保存，避免Git换行转换改变证据。清单有231个原件条目，**不是测试数量**。
