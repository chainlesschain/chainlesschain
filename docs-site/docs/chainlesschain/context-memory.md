# 上下文与记忆

> 适用对象：CLI、Desktop 和 IDE 用户｜状态：现有能力总览；统一 Context/Memory Kernel 仍在设计与迁移中

## 概述

ChainlessChain 中的“上下文”和“记忆”不是同一件事：

| 概念 | 作用 | 典型生命周期 |
| --- | --- | --- |
| 上下文 | 本轮模型实际能看到的信息，包括系统规则、当前任务、近期对话、工具结果和召回内容 | 一轮或一个会话 |
| 压缩 | 在上下文窗口接近上限时，把较旧历史转换为更小的可继续状态 | 发生在会话内部 |
| 记忆 | 从会话之外再次取回的持久信息，例如用户偏好、项目约定或长期笔记 | 跨轮次或跨会话 |

当前版本已经提供上下文用量查看、会话压缩、项目记忆、用户画像、持久记忆和作用域记忆等能力，但它们仍由多套实现分别管理。正在设计的 **Context/Memory Kernel** 将统一压缩规则、记忆作用域、来源、保留期限、删除和跨端一致性。本文只把已经可用的行为写成正式能力；目标 Kernel 的行为会明确标为“统一后”。

## 核心特性

- **上下文可观测**：`cc context` 显示已存无头会话的 token 估算、角色分布和剩余窗口。
- **自动与手动压缩**：headless Agent 可在超阈值时自动压缩，也可以使用 `cc compact` 预览和持久化压缩结果。
- **任务连续性保护**：压缩路径保留系统信息、近期对话、最后一条用户请求，并修复工具调用与工具结果的配对。
- **多种持久信息来源**：项目说明文件、`USER.md`、`MEMORY.md`、每日笔记和 scoped memory 分别服务于不同场景。
- **作用域隔离**：当前 scoped memory 支持 `session`、`agent`、`global`，避免所有 Agent 无差别共享同一批记忆。
- **本地优先管理**：主要会话与记忆数据保存在本机 ChainlessChain 目录；具体位置和安全边界取决于所用能力。
- **统一中的生命周期**：未来由 Context/Memory Kernel 统一来源、可信度、敏感级别、保留、过期、替代和删除语义。

## 系统架构

当前用户可见的信息流如下：

```text
项目规则 / USER.md / 长期记忆 / scoped memory / 会话历史 / 工具结果
                              │
                              ▼
                    各入口的上下文构建器
                              │
                    token 预算与压缩判断
                              │
                              ▼
                         模型上下文
                              │
                   对话、工具调用和结果事件
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
          会话压缩检查点              可选的记忆写入/巩固
```

当前 CLI、Desktop 和部分运行时的构建、压缩与记忆存储还没有统一的权威实现。因此，相同会话从不同入口进入时，不应默认认为压缩结果、自动召回和删除范围完全等价。

统一后，Context/Memory Kernel 将位于 Agent Kernel 与各类存储之间：Agent Kernel 负责模型和工具循环，Context/Memory Kernel 负责“选什么、压什么、记什么、何时遗忘”，会话存储和记忆存储分别保留权威数据。

## 信息类型与生命周期

### 会话上下文

会话上下文包含近期消息、当前任务和工具交互。它会随着对话增长，并受模型上下文窗口限制。`cc context` 是只读报表，不会修改会话。

### 压缩状态

`cc compact` 将压缩结果追加为新的 `compact` 事件；后续恢复从最近一次压缩边界重建。原始 JSONL 事件不会因为压缩而删除，因此“压缩”不等于“擦除聊天记录”。

### 项目记忆

项目记忆来自项目目录中的 `cc.md`、兼容规则文件及其导入链，适合记录构建命令、代码规范和仓库约束。可用 `cc memory files` 查看当前实际加载的文件。项目记忆是显式文件，不是模型自动学习出的长期记忆。

### 用户画像

`~/.chainlesschain/USER.md` 保存用户明确维护的偏好画像，并可通过 Agent REPL 的 `/profile` 查看、修改或清空。它会进入支持该能力的 CLI 上下文，但不代表所有 Desktop/IDE 入口都已经共享同一注入路径。

### 持久记忆

传统持久记忆包括数据库条目、每日笔记和 `MEMORY.md`；scoped memory 则保存在独立的 `memory-store.json` 中。两套数据当前互不等价，`memory search` 和 `memory recall` 也查询不同存储。

### 统一后的目标生命周期

统一 Kernel 将把记忆明确区分为候选、有效、被强化、被替代、归档、过期、删除和物理清除，并记录来源证据。该生命周期目前不是所有记忆后端都已实现的承诺。

## 配置参考

### 常用入口

| 目的 | 命令或入口 | 当前行为 |
| --- | --- | --- |
| 查看上下文占用 | `cc context [session-id]` | 只读估算已存无头会话，不输出消息正文 |
| 预览压缩 | `cc compact <session-id> --dry-run` | 离线计算，不写入会话 |
| 持久化压缩 | `cc compact <session-id>` | 追加 `compact` 事件，恢复时生效 |
| 查看项目记忆来源 | `cc memory files [--json]` | 列出实际加载文件、作用域、字节数和警告 |
| 管理传统记忆 | `cc memory show|add|search|delete` | 操作传统数据库记忆 |
| 管理长期文件 | `cc memory daily` / `cc memory file` | 操作每日笔记和 `MEMORY.md` |
| 写入作用域记忆 | `cc memory store` | 写入 session-core `MemoryStore` |
| 召回作用域记忆 | `cc memory recall` | 查询独立的 `memory-store.json` |
| 管理用户画像 | `/profile show|set|clear|path` | 在交互式 Agent 中管理 `USER.md` |

`cc` 与完整命令名 `chainlesschain` 等价。具体选项以当前安装版本的 `cc <command> --help` 为准。

### 主要存储位置

| 数据 | 默认位置或后端 | 注意事项 |
| --- | --- | --- |
| 无头会话 | `~/.chainlesschain/sessions/*.jsonl` | 压缩为追加事件，不删除旧事件 |
| 用户画像 | `~/.chainlesschain/USER.md` | 用户显式维护，支持自定义路径 |
| scoped memory | `~/.chainlesschain/memory-store.json` | 当前为明文 JSON，不要写入密钥 |
| 长期文件记忆 | `MEMORY.md` 和 daily notes | 与 scoped memory 独立 |
| 项目记忆 | 项目内 `cc.md`、规则文件及导入文件 | 内容可随项目进入版本控制 |

`CHAINLESSCHAIN_HOME` 会影响部分 CLI 运行目录。不要在不了解迁移范围时手动移动或合并这些文件。

## 性能指标

本文不新增跨模型、跨入口的统一性能承诺。现有行为包括：

- `cc context` 使用本地启发式 token 估算，无模型调用；
- 离线 `cc compact` 不请求 LLM，主要耗时随消息和工具结果体量增长；
- scoped memory 当前使用本地关键词、标签和分类匹配，而不是统一向量检索；
- Desktop 永久记忆、层次化记忆和 CLI MemoryStore 有各自的容量与性能口径。

统一 Kernel 的验收将分别记录上下文构建 P50/P95、压缩耗时、压缩比例、召回耗时、外置结果读取量、缓存命中和恢复成功率，并绑定入口、模型、操作系统和版本。

## 测试覆盖

现有专项测试分别覆盖 `cc context` 分类、`cc compact` 命令、PromptCompressor 策略、工具配对、自动压缩持久化、CLI scoped memory 命令，以及 Desktop 上下文工程与永久记忆组件。

这些测试证明各自能力可用，但不能证明三个产品入口已经共享同一 Kernel。统一切换的新增发布门至少包括：

- 同一 fixture 在 CLI、Desktop、VS Code 和 JetBrains 得到等价的保留项与恢复结果；
- 压缩前后的 pending approval、未完成任务和工具调用/结果不丢失；
- 记忆作用域不会在巩固或同步时被扩大；
- 删除、过期和敏感信息过滤覆盖主存储、索引、缓存与同步副本；
- 崩溃、重复提交和 provider 结果未知时不会生成虚假的压缩或记忆成功状态。

## 安全考虑

- 不要把 API key、密码、私钥、会话 cookie 或恢复码写入 `USER.md`、项目记忆、`MEMORY.md` 或 scoped memory。
- `memory-store.json` 当前是明文文件；设备或账号被其他人访问时，其中内容可能被读取。
- 项目记忆可能进入 Git。提交前检查是否包含个人信息、内部地址或凭据。
- 压缩只减少后续送给模型的内容，不会自动删除原始会话事件。
- `memory delete` 当前只操作传统记忆；它不是跨所有后端的“彻底删除全部记忆”。
- 需要彻底删除时，应先确认数据属于会话、传统记忆、scoped memory、用户画像还是项目文件，并按对应文档处理备份和同步副本。
- 从网页、工具或外部文件提取的信息不应因为被写入记忆而自动提升为可信指令。

统一 Kernel 将要求敏感级别、允许去向和删除状态随数据派生传播，但在跨端切换完成前仍应按上述当前边界操作。

## 故障排查

### AI 在新会话中没有记住上次内容

先判断内容是否真正写入了持久记忆。普通聊天历史、`memory add`、`memory store`、项目记忆和 `USER.md` 是不同来源。当前新会话自动注入 top-K scoped memory 仍未在所有入口统一启用。

### `memory recall` 找不到 `memory add` 的内容

`memory add/search` 使用传统记忆后端，`memory store/recall` 使用 session-core scoped memory。请使用成对的命令，并核对 `scope` 与 `scope-id`。

### 压缩后仍能在磁盘上看到旧内容

这是预期行为。会话 JSONL 采用 append-only 审计，`compact` 只改变恢复起点。若目标是删除数据，请执行对应存储的删除流程，不要把压缩当成删除。

### 不确定当前加载了哪些项目规则

运行：

```bash
cc memory files --json
```

检查路径、作用域、截断和导入警告，并移除不应进入上下文的文件。

### 上下文仍然过大

先使用 `cc context <session-id>` 确认主要占用，再用 `cc compact <session-id> --dry-run` 预览。如果大头来自工具 schema、项目文件或当前仍需保留的大结果，仅压缩旧消息可能不会显著降低占用。

### 想清空所有关于自己的数据

当前没有覆盖全部后端的一键命令。需要分别核对会话、`USER.md`、项目记忆、传统记忆、scoped memory、Desktop 永久/层次化记忆以及可能存在的同步副本。统一 Kernel 的删除编排仍属于目标能力。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/cli/src/harness/prompt-compressor.js` | CLI 压缩策略、token 估算和工具配对 |
| `packages/cli/src/harness/provider-backed-compaction.js` | provider-backed 语义压缩路径 |
| `packages/cli/src/lib/cli-context-engineering.js` | CLI 上下文构建与压缩摘要注入 |
| `packages/session-core/lib/memory-store.js` | session/agent/user/global 作用域记忆原语 |
| `packages/session-core/lib/memory-consolidator.js` | 从会话 trace 提炼记忆 |
| `desktop-app-vue/src/main/llm/context-engineering.js` | Desktop 上下文工程实现 |
| `desktop-app-vue/src/main/llm/prompt-compressor.js` | Desktop 独立压缩实现 |

## 使用示例

### 长会话压缩并继续

```bash
cc context session-abc
cc compact session-abc --dry-run
cc compact session-abc
cc agent --resume session-abc
```

### 保存并召回 Agent 作用域偏好

```bash
cc memory store "此 Agent 默认使用 TypeScript" \
  --scope agent --scope-id agent_codegen \
  --category preference --tags typescript,style

cc memory recall "TypeScript" \
  --scope agent --scope-id agent_codegen
```

### 检查显式上下文来源

```bash
cc memory files
cc memory file
cc memory daily --list
```

在交互式 Agent 中还可以运行 `/profile show` 查看用户画像。不要仅凭模型回答判断某条信息来自哪里。

## 相关文档

- [上下文窗口分解](./cli-context.md)
- [会话上下文压缩](./cli-compact.md)
- [持久记忆命令](./cli-memory.md)
- [Context Engineering](./context-engineering.md)
- [层次化记忆](./hierarchical-memory.md)
- [永久记忆](./permanent-memory.md)
- [Agent Kernel 使用与运维](./cli-agent-kernel.md)
- [设计文档：Context/Memory Kernel](/design/modules/108-context-memory-kernel)
