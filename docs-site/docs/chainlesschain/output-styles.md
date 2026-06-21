# 输出风格 (Output Styles)

> **CLI 特性 | `cc output-style` / `cc agent --output-style` / REPL `/output-style` | Claude Code 平价**

输出风格（Output Styles）为 `cc agent` 提供一层**命名、可复用的人格（persona）**：以带 frontmatter 的 Markdown 文件描述「AI 应当如何表现」，其正文被**追加**到系统提示之后，从而在**保留核心编码能力**的前提下改变 agent 的行为与语气。对标 Claude Code 的 `/output-style`。

## 概述

`cc agent` 默认是一个标准编码助手。输出风格让你无需重写整个系统提示，就能把它「染色」成不同风格的助手——例如边做边讲解思路的 `explanatory`，或留出小块让用户自己动手的 `learning`，或任意自定义人格。

- 风格 = 一个 Markdown 文件，`---` frontmatter 含 `name` / `description`，正文是人格描述。
- 正文在 **base 系统提示 + `--append-system-prompt` 之后**作为最后一层追加（不替换 base）。
- 内置 3 个风格（`default` / `explanatory` / `learning`），零文件即可用；同名文件可 **shadow（覆盖）** 内置风格。
- 来源目录：`.chainlesschain/output-styles/`、`.claude/output-styles/`（项目级），`~/.claude/output-styles/`（个人级）。
- 生效优先级：`--output-style <name>` > `.claude/settings.json` 的 `outputStyle` 默认 > 无（不叠加）。

与 `--system-prompt`（**整体替换**系统提示）不同，输出风格是其**之上的叠加层**，不会丢掉 base 编码指令。

## 核心特性

- 🎭 **命名人格叠加**：风格正文追加到系统提示末尾，只改行为/语气，不动核心编码能力与工具机制。
- 📦 **3 个内置风格**：`default`（空正文，无叠加）/ `explanatory`（讲解 why 与权衡）/ `learning`（留 `TODO(you):` 给用户写）。
- 📁 **文件源 + 多层级发现**：项目级 `.chainlesschain/output-styles/`、`.claude/output-styles/` 与个人级 `~/.claude/output-styles/`；**文件覆盖同名内置，项目覆盖个人**。
- 🎯 **三种应用方式**：headless `--output-style`、REPL `/output-style` 运行时热切换、`settings.json` 设默认。
- 🔁 **REPL 运行时热切换**：`/output-style <name>` 即时重算 `messages[0]`（系统消息），`/output-style none` 清除，无需重启会话。
- 🧩 **零依赖 frontmatter 解析**：复用 slash-commands 的解析模式，不引入 js-yaml。
- 🛠️ **`cc output-style` 命令组**：`list` / `show` / `new`（脚手架），`list` 标 `*` = settings 默认。
- 🧪 **`_deps` 注入**：`fs` / `homedir` 可注入，便于单测无副作用。

## 系统架构

```
                       ┌──────────────────────────────────────────┐
   风格来源(优先级低→高) │ 内置(default/explanatory/learning)         │
                       │  → ~/.claude/output-styles/*.md (个人)     │
                       │  → .claude/output-styles/*.md (项目)       │
                       │  → .chainlesschain/output-styles/*.md(项目)│
                       └───────────────────┬──────────────────────┘
                                           │ discoverOutputStyles() 合并
                                           │ (文件覆盖内置, 项目覆盖个人)
                                           ▼
   生效选择                    resolveOutputStyle(explicitName)
   --output-style > settings.json.outputStyle > 无
                                           │ → { name, body, missing? }
                                           ▼
   系统提示组装   composeSystemPrompt(base, { systemPrompt, appendSystemPrompt, outputStyle })
                  base  →(systemPrompt 整体替换?)→ + appendSystemPrompt → + outputStyle(最后一层)
                                           │
                ┌──────────────────────────┼───────────────────────────┐
                ▼                          ▼                            ▼
        headless-runner            headless-stream                 agent-repl
        (-p 一次性)                 (stream-json)                   (交互式)
        missing→warn 忽略           missing→静默忽略                 /output-style 热切换
```

**数据流要点**：

| 阶段     | 函数                                | 行为                                                                                                         |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 发现     | `discoverOutputStyles(cwd, opts)`   | 内置打底 → 个人目录 → 项目目录依次合并，文件按 `name`（或文件名）覆盖同名项                                  |
| 取单个   | `getOutputStyle(name, cwd)`         | 大小写不敏感匹配，未命中返回 `null`                                                                          |
| 读默认   | `settingsDefaultOutputStyle(cwd)`   | 按 `~/.claude` < 项目 `.claude` < `.claude/settings.local.json` 顺序读 `outputStyle`，**后者覆盖前者**       |
| 解析生效 | `resolveOutputStyle(explicit, cwd)` | 显式名 → settings 默认 → 无；命中返回 `{name, body}`；名存在但找不到风格返回 `{name, body:"", missing:true}` |
| 组装     | `composeSystemPrompt(base, {...})`  | `outputStyle` 作为最后一层追加，前置空行分隔                                                                 |

## 内置风格

| 名称          | 说明                         | 行为                                                                                                     |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `default`     | 标准编码助手（无人格叠加）   | 正文为空，`composeSystemPrompt` 不追加任何内容                                                           |
| `explanatory` | 解释改动背后的推理与权衡     | 工作中穿插简短 `★ Insight` 笔记，讲清为什么这么选、有哪些非显而易见的权衡（1–2 句，不为常规步骤注水）    |
| `learning`    | 协作式，给用户留可学习的小块 | 遇到「用户自己写会更有收获」的小范围片段时，插入 `TODO(you):` 标记（含一行说明）而非代劳，再继续其余部分 |

> 同名文件会 shadow 内置风格——例如新建 `.claude/output-styles/explanatory.md` 即可覆盖内置 `explanatory` 的正文。

## 命令参考

```bash
# 列出全部风格（内置 + 文件），标 * = settings.json 默认；--json 输出结构化
cc output-style list [--json]
cc output-style ls               # 别名

# 查看某风格的元信息与正文
cc output-style show <name> [--json]

# 脚手架一个新风格文件（默认落 .claude/output-styles/，--personal 落 ~/.claude/）
cc output-style new <name> [--description "..."] [--personal]
```

`list` 输出中的标签：`[builtin]` = 内置、`[proj]` = 项目级文件、`[pers]` = 个人级文件；`*` 表示该风格是 `settings.json` 当前默认。

**应用风格的三种方式**：

```bash
# 1) headless 一次性套用
cc agent -p "重构这个模块" --output-style explanatory

# 2) settings.json 设默认（见下节）

# 3) REPL 内运行时切换
cc agent
> /output-style                 # 列出全部 + 当前激活(* 标记)
> /output-style learning        # 即时切换
> /output-style none            # 清除人格，回到 base 系统提示
```

## 配置参考

### 风格文件格式

```markdown
---
name: pirate
description: 像海盗船长一样说话，但代码照样严谨
---

## Output style: Pirate

用海盗的口吻与用户交流，但工程严谨度不变。这段文本会被追加到系统提示之后
（base 编码指令之后），所以聚焦于**行为/语气**，不要写工具机制。
```

> frontmatter key 会被驼峰化（`my-key` → `myKey`）；`name` 缺省时回退为文件名（去 `.md`）。正文（`---` 之后）即人格描述。

### settings.json 默认风格

在 `.claude/settings.json`（或个人 `~/.claude/settings.json`、项目 `.claude/settings.local.json`）中：

```json
{
  "outputStyle": "explanatory"
}
```

层级合并规则：`~/.claude/settings.json` < 项目 `.claude/settings.json` < 项目 `.claude/settings.local.json`，**后者覆盖前者**。命令行 `--output-style` 优先级最高，覆盖 settings 默认。

### 发现目录优先级（低 → 高）

| 优先级    | 目录                                       | 作用域 |
| --------- | ------------------------------------------ | ------ |
| 1（最低） | 内置常量 `BUILTIN_OUTPUT_STYLES`           | —      |
| 2         | `~/.claude/output-styles/*.md`             | 个人   |
| 3         | `<cwd>/.claude/output-styles/*.md`         | 项目   |
| 4（最高） | `<cwd>/.chainlesschain/output-styles/*.md` | 项目   |

同名时，高优先级覆盖低优先级（文件覆盖内置，项目覆盖个人）。

## 性能指标

- **零运行时依赖**：frontmatter 自解析，无 js-yaml 等额外加载。
- **一次性磁盘扫描**：`discoverOutputStyles` 仅在启动 / 切换时 `readdirSync` 三个目录，目录不存在静默跳过（`try/catch` 吞 `ENOENT`）。
- **惰性加载**：风格模块在命令/runtime 内通过 `await import("../lib/output-styles.js")` 动态引入，不影响 `cc` 主入口冷启动。
- **运行时切换零重启**：REPL `/output-style` 仅重算 `messages[0].content`（`_replBaseSystem` + 风格正文），不重建会话或工具。
- **上下文成本**：风格正文一次性进入系统提示，内置风格正文均为数行短文，token 开销可忽略；自定义风格越长，系统提示越大。

## 测试覆盖

| 测试文件                                                   | 用例数 | 覆盖点                                                                                                                                                                      |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/__tests__/unit/output-styles.test.js`        | 11     | frontmatter 解析、内置风格、文件发现/覆盖、项目优先个人、`getOutputStyle` 大小写不敏感、`settingsDefaultOutputStyle` 层级合并、`resolveOutputStyle` 优先级与 `missing` 标记 |
| `packages/cli/__tests__/unit/output-style-command.test.js` | 3      | `list` / `show` / `new` 命令行为                                                                                                                                            |

合计 **14** 个单测（loader 11 + command 3）。测试通过 `_deps` 注入 `fs` / `homedir`，无真实磁盘副作用。

```bash
cd packages/cli
npx vitest run __tests__/unit/output-styles.test.js __tests__/unit/output-style-command.test.js
```

## 安全考虑

- **不放宽权限**：输出风格只追加到**系统提示**，不修改工具白名单、权限规则或 shell 黑名单——切风格不会让 agent 获得新能力。
- **叠加而非替换**：风格是 base + `--append-system-prompt` 之上的最后一层，base 编码与安全指令始终保留；要整体替换才用 `--system-prompt`（不同机制）。
- **正文即提示注入面**：风格文件正文进入系统提示，应只来自可信来源；不要直接套用未经审阅的第三方风格文件，正如不会盲目执行未知脚本。
- **损坏配置 fail-safe**：`settings.json` 解析失败被静默忽略（不崩），坏 frontmatter 退化为「无 frontmatter，正文=全文」。
- **缺失风格不静默骗人**：headless（`-p`）下未知风格名会向 stderr 打印 `output-style: unknown style "<name>"` 并忽略，而非假装已套用。

## 故障排除

| 现象                                  | 原因                                                                          | 解决                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cc output-style list` 看不到我的文件 | 文件不在三个发现目录之一，或扩展名不是 `.md`                                  | 放到 `.claude/output-styles/` 或 `.chainlesschain/output-styles/`，确认 `.md` 后缀         |
| 套了风格但行为没变                    | 名字拼错 / settings 默认被 `--output-style` 覆盖 / 用的是 `default`（空正文） | `cc output-style show <name>` 看正文是否非空；headless 留意 stderr 的 `unknown style` 警告 |
| headless 报 `unknown style "x"`       | `--output-style` 或 settings 的 `outputStyle` 指向不存在的风格                | 用 `cc output-style list` 核对可用名                                                       |
| 自定义风格覆盖不了内置                | 文件 `name:` 与内置名不一致                                                   | frontmatter `name` 必须与内置名完全相同（如 `explanatory`）                                |
| 个人风格被忽略                        | 项目目录存在同名文件                                                          | 项目级优先于个人级；改名或移除项目同名文件                                                 |
| REPL `/output-style <name>` 无反应    | 名不存在                                                                      | 先 `/output-style`（无参）列出全部，再切换；`/output-style none` 清除                      |
| settings 默认不生效                   | `outputStyle` 写在了错误的 JSON 文件，或被命令行覆盖                          | 确认写在 `.claude/settings.json`；`--output-style` 会覆盖默认                              |

## 关键文件

| 文件                                          | 职责                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/lib/output-styles.js`       | 核心：`discoverOutputStyles` / `getOutputStyle` / `settingsDefaultOutputStyle` / `resolveOutputStyle` + `BUILTIN_OUTPUT_STYLES` + 零依赖 frontmatter 解析（`_deps` 注入） |
| `packages/cli/src/runtime/system-prompt.js`   | `composeSystemPrompt` 的 `outputStyle` 追加层（最后一层）                                                                                                                 |
| `packages/cli/src/commands/output-style.js`   | `cc output-style list / show / new` 命令实现                                                                                                                              |
| `packages/cli/src/commands/agent.js`          | `--output-style <name>` flag，透传 `outputStyle` 到 headless-runner / headless-stream                                                                                     |
| `packages/cli/src/runtime/headless-runner.js` | `-p` 一次性：`resolveOutputStyle` → 组装系统提示，missing 名 stderr 警告                                                                                                  |
| `packages/cli/src/runtime/headless-stream.js` | stream-json：解析风格正文并 append                                                                                                                                        |
| `packages/cli/src/repl/agent-repl.js`         | 启动时套用 + `/output-style` 运行时热切换（`_replBaseSystem` / `_activeOutputStyle`，重算 `messages[0]`）                                                                 |
| `packages/cli/src/index.js`                   | 注册 `output-style` 命令                                                                                                                                                  |

## 使用示例

### 1. 用内置 `explanatory` 让 agent 边做边讲

```bash
cc agent -p "把这个回调改成 async/await" --output-style explanatory
```

agent 在改动旁穿插 `★ Insight` 简短说明为什么这么改、有什么权衡。

### 2. 用 `learning` 做教学式协作

```bash
cc agent --output-style learning
> 帮我实现一个 LRU 缓存
```

对适合用户自己写的小片段，agent 插入 `TODO(you):` 留白而非代劳。

### 3. 为团队设项目默认风格

```jsonc
// .claude/settings.json
{ "outputStyle": "explanatory" }
```

此后该项目内 `cc agent` 默认套用 `explanatory`，命令行 `--output-style` 可临时覆盖。

### 4. 创建并使用自定义风格

```bash
cc output-style new reviewer --description "像资深审查者一样指出风险"
# 编辑 .claude/output-styles/reviewer.md 写入人格正文
cc output-style show reviewer
cc agent -p "审查这段 diff" --output-style reviewer
```

### 5. REPL 内即时切换

```text
cc agent
> /output-style                 # 列出全部，* 标记当前
> /output-style reviewer        # 切到自定义风格
> ... 对话 ...
> /output-style none            # 清除，回到 base
```

### 6. 脚本中查询可用风格（JSON）

```bash
cc output-style list --json | jq '.styles[].name'
```

## 相关文档

- [代理模式 (agent)](./cli-agent.md) — `cc agent` headless / REPL 总览，`--output-style` 在其工具与系统提示链路中的位置
- [钩子系统](./hooks.md) — `.claude/settings.json` hooks（同属 Claude Code 平价的 settings 配置族）
- [权限系统](./permissions.md) — `.claude/settings.json` 权限规则（allow/ask/deny）
- [计划模式](./plan-mode.md) — agent 制定计划后审批执行
- [多智能体协作](./cowork.md) — Cowork 多 agent 协作系统
- [技能系统](./skills.md) — 内置技能与 SKILL.md 格式
