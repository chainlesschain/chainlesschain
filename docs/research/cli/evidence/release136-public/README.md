# CLI 0.166.136 公开包核验

CLI **0.166.136** 已通过精确提交 CLI CI（76 项任务）和 Strict Sandbox（6 项任务），经 Actions OIDC 发布；独立公共回读校验公开 tarball 与正式制品逐字节一致，签名来源缺失/无效均为 0。

来源：`539e4da6ef89e5142a3f3bb90e2d6123c6afb15e`。[发布](https://github.com/chainlesschain/chainlesschain/actions/runs/41206368406) · [独立公共回读](https://github.com/chainlesschain/chainlesschain/actions/runs/41241946884)。详见 gates.json、cli.json、provenance.json、publication.json。

本轮是 CLI 修复；IDE 沿用 Open VSX 0.37.173 与 JetBrains 0.4.189 官方构建，它们的推荐标记仍为 CLI 0.166.135。JetBrains 构建可用于已授权测试，商店审核状态未在本轮重查。发行及工程回归不增加模型任务通过数；仅五项失败复测另行记录。
