# CLI .129 与 IDE 配套升级（2026-10-29）

## 概述

CLI **0.166.129**、Open VSX **0.37.167** 和 JetBrains **0.4.184** 已公开并完成归档回读，两个 IDE 均推荐 CLI `.129`。Microsoft Marketplace 按计划暂缓；官方 VS Code 可安装版本化 VSIX。PC / 移动端继续使用独立发行的 [v5.0.3.143](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.143)，本轮没有新的客户端发行。

本页依据[公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release129-public/publication.json)。主分支后续的独立 Goal checker、Memory 磁盘与缓存修复、Terra 能力及计费改动尚未发布，不属于安装 `.129` 后可用的新增能力。

## 核心特性

| 范围             | 当前公开版行为                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| 交付复查         | `.129` 加强复查上下文隔离；`--review-changes` 默认关闭，沿用原有权限、轮次和费用预算。  |
| Codex App Server | 统一实验性兼容清单与版本化探针；实验路由默认关闭，版本探测通过不代表生产准入。          |
| IDE 模型配置     | 保留共享推荐、配置读取三态与会话内 `/model` 覆盖；不会改写其他会话的模型选择。          |
| 首次配置         | IDE 发行门加入干净配置目录的入门验证，JetBrains 核对实际启动的配置根目录。              |
| 已有能力         | 继承 `.128` 的 Goal 工具证据约束、检查点错误处理、MCP / Skills 检索及 Memory 索引优化。 |

## 系统架构

CLI 发行源为 `fd8a21637ab188dae0c777442d312ae85d420a9b`，标签 `v-npm-0-166-129`；IDE 发行源单独固定为 `800e9cc99711f9f02eb3bbd78eb14600406bdba5`。IDE 负责交互与会话投影，CLI 负责工具执行、权限、预算及持久状态。公开包与主分支是不同的代码快照。

公开版与后续 Goal、Memory、Terra 源码的具体范围见[本轮运行时设计](/design/release-runtime-update-2026-10-29)。

发行依次核验所需子 npm 包、CLI、IDE，再处理需要发布的客户端。本轮沿用已公开且源码未变的子包版本；CLI 通过完整门禁和公开安装验证后才发布配套 IDE。

## 使用示例

需要 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.129 --registry https://registry.npmjs.org
cc --version
cc doctor
```

| 编辑器              | 安装方式                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open VSX 兼容编辑器 | 安装扩展 `chainlesschain.chainlesschain-ide`，核对版本 **0.37.167**。                                                                                                                                             |
| Microsoft VS Code   | 下载 [0.37.167 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.167/file/chainlesschain.chainlesschain-ide-0.37.167.vsix)，执行 **Extensions: Install from VSIX...**。                       |
| JetBrains 2024.2+   | 在 Marketplace 搜索 **ChainlessChain IDE**，核对版本 **0.4.184**；也可通过 **Install Plugin from Disk** 安装[公开 ZIP](https://plugins.jetbrains.com/files/32208/1205524/chainlesschain-ide-bridge-0.4.184.zip)。 |

升级后重启聊天宿主，确认 Doctor 中的实际 CLI 路径。保留原有配置、API key、会话和部署数据；先核对待恢复会话与草稿，再手动发送。

需要交付复查时可显式启用：

```bash
cc agent -p "完善当前模块并核对交付要求" --review-changes
```

该选项支持 headless 提示词和 stream-json 输入，成功写入或编辑后提供至多一次复查机会。期间可能发生多次读取、修复和模型请求，继续计入原预算。只发布最终文本，保留工具进度；复查提示不代表测试或独立验收通过。

## 配置参考

`--review-changes` 和实验性 Codex App Server 路由仍须显式启用。MCP 紧凑目录仍可选，`mcp.toolSearch.catalogMode` 默认 `stubs`。Skill 自进化默认关闭，详见[开关配置](./self-evolution-configuration)。

IDE 的 `/model <model-id>` 仅覆盖当前会话，`/model --default` 恢复共享默认。不同 `CHAINLESSCHAIN_HOME` 使用独立配置；配置读取失败时先修复读取，避免覆盖原设置。选择模型预设不等于账户可用性已验证。

## 性能指标

本次发布不承诺新的端到端延迟、真实模型成本或任务成功率。Memory 完整磁盘长测、缓存对照和三系统统计仍在进行，相关后续修复尚未进入 `.129`。MCP 合成 token 估算也不能替代真实 A/B 质量与账单证据。

## 测试覆盖

| 证据      | 已核验范围                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| CLI       | 准确发行提交的 Linux、Windows、macOS CLI CI 与 CLI Strict Sandbox 全部通过；CLI CI attempt 2 为 **72/72**。               |
| npm       | GitHub Actions OIDC 发布及独立公开回读通过；归档与不可变 CI 制品逐字节相同，来源签名和十个直接子依赖已核验。              |
| Open VSX  | 正式发行门通过；公开 VSIX SHA-256 为 `daa1dfc582631c645037bac9720d26d5669ca5a47ba78075e9fac82535a375c8`，与 CI 归档相同。 |
| JetBrains | 正式发行门通过；更新 `1205524` 已批准、列出且未隐藏。所有公开 ZIP 成员字节与 CI 一致，外层 ZIP 字节不同。                 |
| 模型任务  | 跨版本累计 **34/45**：普通 **27/36**、首次入口 **7/9**；剩余 **11** 项。此统计不是 `.129` 单轮成功率。                    |

JetBrains 公开 ZIP 共 **1,560,992 字节**，SHA-256 `eed876bdf005856215200a353af952a76234ea5e62043d0b23b6dc1b3cf4ffe3`。归档核验不代表在本机执行过全部 IDE 原生旅程。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留；完整安装、升级、恢复、无障碍与真实任务验收继续单独跟踪。

## 安全考虑

交付复查沿用工具权限、沙箱、取消信号和剩余预算。用量未知、取消或预算耗尽时不能借复查追加模型请求；不会自动开启自进化或晋升 Skill。恢复中断会话前核对已发生副作用与用量，不能通过重发不确定的任务来判断它是否执行过。

连接测试会向模型服务发送推理请求，可能产生费用。普通配置读取与实际连通性测试分开，按需使用。

## 故障排查

| 现象                                   | 处理                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| 升级后仍显示旧 CLI                     | 先运行 `cc --version` 和 `cc doctor`；检查 IDE 明确配置的 CLI 路径，并重启聊天宿主。 |
| 官方 VS Code 找不到扩展                | 使用上方版本化 VSIX；Microsoft Marketplace 本轮暂缓。                                |
| 配置显示读取失败                       | 检查可执行路径、配置目录及权限后重试；读取失败与尚未配置含义不同。                   |
| `cc` 指向系统编译器                    | 在 IDE 设置中明确指定 ChainlessChain 的 CLI 可执行路径。                             |
| 找不到 Terra 新能力或独立 Goal checker | 这些属于尚未发布的主分支改动；不要以源码文档推断 `.129` 已包含。                     |
| Goal 未完成或恢复被拦截                | 检查确定性条件、成功工具证据及检查点；先核对副作用与用量，再按恢复要求继续。         |

## 关键文件

- [公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release129-public/publication.json)：准确源码、工作流和各渠道回读。
- [CLI README](https://github.com/chainlesschain/chainlesschain/blob/main/packages/cli/README.md)：当前安装命令与发行限制。
- [VS Code README](https://github.com/chainlesschain/chainlesschain/blob/main/packages/vscode-extension/README.md) · [JetBrains README](https://github.com/chainlesschain/chainlesschain/blob/main/packages/jetbrains-plugin/README.md)：配套版本与制品身份。
- [当前差距表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md)：未完成任务、后续源码和验收边界。

## 相关文档

- [Agent 完成条件与复查](./cli-agent) · [IDE 安装与模型配置](./ide-plugin)
- [MCP Tool Search](./cli-tool-search) · [Skills 检索](./cli-skill) · [Memory 查询](./cli-memory)
- [输入与恢复边界](./agent-input-and-recovery)
- [上一轮升级说明（.128，历史）](./cli-ide-update-2026-10-28)
- [本轮发行进度](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-release129-progress-2026-10-28.md)
