# 检查点 / 回滚（cc checkpoint）

> **版本: 双引擎 (git-plumbing + copy fallback) | 状态: ✅ 生产可用 | Claude-Code rewind 平价 | 14 单元测试全绿**
>
> `cc checkpoint` 提供**文件状态快照与回滚**能力，对标 Claude Code 的 rewind。它采用**双引擎**设计：在 git 工作树中默认走 git-plumbing 影子提交（零触真实索引/工作区），非 git 目录则退回基于复制的快照。配合 `cc agent --checkpoint`，可在 agent 每次改文件前自动快照，随时回滚。

## 概述

让 AI agent 大胆改代码的前提是「随时能撤回」。`cc checkpoint` 为当前工作目录的文件状态打快照，并能精确回滚到任意快照——回滚会删除「快照后新建」的文件、重建「快照后删除」的文件，并在回滚前自动先打一个安全检查点。它与 git 提交互补：检查点是**会话内的临时安全网**，不污染你的提交历史。

### 双引擎

| 引擎 | 触发条件 | 存储 | 特点 |
|------|---------|------|------|
| **git-plumbing（默认）** | cwd 是 git 工作树 | 影子提交 `refs/cc-checkpoints/<session>/<id>`（+ `_tip` 链接指针） | 经临时索引（`GIT_INDEX_FILE`）捕获整棵工作树，**零触真实索引/工作区**；内容寻址（未变文件零成本）；`.gitignore` 感知 |
| **copy（兜底）** | cwd 非 git 工作树 | `<home>/checkpoints/<id>/<sha256>` | 快照显式指定的路径 |

命令按调用现场用 `isCheckpointAvailable(dir)` 选引擎，并通过归一化适配器（`gitEngine` / `copyEngine`）分发，对外接口一致。

## 核心特性

- 📸 **整棵工作树快照（git 引擎）**：经临时索引捕获，捕获时**不碰真实索引与工作区**
- 🪞 **影子提交存储**：快照存于 `refs/cc-checkpoints/<session>/<id>`，不进入你的提交历史/分支
- 🧮 **内容寻址**：未改动的文件复用对象，零额外成本；`.gitignore` 感知，忽略文件不入快照
- ⏪ **精确回滚**：read-tree + checkout-index，删除「快照后新建」文件、重建「快照后删除」文件
- 🛟 **回滚前自动安全检查点**：先快照当前状态再回滚，回滚本身也可撤回
- 🔍 **干跑（dry-run）**：不写入、不快照，仅计算将发生的变更集
- 🤖 **自动检查点（git 仓库内默认开启，v0.162.45+）**：cwd 在 git 仓库内时 `cc agent` **默认**在每个会改文件的工具前自动快照；`--no-checkpoint` 关闭，显式 `--checkpoint` 在任何目录强制开启（非 git 目录的复制引擎保持 opt-in，避免在家目录静默写真实文件）。只读工具跳过
- 🔁 **去重**：`createCheckpoint({skipIfUnchanged})` 跳过与上一帧完全相同的连续快照
- 📤 **JSON 输出**：`--json` 便于脚本消费

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│ cc checkpoint create|list|show|restore|delete|clear                    │
│ cc agent --checkpoint   （每个改文件工具前自动快照）                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ isCheckpointAvailable(dir) 选引擎
              ┌─────────────────┴───────────────────┐
              │                                     │
   ┌──────────▼──────────┐              ┌───────────▼────────────┐
   │ checkpoint-store.js  │              │ file-checkpoint.js      │
   │  gitEngine（默认）    │              │  copyEngine（兜底）     │
   │  临时索引捕获整树      │              │  复制显式路径            │
   │  refs/cc-checkpoints/ │              │  <home>/checkpoints/    │
   │    <session>/<id>     │              │    <id>/<sha256>        │
   └──────────────────────┘              └─────────────────────────┘
```

### 自动检查点（`agentLoop`）

`cc agent --checkpoint` 的钩子位于 `agent-core.js` 的 `agentLoop`——循环 yield 一个 `checkpoint` 事件，经 `toolContext.autoCheckpoint` + `checkpointSession`（默认 agent sessionId）串接。只读工具跳过，非 git 目录 no-op。

## 命令参考

```bash
cc checkpoint create [--session <s>] [--json]      # 创建快照（git 引擎默认整树）
cc checkpoint list [--session <s>] [--json]        # 列出快照
cc checkpoint show <id> [--diff] [--stat] [--json] # 查看某快照（含 diff/统计）
cc checkpoint restore <id> [--dry-run] [--force]   # 回滚到快照（rewind 别名）
cc checkpoint delete <id> [--json]                 # 删除某快照
cc checkpoint clear [--session <s>] [--force]      # 清空（某会话的）快照
```

公共 flag：`-d/--dir <dir>`（指定工作目录）、`-s/--session <s>`（会话隔离）、`--diff`、`--stat`、`--dry-run`、`--force`、`--json`。

绑定 agent 自动检查点：

```bash
cc agent --checkpoint -p "重构这个模块"   # 每次改文件前自动快照，可随时 restore
```

## 配置参考

- **会话隔离**：快照按 `<session>` 分组（`refs/cc-checkpoints/<session>/`），`--session` 指定，自动检查点默认用 agent 的 sessionId。
- **链接指针**：`_tip` 指针维护同一会话快照链，便于顺序回滚。
- **身份注入**：git 引擎通过 `GIT_*_NAME` / `GIT_*_EMAIL` 环境变量强制提交身份，避免 `commit-tree` 因缺少用户配置而失败。
- **去重**：`createCheckpoint({skipIfUnchanged})` 对连续相同快照去重。
- **copy 引擎根**：兜底引擎快照存于 `<home>/checkpoints/<id>/<sha256>`。

## 性能指标

- **捕获 O(变更)**：git 引擎内容寻址，未改动文件复用对象，仅变更文件产生新对象。
- **零触工作区**：捕获经临时索引完成，不污染真实 `.git/index` 与工作区，可与正常 git 操作并行。
- **干跑无副作用**：`--dry-run` 只计算变更集，不写对象、不快照。

## 测试覆盖率

`__tests__/unit/checkpoint-store.test.js` —— **14** 个测试，跑在真实临时 git 仓库中：

```bash
cd packages/cli
npx vitest run __tests__/unit/checkpoint-store.test.js
```

> 测试固定 `core.autocrlf=false`：Windows 默认会在 checkout-index 时把 `\n` 改写为 `\r\n`，破坏逐字节比较。

## 安全考虑

- **不污染历史**：快照存于私有 ref 命名空间 `refs/cc-checkpoints/*`，不进入分支/提交历史，不会被误推送。
- **回滚可撤回**：回滚前自动安全检查点，回滚结果本身可再回滚。
- **`.gitignore` 感知**：git 引擎尊重 `.gitignore`，密钥/构建产物等忽略文件不进快照。
- **会话隔离**：不同会话的快照互不干扰，避免误回滚他人/他会话的改动。

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 走了 copy 引擎而非 git | cwd 不是 git 工作树 | 在 git 仓库内运行；或接受 copy 引擎按显式路径快照 |
| 回滚后行尾全变了 | Windows `core.autocrlf=true` 在 checkout-index 改写换行 | 设 `core.autocrlf=false`（测试已固定此项） |
| `commit-tree` 报缺用户配置 | git 身份未配置 | 引擎已用 `GIT_*_NAME/EMAIL` 强制注入；确认环境未被清空 |
| 自动检查点没生成 | 工具是只读，或非 git 目录 | 只读工具跳过、非 git no-op 均为预期；改文件工具才快照 |
| 找不到快照 | `--session` 不匹配 | 用 `cc checkpoint list --session <s>` 确认会话 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/checkpoint-store.js` | git-plumbing 引擎（临时索引捕获、影子提交、回滚、dry-run、安全检查点） |
| `packages/cli/src/lib/file-checkpoint.js` | copy 兜底引擎（非 git 目录，按显式路径快照） |
| `packages/cli/src/commands/checkpoint.js` | `cc checkpoint` 命令 + 引擎选择/归一化适配器 |
| `packages/cli/src/ai/agent-core.js` | `agentLoop` 自动检查点钩子（yield `checkpoint` 事件） |
| `packages/cli/__tests__/unit/checkpoint-store.test.js` | 14 单元测试（真实临时仓库） |

## 使用示例

```bash
# 1) 手动打一个检查点
cc checkpoint create
#    → checkpoint <id> created

# 2) 改一通代码后查看某检查点相对现状的差异
cc checkpoint show <id> --diff --stat

# 3) 干跑：看看回滚会改哪些文件（不真正回滚）
cc checkpoint restore <id> --dry-run

# 4) 回滚（先自动安全检查点，再恢复）
cc checkpoint restore <id>

# 5) 让 agent 自带自动检查点地干活，事后随时回滚
cc agent --checkpoint -p "把支付模块拆成三个文件"
cc checkpoint list
cc checkpoint restore <id>     # 不满意就回滚

# 6) 清理某会话的所有检查点
cc checkpoint clear --session <s> --force
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [目标 / OKR 系统（cc goal）](./goal.md)
- [会话管理器](./session-manager.md)
- [Git 同步](./git-sync.md)
- [计划模式](./plan-mode.md)
