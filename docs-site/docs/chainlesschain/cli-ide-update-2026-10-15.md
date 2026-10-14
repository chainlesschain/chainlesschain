# CLI 0.166.101 与 IDE 更新指南

## 概述

截至 2026-10-15，npm `chainlesschain@0.166.101` 与 Open VSX `0.37.145` 已公开；二者对应的发行源码为 `6752b49e1e`。CLI 使用 Context/Memory Kernel `0.1.10`，Session Core 仍为 `0.3.19`。JetBrains Marketplace 当前列出 `0.4.162`，源码候选 `0.4.163` 尚待公开核验。桌面、Android 和 iOS 仍从独立的[产品 v5.0.3.140 下载页](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.140)获取。

```bash
npm i -g chainlesschain@0.166.101 --registry https://registry.npmjs.org
cc --version
cc doctor
```

Open VSX 用户可升级到 `0.37.145`，重启聊天宿主后运行 Doctor，检查真正使用的 CLI 路径和版本。JetBrains 用户以 Marketplace 实际提供的版本为准；当前公开列出的 `.162` 配对 CLI `.100`，不要根据源码候选 `.163` 提前假定插件已升级。Microsoft Marketplace 与 Open VSX 是独立渠道。

## 核心特性

- 压缩如果会清空原本非空的上下文，或丢失刚生成的摘要，会返回 `context_over_budget`。原会话内容与 head 保留；已发生的模型用量仍会结算。
- 用量未知或结算失败时，CLI 停止后续付费重试。被拒绝的工作流压缩显示失败，结果不确定的提交提示需要对账，中断的普通任务保持未完成。
- VS Code 聊天草稿在重置、恢复会话和关闭最后标签后可继续加载；加载失败时可重试。模型连接测试会区分本地依赖缺失与服务提供方错误。

## 系统架构

Context/Memory Kernel 负责压缩规划与拒绝，CLI 保存会话 head、provider 用量和任务结果；IDE 只加载草稿与展示 CLI 返回的状态。已完成的模型请求可能计费，即使最终摘要未采纳。原生产品安装包独立于 npm/IDE 发行。

## 配置参考

| 项目 | 当前值或状态 |
| --- | --- |
| Node.js / npm | ≥22.12.0 / ≥10.0.0 |
| npm CLI / Kernel | 0.166.101 / 0.1.10 |
| Open VSX / JetBrains Marketplace | 0.37.145 / 当前列出 0.4.162 |
| 原生产品 | v5.0.3.140，独立下载 |

沿用已有模型、provider 和权限配置。JetBrains `.163` 尚未公开核验，不能将其候选推荐值作为当前商店版本。

## 性能指标

本轮修复没有给出新的回答时延或压缩吞吐承诺；`context_over_budget` 是安全拒绝，不是自动增加模型上下文窗口。Open VSX 下载计数在 2026-10-15 官方 API 回读中超过 6 万，属于发行使用量指标，不是性能验收。

## 测试覆盖

发行提交 `6752b49e1e` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38559229180) 与 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/38559228915) 成功，npm 和 Open VSX API 可回读公开版本。正式 36+9 样本、完整原生持久恢复和 JetBrains `.163` 公开下载不属于这些结果。

## 安全考虑

正式 36+9 评测仍为 **NOT_RUN**，完整 native review 为 **NOT_ADMITTED**，自动晋升保持 **HOLD**。源码已有耐久正式预算 authority 的部分实现，但状态仍为 **NOT_PAID_READY**，正式付费评测仍拒绝启动。该功能不提供真实费用上限承诺。原生客户端升级前关闭应用，并连同 SQLite 的 WAL/SHM 文件备份数据。

## 故障排查

| 现象 | 操作 |
| --- | --- |
| `cc --version` 仍显示旧版 | 检查 npm 安装位置和 Doctor 报告中的实际可执行文件路径；重启 IDE 聊天宿主 |
| 压缩返回 `context_over_budget` | 保留当前会话，缩小本轮输入或手动整理上下文；不要把该错误当作内容已被清空 |
| 用量或提交状态提示未知 | 保留诊断和 provider 回执，先对账再决定是否重新请求，避免重复计费 |
| VS Code 草稿没有出现 | 在原会话使用加载重试，确认当前标签和会话；不要用重新发送来测试草稿恢复 |
| 连接测试报依赖缺失 | 先运行 `cc doctor` 并检查本地 CLI 环境；provider 错误则核对当前账号和模型配置 |

## 关键文件

Kernel 的 `lib/compaction.js` 负责规划拒绝；CLI 的 `live-compaction.js`、`agent-core.js` 和 `headless-stream.js` 负责运行时结算与结果。VS Code 的 `chat-view.js`、`chat-html.js` 与 `llm-config.js` 对应草稿及连接诊断。

## 使用示例

升级后运行 `cc --version` 与 `cc doctor`。在 VS Code 中恢复原会话并确认草稿，若草稿加载失败则使用重试控制；压缩失败后先检查会话和用量状态，再决定下一步。

## 相关文档

更多实现与证据边界见[本轮设计](/design/release-runtime-update-2026-10-15)、[CLI 当前运行时](./cli-runtime-current)和[发布与升级指南](./agent-platform-release)。
