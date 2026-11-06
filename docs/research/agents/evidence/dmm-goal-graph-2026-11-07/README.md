# 个人项目目标 Graph 接线与恢复证据（2026-11-07）

本批推进 DMM-00/01/03/09，将个人项目风险巡检接入已有 canonical Graph kernel。源码基于 `a2e7f17a03df38bd8e97a8a977351f37dd5319c3`；测试快照逐文件 SHA256、命令、依赖版本及报告摘要见 [summary.json](./summary.json)。这是本地工程证据，尚未完成新提交的远端矩阵、真实产品 GUI 或生产切换。

## 实现与存储边界

桌面可信主进程通过独立 [CLI host 入口](../../../../../packages/cli/src/host/README.md) 装配 Graph，不加载 CLI 主程序或启动模型循环。`CHAINLESSCHAIN_GRAPH_PROJECT_GOALS` 支持 `legacy`（默认）、`shadow`、`canonical`。未参与 Graph 的默认 legacy 路径不创建 Graph 日记；组织项目仍使用独立宿主，不继承个人项目开关。

三个持久域分别承担原生项目目标/业务回执与参与水位、独立调度库的 occurrence/lease，以及独立 `graph.sqlite` 的 Graph 历史与切换账本。不宣称跨库原子事务。原生参与记录在 Graph 调用前保存，业务执行前固定 Graph head；项目库与 Graph 库持有配对身份。已启用库缺失、被替换、历史回退或内容损坏均拒绝继续，开关回到 legacy 也不会自动退回旧执行路径。即使调度器已有成功缓存，也要重验原生凭据和 Graph 历史。

原生结果已提交、Graph receipt 未落盘的间隙，仅允许同步读取当前授权下完全匹配的原生结果，恢复同一 Graph 结果，不重新运行 adapter 或重复计费。没有原生证明的未知结果保留 reconciliation。只读验证不获取 Graph writer；调度 lease 被接管后，迟到旧 fence 不能写原生数据。权限、预算、原生逐次确认及独立目标完成检查仍由原服务执行。

## 旧读取器与格式门槛

显式参与 Graph 时，仅该目标升级为 `chainlesschain.goal/v2`、`requiresGraphAwareHost: true`；objective revision 和 controlGeneration 保持不变，这是读取器最低能力要求的格式升级。未参与目标继续使用 v1。新原生 CAS 拒绝去除该要求；缺少 Graph-aware host 的监控引擎拒绝运行参与目标。

冻结的旧 validator 来自已公开 Session Core **0.3.26** 的准确源码 `3fa3a4b258bbcb60b23b4298cec375661ad6f410`。测试验证原始源码（统一 LF）与 fixture 字节一致，SHA256 为 `1be40a2a686ce8ae1a21afd31882677f1bd66dbd8858a86326500694315f9479`，并执行旧 validator 证明旧 v1 仍可读取、参与后的 v2 无法读取或修订。这不是旧 Electron 安装包的真实启动验证。

## 已运行验证

Windows 10 x64、Node **22.22.2**、Vitest **4.1.10**、better-sqlite3 **12.11.1**。本批共 **55 个不重复文件、866 项通过，0 失败、0 跳过**；不与此前移交批次的 49 文件/790 项相加。

| 范围                                | 文件数 | 通过 | 报告                                                           |
| ----------------------------------- | -----: | ---: | -------------------------------------------------------------- |
| CLI Graph、调度、目标及真实进程恢复 |     30 |  438 | [cli-tests.json](./cli-tests.json)                             |
| 桌面完整 business-actions 配置      |     20 |  392 | [desktop-tests.json](./desktop-tests.json)                     |
| Session Core 目标合同               |      1 |   19 | [contract-tests.json](./contract-tests.json)                   |
| 组织宿主兼容                        |      2 |   14 | [organization-host-tests.json](./organization-host-tests.json) |
| npm pack 隔离宿主边界               |      2 |    3 | [packed-host.tap](./packed-host.tap)                           |

新增真实子进程用例覆盖四条路径：原生提交后/Graph receipt 前被终止；Graph 完成后/调度投影前被终止并将开关改回 legacy；Graph 启动后且尚无原生证明被终止；原进程仍存活时 lease 被接管，旧 fence 写入被拒绝。父进程独立读取持久状态，并验证无重复执行/usage 或未知结果自动重放。

使用真实 SQLite、已有 Graph kernel、磁盘身份/历史水位、进程终止、Windows ACL 和隔离 npm pack。桌面完整配置在 sandbox 外运行原有 ACL/localhost 测试，没有削弱保护条件。打包验证实际 CLI 与 Session Core tarball 源码、仅复制声明的 Ajv 依赖闭包，以 Node 原生 SQLite 加载公共 host 并验证 terminal result，不启动 CLI 或写入真实用户配置。

Electron 窗口、对话框、登录状态和项目数据为测试替身/合成数据。生产签名与 coverage 验证使用 fixture；不能当作真实生产观察。

复核命令：`node docs/research/agents/evidence/dmm-goal-graph-2026-11-07/verify-evidence.mjs`。它核对报告完整性、非重复文件、packed TAP、旧 validator 来源，重新执行 diff/固定 IPC/源码出口检查，并输出带源码摘要的 summary；它不会重新运行上述测试，不能代替测试报告。源码出口审计通过，但 `paidReady` 与 `runtimeCoverageVerified` 仍为 false。

## 生产清单与未完成项

清单新增 `scheduler/desktop-project-goals`，冻结数量为 **5 surfaces、24 entries、21 durable、8 migrate、13 retire、3 disabled**，对应 **22 store slots / 66 platform-store slots**。生产 gate 因此要求 **72 份独立签名来源回执**；此前 23-entry/69-receipt 证据不满足新清单。本批仅验证 gate fixture，未运行真实观察或宣称已切换生产权威。

尚未运行真实 Electron/IDE GUI、独立业务样本效果、Linux/macOS、完整安装包、新源码远端发行矩阵、24-entry 真实生产观察/分阶段切换，以及断电或任意备份库回滚恢复。其他业务 adapter、默认关闭的试点、迁移与回退验收仍待继续。新增 host API 不在公开 CLI **0.166.143** 中；本批未发布新包。DMM 总体目标保持进行中，P2 的独立部署/真实连接器条件保留。
