# 后台会话全扫、分页与索引失效容量对照（2026-09-27）

对应 [CLI 审计 PERF-01](./cli-claude-code-codex-gap-analysis-2026-09-27.md) 与
[实施台账](../cli-ide-gap-implementation-2026-09-27.md)。这份记录补充当前分页生产路径的测量；历史 G10 全扫结果仍保留其原始含义。

## 1. 本批实现

现有 `persistent-capacity-benchmark.mjs` 对每个后台任务档位复用同一份磁盘夹具，保留全扫基线，新增 `comparison`。夹具为完成状态、每条一个 JSON 文件，页大小固定 50；读取统一使用 `all:true,persist:false`。

| 阶段                 | 调用与证据                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| 全扫                 | 原 `listBackgroundAgents` 首进程与重复全目录读取、投影、排序                              |
| 首次分页             | 删除本夹具的派生索引后，在新 Node 进程调用 `listBackgroundAgentsPage`；须观测到 `rebuilt` |
| 已有索引的新进程分页 | 另一个新 Node 进程读同一目录；须观测到 `index`                                            |
| 热首页、热下一页     | 同进程重复调用真实分页入口，分别记录 p50/p95/p99 与实际读取路径                           |
| 失效重建             | 原子替换最旧记录，变更排序时间和标题；分页须重建索引并与全扫结果一致，最后恢复原夹具      |
| 完整遍历             | 在计时区间外遍历所有页，与全扫逐页核对完整投影，拒绝遗漏、重复、错误顺序和循环 cursor     |

`indexObserver` 只提供读取路径和记录数，回调错误不影响结果，不向产品协议增加诊断字段。新进程结果同时核对进程退出码、页摘要、数量、下一页标记和实际索引路径。新进程失败或任一阶段落到全扫时，`pathsVerified` 为 false，不能报告完整索引对照已通过。

## 2. 结果字段与解释

报告保留 `chainlesschain.persistent-capacity-measurement/v1`，新增嵌套
`chainlesschain.background-capacity-comparison/v1`：

- `coldBuild` / `coldCached`：worker 结果、operation/wall time 与校验结果。
- `warmFirstPage` / `warmNextPage` / `invalidationRebuild`：分位数、样本数和读取路径计数。
- `traversal`：遍历记录数、页数与内容校验次数。
- `datasetDigest`：原始全扫投影摘要，用于区分数据集。
- `processPeakRssBytes`：Node `resourceUsage().maxRSS` 转成字节后的进程高水位；既有 `peakRssBytes` 仍为采样时 RSS，保留兼容。
- `lockWait.applicable:false`：该分页路径使用文件 inventory 校验，没有持久端口锁；不能把“不适用”写成“锁等待为零”。Memory 仍使用原生产锁观测。

计时排除夹具生成、内容摘要核对及变更写入；失效重建的计时包含分页调用内的索引重建。新进程操作时间排除后续页摘要计算，wall time 包含启动和返回证据。

## 3. 运行方式

从仓库根目录执行：

```powershell
node packages/cli/scripts/persistent-capacity-benchmark.mjs --profile smoke --output .tmp/persistent-capacity-comparison.json
```

默认 smoke 保留 Memory 100/1k、后台 100/1k、3 次重复。formal 仍要求干净工作树、指定完整 SHA，保留 Memory 1k/10k/100k、后台 1k/10k，至少 11 次重复与 8 路 Memory 并发。现有 `CLI Persistent Capacity` 手动 workflow 会在三个系统运行更新后的脚本，本批未触发远端工作流。

测试使用真实临时目录和新 Node 进程，包含 105 条记录的三页完整遍历、失效后排序/正文变化、夹具恢复、冷进程失败与观测回调失败。准确测试结果和已提交版本见实施台账。

## 4. 尚未完成的性能验收

索引每次仍枚举、stat 全部权威文件，解析索引并排序；收益主要来自减少正文读取。完整遍历因每页重复 inventory 校验，成本还会随页数增长。数据集全为 terminal 状态，未覆盖运行中进程身份探针、并发心跳更新与缓存高频失效。

“冷进程”只指新 Node 进程，未清空 OS page cache。进程峰值可能包含该进程更早执行的 Memory 测量及夹具/校验内存，不等于一次分页的增量分配。单次冷进程结果和 smoke 的 3 样本不能推断生产 p99；formal 的经验分位数也必须连同样本数解释。

报告继续保留 `performanceGate:false`、`productionQualified:false`。目标硬件、交互预算、分位数样本量和 p95/p99/RSS/锁等待 SLO 尚未冻结；三系统精确 SHA formal 结果与汇总门仍待完成。不能按本次测量结果事后调整阈值并宣称通过，也未据此迁移 Memory 存储。
