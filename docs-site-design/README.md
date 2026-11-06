# ChainlessChain 设计文档网站

`design.chainlesschain.com` 的 VitePress 项目。设计权威源位于仓库根 `docs/design/`；本项目 `docs/` 下的对应页面由同步脚本生成，不单独手改副本。

## 当前设计核对（2026-11-06）

CLI **0.166.143**、Session Core **0.3.26**、Open VSX **0.37.179** 和 JetBrains **0.4.196** 已公开核验，两个 IDE 推荐 CLI .143；不可变发行源码为 `3fa3a4b258bbcb60b23b4298cec375661ad6f410`。本轮说明本地算力配置、端点凭据隔离、待审创建请求和逐次授权模型草稿的边界。客户端 **v5.0.3.145** 已独立公开，但较早产品源码不包含本批新增原生 v6 创建/模型起草。真实特性 GUI、力数推理、业务效果与灰度迁移回退仍待独立验收；本次文档部署不发起模型请求。

- [本轮设计源](../docs/design/release-runtime-update-2026-11-06-143.md)
- [发行证据](../docs/research/cli/evidence/release143-public/README.md)
- [用户升级指南](../docs-site/docs/chainlesschain/cli-ide-update-2026-11-06-143.md)

## 构建与部署

使用 Node.js **22.12.0+**、npm **10+**。`npm ci` 安装本项目锁定依赖，`npm run build` 同步设计源并完整构建 `docs/.vitepress/dist/`。
三个站点可通过 `.github/workflows/docs-snapshot-build.yml` 从同一已提交源码构建快照；核对归档 SHA-256、完整 HTML 数量和目标页面后，使用仓库根 `scripts/deploy-docs-snapshot.ps1` 部署。
部署保留旧站备份和失败回滚，公网 `/deployment-source.json` 的源码身份与不可变运行时发行身份分别记录。
