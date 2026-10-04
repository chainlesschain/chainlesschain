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

## 4. 本机干净提交结果

在完整 SHA `6c47788623d6bc4ab64afa096d8ce739ebbacf0a`、干净工作树上运行默认 smoke；Windows `10.0.19045` / x64 / Node `v22.22.2`，耗时 23.279 秒。原始 [JSON receipt](./evidence/persistent-capacity-smoke-windows-6c47788623.json) 已保存，canonical digest 已重新计算核对：`sha256:b2b44278ebc7c6533cfbbabdf85b293249d6d2cecb0933b909ed5febbcff61df`。

| 后台记录数 | 全扫 p95   | 首进程建索引 | 已有索引新进程 | 热首页 p95 | 热下一页 p95 | 失效重建 p95 |
| ---------- | ---------- | ------------ | -------------- | ---------- | ------------ | ------------ |
| 100        | 36.335 ms  | 92.948 ms    | 40.799 ms      | 37.334 ms  | 36.774 ms    | 85.207 ms    |
| 1,000      | 336.129 ms | 677.356 ms   | 190.509 ms     | 164.045 ms | 160.822 ms   | 694.739 ms   |

两档 `pathsVerified:true`，分别完整遍历 2 / 20 页。表中冷进程列为单次 operation time，其余为 3 样本经验 p95，并非同等置信度的统计估计。Memory 100/1k 均可读，原有并发读/更新/删除全部成功。主测量进程高水位 150,568,960 字节，包含此前 Memory、夹具与核对开销。

该次运行中，100 条的热分页与全扫接近；1k 的热首页比全扫快，但建索引和失效重建成本更高。后续应测量心跳等实际变更下的命中率，以及减少重复 inventory 扫描的方案，保持权威变更校验后再评价收益。不能仅凭稳定 terminal 夹具的命中结果推广为实时列表性能承诺。

## 5. 尚未完成的性能验收

索引每次仍枚举、stat 全部权威文件，解析索引并排序；收益主要来自减少正文读取。完整遍历因每页重复 inventory 校验，成本还会随页数增长。数据集全为 terminal 状态，未覆盖运行中进程身份探针、并发心跳更新与缓存高频失效。

“冷进程”只指新 Node 进程，未清空 OS page cache。进程峰值可能包含该进程更早执行的 Memory 测量及夹具/校验内存，不等于一次分页的增量分配。单次冷进程结果和 smoke 的 3 样本不能推断生产 p99；formal 的经验分位数也必须连同样本数解释。

报告继续保留 `performanceGate:false`、`productionQualified:false`。目标硬件、交互预算、分位数样本量和 p95/p99/RSS/锁等待 SLO 尚未冻结；三系统精确 SHA formal 结果与汇总门仍待完成。不能按本次测量结果事后调整阈值并宣称通过，也未据此迁移 Memory 存储。

## 6. Memory 分片 authority 候选（2026-10-04）

CLI runtime 的 canonical 路径新增 `SegmentedMemoryPort`：按 ID 的 SHA-256 前一字节分成 256 个 bucket，点读验证一个 bucket；修改只重写涉及的 bucket，再原子替换原 authority 路径上的 v2 manifest。manifest 同时绑定全局 revision、各 bucket 内容摘要、字节数、记录数和审计事件数。记录、审计事件与 reconciliation 通过同一次 manifest 替换提交；审计使用全局 sequence 保留原事件及其顺序，`exportSnapshot()` 可重建完整 v1 形状的快照。

保留单 bucket 64 MiB 边界，活动 bucket 合计最多 1 GiB、审计最多 1,000,000 条，manifest 最多 256 KiB。限制针对实际 UTF-8 字节；临时写入会额外占用本次被改写 bucket 的大小，snapshot 初始化最坏需要另一个聚合容量，不把磁盘峰值说成 1 GiB。没有截断旧事件或通过删除历史增加可用容量。分片分布不均时可能先遇到单 bucket 上限。

v1 迁移和所有文件读取、提交、清理共享原 authority 文件锁。迁移先校验旧快照，再写私有不可变 bucket，最后替换 manifest；替换前失败保留 v1，旧客户端读取 v2 明确拒绝，避免双 authority。shadow 实例只读 v1/v2，不迁移、不清理。聚合容量不是恢复已超限 v1 文件的旁路；旧文件仍受原 64 MiB 有界读取约束。

读路径检查 regular file、hard link、no-follow 句柄、目录身份和摘要。除 macOS root-owned 的精确 `/var`、`/tmp` 系统别名外，拒绝 authority 祖先中的 symlink/junction。GC 在同一锁内流式检查最多 4,096 个目录条目，只删除自有命名空间中未被当前 manifest 引用的 bucket/临时 manifest；未知文件不删除。目录身份变化时停止清理，避免沿替换路径删除文件。此实现没有 Node 不提供的 `openat` 级目录句柄相对操作，不宣称能抵御拥有同一目录写权限的恶意进程在系统调用之间反复替换路径。

manifest 替换后若目录同步或 GC 失败，抛出 `CONTEXT_MEMORY_COMMIT_PUBLISHED`，携带 `committed:true`、已发布 `storeRevision`、`durability` 和 `cleanupComplete:false`，不回滚 manifest，也不删除其引用的 bucket。调用者必须读取已提交状态后处理，旧 CAS 重试不会重复写入。Windows 不支持目录 fsync 的既有边界被明确标记，不能据此承诺断电无损；进程崩溃留下的自有文件在下一次 canonical 操作中清理。

完整 `query()` 仍读取全部 bucket：锁内捕获同一 manifest 代的有界原始字节，锁外仅对这些自有 buffer 做摘要和 schema 校验。后续 GC 不会影响已捕获快照。`listRecords()` 和语义/词法 recall 仍是全扫，未增加业务字段二级索引或全局分页。并发 query 各自保留原始快照，因此并发内存不能用单进程 RSS 代替。点读测量包含锁、manifest 校验、孤儿目录检查及 bucket 校验，并非纯哈希查找延迟。

容量脚本新增 `--storage segmented`，通过生产 `importSnapshot()` 建立夹具，显式区分批量 snapshot 导入与逐记录 commit。冷进程重开、并发读/更新/删除完成后，另做完整审计前缀摘要、事件数、revision、更新和 purge 内容后验核对。正式 workflow 使用该 backend，旧单文件基线仍可用 `--storage json` 重跑。最终候选 SHA 的本机测量及三系统验收需要单独记录；这段实现说明不等于 SLO 或生产验收通过。
