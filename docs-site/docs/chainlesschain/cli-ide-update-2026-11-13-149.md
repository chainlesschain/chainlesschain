---
title: CLI 0.166.149 与 IDE 插件升级说明
description: 自进化保留历史的原始目录边界校验、版本配对和发布状态
---

# CLI 0.166.149 与 IDE 插件升级说明

## 概述

本轮候选组合为 CLI **0.166.149**、VS Code/Open VSX **0.37.188**、JetBrains **0.4.203**。尚未公开；当前公开组合仍为 CLI **0.166.148**、Open VSX **0.37.187**、JetBrains **0.4.202**。每个渠道须分别完成正式工作流和公开回读，不能以源码版本替代发布状态。

## 核心特性

保留的 observed-text 历史和签名 anchor 历史现在绑定真实原始 journal 的 catalog/head 目录边界，并在捕获、重放及最终 journal 验证后检查目录。目录替换会拒绝报告；混合、伪造或包装端口不能获得原组件所有权。

## 系统架构

所有权通过私有 WeakMap 记录和纯身份探针串联，不调用调用方 getter、代理或回调。临时报告新增 `manifestDirectoryBoundaryDigest`、`manifestDirectoryBoundaryRechecked`、`manifestBoundaryScope`；持久化 schema、签名、CAS 和 `localCompositionDigest` 保持兼容。自定义后端的原目录能力为不可用。

## 配置参考

两款候选 IDE 推荐 CLI **0.166.149**。Session Core **0.3.27**、Agent Protocol **0.1.13**、Agent SDK **0.2.18**、Context/Memory Kernel **0.1.12** 保持原版本。发布顺序为子包核验、CLI OIDC 发布及回读、IDE 发布及回读。

## 性能指标

本轮未进行吞吐量或延迟基准测试，不据此宣称性能提升。

## 测试覆盖

本地 Node.js 22.20.0 / Windows 聚焦验证覆盖九个文件，138 项通过，两项已有平台专用 FIFO 检查跳过。包括真实追加、重开、签名历史以及最终 journal 验证后的目录替换。正式发布仍要求准确提交的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 全部通过；IDE 另需完整宿主矩阵。

## 安全考虑

本次限于本地目录元数据，不构成完整运行时生产者或存储图、独立安装器与固定依赖的证明。`productionAuthority=false`、`runtimeEvidence=false`、`automaticPromotion=HOLD` 保持。A/B/C 评测、模型任务增益、业务效果和付费准入尚未完成。

## 故障排查

出现目录边界错误时检查原始目录是否被替换，不要把失败自动降级为有效证据。自定义后端报告能力不可用属于边界限制。升级后重启 CLI / IDE 宿主；先检查 `cc --version`、`cc doctor` 再检查部署状态。

## 关键文件

- `packages/cli/src/lib/evolution/evolution-ledger-v2-journal.js`
- `packages/cli/src/lib/evolution/rrsi-observed-text-index.js`
- `packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-history.js`
- `docs/design/modules/112-governed-skill-evolution-design.md`

## 使用示例

当前安装已公开版本：

```bash
npm i -g chainlesschain@0.166.148 --registry https://registry.npmjs.org
cc --version
cc doctor
cc evolution deployment status --json
```

CLI .149 正式公开并回读通过后，才将安装命令版本改为 `0.166.149`。IDE .188 / .203 应在 CLI .149 公开后安装。Microsoft Marketplace 本轮仍不发布；VS Code 兼容编辑器使用 Open VSX 或版本化 VSIX。PC/mobile 公开版本保持 **v5.0.3.145**。

## 相关文档

- [CLI 0.166.148 升级说明](./cli-ide-update-2026-11-13-148.md)
- [CLI 功能入口](./cli.md)
- [自进化设计](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/modules/112-governed-skill-evolution-design.md)
