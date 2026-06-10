# 自定义斜杠命令宏（cc command）

> **版本: Claude-Code parity 补齐 #1 | 状态: ✅ 生产可用 | 零运行时依赖 | 11 单元测试全绿**
>
> `cc command`（别名 `cc cmd`）实现**用户自定义的斜杠命令宏**：把 `.claude/commands/` 下的 Markdown 文件变成可复用的 prompt 宏。它对标 Claude Code 的自定义斜杠命令，**与技能（skill）不同**——技能是 AI 自动触发的能力包，而命令宏是你**显式运行**的 prompt 模板。

## 概述

很多重复性的 AI 操作（生成提交信息、写 changelog、审查某类代码）都对应一段固定的 prompt 模板。`cc command` 让你把这些模板沉淀为 Markdown 文件：`.claude/commands/git/commit.md` 即成为命令 `git:commit`，运行 `cc command run git:commit` 时它会被展开（参数替换 + 可选 shell 拼接 + 文件引用）后驱动一次 headless agent 运行。

命令来源分两层：

| 层级 | 路径 | 作用域 |
|------|------|--------|
| 项目 | `.claude/commands/`（递归） | 当前项目，随仓库共享 |
| 个人 | `~/.claude/commands/` | 当前用户，全局可用 |

**命名冲突时项目层覆盖个人层。** 文件名到命令名的映射：子目录用冒号连接，`git/commit.md → git:commit`（运行时 `git:commit` 与 `git/commit` 两种写法都接受）。

## 核心特性

- 📝 **Markdown 即宏**：一个 `.md` 文件就是一条可复用命令，无需编程
- 🗂️ **双层发现**：项目 `.claude/commands/`（递归）+ 个人 `~/.claude/commands/`，项目覆盖个人
- 🔢 **参数替换**：`$ARGUMENTS`（全部参数）与 `$1..$9`（位置参数）
- 🐚 **Shell 拼接**：`` !`cmd` `` 在展开时执行命令并把输出嵌入 prompt（best-effort，10s 超时，失败标记 `[command failed: …]`，可由 `--no-bang` 关闭）
- 📎 **文件引用**：`@path` 通过既有 `file-ref-expander.js` 注入文件内容
- 🎛️ **运行域控制**：frontmatter `allowed-tools` / `model` 限定本次运行的工具白名单与模型
- 🔍 **干跑预览**：`--print-prompt` 只展开打印最终 prompt 而不真正运行
- 🪶 **零运行时依赖**：frontmatter 用**自写的零依赖 `key: value` 标量解析器**，不引入 js-yaml（避免全局安装崩溃）

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│  cc command list | show <name> | run <name> [args] | new       │
└───────────────────────────┬──────────────────────────────────┘
                            │
                ┌───────────▼────────────┐
                │ slash-commands.js       │
                │  discoverCommands()     │  项目层覆盖个人层
                │  getCommand(git:commit) │  接受 : 或 / 写法
                │  parseCommandFile()     │  零依赖 frontmatter 解析
                │  expandCommand()        │
                └───────────┬────────────┘
                            │  展开顺序（见下）
                ┌───────────▼────────────┐
                │ runAgentHeadless(...)   │  驱动一次 headless 运行
                └─────────────────────────┘
```

### 展开顺序（`expandCommand`）

1. **参数替换**：`$ARGUMENTS` / `$1..$9`
2. **Shell 拼接**：`` !`cmd` `` 执行（best-effort，10s 超时，失败 → `[command failed: …]`；受 `allowBang` 门控，`--no-bang` 关闭）
3. **文件引用**：`@path` 经 `file-ref-expander.js` 注入文件内容

## 命令参考

```bash
cc command list                          # 列出所有可用命令（别名 cc cmd）
cc command show <name>                    # 显示某命令的内容与 frontmatter
cc command run <name> [args...]          # 展开并运行（驱动 headless agent）
cc command run <name> [args] --print-prompt   # 干跑：只打印展开后的 prompt
cc command run <name> [args] --no-bang   # 运行但禁用 !`cmd` shell 拼接
cc command new <name>                    # 新建一个命令模板文件
```

## 配置参考

### 命令文件 frontmatter（全部可选）

```markdown
---
description: 为暂存的改动生成规范化提交信息
argument-hint: "[scope]"
allowed-tools: run_shell, read_file
model: claude-opus-4-8
---

为以下暂存改动生成一条 Conventional Commits 提交信息（scope=$1）：

!`git diff --cached --stat`

参考最近风格：@CHANGELOG.md
```

| 字段 | 说明 |
|------|------|
| `description` | 命令简述，`list` 时展示 |
| `argument-hint` | 参数提示，引导调用方传参 |
| `allowed-tools` | 限定本次运行的工具白名单 |
| `model` | 指定本次运行的模型 |

> frontmatter 键做 kebab→camel 归一，**用零依赖手写标量解析器**（不用 js-yaml，也不用 skill-loader 的 `parseSkillMd`），以免引入会导致全局安装崩溃或 Windows vitest EPERM 的依赖链。

## 性能指标

- **展开为本地操作**：参数替换与 frontmatter 解析为纯字符串处理，毫秒级。
- **Shell 拼接有界**：`` !`cmd` `` 单条 10s 超时、best-effort，失败不阻断展开。
- **零额外依赖**：不加载 YAML/技能加载链，命令发现与解析无重型依赖开销。

## 测试覆盖率

11 个单元测试，全绿：

```bash
cd packages/cli
npx vitest run __tests__/unit/slash-commands.test.js
```

覆盖：双层发现与项目覆盖、`git:commit`/`git/commit` 双写法解析、frontmatter 解析、`$ARGUMENTS`/`$1..$9` 替换、`` !`cmd` `` 拼接与 `--no-bang` 门控、`@path` 文件引用。

> 纯函数通过 `opts.home` + `opts.deps.{fs,path,execSync}` + `opts.cwd` 注入，测试不触碰真实文件系统/Shell。

## 安全考虑

- **Shell 拼接默认可关**：`` !`cmd` `` 会执行 Shell，`--no-bang` 可在运行不可信命令文件时关闭拼接；执行 best-effort + 10s 超时，失败以 `[command failed: …]` 标记而非中断。
- **工具白名单收口**：frontmatter `allowed-tools` 限定本次运行可用的工具，缩小命令宏的能力面。
- **干跑优先**：对不熟悉的命令文件，先 `--print-prompt` 审阅展开后的 prompt（含 Shell/文件注入结果）再真正运行。
- **本地来源**：命令仅来自项目 `.claude/commands/` 与个人 `~/.claude/commands/`，不从网络拉取。

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `cc command run` 找不到命令 | 文件不在 `.claude/commands/` 或 `~/.claude/commands/` | 用 `cc command list` 确认；子目录用 `:` 连接命令名 |
| 个人命令被「忽略」 | 同名项目命令覆盖了个人命令 | 项目层优先；改名或删除项目同名文件 |
| `` !`cmd` `` 没有执行 | 用了 `--no-bang`，或 frontmatter 未授权 | 去掉 `--no-bang`；确认 `allowBang` 未被关闭 |
| Shell 拼接显示 `[command failed: …]` | 命令出错或 >10s 超时 | 单独运行该 Shell 命令排查；保持其 <10s |
| `@path` 未注入文件 | 路径相对基准不对 | 用相对项目根/cwd 的正确路径；先 `--print-prompt` 验证 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/slash-commands.js` | `discoverCommands` / `getCommand` / `parseCommandFile` / `substituteArgs` / `expandCommand`（纯函数，可注入依赖） |
| `packages/cli/src/commands/command.js` | `list \| show \| run \| new` 命令，`run` 展开后驱动 `runAgentHeadless` |
| `packages/cli/src/lib/file-ref-expander.js` | `@path` 文件引用展开（复用） |
| `packages/cli/__tests__/unit/slash-commands.test.js` | 11 单元测试 |

## 使用示例

```bash
# 1) 新建一个命令模板
cc command new git:commit
#    → 生成 .claude/commands/git/commit.md，编辑其内容与 frontmatter

# 2) 列出 / 查看
cc command list
cc command show git:commit

# 3) 干跑：只看展开后的最终 prompt（含 Shell 与文件注入结果）
cc command run git:commit feat --print-prompt

# 4) 真正运行（scope=feat 即 $1）
cc command run git:commit feat

# 5) 运行但禁用 Shell 拼接
cc command run review:security src/auth.js --no-bang
```

命令文件示例（`.claude/commands/review/security.md`）：

```markdown
---
description: 对指定文件做安全审查
argument-hint: "<file>"
allowed-tools: read_file
---

请对文件 @$1 做安全审查，重点检查注入、鉴权与敏感信息泄露。
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [目标 / OKR 系统（cc goal）](./goal.md)
- [钩子系统](./hooks.md)
- [输出风格](./output-styles.md)
- [技能系统](./skills.md)
