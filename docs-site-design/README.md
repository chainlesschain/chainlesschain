# ChainlessChain 设计文档网站

`design.chainlesschain.com` 的 VitePress 项目。设计权威源位于仓库根 `docs/design/`；本项目 `docs/` 下的对应页面由同步脚本生成，不单独手改副本。

## 当前设计核对（2026-11-05）

按 `main@4ddbde1227` 和 Git 记录说明 CLI **0.166.142**、Session Core **0.3.25**、Open VSX **0.37.178**、JetBrains **0.4.195** 的目标事件、独立 v5 历史授权、事务账本、至少一次交付、两端逐页恢复和最小组合场景。
不可变 npm/IDE 源码为 `b78cf0af8c8b0491189465773b148ac77c332222`。客户端 **v5.0.3.145** 尚在发行构建中，公开版本仍为 **v5.0.3.144**；真实 DMM GUI、自动任务创建、业务效果与灰度回退尚未验收。

- [本轮设计源](../docs/design/release-runtime-update-2026-11-05-142.md)
- [发行证据](../docs/research/cli/evidence/release142-public/README.md)
- [用户升级指南](../docs-site/docs/chainlesschain/cli-ide-update-2026-11-05-142.md)

## 构建与部署

使用 Node.js **22.12.0+**、npm **10+**。`npm ci` 安装本项目锁定依赖，`npm run build` 同步设计源并完整构建 `docs/.vitepress/dist/`。
三个站点可通过 `.github/workflows/docs-snapshot-build.yml` 从同一已提交源码构建快照；核对归档 SHA-256、完整 HTML 数量和目标页面后，使用仓库根 `scripts/deploy-docs-snapshot.ps1` 部署。
部署保留旧站备份和失败回滚，公网 `/deployment-source.json` 的源码身份与不可变运行时发行身份分别记录。
