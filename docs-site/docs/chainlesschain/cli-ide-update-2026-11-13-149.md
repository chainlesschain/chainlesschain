---
title: CLI 0.166.149 与 IDE 插件升级说明
description: 自进化保留历史的原始目录边界校验、版本配对和发布状态
---

# CLI 0.166.149 与 IDE 插件升级说明

## 概述

截至 2026-11-14，CLI **0.166.149** 已通过 [Actions OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/43475425890)，准确源码为 `168a3d561b5a16e9d27b060944c63b2264c99df0`。官方来源及归档回读通过，独立公开下载与正式制品逐字节一致。

Open VSX **0.37.188** 已公开，推荐 CLI **0.166.149**；完整宿主门禁通过，独立回读确认版本已列出、可下载，且 VSIX 与官方制品字节一致。JetBrains **0.4.203** 推荐同一 CLI，已通过完整正式门禁并上传，待商店审核及公开下载核验；此前已核验的公开 JetBrains **0.4.202** 推荐 CLI **0.166.148**。各渠道分别记录状态，源码版本不替代发布状态。见[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release149-public/publication.json)。

## 核心特性

保留的 observed-text 历史和签名 anchor 历史现在绑定真实原始 journal 的 catalog/head 目录边界，并在捕获、重放及最终 journal 验证后检查目录。目录替换会拒绝报告；混合、伪造或包装端口不能获得原组件所有权。

## 系统架构

所有权通过私有 WeakMap 记录和纯身份探针串联，不调用调用方 getter、代理或回调。临时报告新增 `manifestDirectoryBoundaryDigest`、`manifestDirectoryBoundaryRechecked`、`manifestBoundaryScope`；持久化 schema、签名、CAS 和 `localCompositionDigest` 保持兼容。自定义后端的原目录能力为不可用。

## 配置参考

两款新 IDE 推荐 CLI **0.166.149**。Session Core **0.3.27**、Agent Protocol **0.1.13**、Agent SDK **0.2.18**、Context/Memory Kernel **0.1.12** 保持原版本。发布顺序为子包核验、CLI OIDC 发布及回读、IDE 发布及回读。

## 性能指标

本轮未进行吞吐量或延迟基准测试，不据此宣称性能提升。

## 测试覆盖

本地 Node.js 22.20.0 / Windows 聚焦验证覆盖九个文件，138 项通过，两项已有平台专用 FIFO 检查跳过。包括真实追加、重开、签名历史以及最终 journal 验证后的目录替换。

准确发布提交的 Linux、Windows、macOS [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/43442500176) **76/76**、[Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/43442499774) **6/6** 已全部通过。[VS Code 正式标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/43478454182) 的完整宿主、Remote-SSH、浏览器门禁及公开回读通过，11 项成功、3 项其他 IDE 渠道任务不适用而跳过。[JetBrains 正式标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/43478484313) 第 3 次完整执行全部通过，13 项成功、6 项其他渠道任务不适用而跳过；商店已接收上传，公开回读仍待审核。

## 安全考虑

本次限于本地目录元数据，不构成完整运行时生产者或存储图、独立安装器与固定依赖的证明。`productionAuthority=false`、`runtimeEvidence=false`、`automaticPromotion=HOLD` 保持。A/B/C 评测、模型任务增益、业务效果和付费准入尚未完成。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保持，本轮没有新增模型任务验收。

## 故障排查

出现目录边界错误时检查原始目录是否被替换，不要把失败自动降级为有效证据。自定义后端报告能力不可用属于边界限制。升级后重启 CLI / IDE 宿主；先检查 `cc --version`、`cc doctor` 再检查部署状态。

## 关键文件

- `packages/cli/src/lib/evolution/evolution-ledger-v2-journal.js`
- `packages/cli/src/lib/evolution/rrsi-observed-text-index.js`
- `packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-history.js`
- `docs/design/modules/112-governed-skill-evolution-design.md`

## 使用示例

安装已公开 CLI：

```bash
npm i -g chainlesschain@0.166.149 --registry https://registry.npmjs.org
cc --version
cc doctor
cc evolution deployment status --json
```

CLI .149 与 Open VSX .188 均已公开并回读通过，可下载 [0.37.188 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.188/file/chainlesschain.chainlesschain-ide-0.37.188.vsix)。JetBrains .203 已通过完整正式门禁并上传，待商店审核及公开下载核验；当前已核验公开 .202 推荐 CLI .148。Microsoft Marketplace 本轮仍不发布；VS Code 兼容编辑器使用 Open VSX 或版本化 VSIX。PC/mobile 公开版本保持 **v5.0.3.145**。

## 相关文档

- [CLI 0.166.148 升级说明](./cli-ide-update-2026-11-13-148.md)
- [CLI 功能入口](./cli.md)
- [自进化设计](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/modules/112-governed-skill-evolution-design.md)
