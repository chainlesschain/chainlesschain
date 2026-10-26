# CLI .125 与 IDE 升级指南（2026-10-26）

## 当前公开 CLI .125

CLI **0.166.125** 已通过 [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40274009347) 公开发布，精确源提交为 `4285a55c2f4dfb0c0eddb7cb8f63fc73f2ff1a2b`。Linux、Windows、macOS 的 CLI CI 和 Strict Sandbox 全部通过；公开归档与 CI 制品逐字节一致，签名来源、十个子包依赖及离线变更日志版本已核验。[发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release125-public/publication.json)。

本次修复 Python `subprocess.run(["git", *args])` 成功后，下一轮历史投影误报 JSON 错误并退出的问题，并覆盖已知代码路径中的 JS 展开、对象解包及部分运算表达式。严格 JSON 校验、敏感信息脱敏、预算和历史证据验证继续生效；敏感名称或无法解码的模板上下文仍保守拒绝。

```bash
npm i -g chainlesschain@0.166.125 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 IDE 聊天宿主。`cc --version` 应为 `0.166.125`；Doctor 中的路径必须对应实际升级的 CLI。当前公开插件为 Open VSX **0.37.162** / JetBrains **0.4.179**，其推荐值仍为 CLI **0.166.123**。本次只更新 CLI，子包版本不变。

候选 `.124` 因未同步离线变更日志被 CI 拦截，未发布，标签保留。未新增真实模型任务验收，累计仍为 **32/45**、**13** 项未完成；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。以下为 `.121` 的历史发行记录。

## CLI .121 历史发行记录

CLI **0.166.121**、Open VSX **0.37.161**、JetBrains **0.4.178** 均已公开并完成下载核验。两个 IDE 均推荐 CLI **0.166.121**。这次修复主要针对 Agent 在读到 Git、Shell、日志或普通说明文本后，错误报告 `Agent model JSON text is malformed or ambiguous` 的情况。

## 使用示例：升级步骤

先安装 CLI，再升级 IDE 插件：

```bash
npm i -g chainlesschain@0.166.121 --registry https://registry.npmjs.org
cc --version
cc doctor
```

`cc --version` 应显示 `0.166.121`。如果版本不符，在 Windows 使用 `where cc`，在 macOS/Linux 使用 `command -v cc` 检查实际可执行文件，再核对 IDE 中配置的 CLI 路径。升级后重启 IDE 聊天宿主并运行 Doctor；已经启动的旧宿主不会因为 npm 安装自动切换版本。

| 编辑器                              | 安装版本与渠道                                                                                                                                                  | 检查要点                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cursor、VSCodium 等 Open VSX 编辑器 | Open VSX **0.37.161**                                                                                                                                           | 插件版本及 Doctor 中 CLI 推荐为 `.121`                             |
| 原版 Microsoft VS Code              | [下载版本化 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.161/file/chainlesschain.chainlesschain-ide-0.37.161.vsix)，使用“从 VSIX 安装” | Microsoft Marketplace 仍未发布，不把 Open VSX 上架等同微软商店上架 |
| IntelliJ IDEA、PyCharm、WebStorm 等 | JetBrains Marketplace **0.4.178**，或[公开插件 ZIP](https://plugins.jetbrains.com/files/32208/1202806/chainlesschain-ide-bridge-0.4.178.zip)                    | 已批准、上市并验证公开下载；安装后重启并检查 CLI 路径              |

## 核心特性

普通状态 `[0 26]`、进度 `[1/3]`、百分比、日期时间、Git 哈希和范围、版本链接、简单 wiki 链接、数字正则范围及有限 Shell 判断不再仅因外观类似 JSON 而中止下一轮模型请求。非敏感的独立引号说明也可以保留。ANSI 控制码不会再触发 JSON 解析错误，但原有注入隔离仍然有效。

这不意味着所有解析错误都会被忽略。真正损坏或有重复键的 JSON、超预算输入，以及敏感键下无法安全脱敏的表达式仍会拒绝。保护凭据的表达式处理也已修复，避免只遮住第一个 token 却保留敏感后缀。

## 故障排查

升级后先查看已保存的工具结果和实际外部状态，再继续对话。若错误发生在 Git push 附近，模型入口失败本身不能证明 push 没有执行；先检查远端分支或已有 Git 结果，避免直接重复有副作用的命令。

本轮保留此前输入交付状态、Windows 草稿恢复、图片预算及工具轮次结算修复。图片原始字节限制与耐久事件限制是不同边界；备份图片会话时应同时保存 JSONL 和会话消息包目录。详细限制见[Agent 输入与恢复](./agent-input-and-recovery)。

## 测试覆盖

发行源码为 `4a7e5adc5e6a241434ecfa906a272e34b5ea6d2a`。CLI 的 Linux、Windows、macOS 发布门与 Strict Sandbox 均通过，之后经 GitHub Actions OIDC 发布。独立公共 npm 安装使用 `--ignore-scripts`，检查 CLI 和十个直接子包的来源、完整性与版本，并验证版本命令和静态 capability 清单。

Open VSX 公开 VSIX 与不可变 CI 候选的原始摘要和完整 ZIP 内容摘要一致。JetBrains 公开 ZIP 与候选 ZIP 的原始字节不同，但公开包内版本、编译后的 CLI 推荐值及所有候选 JAR 内部条目均已核对，且无新增条目；不声称两份 ZIP 逐字节相同。[完整发行证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/publication.json)保留审核中到公开的历史观察。

跨版本累计验收保持 **32/45**、**13** 项未完成；本次没有新增真实模型任务验收。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 不变。桌面和移动端产品具有独立版本、安装授权及验收流程，不能由 CLI 或 IDE 发布推断对应客户端已更新。

原生产品 **v5.0.3.141** 已于 **2026-10-25 18:12:59 UTC** 正式公开，非草稿、非预发布；源码为 `a024f3c6723375bbf76d17f701917243c118b1d1`，[Release 工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/40213914325)成功。它是独立于 CLI `.121` 的产品发行，不代表新增原生或模型任务验收；旧文档中的 `.140` 属于历史版本。

## 系统架构

IDE 使用配置的本机 CLI 路径启动宿主；CLI 在请求模型前执行有界输入快照与 Evolution 投影，真实工具结果继续按会话修订结算。`.121` 的文本识别修复发生在 CLI 投影层，升级插件不能替代升级实际执行的 CLI。设计细节见[本轮运行时设计](/design/release-runtime-update-2026-10-26)。

## 配置参考

| 检查项         | 当前配对与配置要求                                                    |
| -------------- | --------------------------------------------------------------------- |
| CLI 可执行路径 | Doctor 中显示的实际路径必须对应 `0.166.121`                           |
| IDE 推荐版本   | Open VSX `.161` / JetBrains `.178` 均推荐 `.121`                      |
| 模型配置       | 保留既有 provider、endpoint、文本与视觉模型设置；此次升级不要求换模型 |
| 持久会话备份   | JSONL 与对应消息包目录一起备份，保留原权限                            |

## 性能指标

本轮没有新增性能基准或真实模型验收，不承诺吞吐或任务成功率提升。普通文本兼容变化仍受既有字节、节点和深度限制；模型可见投影保持 896 KiB，图片和持久事件具有独立上限。累计 **32/45** 是跨版本结果，不是 `.121` 单轮成功率。

## 安全考虑

升级不放宽工具权限、严格 JSON 检查或敏感信息保护。无法安全投影的敏感表达式继续拒绝；ANSI 文本仍可能进入注入隔离。安装验证中的 `--ignore-scripts` 只描述独立取证步骤，不证明所有原生模块或安装脚本已验收。

## 关键文件

- [公开发行记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/publication.json)：三渠道版本、精确提交与工作流。
- [公共 npm 安装证明](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/public-registry-install.json)：来源、依赖固定版本与静态 smoke。
- [JetBrains 公开回读](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/jetbrains178-marketplace-readback.json)：批准、上市、下载与候选比较范围。

## 相关文档

上一版配对为 CLI **0.166.118** / Open VSX **0.37.160** / JetBrains **0.4.177**；更早 `.117/.159/.176` 的预算和恢复说明见[2026-10-23 指南](./cli-ide-update-2026-10-23)。带日期的旧文档保留其当时的版本和验收范围，当前安装以本页为准。
