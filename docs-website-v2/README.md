# ChainlessChain 官方网站

`www.chainlesschain.com` 的 Astro 源码。2026-10-27 已核验公开版本：CLI **0.166.127**、Open VSX **0.37.165**、JetBrains **0.4.182**；两个 IDE 均推荐 CLI `.127`。移动与 PC 产品 **v5.0.3.142** 已公开。

## 内容来源

- `src/data/release-status.json`：经过发行门禁及公共回读的版本、源码与验收边界。
- `src/data/release-sizes.json`：原生产品下载文件大小缓存。
- `src/components/SourceUpdate.astro`：中英文版本、输入预算及恢复说明。
- `src/pages/`：官网中英文页面。
- `../docs/design/`：设计文档权威源；两个 VitePress 站点通过同步脚本复制。

更新公开版本前，核对 `../docs/research/cli/evidence/release127-public/publication.json` 等对应发行回执。保留 CLI、IDE、原生产品的独立源码与版本，历史真实模型验收统计继续注明所属轮次。

## 本地构建

需要 Node.js **22.12.0+** 和 npm **10+**：

```bash
npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm run build
```

默认构建先更新下载大小缓存，再输出 `dist/`。开发使用 `npm run dev`。

## 三站部署

三个站点的部署源分别为 `docs-site`、`docs-site-design`、`docs-website-v2`。最终部署先更新并提交缓存和文档，再从该提交重新构建三个站点，确保 `deployment-source.json` 记录的源码与产物一致。

在官网目录先运行 `npm run fetch:sizes`，提交相关源码后使用 `npm exec --offline -- astro build` 完成固定快照构建；两个文档站分别运行 `npm run build`。从仓库根运行：

```powershell
powershell -NoProfile -File scripts/deploy-docs-snapshot.ps1
```

现有脚本通过已信任的 SSH 主机向 `/www/wwwroot/` 下三个站点上传压缩包，校验 SHA-256、页面数量及本轮版本，再使用互斥锁、独立 staging、备份和失败回滚切换目录。完成后核对公网新页面、首页和 `deployment-source.json`。保留脚本打印的备份目录与部署编号。

## 当前文档与验收范围

- [CLI / IDE 升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-27.html)
- [自进化开关配置](https://docs.chainlesschain.com/chainlesschain/self-evolution-configuration.html)
- [图片预算与会话恢复](https://docs.chainlesschain.com/chainlesschain/agent-input-and-recovery.html)
- [最新运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-10-27.html)

本轮没有新增真实模型任务验收；历史跨版本 **32/45**、**NOT_PAID_READY**、**NOT_ADMITTED** 和自动晋升 **HOLD** 继续分别记录。文档站部署不改变 npm、IDE 或原生产品制品。
