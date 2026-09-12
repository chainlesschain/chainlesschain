# Claude Code / Codex 差距优化：G10 持久路径容量测量实施记录

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 范围：测量 CLI canonical Memory JSON authority 与后台 Agent 状态目录的实际持久路径，记录跨进程锁等待、p50/p95/p99、峰值 RSS 和当前配置上限。本批不预设性能 SLO，不用内存算法基准替代磁盘结果，也尚未加入后台列表索引/分页。

## 1. 交付结果

新增两个入口：

```powershell
# 开发 smoke：Memory 100/1k，后台任务 100/1k
npm run benchmark:cli-persistent-capacity

# 正式测量：Memory 1k/10k/100k，后台任务 1k/10k
# formal 要求干净工作树；建议由下述手动三平台 workflow 运行
npm run benchmark:cli-persistent-capacity:formal -- --candidate-sha <exact-sha> --output <receipt.json>
```

主要实现：

- [持久容量基准](../packages/cli/scripts/persistent-capacity-benchmark.mjs)
- [DurableJsonMemoryPort](../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js)
- [跨进程文件锁](../packages/cli/src/lib/with-file-lock.js)
- [后台 Agent 列表生产路径](../packages/cli/src/lib/background-agent-supervisor.js)
- [手动三平台精确 SHA 工作流](../.github/workflows/cli-persistent-capacity.yml)

报告 schema 为 `chainlesschain.persistent-capacity-measurement/v1`。每份报告绑定当前完整 SHA、工作树是否干净、OS release、架构、Node 版本、profile 与配置上限，并计算 canonical digest。formal profile 不允许移除 1k/10k/100k Memory 或 1k/10k 后台任务档位，也不允许把样本降到 11 以下、并发降到 8 以下。

工作流只支持手动触发，要求调用者提供小写 40 位 SHA，在 Ubuntu、Windows、macOS 分别 checkout 并再次校验 HEAD/clean 状态；结果按 OS、SHA 和 run attempt 独立上传。工作流的存在不等于本提交已经取得三平台结果。

## 2. 实际测量路径

### 2.1 Durable Memory

每个档位生成 digest 有效的 `chainlesschain.cli-context-memory-store/v1` 文件，records 与 audit events 一一对应。夹具直接生成，以免用 O(n²) 的逐条全文件重写掩盖被测操作；报告明确 `seededThroughProductionCommit:false`，并把 setup 时间和字节数单列。

随后使用真实 `DurableJsonMemoryPort` 测量：

- 新 Node 进程首次 `query` 的 wall time、operation time 和 RSS；
- 同一进程 `query`、单 ID `read`、`listRecords` 全量排序的 p50/p95/p99；
- 多 Node 进程并发全量读取；
- 不同记录的并发 reinforce 更新；
- 不同记录的并发 tombstone + purge 删除；
- 所有生产端口操作的锁获取时间与重试次数；
- 操作前后文件字节数、实际记录数、64 MiB 文件上限与 100,000 audit-event 上限。

`withFileLock` 现在把 `waitMs` 与 `attempts` 放入既有 callback context。Durable port 仅在显式提供 `lockObserver` 时投影这两个值；observer 异常会被隔离，不能改变权威读写。正常产品路径没有新增持久状态或回调开销之外的第二权威源。

100,000 档位刻意保留“一条记录对应一条事件”，所以已到默认事件上限。更新和删除预期可能返回 `CONTEXT_MEMORY_STORE_LIMIT`；如果夹具超过 64 MiB，读路径应返回 `CONTEXT_MEMORY_STORE_CORRUPT` 的配置上限原因。报告用 `reachable`、`reachedConfiguredEventCeiling` 和 worker failures 保存事实，不把 100k 写成已承诺的记忆容量。

### 2.2 后台任务

后台任务夹具使用现行每任务一个 JSON 文件的目录形态，全部标为 terminal，避免进程身份探针干扰列表测量。随后真实调用 `listBackgroundAgents({all:true,persist:false})`，记录新 Node 进程首次列表及同进程全目录枚举、逐文件 JSON 读取、状态投影、排序的 p50/p95/p99 与 RSS。

报告固定写明：

```json
{
  "paginationApplied": false,
  "indexApplied": false
}
```

因此这份基准能为索引/分页决策提供前后对照，但不会把当前仍为 O(n) 的实现描述成已优化。

## 3. 报告不等于性能 PASS

基准没有擅自设置“1k 必须低于多少毫秒”等阈值。所有结果固定包含：

```json
{
  "qualification": {
    "performanceGate": false,
    "productionQualified": false,
    "reason": "measurement-only-no-approved-slo"
  }
}
```

在获得目标硬件的多轮曲线、产品交互预算和回归方差前，设置任意阈值只会制造虚假的绿色门。后续应先保存精确 SHA 三平台 formal 报告，再批准各档位 SLO；SLO 一旦批准，另加 gate，不能追溯修改旧 measurement 含义。

## 4. 本地验证

| 检查                                                 | 结果                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| 容量 harness、真实持久端口/后台列表与 file-lock 回归 | 2 files，35 passed                                            |
| CLI canonical Context/Memory Node suite              | 20 passed                                                     |
| 目标 ESLint                                          | 0 errors/warnings                                             |
| 最小真实旅程（6 条 Memory/6 条后台状态）             | 并发 read/update/delete、锁观测与后台 full scan 全部完成      |
| 默认 smoke（100/1k）                                 | `status=measured`，约 21.3s；两档均 reachable，并发操作均成功 |

本机默认 smoke 是 Windows 10.0.19045 / Node 22.22.2，在父提交 `7fa21b99b77e38f61d98957eb3febb50e5776470` 的开发中工作树运行；报告标记 `cleanWorktree:false`、`productionQualified:false`，没有签入机器相关 receipt。观测到 Memory 1k 的 query p95 约 273.6ms、list/sort p95 约 281.4ms；后台任务 1k 的 full scan p95 约 561.5ms。这些单机少样本值只证明 harness 走通，不是 SLO，也不外推到其他提交或 OS。

## 5. 保留边界

- 尚未运行 1k/10k/100k Memory 与 1k/10k 后台任务的精确 SHA 三平台 formal workflow。
- 夹具 setup 不是逐条生产 commit；报告单列 setup，只对 setup 后的生产读写操作计时。
- “cold process”包含 Node 启动，但宿主 page cache 可能仍是热的；真正冷盘需要受控宿主或 cache 处理权限，不能由普通脚本假定。
- 锁 `waitMs` 包含锁目录安全发布时间；跨进程并发结果同时受文件解析、全量重写、fsync 和调度影响。
- 当前没有后台任务只读索引、cursor 分页或归档；也没有将 JSON Memory 迁移到分段/SQLite。
- 尚未覆盖断电、磁盘写满和 250,000-event 演化账本目标；这些与本批的 Memory 100,000 audit-event 上限是不同容量单位。

因此，G10 的“先测实际持久路径”工具与精确 SHA 三平台执行入口已经落地；是否加索引、分页、分段存储及其性能门，要以 formal 曲线为依据继续实施。
