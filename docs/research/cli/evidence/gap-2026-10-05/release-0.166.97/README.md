# CLI 0.166.97 配对发行准备

候选：CLI 0.166.97 / VS Code 0.37.141 / JetBrains 0.4.159，Agent SDK 保持 0.2.14。当前尚未发布；用户授权最终必需测试门通过后发行。候选标签 `v-npm-0-166-97`、`ide-vscode-v0.37.141`、`ide-jetbrains-v0.4.159` 在准备时均未存在，不移动旧标签。

全部 13 子包完整源码树与 `da91e730d802b7c9dcdc075b222ecc257021e552` 一致，本地 npm pack 与实际公开 tarball 原字节一致，可沿用已发布版本；[原始摘要](./children-summary.json.gz)及[清单](./preparation.json)保留字节绑定。本地结果不是 OIDC provenance 或最终 SHA CI 的替代。SDK vendor 实际重建无 tracked 差异。局部 CLI 35、VS Code 22、JetBrains 14 版本相关测试通过；JetBrains 指定既有 Java 21 后成功。

最终准确 SHA 须 CLI CI、CLI Strict Sandbox 三平台完整门，IDE Extensions 主宿主/浏览器/构建门与独立 ARM64 完整 aggregate。通过后推 immutable CLI tag，由 GitHub Actions OIDC 校验/复用子包、公开来源和 registry-only 安装后发布 CLI；公开 CLI 可取且配对正确后才推 IDE 标签。Open VSX 回读真实 VSIX；JetBrains 绿色上传但 pending 时仍未公开。默认渠道沿用 Open VSX/JetBrains，不新增 Microsoft Marketplace 发布。

本轮 native 根坐标诊断与[正式未完成边界](../root-coordinates-2026-10-10/README.md)分开，36+9/NOT_RUN、$99、observations、旧矩阵及 durable/账号/人工/长时状态不因发行改变。
