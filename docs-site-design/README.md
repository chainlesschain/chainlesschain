# ChainlessChain 设计文档网站

## 2026-11-13 设计文档状态

Module 112 now defines the CLI/IDE capability projection boundary: `sourceWiring` is separate from runtime `verified`, `automaticPromotion` remains `HOLD`, and production authority/runtime evidence remain disabled. The source of truth is `docs/design/`.

## 2026-11-09 当前发行与主线核对

公开组合 **CLI 0.166.145 / Session Core 0.3.27 / Open VSX 0.37.181 / JetBrains 0.4.198**，两款 IDE 推荐 CLI .145。Open VSX 下载突破 **7 万+**（项目方确认）。PC/mobile 仍为 **v5.0.3.145**；源码产品 .146 与 VS Code .182 不作为已发布下载推荐。

主线 `c34a664f42` 完善模型实际输入诊断、REPL 恢复、MCP Tasks、Memory、宿主故障定位和持久计费窗口。它们按各自源码及证据范围判断，不全部归入公开 .145。CLI .145 已含 `goal transfer-to-project`；原生导入需匹配新桌面并显式确认。发行源 CLI CI **75 成功、1 跳过** / Strict Sandbox **6 成功**；文档更新不新增模型任务验收。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留，历史 **2/4** 等成绩不合并为当前版本成绩。

[本轮用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-09-145.html) · [运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-11-09.html)

以下带日期段落保留历史范围；构建和部署方式仍适用。

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
