# .131 原生任务续测当前进度

远端状态观察：2026-10-29T16:40:18.040Z。本页按真实运行及严格 ledger 更新，不以作者声明、发布或本地测试增加合格数。

累计独立合格 **34/45**，剩余 **11**；本轮已收集生成 **3**、独立验收 **3**、新增合格 **0**。按用户最新要求，先完成 CLI / JetBrains 两项首次安装旅程。

人工辅助修复另列：[verify-10](./cli-ide-assisted-verify10-progress-2026-10-30.md)、[CLI 分页 verify-07](./cli-ide-assisted-cli07-progress-2026-10-30.md)、[JetBrains 来源 verify-09](./cli-ide-assisted-install-progress-2026-10-30.md) 均已通过原检查器的独立 GitHub Actions 复验，完成 **3 项**。三文件已仅经格式化安装到主线工作区，当前主线相关六文件 **70/70** 通过，见[安装与本机复核](./cli/evidence/native131-assisted-integration-2026-10-30/review.json)。不回写原自动候选或累计数，也不冒充完整 macOS 首次安装旅程通过。

| 任务 | 平台 / 入口 | 本轮生成 | 独立验收 | 当前阶段 | 运行 |
| --- | --- | --- | --- | --- | --- |
| first-run-darwin-cli | macOS / CLI | 未通过 | 未通过 | 本次尝试未通过 | [40905249327](https://github.com/chainlesschain/chainlesschain/actions/runs/40905249327) |
| first-run-darwin-jetbrains | macOS / JetBrains | 通过 | 未通过 | 本次尝试未通过 | [40909552042](https://github.com/chainlesschain/chainlesschain/actions/runs/40909552042) |
| verify-10 | Windows / CLI | 通过 | 未通过 | 本次尝试未通过 | [40897500088](https://github.com/chainlesschain/chainlesschain/actions/runs/40897500088) |
| verify-04 | Linux / CLI | 未完成 | 未执行 | 待派发 | — |
| verify-13 | Linux / CLI | 未完成 | 未执行 | 待派发 | — |
| verify-09 | macOS / JetBrains | 未完成 | 未执行 | 待派发 | — |
| verify-30 | Windows / JetBrains | 未完成 | 未执行 | 待派发 | — |
| verify-07 | macOS / CLI | 未完成 | 未执行 | 待派发 | — |
| verify-19 | Windows / CLI | 未完成 | 未执行 | 待派发 | — |
| verify-08 | macOS / VS Code | 未完成 | 未执行 | 待派发 | — |
| verify-11 | Windows / VS Code | 未完成 | 未执行 | 保留原未决请求，本入口不派发 | — |

使用公开 CLI **0.166.131**、Open VSX **0.37.169**、JetBrains **0.4.186**。评价源码固定为 `44fd177967e498707ae904fd2efed7a78f2045fb`；[本轮计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-131-preflight-repair-20261029-plan.json)保留原项目、模型、回合 / 请求 / 输出预算与六文件工具条件。逐项收齐用量和独立验收后再派下一项。

原前置运行 `40886343743` 在生成前终止，见[修复与独立证书](./cli-ide-native-preflight131-progress-2026-10-29.md)，未计作已完成模型任务。原 .127 / .129 未决责任仍保留；Microsoft 渠道暂缓。

本轮三个已派发运行均已结束并完成严格收集，物理请求 / 完整用量分别为 **10/10、3/3、14/14**，三个 broker 均未 poisoned。后续只读准入预览使用旧资金观测，在共享记账阶段返回 `EXISTING_AUTHORIZED_COVERAGE_INSUFFICIENT`，没有派发新样本。用户随后提供当前账户余额并明确继续授权，已另行追加私有观测与下一版本授权记录，保留历史累计、单项上限和未决预留，未覆盖旧记录或宣称账单已核对。独立辅助 CI 不调用模型，也不替代完整原生首次安装旅程。

按用户最新要求，需要产品修复的任务先完成修复及准确源码完整门禁，再依次发布所需子包、CLI 和 IDE，核验公开制品后以新版本、新计划及新来源重测。本轮不再继续使用旧版本派发；原失败与未决记录保留，原派发 journal 不迁移到新 SHA。Microsoft 渠道暂缓。
