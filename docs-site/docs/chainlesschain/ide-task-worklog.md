# IDE 任务记录与新会话接力

> 适用版本：CLI `0.166.59`、Context/Memory Kernel `0.1.4`、VS Code `0.37.105`、JetBrains `0.4.126`。公开制品均来自精确提交 `a148ec7a57`；CLI `0.166.58` 及更早版本不支持本功能。

## 概述

IDE 任务记录用于保存长任务的目标、文件证据、失败尝试、修改、计划和压缩边界，并在需要时把这些已校验资料交给独立新会话。它解决上下文压缩、暂停或进程重启后重复探索和遗漏失败证据的问题。

Context/Memory Kernel 会话检查点是权威状态，项目内 `.chainlesschain/sessions/<session-id>/WORKLOG.md` 是便于人阅读的有界投影。Markdown 缺失或被修改时可以从检查点重建；手工编辑 Markdown 不会授予权限、覆盖权威状态或自动进入长期记忆。

VS Code 的 `↗` / **Continue in New Conversation with Task Notes** 和 JetBrains 的 **Continue in new chat** 会先等待完整工具边界并保存记录，再打开独立对话。新对话不复制完整旧聊天，不继承临时授权或执行中的工具；历史校验失败时不会调用模型。

## 快速开始

### 安装配套版本

```bash
npm install --global chainlesschain@0.166.59 --registry https://registry.npmjs.org
cc --version
```

- VSCodium、Cursor 等 Open VSX 客户端安装 `0.37.105`。
- 官方 VS Code 从 [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) 下载 `0.37.105` VSIX，再运行 **Extensions: Install from VSIX...**。
- JetBrains 2024.2+ 在 Marketplace 安装 `0.4.126`。

CLI 与插件应成对升级。旧插件没有接力按钮；旧 CLI 会被插件明确识别为不支持，不会静默创建一个没有历史的新会话。

### 第一次接力

1. 在旧会话中完成或暂停到安全的工具边界。
2. VS Code 点击标签栏 `↗`，或在命令面板运行 **Continue in New Conversation with Task Notes**；JetBrains 点击 **Continue in new chat**。
3. 若有待处理权限卡，先批准、拒绝或取消；保存成功前旧会话保持不变。
4. 新标签页出现后，检查预填的继续提示词并发送。也可以先改成“只分析失败原因，不修改文件”等更具体的要求。

## 核心特性

- **自动事件记录**：用户输入、工具开始/结束、助手回复、压缩前后、停止和异常都会更新检查点，不依赖模型主动写文件。
- **有界 Markdown 投影**：`WORKLOG.md` 最大 32 KiB；旧明细裁剪时保留计数，目标和最近进展优先保留。
- **权威状态校验**：读取历史时验证 session、workspace、revision 和 digest；缺失或过期 Markdown 从 JSONL 会话权威重建。
- **独立会话身份**：接力会话使用新的 session ID，只携带指定历史引用，不设置旧会话 resume ID。
- **当前要求优先**：历史以“低信任资料”注入，用户在新会话中的最新要求优先于旧计划。
- **失败闭合**：保存失败会保留旧会话；加载失败会在模型执行前中止，不会无提示地从零开始。
- **协议一致**：`TaskCheckpoint` 已同步到 Agent Protocol `0.1.11`、TypeScript SDK `0.2.11`、Python SDK `0.2.9` 及 Kotlin/Swift 生成投影。
- **凭据保护**：常见凭据在持久化和注入前遮盖；路径逃逸、超大文件、非法 session ID 和符号链接重定向会被拒绝。

## 系统架构

```text
VS Code / JetBrains 对话
        │ CC_TASK_WORKLOG=1
        ▼
CLI stream-json 会话生命周期
        │ 用户 / 工具 / 压缩 / 停止事件
        ▼
Context/Memory Kernel checkpointTaskProgress
        │ revision + digest + session/workspace binding
        ▼
JSONL SessionContextPort（权威）
        │ 校验后投影 / 缺失时重建
        ▼
.chainlesschain/sessions/<session-id>/WORKLOG.md
        │ worklog_session_id（仅首次发送）
        ▼
新的独立会话
```

IDE 只发起“保存”和“带指定历史开始”请求。CLI/Kernal 持有检查点与校验逻辑，Markdown 不成为第二套数据库。`worklog_saved` 返回成功后插件才停止旧执行入口并创建新标签页；新会话收到 `worklog_loaded` 后清除一次性来源引用。

## 配置参考

| 配置或入口 | 默认行为 | 说明 |
| --- | --- | --- |
| `CC_TASK_WORKLOG=1` | IDE 自动注入 | 为持久 stream-json 会话启用任务记录；普通用户不需要手工设置。 |
| `CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE` | 由 IDE 权威配置决定 | 工作记录要求 canonical 模式；shadow 模式只观察、不写检查点。不要在受管环境中自行改写。 |
| `CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_OPT_IN` | 仅 opt-in canary 使用 | 只在管理员明确采用 `opt_in_canary` 阶段时生效。 |
| `WORKLOG.md` | 最大 32 KiB | 自动生成；不要把手工编辑当作修改会话状态的接口。 |
| VS Code `+` / JetBrains `+ New chat` | 新建空白会话 | 用于新任务，不加载旧历史。 |
| VS Code `↗` / JetBrains `Continue in new chat` | 保存后接力 | 用于继续当前任务；最长等待保存确认 60 秒。 |

任务记录目录已在本仓库忽略。其他项目建议加入：

```gitignore
.chainlesschain/sessions/
```

## 性能指标

本功能没有承诺固定的 token 节省比例或服务等级。当前实现的可验证边界如下：

| 指标 | 边界 |
| --- | --- |
| Markdown 投影大小 | 最大 `32 KiB` |
| 最近用户要求 | 保留最近 4 条 |
| 继承事件 | 最多最近 16 条 |
| 继承文件/失败/修改 | 各最多最近 6 条 |
| 待完成工具记录 | 最多 64 条 |
| IDE 保存等待 | 60 秒，超时保留旧会话 |
| 额外模型调用 | 0；记录由运行事件生成 |

读取工作记录本身仍占用上下文，且尚未完成超长会话持久化 I/O 的生产基准。32 KiB 是安全上限，不是建议把每次记录写满的目标。

## 测试覆盖

发布前的针对性回归覆盖以下路径：

- 9 个 CLI/IDE 回归文件共 77 条测试：自动记录、真实 JSONL 检查点、流式接力、VS Code 标签页及图片消息、压缩、重启和中断。
- Context/Memory Kernel 99 条测试及 writer inventory 校验：session scope、digest、revision CAS、shadow 不写与 canonical settlement。
- JetBrains `compileJava` 与 `AgentChatSessionTest` 13 条测试：历史引用、附件、非法来源 ID 与新会话身份。
- 安全用例覆盖缺失、超大、格式错误、路径逃逸、workspace 不匹配、符号链接重定向、凭据遮盖和陈旧 writer。
- 精确提交 `a148ec7a57` 的三平台 CLI CI、Strict Sandbox、npm OIDC 发布、VS Code 标签门与 JetBrains 标签门均成功。

这些自动化结果不替代用户项目中的真实模型、完整 IDE UI 与超长会话验收。

## 安全考虑

- 历史记录是资料，不是指令、成功证明或权限凭证；新会话必须服从当前用户要求和当前策略。
- 接力不会继承旧会话的临时批准、执行中工具或完整聊天。需要权限的操作会重新走审批。
- session ID 只接受安全字符；记录必须位于当前真实 workspace 下，路径逃逸与链接重定向失败关闭。
- Markdown 与权威检查点不一致时，以检查点为准并重建投影；不能靠修改 Markdown 伪造已完成结果。
- 常见凭据会遮盖，但记录可能包含代码、文件名、错误信息与业务上下文。复制、提交或分享前仍须人工检查。
- 强制终止只能保证恢复最后一次已持久化检查点；结果未知的工具必须重新核实，不能当作成功。

## 故障排除

| 现象 | 原因与处理 |
| --- | --- |
| 提示 CLI 不支持任务记录 | 升级到 `0.166.59`，确认插件为 VS Code `0.37.105` 或 JetBrains `0.4.126`，发送一条消息完成 init 后重试。 |
| 看不到接力按钮 | 当前插件过旧，或尚未打开 ChainlessChain 对话视图。升级并重载 IDE。 |
| 保存等待超过一分钟 | 当前工具批次或权限卡未结束。处理待确认操作后重试；旧会话不会被关闭。 |
| 无法写入 `WORKLOG.md` | 检查项目目录权限、磁盘空间、链接目录和 Context/Memory 模式。不要手工创建指向项目外的链接。 |
| 历史加载失败 | 确认新旧会话使用同一真实 workspace，原 JSONL 会话日志仍存在，且没有传入当前会话自身的 ID。 |
| Markdown 被删除或修改 | 原检查点存在时会自动重建；若权威日志也已删除，则不能从 Markdown 反向恢复会话。 |
| 新会话重复读取旧文件 | 记录只提供定位和旧证据；文件已变化时重新核实是预期行为。 |
| 记录中出现 `outcome not yet known` | 工具已启动但没有可信结果。重新检查外部状态，不要直接重放可能有副作用的操作。 |

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/cli/src/lib/context-memory-kernel/task-worklog-port.js` | 有界状态、投影、遮盖、路径校验、继承和重建。 |
| `packages/cli/src/lib/context-memory-kernel/jsonl-session-context-port.js` | 从现有 JSONL 会话权威读取/写入任务检查点。 |
| `packages/cli/src/runtime/headless-stream.js` | stream-json 生命周期、保存/加载事件与模型执行前失败闭合。 |
| `packages/context-memory-kernel/lib/task-checkpoint.js` | revision、digest、session scope 与 canonical checkpoint 契约。 |
| `packages/context-memory-kernel/schema/context-memory-kernel.schema.json` | `TaskCheckpoint` 权威 schema。 |
| `packages/vscode-extension/src/chat/chat-view.js` | VS Code 接力按钮、超时、标签页和一次性历史引用。 |
| `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/AgentChatSession.java` | JetBrains stream 事件和历史来源发送。 |
| `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java` | JetBrains 原生接力入口与会话切换。 |

## 使用示例

### 新任务，不带历史

点击 VS Code `+` 或 JetBrains `+ New chat`，输入：

```text
分析当前项目的登录性能，只报告瓶颈，先不要修改代码。
```

### 将长任务接到新会话

在旧会话点击接力入口，等新标签页出现后发送预填提示词，或改成：

```text
读取已校验的任务记录，重新核对最近修改的文件；只修复仍然失败的测试，然后运行针对性验证。
```

### 只复盘失败，不继续修改

```text
读取历史任务记录，列出已经失败的尝试、对应证据和仍未知的结果。不要修改文件或重放外部操作。
```

### 查看记录

```bash
# 将 <session-id> 换成实际会话 ID
code .chainlesschain/sessions/<session-id>/WORKLOG.md
```

不要用编辑该文件的方式更改目标；直接在当前对话中补充要求。

## 相关文档

- [简明操作指南](/guide/ide-task-worklog)
- [IDE 插件使用指南](/chainlesschain/ide-plugin)
- [Context/Memory Kernel](/chainlesschain/context-memory)
- [会话管理器](/chainlesschain/session-manager)
- [Agent Platform 发布与升级](/chainlesschain/agent-platform-release)
- [设计文档：IDE 任务过程持久化与新会话交接](/design/ide-task-worklog-handoff)
- [Agent Protocol](/chainlesschain/agent-protocol)
- [Agent SDK](/chainlesschain/agent-sdk)
