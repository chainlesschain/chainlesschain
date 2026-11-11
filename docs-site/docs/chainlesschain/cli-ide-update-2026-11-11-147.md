# CLI 0.166.147 与 IDE 配套候选

更新日期：2026-11-11。本文记录本批候选，公开状态按下表核对。

| 渠道                  | 当前已核验公开版本 | 新候选    | 发布条件                                                                         |
| --------------------- | ------------------ | --------- | -------------------------------------------------------------------------------- |
| npm CLI               | 0.166.146          | 0.166.147 | 同一提交的完整 CLI CI / Strict Sandbox 三平台检查；Actions OIDC 发布与公开包回读 |
| Open VSX              | 0.37.185           | 0.37.186  | CLI 先公开；同一提交的 IDE / ARM64 / Remote-SSH 检查及公开 VSIX 回读             |
| JetBrains Marketplace | 0.4.200            | 0.4.201   | CLI 先公开；原生宿主、ARM64、构建检查及上传；审核/上架与公开下载单独核验         |

当前可安装 CLI：`npm i -g chainlesschain@0.166.146 --registry https://registry.npmjs.org`。候选发布核验通过后，使用 `npm i -g chainlesschain@0.166.147 --registry https://registry.npmjs.org`，重启宿主，运行 `cc --version` 和 `cc doctor`。两端 IDE 候选均推荐 0.166.147；Session Core 0.3.27、Protocol 0.1.13、Agent SDK 0.2.18、Context/Memory Kernel 0.1.12 保持现有版本。

本批 CLI 将原始 manifest catalog/head 所有权沿真实工厂传递，拒绝跨实例拼接端口或认领被替换的目录；已有自定义后端读写合同保持可用。这是自进化存储链的一个增量，不授予完整存储图或自动晋升权限。DMM 新增的是隔离受控时钟的真实 Electron 通知验收旅程，实际执行结果、真实整夜运行及已安装客户端验收分别记录。

JetBrains 0.4.200 已获批准、列出并可下载，更新 ID 为 1217276。公开包的 631 个 ZIP/JAR payload 与官方构建逐项相同；外层 ZIP 摘要不同。[正式发布](https://github.com/chainlesschain/chainlesschain/actions/runs/42945700403) · [公开下载](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1217276)。新候选保留这次 Rewind 修复。

新增 36+9 复测准备沿用原任务源码、分配、模型和预算，在独立轮次重复 36 项维护任务及九次首次安装；发布证明未齐时不启动。比较基准为历史单轮严格通过 **24/45**，不能使用跨版本累计 36/45 作为单轮完成率。新任务成绩尚未产生；结果需分别列出生成、独立验收、严格完成、成本与耗时，版本变化也不能直接归因于自进化学习。[历史单轮回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/README.md)。

Microsoft Marketplace、移动/PC 客户端、独立业务效果、账单对账和付费准入仍需各自的验证与发行。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。
