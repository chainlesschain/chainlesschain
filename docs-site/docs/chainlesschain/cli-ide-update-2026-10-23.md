# CLI .117 / IDE .159 与 .176 升级指南

## 概述

2026-10-23 公共回读确认以下版本可下载。文档核对主线 `57fd80d530`；CLI 和 IDE 各自绑定精确发行源码，原生产品继续独立升级。

| 组件                  | 公开版本       | 配对                                                             |
| --------------------- | -------------- | ---------------------------------------------------------------- |
| CLI                   | **0.166.117**  | Session Core **0.3.22**、Personal Data Hub **0.4.66** 已先行发布 |
| VS Code / Open VSX    | **0.37.159**   | 推荐 CLI **0.166.117**                                           |
| JetBrains Marketplace | **0.4.176**    | 推荐 CLI **0.166.117**；update **1200483** 已批准、上架、非隐藏  |
| 原生桌面与移动产品    | **v5.0.3.140** | 独立安装包与能力验收范围                                         |

Microsoft VS Code Marketplace 仍未发行；原版 VS Code 用户可安装公开 VSIX。

## 核心特性

本轮修复 Evolution 将 Python/JavaScript 代码误判为 JSON、长输出截断、图片预算混算和异常退出的工具轮次结算。承接的配置修复还覆盖保存的 provider 与模型、Gemini/Anthropic 协议路由、Ollama 地址及本机签名路径恢复。

图片限制、备份及故障步骤见[Agent 输入、图片预算与会话恢复](./agent-input-and-recovery)。目标草稿、桌面授权和原生确认仍按[目标草稿指南](./goal-drafts-current)使用。

## 系统架构

发行顺序为子 npm 包、CLI、IDE 插件。CLI 经 GitHub Actions OIDC 发布；IDE 在确认公共 CLI 和依赖图后发布。网站、文档、CLI、IDE 与原生产品分别记录源码和部署状态。

## 配置参考

```bash
npm i -g chainlesschain@0.166.117 --registry https://registry.npmjs.org
cc --version
cc doctor
```

在 Open VSX 编辑器中更新至 **0.37.159**。原版 VS Code 使用[版本化 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.159/file/chainlesschain.chainlesschain-ide-0.37.159.vsix)的 **Install from VSIX** 操作。JetBrains 使用 [Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge) 的 **0.4.176**。

更新后重启 IDE 聊天宿主，并运行 Diagnose Bridge / Doctor，确认宿主实际使用的 CLI 路径和版本。

## 性能指标

文本与图片独立预算：文本快照 **1 MiB**，模型可见投影 **896 KiB**，单消息图片合计 **20 MiB**，单模型请求图片合计 **40 MiB**。工具结果预览总上限 **50,000 字符**。更多边界见[输入与恢复指南](./agent-input-and-recovery#性能指标)。本轮没有新增吞吐或真实模型时延承诺。

## 测试覆盖

CLI 发行提交 `00e638dd71e7ffa69d2ff366d85f1d209fd38877` 的 CLI CI **71** 项作业与 Strict Sandbox **6** 项均成功。子包和 CLI 共 **14** 个公开压缩包通过完整性/身份核验，并完成独立公共安装及来源验证。

IDE 标签源码为 `ab31677d6691b4fdd5390e16fae60de5a5895cf1`。Open VSX 发布的 **11** 项必需作业、JetBrains 的 **13** 项必需作业全部成功。Open VSX 公开 VSIX 与 CI 候选一致；JetBrains 公开 ZIP 已核对描述符及编译后 CLI 推荐值。

本轮未新增真实模型任务验收；跨版本历史 **31/45**、普通 **26/36**、首次 **5/9** 保留，剩余 **14** 项。**NOT_PAID_READY**、**NOT_ADMITTED** 和自动晋升 **HOLD** 继续分别验收。

## 安全考虑

升级和恢复前保留会话与图片消息包备份。真实 JSON 错误、过期会话版本、权限拒绝和预算超限仍须处理，不应通过编辑账本或关闭治理校验继续执行。

## 故障排查

仍显示旧版本时，先检查 IDE 配置的 CLI 路径、全局安装位置与聊天宿主是否重启。出现 Evolution 输入错误、工具轮次结算错误或图片恢复失败时，按[专项排查表](./agent-input-and-recovery#故障排查)核对。真实模型效果和本地 Ollama 长任务可在升级后按实际环境复测。

## 关键文件

- `docs/research/cli/evidence/release117-public/publication.json`：公共发行状态与回执索引。
- `packages/cli/README.md`：当前 CLI 安装与限制。
- `packages/vscode-extension/package.json`：VS Code 插件版本和 CLI 推荐值。
- `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/CliVersionCheck.java`：JetBrains 编译后 CLI 推荐值的源码。

## 使用示例

```bash
cc agent --session upgrade-check
cc session validate upgrade-check
cc context upgrade-check
```

使用自己的会话 ID 恢复任务；先核对已发生的工具操作，再继续执行。

## 相关文档

- [发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release117-public/publication.json)
- [最新设计](https://design.chainlesschain.com/release-runtime-update-2026-10-23.html)
- [Agent 输入与会话恢复](./agent-input-and-recovery)
- [发布与升级索引](./agent-platform-release)
- [10 月 20 日历史版本记录](./cli-ide-update-2026-10-20)
