# 上下文与记忆

> 适用对象：CLI、Desktop 和 IDE 用户｜状态：统一 Context/Memory Kernel 已完成默认切换与正式生产关闭；当前公开基线为 CLI `0.166.15`、Kernel `0.1.0`、Agent Protocol `0.1.7` 与 SDK `0.2.7`

## 概述

ChainlessChain 中的“上下文”和“记忆”不是同一件事：

| 概念 | 作用 | 典型生命周期 |
| --- | --- | --- |
| 上下文 | 本轮模型实际能看到的信息，包括系统规则、当前任务、近期对话、工具结果和召回内容 | 一轮或一个会话 |
| 压缩 | 在上下文窗口接近上限时，把较旧历史转换为更小的可继续状态 | 发生在会话内部 |
| 记忆 | 从会话之外再次取回的持久信息，例如用户偏好、项目约定或长期笔记 | 跨轮次或跨会话 |

公开版本已经通过 [模块 108：Context/Memory Kernel](/design/modules/108-context-memory-kernel) 的统一 schema、planner、压缩与记忆状态机管理 CLI、Desktop、App Server 和 IDE projection。CLI 旧 SQLite/session-core 记忆会幂等迁移到 canonical authority；旧 writer 在默认阶段失败关闭。唯一关闭候选 `e93dc817ae7f65159ffa754472ebdac30de34180` 已通过 exact-SHA Linux/Windows/macOS 矩阵、30 分钟 soak、证据聚合与 production-close 验签；`main@db53dc2da4` 的后续 Graph/Team 质量加固不改变该 Context/Memory 关闭身份。

## 核心特性

- **上下文可观测**：`cc context` 显示已存无头会话的 token 估算、角色分布和剩余窗口。
- **自动与手动压缩**：headless Agent 可在超阈值时自动压缩，也可以使用 `cc compact` 预览和持久化压缩结果。
- **任务连续性保护**：压缩路径保留系统信息、近期对话、最后一条用户请求，并修复工具调用与工具结果的配对。
- **多种持久信息来源**：项目说明文件、`USER.md`、`MEMORY.md`、每日笔记和 scoped memory 分别服务于不同场景。
- **作用域隔离**：Kernel 契约支持 `turn`、`session`、`agent`、`project`、`user`、`global`；CLI 的 `memory store/recall` 当前直接暴露 `session`、`agent`、`user`、`global`，入口不能自行扩大作用域。
- **本地优先管理**：主要会话与记忆数据保存在本机 ChainlessChain 目录；具体位置和安全边界取决于所用能力。
- **统一生命周期**：来源、可信度、敏感级别、保留、过期、替代、tombstone、物理清除和重启对账使用同一契约。
- **跨端只读投影**：VS Code 与 JetBrains 只消费 App Server canonical lifecycle，不直接写记忆存储。

## 系统架构

当前 canonical 信息流如下：

```text
项目规则 / USER.md / 长期记忆 / scoped memory / 会话历史 / 工具结果
                              │
                              ▼
                    Context/Memory Kernel
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

Context/Memory Kernel 位于 Agent Kernel 与各类存储之间：Agent Kernel 负责模型和工具循环，Context/Memory Kernel 负责“选什么、压什么、记什么、何时遗忘”，会话存储和记忆存储分别保留权威数据。宿主仍可提供更严格的预算和隐私 policy，但不能扩大 scope、trust 或 allowed sinks。

## 信息类型与生命周期

### 会话上下文

会话上下文包含近期消息、当前任务和工具交互。它会随着对话增长，并受模型上下文窗口限制。`cc context` 是只读报表，不会修改会话。

### 压缩状态

`cc compact` 将压缩结果追加为新的 `compact` 事件；后续恢复从最近一次压缩边界重建。原始 JSONL 事件不会因为压缩而删除，因此“压缩”不等于“擦除聊天记录”。

### 项目记忆

项目记忆来自项目目录中的 `cc.md`、兼容规则文件及其导入链，适合记录构建命令、代码规范和仓库约束。可用 `cc memory files` 查看当前实际加载的文件。项目记忆是显式文件，不是模型自动学习出的长期记忆。

### 用户画像

`~/.chainlesschain/USER.md` 作为兼容输入幂等导入 canonical user-scope 记录。Agent REPL 的 `/profile` 仍提供用户操作入口；实际 provider 上下文由 ContextPlan 选择，IDE 通过 canonical projection 展示状态。

### 持久记忆

`cc memory show|add|search|delete|store|recall` 使用 canonical durable store。旧数据库和 `memory-store.json` 只作为受审计 importer/read-only projection；删除时按 evidence reference 物理清除旧副本，失败返回 partial，并可使用 `cc memory reconcile <operation-id>` 在重启后继续。

### 统一记忆生命周期

统一 Kernel 把记忆明确区分为候选、有效、被强化、被替代、归档、过期、删除和物理清除，并记录来源证据。删除先持久化不含正文的最小 tombstone，再清除 first-party projection；只有所有 purge receipt 成功后才返回 `purged`。

## 配置参考

### 常用入口

| 目的 | 命令或入口 | 当前行为 |
| --- | --- | --- |
| 查看上下文占用 | `cc context [session-id]` | 只读估算已存无头会话，不输出消息正文 |
| 预览压缩 | `cc compact <session-id> --dry-run` | 离线计算，不写入会话 |
| 持久化压缩 | `cc compact <session-id>` | 追加 `compact` 事件，恢复时生效 |
| 查看项目记忆来源 | `cc memory files [--json]` | 列出实际加载文件、作用域、字节数和警告 |
| 管理 canonical 记忆 | `cc memory show|add|search|delete` | 操作 canonical durable memory；旧数据库只导入/清除 |
| 管理作用域记忆 | `cc memory store|recall`，删除使用 `cc memory delete` | 使用 session/agent/project/user/global scope fence |
| 恢复部分删除 | `cc memory reconcile <operation-id>` | 重试物理清除并返回可审计 receipt |
| 查看兼容长期文件 | `cc memory daily` / `cc memory file` | daily append 进入 canonical；`MEMORY.md` 保持只读兼容来源 |
| 写入作用域记忆 | `cc memory store` | 写入 session-core `MemoryStore` |
| 召回作用域记忆 | `cc memory recall` | 查询 canonical durable store；首次切换会幂等导入旧 `memory-store.json` |
| 管理用户画像 | `/profile show|set|clear|path` | 在交互式 Agent 中管理 `USER.md` |

`cc` 与完整命令名 `chainlesschain` 等价。具体选项以当前安装版本的 `cc <command> --help` 为准。

### 主要存储位置

| 数据 | 默认位置或后端 | 注意事项 |
| --- | --- | --- |
| 无头会话 | `~/.chainlesschain/sessions/*.jsonl` | 压缩为追加事件，不删除旧事件 |
| 用户画像 | `~/.chainlesschain/USER.md` | 用户显式维护，支持自定义路径 |
| canonical memory | `~/.chainlesschain/context-memory/kernel-v1.json` | 当前为本地明文 JSON authority，不要写入密钥 |
| legacy scoped memory | `~/.chainlesschain/memory-store.json` | 只作受审计导入与删除对账，不再是默认 writer |
| 长期文件记忆 | `MEMORY.md` 和 daily notes | 与 scoped memory 独立 |
| 项目记忆 | 项目内 `cc.md`、规则文件及导入文件 | 内容可随项目进入版本控制 |

`CHAINLESSCHAIN_HOME` 会影响部分 CLI 运行目录。不要在不了解迁移范围时手动移动或合并这些文件。

## 性能指标

本文不新增跨模型、跨入口的统一性能承诺。现有行为包括：

- `cc context` 使用本地启发式 token 估算，无模型调用；
- 离线 `cc compact` 不请求 LLM，主要耗时随消息和工具结果体量增长；
- scoped memory 当前使用本地关键词、标签和分类匹配，而不是统一向量检索；
- Desktop 永久记忆、层次化记忆和 CLI MemoryStore 有各自的容量与性能口径。

统一 Kernel 的容量与 soak 验收记录上下文构建 P50/P95、压缩耗时、压缩比例、召回耗时、外置结果读取量、缓存命中和恢复成功率，并绑定入口、操作系统、提交和证据 digest；机器间数值不作为统一性能承诺。

## 测试覆盖

专项测试与跨端 conformance fixture 已覆盖 `cc context` 分类、`cc compact`、PromptCompressor、工具配对、自动压缩持久化、CLI scoped memory、Desktop、App Server、VS Code 与 JetBrains projection。正式关闭还验证了：

- 同一 fixture 在 CLI、Desktop、VS Code 和 JetBrains 得到等价的保留项与恢复结果；
- 压缩前后的 pending approval、未完成任务和工具调用/结果不丢失；
- 记忆作用域不会在巩固或同步时被扩大；
- 删除、过期和敏感信息过滤覆盖主存储、索引、缓存与同步副本；
- 崩溃、重复提交和 provider 结果未知时不会生成虚假的压缩或记忆成功状态。

## 安全考虑

- 不要把 API key、密码、私钥、会话 cookie 或恢复码写入 `USER.md`、项目记忆、`MEMORY.md` 或 scoped memory。
- canonical `context-memory/kernel-v1.json` 与遗留 `memory-store.json` 都是本地明文文件；设备或账号被其他人访问时，其中内容可能被读取。
- 项目记忆可能进入 Git。提交前检查是否包含个人信息、内部地址或凭据。
- 压缩只减少后续送给模型的内容，不会自动删除原始会话事件。
- `memory delete` 通过 canonical lifecycle 删除已登记记录并清理 first-party projection；它不等于清除项目文件、外部备份或法务保留副本。
- 需要彻底删除时，应先确认数据属于会话、传统记忆、scoped memory、用户画像还是项目文件，并按对应文档处理备份和同步副本。
- 从网页、工具或外部文件提取的信息不应因为被写入记忆而自动提升为可信指令。

统一 Kernel 要求敏感级别、允许去向和删除状态随数据派生传播；外部备份、法务保留与尚未接入的离线副本仍受部署方策略约束，不能仅凭在线 purge receipt 推断它们已经清除。

## 故障排查

### AI 在新会话中没有记住上次内容

先判断内容是否真正写入了持久记忆。普通聊天历史、`memory add`、`memory store`、项目记忆和 `USER.md` 仍是不同来源；ContextPlan 会按入口能力、作用域、可信度、敏感级别、预算和允许去向筛选召回项，因此“已存储”不表示每轮都会注入。

### `memory recall` 找不到 `memory add` 的内容

两组命令现在都通过 canonical authority，但保留不同的用户语义：`add/search` 面向通用条目，`store/recall` 面向显式 scoped memory。请使用成对的命令，并核对 `scope`、`scope-id`、分类与标签；旧 SQLite/session-core 数据只会幂等导入，不再获得独立写权限。

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

当前没有覆盖外部备份与所有部署后端的一键命令。在线 canonical 删除会先提交 tombstone，再清理已注册的主存储、索引、缓存与副本，并在部分失败时提供 reconciliation；仍需分别核对 `USER.md`、项目文件、法务保留、外部备份与未接入 Kernel 的离线副本。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/cli/src/harness/prompt-compressor.js` | CLI 压缩策略、token 估算和工具配对 |
| `packages/cli/src/harness/provider-backed-compaction.js` | provider-backed 语义压缩路径 |
| `packages/cli/src/lib/cli-context-engineering.js` | CLI 上下文构建与压缩摘要注入 |
| `packages/context-memory-kernel/lib/runtime.js` | 唯一 Context/Memory mutation runtime |
| `packages/context-memory-kernel/inventory/writers.v1.json` | writer authority 与切换状态清单 |
| `packages/context-memory-kernel/fixtures/cross-surface-projection-v1.tsv` | 7 个 surface、14 个场景的 conformance fixture |
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
