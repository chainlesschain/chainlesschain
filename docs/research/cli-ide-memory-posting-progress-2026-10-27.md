# CLI / IDE 差距优化第八批：Memory 索引候选合并

日期：2026-10-27。承接[差距复核](./cli-ide-codex-claude-gap-review-2026-10-27.md)及[PERF-04 实施计划](./cli-ide-codex-claude-implementation-plan-2026-10-15.md#perf-04-将性能数据变成可执行目标)。基线为 `6b76d4fd5486f44c8cc662512edbb8db45b64266`。

## 本批改动

[Memory 查询索引](../../packages/cli/src/lib/context-memory-kernel/memory-query-index.js)原先先将每种筛选条件的多个位置列表展开、去重、排序，再选择其中最短的一组。分类已将候选缩小到几条记录时，宽泛的标签、作用域或 sink 列表仍会先被完整合并，产生额外计算和临时分配。

现在先比较现成位置列表的长度，再按需要合并其他列表：

- 某组的任一列表已不短于当前最优候选，其并集也不会更短，直接跳过合并。
- 合并过程中，一旦候选数量达到当前最优数量，停止构造该并集。
- 确实更小的并集才排序；记录仍逐条通过原有全部筛选条件。

保留原排序、游标二分定位、重复位置去重和跨分片归并。没有改变存储格式、磁盘校验、锁、内容摘要、generation 绑定或默认 `validate-disk` 策略；已有 `verified-memory` 的失效规则继续适用。

## 验证

新增[候选选择回归](../../packages/cli/__tests__/unit/memory-query-posting-selection.test.js)：28 组查询分别在无游标及两个游标位置核对全量扫描，共 84 组结果比较，覆盖分类、作用域、sink、标签、生命周期、空筛选和排序边界。独立用例监测宽泛位置列表的实际访问，验证窄分类存在时不遍历它们；只读冻结列表检查未修改原索引。

既有存储回归覆盖索引缺失 / 截断 / 过期重建、损坏权威分片、硬链接、generation 改变、竞争 CAS 写入、只读影子、权限过滤及召回不提前截断。补充 CLI 分页与存储容量检查。

| 检查           | 结果                                                              |
| -------------- | ----------------------------------------------------------------- |
| 算法与存储组合 | 4 个套件，41 项通过，1 项跳过                                     |
| CLI 与边界补充 | 5 个套件，25 项通过；与前组重复的 5 项不累计                      |
| 去重合计       | 7 个套件，61 项通过，1 项 Windows 不适用的目录 fsync 故障测试跳过 |
| 静态检查       | 修改代码的语法、Prettier 及 `git diff --check` 通过               |
| ESLint         | 本地缺少 `@eslint-community/eslint-utils`，未能启动，不计为通过   |

最终补充运行包含加强后的 sink 拒绝 / 通配组合及实际哈希分片 benchmark fixture；生产修改在上述存储回归后未再变化。

## 局部性能基线

[测量脚本](../../packages/cli/scripts/memory-posting-selection-benchmark.mjs)生成 1K / 10K / 100K 条合成元数据，按生产 SHA-256 前两位规则分入最多 256 个桶。比较[基线合并算法副本](../../packages/cli/__tests__/fixtures/memory-query-eager-selection-v1.mjs)与新算法，共用相同的筛选、排序、游标及跨桶归并函数；两者的每次输出均与全量扫描结果核对。

原始报告：[selection-benchmark.json](./cli/evidence/memory-posting-selection-2026-10-27/selection-benchmark.json)。记录实现和样本摘要、结果摘要、分片数、样本数与环境。Windows x64、Node `22.22.2`、ICU `78.2`、Intel Core i7-4770HQ；每个场景预热 5 次，再交替执行两个算法各 100 次。

下表均为**内存中的筛选及分页合并 p95**，不包含索引编译、文件 I/O、锁、权威分片校验或 kernel 排名。

| 记录数 | 非空桶数 | 窄分类 + 宽 sink：原算法 | 新算法  |
| ------ | -------- | ------------------------ | ------- |
| 1K     | 254      | 1.526ms                  | 0.852ms |
| 10K    | 256      | 4.992ms                  | 0.751ms |
| 100K   | 256      | 28.869ms                 | 0.800ms |

100K 档的全部场景：

| 场景                     | 原算法 p95 | 新算法 p95 | 与全量扫描一致 |
| ------------------------ | ---------- | ---------- | -------------- |
| 窄分类 + 宽 sink         | 28.869ms   | 0.800ms    | 是             |
| 窄分类 + 宽标签 / 作用域 | 60.354ms   | 3.684ms    | 是             |
| 稀疏标签并集 + 游标      | 31.666ms   | 3.596ms    | 是             |
| 空作用域准入             | 48.283ms   | 0.921ms    | 是             |
| 无筛选的首屏对照         | 0.631ms    | 0.693ms    | 是             |

无筛选对照在该档略慢，不能概括为所有查询均加速。局部计算减少也不能直接推导完整 Memory 查询满足热 p95 <200ms 或冷 p95 <1s；磁盘读取、完整索引校验、重建、事件循环延迟、Stop 响应及并发吞吐的完整基线仍待独立测量。不得与旧报告的 854ms 热查询直接相减或换算收益。

报告保留 `fullStoreSloVerified:false`、`providerCalls:0`。本批没有模型请求、付费任务或发行，不改变正式任务、预算及 native 验收状态。

复现命令：

```bash
# packages/cli；纯本地元数据测量，不访问模型或实际用户 Memory
node scripts/memory-posting-selection-benchmark.mjs --output ../../docs/research/cli/evidence/memory-posting-selection-2026-10-27/selection-benchmark.json

node ../../node_modules/vitest/vitest.mjs run __tests__/unit/memory-query-posting-selection.test.js __tests__/unit/memory-posting-selection-benchmark.test.js __tests__/unit/memory-query-index.test.js __tests__/unit/segmented-memory-port.test.js --maxWorkers 1

node ../../node_modules/vitest/vitest.mjs run __tests__/unit/memory-query-posting-selection.test.js __tests__/unit/memory-posting-selection-benchmark.test.js __tests__/unit/memory-show-pagination.test.js __tests__/unit/memory-status.test.js __tests__/unit/durable-memory-port-limits.test.js --maxWorkers 1
```
