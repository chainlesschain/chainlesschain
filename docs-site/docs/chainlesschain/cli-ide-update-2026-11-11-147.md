# CLI 0.166.147 公开发行与 IDE 配套进度

更新日期：2026-11-11。CLI 已公开并核验，IDE 配套仍待宿主检查及发行。

| 渠道                  | 当前已核验公开版本 | 新候选   | 发布条件                                                                            |
| --------------------- | ------------------ | -------- | ----------------------------------------------------------------------------------- |
| npm CLI               | 0.166.147          | —        | 已完成三平台 CLI CI 76/76、Strict Sandbox 6/6、Actions OIDC 发布及公开字节/来源回读 |
| Open VSX              | 0.37.185           | 0.37.186 | CLI 先公开；同一提交的 IDE / ARM64 / Remote-SSH 检查及公开 VSIX 回读                |
| JetBrains Marketplace | 0.4.200            | 0.4.201  | CLI 先公开；原生宿主、ARM64、构建检查及上传；审核/上架与公开下载单独核验            |

当前可安装 CLI：`npm i -g chainlesschain@0.166.147 --registry https://registry.npmjs.org`。重启宿主，运行 `cc --version` 和 `cc doctor`。准确发布源码 `32451e4d568e414acdb9c956208e5cff827cd6e0` 的 [OIDC 发行](https://github.com/chainlesschain/chainlesschain/actions/runs/42976618525)与[公开回读](https://github.com/chainlesschain/chainlesschain/actions/runs/43032767673)成功，公开 tarball 为 9,628,979 字节，与官方不可变制品逐字节一致，来源证明验证通过。两端 IDE 候选均推荐 0.166.147，现有公开 IDE 仍推荐 0.166.146；Session Core 0.3.27、Protocol 0.1.13、Agent SDK 0.2.18、Context/Memory Kernel 0.1.12 保持现有版本。

IDE 修正提交 `c3ac7485b2e671864acc52da1fa36fa13ad134fa` 的主矩阵已通过，标准插件单元测试为 353/353。ARM64 首次 Windows JetBrains 菜单失败已保留，正在原样复跑该宿主与汇总，未改源码或断言。IDE 标签及公开状态须在完整门禁通过后另行核验。[本批发行回执](../../../docs/research/cli/evidence/release147-public/README.md)。

本批 CLI 将原始 manifest catalog/head 所有权沿真实工厂传递，拒绝跨实例拼接端口或认领被替换的目录；已有自定义后端读写合同保持可用。这是自进化存储链的一个增量，不授予完整存储图或自动晋升权限。DMM 新增的是隔离受控时钟的真实 Electron 通知验收旅程，实际执行结果、真实整夜运行及已安装客户端验收分别记录。

JetBrains 0.4.200 已获批准、列出并可下载，更新 ID 为 1217276。公开包的 631 个 ZIP/JAR payload 与官方构建逐项相同；外层 ZIP 摘要不同。[正式发布](https://github.com/chainlesschain/chainlesschain/actions/runs/42945700403) · [公开下载](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1217276)。新候选保留这次 Rewind 修复。

新增 36+9 复测准备沿用原任务源码、分配、模型和预算，在独立轮次重复 36 项维护任务及九次首次安装；发布证明未齐时不启动。比较基准为历史单轮严格通过 **24/45**，不能使用跨版本累计 36/45 作为单轮完成率。新任务成绩尚未产生；结果需分别列出生成、独立验收、严格完成、成本与耗时，版本变化也不能直接归因于自进化学习。[历史单轮回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/README.md)。

Microsoft Marketplace、移动/PC 客户端、独立业务效果、账单对账和付费准入仍需各自的验证与发行。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。
