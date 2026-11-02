# CLI 0.166.138 / IDE 升级说明

## 概述

截至 **2026-11-02**，CLI **0.166.138** 与 Agent SDK **0.2.17** 已通过 GitHub Actions OIDC 发布。Open VSX **0.37.174** 已完成正式发布和公开 VSIX 核验；JetBrains **0.4.191** 已获 Marketplace 批准并公开列出（update `1209507`）；公开 ZIP 与正式构建的负载一致性仍待核验。两个新插件均推荐 CLI **0.166.138**。Kernel 保持 **0.1.11**，PC / 移动客户端继续使用独立 **v5.0.3.143**。

本页依据 `main@94b6bd418e`、[发行证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release138-public/README.md)与[公开包四项复验](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-openai-138/README.md)更新。

## 核心特性

- 源码片段实际送入模型请求后才确认读取覆盖；被省略的内容仍可恢复，重复失败给出明确限制。
- 上下文压缩、工具尾部与持久会话保留原始用户任务。
- 保留已验证的 JavaScript 源码表达式，继续拒绝不合法工具参数、损坏 JSON 与重复键。
- 延续 .135 的 Responses 断连、完成事件与取消恢复，以及 .136 的完整历史分叉和后台启动策略恢复。

主分支 `2e97ce3d79` 的独立 WebSocket 宿主模型策略修复晚于发行源，**未包含在 npm 0.166.138**，需要后续单独发行。

## 系统架构

CLI 负责模型请求、工具执行、会话、预算与证据处理，Web Panel 与 IDE 使用配套运行时。CLI / Open VSX 发行源为 `e42ea07b6da7ab2c3eb709002448b32d5fedf535`；JetBrains 构建源为 `ef13d5238e2b3e4c4571e48e820d0eb31a3107b2`。后者修正插件升级下限测试与 CLI 推荐元数据的对应关系，独立通过宿主门禁。

## 配置参考

升级后重启已运行的 `cc ui`、终端 Agent 与 IDE 聊天宿主，再检查版本。自进化沿用[现有开关](./self-evolution-configuration)：`cc config set evolution.enabled false` 关闭，`cc config set evolution.enabled true` 开启；新安装默认关闭。启用交付复查仍使用原有权限与剩余预算，不保证每次任务都能在轮次耗尽前进入审阅。

## 使用示例

```bash
npm i -g chainlesschain@0.166.138 --registry https://registry.npmjs.org
cc --version
cc doctor
```

VS Code / Cursor / VSCodium 可从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 或 [0.37.174 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.174/file/chainlesschain.chainlesschain-ide-0.37.174.vsix) 安装。JetBrains .191 已获[Marketplace 批准上架](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge/versions)，可从商店安装；[公开 ZIP](https://plugins.jetbrains.com/plugin/download?updateId=1209507)与正式构建的负载一致性仍待核验。本轮模型复验实际使用审核前的正式 Actions 侧载制品，原记录保持不变。Microsoft Marketplace 继续暂缓。

## 性能指标

本版没有新增通用延迟、吞吐量或 Memory SLO 基准。四项模型复验的 **80/80** 个物理请求均有完整用量，已知 token 费用估算为 **$2.6309597**，实际账单未知；这不是日常使用费用保证。

## 测试覆盖

精确发行源码通过 Linux、Windows、macOS 的 CLI CI **75 项必需任务**（另 1 项可选 PR 演练跳过）与 Strict Sandbox **6/6**；正式 OIDC 发布完成公共 SDK / CLI 字节、安装启动及来源签名核验。

公开 .138 只复验四项未完成样本：**2/4 通过**，分别为 `first-run-darwin-vscode` 与 `verify-13`。`verify-08`、`verify-36` 的独立候选测试分别为 3/3、23/23，行为变异均被检出，但作者阶段 **20/20** 轮耗尽，终态 `error_max_turns`，未进入独立审阅，因此仍失败。已通过的 verify-19（CLI .136）没有重跑。

历史累计 **41/45**、前轮 .137 **0/5** 与本轮 **2/4** 各自保留，不能作为同一版本完整 45 项成功率；图像专项 **0/1** 单列。后续已通过项跳过，工程检查与发布不会增加模型任务通过数。

## 安全考虑

发行继续使用 Actions OIDC，按子包 → CLI → IDE → 客户端的顺序核验上游。未知用量、硬预算、取消、工具权限与敏感信息检查继续有效。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留，公开发行不能替代付费、原生生产或自动晋升的独立验收。

## 故障排查

- 升级后仍显示旧行为：运行 `cc --version`，确认使用 .138，再重启已有宿主。
- JetBrains 找不到 .191：商店 API 已批准 update 1209507；检查商店缓存和 IDE 兼容版本。商店批准不能替代公开 ZIP 与正式构建的负载一致性核验。
- 显示 `error_max_turns`：检查已保存改动、测试和会话状态；候选测试通过不能说明模型正常完成，不能直接将任务标记成功。
- 独立 WebSocket 行为与主分支描述不同：.138 不包含后续 `2e97ce3d79` 修复。

## 关键文件

`packages/cli/src/runtime/agent-core.js` 处理模型与工具循环；`packages/cli/src/lib/evolution/evolution-evidence-projector.js` 处理模型证据投影；`packages/cli/src/gateways/ws/ws-server.js` 含后续未发布的 WebSocket 修复。发行与复验分别保存在 `docs/research/cli/evidence/release138-public/`、`docs/research/cli/verify01-openai-138/`。

## 相关文档

- [当前发布与升级指南](./agent-platform-release)
- [输入、图片预算与恢复](./agent-input-and-recovery)
- [Agent 完成条件与可选复查](./cli-agent)
- [IDE 安装与诊断](./ide-plugin)
- [最新运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-11-02-138.html)
