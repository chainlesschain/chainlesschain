# 正式 36+9、native review 与长时观察续做

本目录保存本轮原字节及限定范围结论。正式状态仍为 **NOT_RUN / 0/36 任务 / 0/9 首次安装 / 共享 $99**；总费用和剩余额度未知。v2 指纹、18 个火山任务加 9 次首次旅程、18 个 OpenAI 任务及公开产品身份未改变。本轮没有付费 provider 调用，也没有新发行。

## 正式计划与预算模块

Node 22.12.0 重新校验 v2，并对实际已审阅的 72 脚本包执行只读 collection：`reviewValidated=true`，实际退出 **2 / INSUFFICIENT_EVIDENCE**。这没有创建 observations。

预算开发源码 `31ff33a228f2f6c03541e0dd555693191852fe40` 的 [CLI CI run38296245859](https://github.com/chainlesschain/chainlesschain/actions/runs/38296245859) 已完成：**70 success / 1 条件 skip**，三系统预算模块步骤各 **60/60、零 skip**。完整作业 API、三个实际日志及源码记录已保存。此结果关闭该模块三系统 CI 回读，不证明所有付费出口已接线、lineage 唯一、防回滚或真实账号费用准入，也不是公开发行提交的发布门。

## 当前 native 工程回归

Astra 在准确 `e3c42a3d3a` 的独立 Windows 10 / Node 22.12.0 工作树复验两份原失败相关文件：原有 **37 pass / 0 fail / 1 skip**。新增真实 junction 与 lstat 误分类组合后为 **38 pass / 0 fail / 1 skip**，不是 39 项全部通过。移除 native canonical guard 的独立负对照令新增行为断言真实失败；恢复后的生产字节摘要一致。

测试提交 `91abe787bd81dbba5caeebcb21e6107e7b810846` 已在本轮分支 cherry-pick 为 `b69d8f747c`；两者 Git tree 均为 `636d4546249eb3b8c2573fc331fbe3567b377899`。本增量只增加回归，没有新修复当前普通宿主的 ACL 行为，没有改生产权限。

原冻结 **211 = 208 pass / 2 fail / 1 skip**、更早 **194/16/1** 和控制 **6/4/4** 均保留。完整 native 仍 **NOT_ADMITTED**：LowBox 与精确 owner-only 文件访问不兼容，受保护存储 broker、journal 写入/CAS/flush/recovery 尚缺；Windows 固定 skip 与禁止 skip 的旧 parser 冲突，macOS 也有 Linux-only baseline。需要版本化平台等效 review 及准确 v2/Node22.12 接线，不能放宽旧判据或把普通宿主回归当作 AppContainer 准入。实际 Windows 11 24H2、macOS 15 arm64 宿主仍缺。

## 两条真实 24 小时工程观察

冻结 `.99` 发行源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b` 的独立、干净工作树已启动既有 session-message workload：Windows 10 x64 和 Ubuntu 24.04.3 / WSL1 x64 均使用 Node 22.12.0。它持续运行消息乱序、重投递、恢复与真实跨进程 custody 检查；报告每 30 秒更新。归档时两条均 **running**，尚未到 8h/24h。

原 v1 watcher 有实际复现的错误：1 秒 passed、错误 schema/digest、未来时间、外国平台/启动以及读失败可误报或残留旧状态。Astra 的纯内存反例及原源码保留。新 [v2 observer](../../../../../../../scripts/verify01-long-engineering-watch.mjs) 校验报告摘要、schema、SHA、平台、起点、时间和真实进程 start/executable/command/boot 身份；完成阶段实际调用冻结 producer validator。持久状态保留 prefix/gaps/里程碑和首次拒绝，拒绝状态不自动恢复；原报告字节按 8h/24h 保存，运行中检查点保留 running。

最终 watcher SHA-256 为 `91d79e73be4eb680628977923e0b5ca2a686778f984d0baf620eb5f6c28d86c7`，两实际运行副本字节相同。Windows/Linux 各 **12/12**，前后源码摘要稳定。Astra 结论为 **ACCEPTED_FOR_SUPPLEMENTARY_ENGINEERING_OBSERVATION**，reviewerKind=AI、human=false。三系统 CLI CI 已加入同一组回归和对应触发路径，新提交 Actions 结果另验。

旧监控经进程命令/启动身份核验后已停用，原 workload 没有重启。v2 仍如实保存首段未监视时间及一次约 188/190 秒观察间隔，`monitoringCompleteFromLaunch=false`。这两条 local 组件报告始终 `qualifyingEvidence=false / formalHostAcceptance=false`，不是九个公开 CLI/IDE 入口的正式 8h/24h 回执，不证明真人辅助技术、固定硬件 SLO、账单或 native durable。

实时原件留在操作者工作区：`.work/verify01-long-observation-20261013` 和 `.work/verify01-linux-long-observation-20261013`。本目录只保存归档时点快照；后续完成或失败需另补原件，不能用当前 running 快照宣布完成。

[结构化结论](./summary.json) 与 [原字节索引](./manifest.json) 保存正式缺失、进程/来源、限定范围及剩余外部条件。187 个对象是原件数量，不是测试数量。gzip 对象同时记录原字节和压缩字节摘要，避免 Git 换行转换改变证据。
