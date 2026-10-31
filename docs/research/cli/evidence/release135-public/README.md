# CLI 0.166.135 发行核验进度

CLI **0.166.135** 与 Open VSX **0.37.173** 已公开并完成正式制品回读。JetBrains **0.4.189** 的完整测试、构建、兼容性和 Marketplace 上传已成功；公开列表尚未出现该版本，官方发布回执为等待 Marketplace 审核/上架，不能记为已公开。当前仍可公开下载的 JetBrains 为 **0.4.188**。

CLI / JetBrains 来源为 `82aa6d703a8695721a7ccf0793a435853bc2bbf2`，Open VSX 来源为 `98db89940de30106f57ee73c063acf249d23bec0`。后者仅修改两个 VS Code README/版本文件；CLI、Web Panel、锁文件、SDK、Kernel 对象完全相同，详见 `source-identity.json`。

- `gates.json`：精确 CLI 来源的完整 CLI CI（76/76）与 Strict Sandbox（6/6）。
- `cli.json`、`provenance.json`、`children.json`：公开 npm 字节、OIDC 来源和十个直接子依赖。
- `vscode.json`：公开 VSIX 与正式候选逐字节一致，推荐 CLI 0.166.135。
- `jetbrains-pending.json`：实际公开列表的检查时间与等待状态；它不是公开归档回读。
- `publication.json`：各组件来源、六个成功工作流及尚未合并的 PR #513。

PR #513 仍为草稿且未启用自动合并，等待 JetBrains 公开核验后再合并。发布后的单次真实恢复探针尚未执行，遵守双 IDE 公开后才测试的顺序。历史 OpenAI 36+9 仍为 **39/45**；工程测试和发行不增加任务验收数。Microsoft Marketplace 暂缓；PC/mobile 保持独立 **v5.0.3.143**。

[CLI 发行](https://github.com/chainlesschain/chainlesschain/actions/runs/41168880872) · [CLI 独立回读](https://github.com/chainlesschain/chainlesschain/actions/runs/41169921448) · [Open VSX 发行](https://github.com/chainlesschain/chainlesschain/actions/runs/41171249316) · [JetBrains 上传与等待回执](https://github.com/chainlesschain/chainlesschain/actions/runs/41170221376)。

后续用户调整了测试前置条件：可以用已通过门禁的构建包，不等待 JetBrains 审核。仅复测上次失败 6 项已结束，结果 **1/6**，跨版本累计 **40/45**；[独立重测报告](../../verify01-openai-135/retest-six-99b93fc209/REPORT.md)。上面的发行回执保持其原始检查时间与待审事实，不将测试包可用记为商店批准。
