# Memory 权威分片解析复用与完整采样准备

日期：2026-10-29。第十八批，承接[完整磁盘与取消基线](./cli-ide-memory-store-progress-2026-10-29.md)和[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.8 节。源码基线 `0005a2b0d03df345e053f7c865d4cf5772b88803`；直接修改 `main`，Microsoft 渠道继续暂缓。

100K 查询只返回 20 条结果，也会重新验证约 19 个完整权威分片；逐分片的目录校验还重复遍历同一组祖先。本次复用已验证的解析结果，并去掉同一次目录检查中的重复祖先遍历。默认仍是 `validate-disk`，不会为达到延迟目标而改成跳过索引磁盘检查。

| 项目             | 当前完成情况                            | 验证 / 边界                                                                                                                            |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 权威分片解析缓存 | **实现及本地回归完成**                  | 新读取的分片字节 SHA-256、当前 manifest generation 与物理 authority 身份全部一致才复用；仍读取磁盘，不信任时间戳                       |
| 有界保留         | **实现完成**                            | 最多 32 个解析图、来源字节合计默认 16 MiB；构造参数 `decodedShardCacheBytes: 0` 可禁用，最大允许 64 MiB；来源字节预算不是进程 RSS 上限 |
| 版本与返回值隔离 | **回归通过**                            | 观察到 generation 变化或本实例发布新 manifest 时清空缓存；旧快照不能重新填入当前缓存；返回记录复制后交给调用者                         |
| 损坏与删除       | **回归通过**                            | 同长度、保留时间戳的权威字节损坏仍被拒绝；另一实例更新、delete / purge 后不返回旧记录；派生索引仍按原模式修复                          |
| 目录验证         | **回归通过**                            | 分片目录的完整祖先遍历已覆盖 authority 父目录；保留目录身份比较、Windows native 路径核对、链接 / hardlink 拒绝及私有目录权限检查       |
| 本地测试         | **144 项通过、1 项平台跳过**            | 11 个 Vitest 套件 118 项通过、1 项跳过，CLI Node 集成 / 恢复 26 项通过；含新增缓存 9 项、真实并发提交及原有取消测试                    |
| 测量器           | **完整采样入口已补齐**                  | 磁盘脚本允许至少 100 样本，增加损坏索引恢复、逐样本原子保存、事件循环延迟与 RSS / heap；并发脚本允许 100 轮；既有 Stop 脚本支持 100 次 |
| 三系统测量       | **Linux 1500 次回读完成，其余继续运行** | 准确提交 `16af6d6199` 的 Linux 五场景 × 三档各 100 次通过结果等价和身份核验；Windows / macOS 尚未完成，不计为跨平台通过                |
| 查询 SLO         | **仍未证明达标**                        | 初步诊断显示重复解析开销下降；正式 p95 需完成 1K / 10K / 100K 的每场景 100 次采样，不能用少量诊断或缓存模式切换宣称达标                |
| 发行与真实旅程   | **未完成**                              | 没有发布新包；真实 IDE Stop、跨平台恢复与正式准入继续单独验收，真实任务产物仍为 34/45                                                  |

实现位于 [memory-shard-snapshots.js](../../packages/cli/src/lib/context-memory-kernel/memory-shard-snapshots.js)，只用于索引查询返回的分片解析结果。点读、全量审计、写入及损坏索引重建仍执行原有验证路径；任何缓存命中前，生产路径都会重新读取所选权威分片的字节。缓存内部对象不会直接返回给调用者，也不会把不同代的分片拼成一个查询结果。

并发回归的注入点从“实际解码”移动到“锁释放后的分片快照读取”，确保即使命中缓存也仍实际触发外部进程提交和旧文件回收。没有取消并发写入、放宽版本断言或把缓存命中当成并发已验证。

验证回执与原始回归归档见[本批证据](./cli/evidence/memory-snapshot-cache-2026-10-29/verification.json)。ESLint 缺少 `@eslint-community/eslint-utils` 的环境问题尚在，未记为通过；语法、Prettier、生成进程清单和 diff 检查单独核验。本批没有改动 Context/Memory 子包；上一批子包的取消接口仍须按既定子包 → CLI → IDE 顺序发行。

完整测量按以下顺序执行，避免同时运行本批重负载测试；每条命令使用新的输出路径。报告中的 `complete: false` 或未满 100 次的组不能记为完成。冷查询是新 Node 进程，不清空 OS 文件缓存；每次查询结果都与完整参考数据的摘要核对。损坏 / 重建只操作合成数据的派生索引。

2026-10-29 本机采样进展：Memory 测量启动 HEAD 为 `16af6d6199ea5c8d261b9a1872c50b185841192d`，每份报告另绑定实现摘要与 dirty 状态。1K 和 10K 五场景均已完成各 100 次，全部查询结果与参考摘要一致。本机完整报告仍为 `complete:false`，100K 和后续 Stop / 并发测量尚未完成。保留[原 1K 快照](./cli/evidence/memory-snapshot-cache-2026-10-29/sampling-progress.json)，新增[10K 进展快照](./cli/evidence/memory-snapshot-cache-2026-10-29/sampling-progress-10k.json)。

| 1K 场景      | 已完成样本 | p95        | 当前判断                        |
| ------------ | ---------- | ---------- | ------------------------------- |
| 全量参考查询 | 100        | 631.268ms  | 结果对照基线                    |
| 冷查询       | 100        | 463.657ms  | 本地样本低于 1s；不代表其他规模 |
| 热查询       | 100        | 341.473ms  | **未达到 200ms 目标**           |
| 索引重建     | 100        | 1980.359ms | 保留完整重建成本                |
| 损坏索引恢复 | 100        | 2531.332ms | 重新核验权威数据并恢复派生索引  |

| 10K 场景     | 已完成样本 | p95        | 当前判断                       |
| ------------ | ---------- | ---------- | ------------------------------ |
| 全量参考查询 | 100        | 2547.047ms | 结果对照基线                   |
| 冷查询       | 100        | 1036.680ms | **未达到 1s 目标**             |
| 热查询       | 100        | 354.161ms  | **未达到 200ms 目标**          |
| 索引重建     | 100        | 3642.437ms | 保留完整重建成本               |
| 损坏索引恢复 | 100        | 3874.732ms | 重新核验权威数据并恢复派生索引 |

本地长测期间也进行了模型文档编辑和单 worker 的定向回归，因此这些数据属于共用工作站测量，不能描述为隔离硬件实验。未修改测量绑定的 Memory 查询实现或脚本，也未同时启动另一轮重负载 Memory 测量。

远端矩阵 [40760822884](https://github.com/chainlesschain/chainlesschain/actions/runs/40760822884) 的 **Linux 作业已成功并回读**，Windows / macOS 仍在运行。Linux `complete:true`、工作树干净、Node `22.12.0`、默认 `validate-disk`；11 个来源摘要与准确提交的 Git blob 一致，1500/1500 样本结果摘要与全量参考一致，下载 ZIP 的 SHA-256 与 GitHub 元数据匹配。见[Linux 回读与原报告](./cli/evidence/memory-snapshot-cache-2026-10-29/remote-ubuntu-40760822884/verification.json)。首次制品下载返回 HTTP 401，保留原作业；随后带独立查询参数的只读下载成功，未重跑测量。

| Linux 数据量 | 每场景样本 | 全量基线 p95 | 冷查询 p95 | 热查询 p95 | 重建 p95   | 损坏恢复 p95 |
| ------------ | ---------- | ------------ | ---------- | ---------- | ---------- | ------------ |
| 1K           | 100        | 75.459ms     | 39.985ms   | 10.599ms   | 241.995ms  | 339.223ms    |
| 10K          | 100        | 392.108ms    | 95.337ms   | 18.034ms   | 643.635ms  | 729.399ms    |
| 100K         | 100        | 3719.063ms   | 486.836ms  | 72.194ms   | 4038.006ms | 4313.454ms   |

Linux 本次冷 / 热 p95 低于 1s / 200ms，但工作流只将结果等价和完整性作为门禁，没有配置耗时阈值。该 runner 的观察不替代 Windows 超标结果、完整三系统 SLO、Stop / 混合并发或真实 IDE 验收。

```powershell
node packages/cli/scripts/memory-query-index-benchmark.mjs --counts 1000,10000,100000 --samples 100 --output <disk-100.json>
node packages/cli/scripts/memory-query-index-benchmark.mjs --counts 1000,10000,100000 --samples 100 --modes hot --cache-mode verified-memory --output <verified-memory-hot-100.json>
node packages/cli/scripts/memory-query-responsiveness-benchmark.mjs --counts 1000,10000,100000 --samples 100 --require-cancellation --output <stop-100.json>
node packages/cli/scripts/memory-mixed-concurrency-benchmark.mjs --counts 1000,10000,100000 --rounds 100 --output <mixed-100.json>
```
