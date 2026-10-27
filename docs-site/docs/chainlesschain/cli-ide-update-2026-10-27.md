# CLI .127、IDE 与五平台客户端升级（2026-10-27）

## 概述

当前公开配对为 CLI **0.166.127**、Open VSX **0.37.165**、JetBrains **0.4.182**；两个 IDE 均推荐 CLI `.127`。移动端和 PC 安装包 **v5.0.3.142** 已公开，五平台构建、22 个公开资产与桌面更新元数据均已回读核验。Microsoft VS Code Marketplace 仍未发布，VS Code 用户可安装 Open VSX 的版本化 VSIX。

本轮从“默认进入自进化”调整为可选开启，并继承 `.123` 的模型配置和 Windows 启动修复、`.125` 的代码表达式投影修复及 `.126` 的恢复摘要修复。源码、工作流与公开制品见[发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release127-public/publication.json)。

## 核心特性

- 新安装和旧版自动生成的本地部署默认关闭自进化；普通 Agent、ask、chat 和 Quick Ask 仍可使用。
- CLI、cc ui、VS Code 扩展与 JetBrains 通过同一配置目录的 `evolution.enabled` 共享开关。Android 本地终端也提供开启与关闭按钮。
- 文件摘要、远端读取、任务检查点、旧会话恢复和 WORKLOG 投影保留完整、有界的 JSON，无法安全表达的摘录明确省略。
- Open VSX 扩展保留 Agent 仍可能读取的附件，并拒绝过期页面或旧会话排队的丢弃操作。

## 系统架构

普通模型入口先读取开关策略，决定是否选择 Evolution 部署。关闭时走普通请求路径；开启时继续校验部署签名、信任根和证据，损坏部署不会自动降级。已有手动配置并启用的 managed/test 部署或明确提供的外部部署，在配置项缺省时仍视为主动开启。

Android 的按钮通过独立 CLI 进程写入配置，Android 发布步骤核对归档内 CLI 版本。桌面 Web 界面使用 Skill 自进化配置页，每次新模型请求重新读取开关。产品 `.142` 有独立发行源码，不能将 CLI 的验收结果直接当作所有原生功能的验收。

## 配置参考

先运行 `cc config list` 查看当前配置目录。默认文件为 `~/.chainlesschain/config.json`，自定义目录由 `CHAINLESSCHAIN_HOME` 选择。保留文件中的其他设置，使用 JSON 布尔值：

```json
{ "evolution": { "enabled": false } }
```

| 配置值  | 行为                                                                           |
| ------- | ------------------------------------------------------------------------------ |
| `false` | 明确关闭，优先于继承的部署环境变量；保留部署、信任和历史记录。                 |
| `true`  | 明确开启，首次实际使用可初始化本地签名运行时。                                 |
| 未设置  | 新安装与旧自动本地部署关闭；明确提供的外部部署或已启用的手动部署保留开启语义。 |

cc ui、VS Code 命令面板和 JetBrains 设置/动作中的 **Skill 自进化配置** 页可修改同一开关；配置目录不同的宿主不会共享设置。Quick Ask 和 UI 模型意图请求每次新请求读取配置；**运行中的 Agent 要停止并重新启动**。切换开关不会取消已在执行的请求或任务。

## 使用示例

需要 Node.js **22.12.0+**、npm **10+**。安装后重启 IDE 聊天宿主，并核对实际运行路径：

```bash
npm i -g chainlesschain@0.166.127 --registry https://registry.npmjs.org
cc --version
cc doctor
cc evolution deployment status --json
```

按需选择以下命令，开启与关闭是不同操作：

```bash
cc evolution deployment enable
```

```bash
cc evolution deployment disable
```

也可运行 `cc config set evolution.enabled true` 或 `cc config set evolution.enabled false`。`deployment enable` 可立即初始化缺失的本地签名运行时；只写配置时，初始化可能在首次实际使用发生。状态的 `evolutionEnabled` 是开关策略，`effectiveEnabled` 是部署选择，`verified` 才表示验证结果。

客户端从 [v5.0.3.142 Release](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.142) 下载；iOS IPA 的签名与安装仍按对应平台方式处理。

## 性能指标

本轮没有新增性能基准或真实模型任务验收，不承诺延迟或成功率提升。既有边界保持：文本快照 **1 MiB**、模型可见投影 **896 KiB**、图片单消息 **20 MiB**、单请求 **40 MiB**、JSONL 单事件 **16 MiB**。CLI 单输入最多 8 张图片、IDE 最多 4 张；实际 token 按服务商 usage 结算。

## 测试覆盖

CLI 发行源 `0377050191` 的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 均通过，随后经 GitHub Actions OIDC 发布。公开 npm 归档与不可变 CI 制品一致，签名来源和十个直接子依赖已核验；子依赖版本本轮未变，Session Core 为 **0.3.24**。

Open VSX `.165` 通过浏览器、宿主和真实 Remote SSH 发布门，公开 VSIX 与 CI 制品逐字节一致。JetBrains `.182` 已公开，原始候选的所有 payload 条目匹配；公开 ZIP 与 CI ZIP 的原始摘要不同。产品 `.142` 的五平台工作流通过，22 个公开资产匹配 CI manifest，三套桌面更新元数据通过回读。

累计验收仍为 **32/45**，**13** 项未完成；本轮未新增真实模型任务验收。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保持。

## 安全考虑

关闭自进化保留普通工具权限与沙箱策略；开启后仍严格验证签名和证据。真正损坏或重复键 JSON、敏感表达式、超预算输入继续拒绝。开关不会启动完整 RRSI 评估，也不会自动发布或晋升 Skill。

恢复摘要是派生视图，原始会话不被重写。省略摘录不算已读到对应源内容；需要时按字段或行范围重新读取。备份图片会话须同时保留 JSONL 与消息包目录。

## 故障排查

| 现象                                      | 处理                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 开关修改后 Agent 行为未变                 | 停止并重启该 Agent；用 Doctor 检查 CLI 路径与版本，核对各宿主配置目录。                                                         |
| `CC_AGENT_EVOLUTION_INGRESS_FAILED`       | 查看 `deployment status --json`。不需要自进化时明确关闭并重启；需要时处理报告中的部署或证据错误。该错误不只有摘要截断一种原因。 |
| `effectiveEnabled` 为真但 `verified` 为假 | 已选择部署不等于验证通过；核查 descriptor、trust root 与权限，不要修改摘要绕过验证。                                            |
| 恢复后担心命令重复执行                    | 先核对持久化工具结果及实际远端状态，再继续；模型入口失败不能证明 Git push 等副作用未发生。                                      |
| Windows 的 `cc` 指向 C 编译器             | 在 IDE 中设置正确 CLI 可执行路径，再运行 Doctor。                                                                               |

## 关键文件

- `packages/cli/src/lib/evolution/evolution-enabled.js`：开关值读取。
- `packages/cli/src/lib/evolution/evolution-deployment-loader.js`：可选部署选择与验证。
- `packages/cli/src/lib/retained-context-preview.js`：恢复摘要边界。
- `packages/vscode-extension/src/chat/draft-store.js`：附件与丢弃约束。
- [产品发布回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release127-public/product-publication.json)：五平台构建与制品验证。

## 相关文档

- [自进化配置详解](./self-evolution-configuration)
- [输入、图片预算与恢复](./agent-input-and-recovery)
- [本轮运行时设计](/design/release-runtime-update-2026-10-27)
- [上一轮普通文本投影说明（历史）](./cli-ide-update-2026-10-26)
