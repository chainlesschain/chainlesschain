# CLI 0.166.147 公开发行与 IDE 配套进度

## 概述

更新日期：2026-11-11。CLI **0.166.147 已公开并核验**。Open VSX **0.37.186** / JetBrains **0.4.201** 仍等待新提交的完整宿主及 ARM64 验证，当前未发布。现有公开插件为 **0.37.185 / 0.4.200**，均仍推荐 CLI **0.166.146**。

## 核心特性

本批 CLI 将原始 manifest catalog/head 所有权沿真实工厂传递，拒绝跨实例拼接端口或认领被替换的目录，保留已有自定义后端读写合同。这是自进化存储链的增量，不授予完整存储图或自动晋级权限。独立 36+9 复测已准备，尚无新完成率。

桌面源码另有受控时钟下的真实 Electron 跨夜通知验收，不能据此宣称真实整夜运行或新桌面客户端已公开。IDE 新修正让 Rewind 菜单等待原生焦点恢复后显示，实际新宿主验收仍在进行。

## 系统架构

发行顺序为：公开子包 → CLI → IDE 插件 → 移动/PC 客户端。IDE 通过配套 CLI 运行；插件升级不会替换客户端内固定的 CLI，也不会代替业务动作的原生确认。

CLI 发行源码为 `32451e4d568e414acdb9c956208e5cff827cd6e0`；IDE 焦点修正候选为 `674593a1bb21a68d33b56dc0cb6ed420212143a2`。两者使用各自准确提交的证据。

## 配置参考

| 组件                  | 当前公开版本 | 本批配套目标与状态                          |
| --------------------- | ------------ | ------------------------------------------- |
| npm CLI               | 0.166.147    | OIDC 发布、来源证明及公开字节回读通过       |
| Open VSX              | 0.37.185     | 0.37.186 待完整宿主/ARM64 门禁与公开回读    |
| JetBrains Marketplace | 0.4.200      | 0.4.201 待完整门禁、上传及审核/公开下载核验 |
| Session Core          | 0.3.27       | 不变                                        |
| Agent Protocol        | 0.1.13       | 不变                                        |
| Agent SDK             | 0.2.18       | 不变                                        |
| Context/Memory Kernel | 0.1.12       | 不变                                        |

需要 Node.js **22.12.0 或更新版本**。两款新 IDE 候选都推荐 CLI **0.166.147**；本页不会把候选版本列作已公开下载。

## 性能指标

本批没有新增吞吐、延迟或真实模型完成率测量。公开 CLI tarball 为 **9,628,979 字节**，这是分发体积，不是运行性能成绩。

36+9 的比较基准为历史单轮严格通过 **24/45（53.3%）**，不能使用跨版本累计 36/45 作为单轮基准。新一轮仍为 **PREPARED_NOT_RUN**；版本分数变化也不能直接归因于自进化学习。

## 测试覆盖

| 范围               | 准确来源与结果                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 完整矩阵       | 发布源码的 [CLI CI 76/76](https://github.com/chainlesschain/chainlesschain/actions/runs/42959022247)、[Strict Sandbox 6/6](https://github.com/chainlesschain/chainlesschain/actions/runs/42959022282) 全部成功，覆盖全部配置宿主                                                 |
| CLI 正式发布与回读 | [OIDC 发行](https://github.com/chainlesschain/chainlesschain/actions/runs/42976618525)及[公开回读](https://github.com/chainlesschain/chainlesschain/actions/runs/43032767673)成功；公开 tarball 与官方不可变制品逐字节一致                                                       |
| 旧 IDE 候选        | `c3ac7485b2e671864acc52da1fa36fa13ad134fa` 的标准单元 353/353 和主矩阵通过；ARM64 Windows 菜单两次执行失败，均保留                                                                                                                                                               |
| 新 IDE 修正        | `674593a1bb21a68d33b56dc0cb6ed420212143a2` 的五项新 JUnit 及真实最低 SDK 源码编译通过；[新主矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/43039428960)和[新 ARM64 矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/43039429061)尚待完成 |

本地扩展检查另保留工作树 Git 路径解析限制，不将其记为通过。上述结果不累加成不同源码的一次全量成绩。

## 安全考虑

CLI 使用 GitHub Actions OIDC Trusted Publishing，正式流程先核对公开子包及仅 registry 安装，再发布 CLI。来源证明绑定固定标签 `v-npm-0-166-147`、准确源码与正式运行；公开包回读核对完整字节。

本次发行不扩大自动晋级、独立业务效果、账单对账或付费准入范围，**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。模型配置和逐次业务确认仍由用户核对。

## 故障排查

- `cc --version` 仍为旧版本：关闭旧 CLI/IDE 宿主，重启后用 `cc doctor` 核对实际 CLI 路径，再检查全局安装。
- 编辑器找不到 0.37.186 或 0.4.201：这两个版本仍待发布，源码版本号不代表渠道已提供下载。
- 插件提示 CLI 配对版本：先核对安装渠道和版本，再更新 CLI 并重启宿主；现有公开 IDE 仍推荐 .146，新候选推荐 .147。
- ARM64 Rewind 菜单关闭：两次失败及新焦点交接修正已记录，等待完整新宿主验收；不将本地单元通过视为已解决全部原生问题。

## 关键文件

- [CLI 安装说明](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/README.md)：公开版本、安装命令及配套限制。
- [CLI 发行回执](https://github.com/chainlesschain/chainlesschain/blob/feature/cli147-release-evidence-20261111/docs/research/cli/evidence/release147-public/README.md)：来源证明、公开字节和原始回读文件。
- [菜单失败与修正证据](https://github.com/chainlesschain/chainlesschain/blob/feature/cli147-release-evidence-20261111/docs/research/cli-ide/evidence/jetbrains201-focus/README.md)：两次失败原始报告及新修正范围。

## 使用示例

先升级已公开 CLI，再核对插件渠道与版本：

```bash
npm i -g chainlesschain@0.166.147 --registry https://registry.npmjs.org
cc --version
cc doctor
```

重启宿主后，`cc --version` 应显示 `0.166.147`。Microsoft Marketplace 仍未发布；VS Code 兼容编辑器当前可使用 [Open VSX 的公开 0.37.185 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.185/file/chainlesschain.chainlesschain-ide-0.37.185.vsix)。JetBrains 0.4.200 已批准并公开，更新 ID 为 1217276，[公开下载](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1217276)的 631 个 payload 已与官方制品逐项核对；该历史结果不替代新候选验收。

## 相关文档

- [11-10 安装升级记录](./cli-ide-update-2026-11-10-146.md)：此前 .146 组合的历史范围。
- [焦点修正 PR #605](https://github.com/chainlesschain/chainlesschain/pull/605)：当前候选实现及验证进度。
- [CLI/IDE 完成情况表](https://github.com/chainlesschain/chainlesschain/blob/feature/cli147-release-evidence-20261111/docs/research/cli-ide/plans/cli-ide-codex-claude-gap-review-2026-11-08.md)：工程完成项与未完成验收。

移动/PC 客户端、独立业务效果及真实 36+9 完成率仍需各自验证，不由本次 CLI 发布推定。
