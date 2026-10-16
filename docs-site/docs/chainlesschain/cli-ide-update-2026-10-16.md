# CLI 0.166.103 与 IDE 升级指南

## 概述

截至 2026-10-16，公开 CLI **0.166.103**、Open VSX **0.37.148** 与 JetBrains Marketplace **0.4.165** 已完成发布回读，两个 IDE 均推荐 CLI `.103`。主线核对至 `920f263e3f`；VS Code `.148` 已包含草稿容量回收修复。桌面、Android 和 iOS 继续从独立的[产品 v5.0.3.140](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.140)下载。

```bash
npm i -g chainlesschain@0.166.103 --registry https://registry.npmjs.org
cc --version
cc doctor
```

在 Open VSX 升级至 `.148`，或在 JetBrains Marketplace 升级至 `.165`；重启聊天宿主，再用 Doctor 核对实际 CLI 路径和版本。Microsoft Marketplace 是独立渠道，本轮未发行。

## 核心特性

- CLI `.103` 在正式预算 scope 中拒绝没有治理传输或有效费用合同的工具、模型和外部服务出口，避免通过普通路径绕过限制；正式付费评测仍未开放。
- 承接 `.102` 的模型服务层级配置、价格校验、上下文与记忆检索修复；IDE 在缺少明细时可显示 aggregate token 用量。
- Personal Data Hub `.65` 的回答引用附带来源快照证据，可核对回答生成时的事实来源。
- 公开 VS Code `.148` 新增 128 会话容量到限时的空记录与已接受恢复副本回收，保留尚未确认或需要恢复的输入。

## 系统架构

CLI 负责模型配置、工具执行、预算状态和用量记录；Session Core / Context Memory Kernel 管理会话及上下文。IDE 展示 CLI 状态并保存本地草稿。正式预算 transport 仍标记 `paidReady:false`；IDE 或插件升级不会解除准入限制，也不会自动更新原生客户端安装包。

## 配置参考

| 项目                                       | 当前值或使用方式                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Node.js / npm                              | ≥22.12.0 / ≥10.0.0                                                       |
| CLI                                        | 0.166.103                                                                |
| Open VSX / JetBrains Marketplace           | 0.37.148 / 0.4.165，均推荐 CLI .103                                      |
| Session Core / Context Memory Kernel / PDH | 0.3.19 / 0.1.10 / 0.4.65                                                 |
| 模型服务层级                               | `llm.serviceTier` 或 `cc agent --service-tier`，发送前校验模型和端点支持 |
| VS Code 草稿容量修复                       | 已包含于公开 0.37.148                                                    |

默认使用 `standard`。`fast`、`priority`、`flex`、`ultrafast` 等层级是否可用，取决于具体 provider / model / endpoint 合同；设置成功不等于账号已开通，可能产生不同费用。先查看 `cc agent --help`，按当前模型配置选择，遇到不支持错误时恢复 `standard`。

## 性能指标

本轮没有新的端到端时延、吞吐或费用节省承诺。上下文来源报告区分估算和观测值；provider 只返回 aggregate tokens 时，不推算缺失的 input/output 明细。模型层级名称不代表本账号的速度或价格已经验证。

## 测试覆盖

CLI 发行提交 `b235ac8068` 已通过三系统 CLI CI、CLI Strict Sandbox、[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/38854237037)及[公共 npm 独立回读](https://github.com/chainlesschain/chainlesschain/actions/runs/38855697795)。[Open VSX .148](https://github.com/chainlesschain/chainlesschain/actions/runs/38861905795)标签指向 `c8a64caa92`，[JetBrains .165](https://github.com/chainlesschain/chainlesschain/actions/runs/38860748741)标签指向 `fa64840216`；各自工作流已完成宿主及公开制品核验。正式 36+9 评测保持 **NOT_RUN（0/36、0/9）**。

## 安全考虑

正式预算能力仍 **NOT_PAID_READY**，完整 native review **NOT_ADMITTED**，自动晋升 **HOLD**。进程内出口守卫不能代替真实账户账单、历史费用对账、独立生产检查点和操作系统网络隔离。普通 token 估算或 `--max-budget-usd` 不能视为本轮正式评测的真实总费用保证。原生客户端升级前关闭应用，并连同 SQLite WAL/SHM 备份数据。

## 故障排查

| 现象                           | 处理方式                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| 安装出现镜像 E404              | 使用上方官方 npm registry 命令，重新运行 Doctor                                              |
| IDE 仍使用旧 CLI               | 重启聊天宿主，查看 Doctor 的实际可执行文件路径及推荐版本                                     |
| 服务层级不受支持               | 核对 provider、model、端点和账号；恢复 `standard`，避免盲目重试                              |
| 出现 `CC_BUDGET_*_NOT_COVERED` | 当前正式 scope 不支持该出口；保留诊断并补齐宿主和费用证据，不改用未治理路径绕过              |
| 草稿提示容量已满               | 在已保存草稿列表恢复需要的输入，确认保存后显式丢弃不再需要的草稿；重启不会增加容量           |
| 已发消息仍占草稿容量           | 升级公开 .148 并重启聊天宿主；结果未知或被拒绝的提交会保留，先确认结果，不要删除整个草稿目录 |
| 用量只有总 token               | provider 没有提供完整明细；不要将来源 token 估算当作账单                                     |
| 压缩返回 `context_over_budget` | 保留会话并缩小输入；原上下文仍在，已发生用量仍需结算                                         |

## 关键文件

CLI 的 `formal-budget-provider-scope.js`、`formal-budget-lineage-registry.js` 和 `formal-budget-transport.js` 对应预算边界；`model-capabilities.js` 与 `config-schema.js` 对应层级配置；`context-source-ledger.js` 对应来源统计。PDH 的 `analysis.js`、`prompt-builder.js` 生成引用证据；VS Code 的 `draft-store.js` 包含公开 .148 的容量修复。

## 使用示例

安装后先运行 `cc --version` 与 `cc doctor`，确认 `.103` 和正确路径；升级 IDE 并重启聊天宿主。恢复原会话，确认未发送文字、附件和问题答案仍在。需要释放草稿空间时，先恢复并保存输入，再显式丢弃对应记录；接受状态未知的提交应先确认结果。

## 相关文档

参见[本轮设计](/design/release-runtime-update-2026-10-16)、[当前运行时](./cli-runtime-current)、[发布与升级](./agent-platform-release)及[上一轮压缩与恢复指南](./cli-ide-update-2026-10-15)。带日期的旧记录保留当时状态，当前安装以本页版本表为准。
