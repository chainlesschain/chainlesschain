# PERF-01 完整 ID 删除的实际 Service 路径对照

实际测量提交为 `8b13129624d4b7fa5b122a4109151c574564448e`，原实现为 `22c0e4036cd08f6a205539c88fcdec47081af544`。测量在干净 detached 工作树中执行；后续 `736784f999` 和 `8458a0a502` 的完整 `packages` Git tree 与被测提交相同，均为 `bce9601db3e9336c76095d4c1dc845ea00c17243`。源码相同不代替后续提交的托管发布矩阵。

| 记录数  | 配对样本数 | 原实现 p95    | 点读实现 p95 |
| ------- | ---------- | ------------- | ------------ |
| 1,000   | 11         | 660.816 ms    | 211.429 ms   |
| 10,000  | 11         | 1,665.553 ms  | 236.856 ms   |
| 100,000 | 11         | 11,411.213 ms | 647.778 ms   |

调用真实 `CliCanonicalMemoryService.delete`、生产 `SegmentedMemoryPort` 和 Kernel；两份独立存储导入同一规范快照，11 对完整 ID 交替执行原实现和候选，不并发、不清操作系统缓存。原实现每档调用 `listRecords/query` 各 11 次，候选均为 0 次；候选每次还保留 Kernel 内的身份点读。

66 次删除全部返回 `purged`。计时结束后重新打开六份存储，逐档核对原审计前缀、11 个清空墓碑、其余 active 记录、11 个 reconciliation 及 `+44 storeRevision / +22 events`。独立回读程序复算全部分位数并校验源码、依赖和执行程序摘要。

范围仅本机 Windows x64 / Node 22.22.2、Intel i7-4770HQ、16 GiB 内存，canonical 路径的 `purgePorts=[]`。计时包含 ID 解析、删除状态转换、reconciliation、分片及 manifest 持久化和返回回执；排除 CLI 启动、legacy 隐私清理、夹具准备及后验。每档 11 个样本按 nearest-rank 计算，p95/p99 等于最大值，不是统计置信界。该结果不关闭全扫 recall、分页/二级索引、全平台或目标硬件 SLO，也不替代真实项目效果验收。

`memory-exact-delete-comparison-8b131.raw.json` 为未修改的原始数据，SHA-256：`0006470d8ec807400e429449b9dbe70886d7c163ebd2fee93dad94184ca15b42`。`.method.json` 记录独立回读及上述后续源码等价证明。

同目录三个 `.mjs` 为实际执行程序的原样归档，没有为发布文档重新格式化。benchmark 从当前工作目录加载候选生产源码，要求 HEAD 为被测提交且工作树干净，生成 baseline 时仅将其 runtime import 指向已核对字节相同的候选 runtime，保留原 Service 主体。baseline 和回读程序包含本次环境的绝对路径；复放时应恢复对应 detached 工作树及依赖布局，或在副本中调整路径并记录新程序摘要和新测量结果。不要修改归档原件后沿用原始执行摘要。
