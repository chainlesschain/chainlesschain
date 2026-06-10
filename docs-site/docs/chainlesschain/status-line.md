# 状态栏（cc statusline）

> **版本: Claude-Code statusLine 平价 + 内置上下文用量行 | 状态: ✅ 生产可用 | 23 单元测试全绿**
>
> `cc statusline` 在 `cc agent` 交互式 REPL 中**每次提示前渲染一行状态**。支持两种来源：① 你在 `.claude/settings.json` 配置的**自定义命令**（输出模型/分支/花费等任意信息）；② 未配置自定义命令时的**内置上下文用量行**（模型 · 已用/窗口 token 占比 · 目录 · 回合数），默认开启。

## 概述

交互式 agent 会话里，你需要随手就能看到「当前用哪个模型 / 在哪个分支 / 上下文窗口快满了没」。`cc statusline` 借鉴 Claude Code 的 `statusLine`：REPL 在每次提示前把一行状态写到终端。若你在 `settings.json` 配置了自定义命令，REPL 会把会话上下文以 JSON 通过 stdin 喂给该命令并取其首行 stdout 显示；若没配置，则显示内置的上下文用量行。

## 核心特性

- 🧭 **每提示前渲染**：REPL 每次提示前刷新一行状态，始终反映当前会话
- 🛠️ **自定义命令**：`.claude/settings.json` 的 `statusLine` 字段，裸字符串或 `{type, command, padding}`，输出任意信息（模型/分支/花费…）
- 📊 **内置上下文用量行**：未配置自定义命令时默认显示 `模型 · ⛁ 已用/窗口(占比%) · 目录 · 回合 N`
- 🔢 **实时 token 占用**：内置行从用量事件实时估算当前上下文 token，窗口取自压缩器的 `getContextWindow`
- 🧩 **CC 兼容上下文**：自定义命令收到与 Claude Code 兼容的 JSON（`hook_event_name:"Status"`、`session_id`、`model`、`provider`、`workspace`、`cwd`，并附加 `context`/`turn`）
- 🔌 **层级配置 + 可禁用**：`settings.json` 层级合并（last-wins），高层可用 `false`/`null` 禁用；内置行可经 `CC_STATUSLINE=0` / `statusLine:false` / `/statusline off` 关闭
- ⚡ **best-effort**：自定义命令非零退出/出错/超时 → 当轮不显示，不阻断 REPL；内置行为纯函数渲染无 spawn

## 系统架构

```
┌────────────────────────── agent-repl prompt() ──────────────────────────┐
│  每次提示前：                                                             │
│   ┌─ 配了 statusLine 命令？ ─┐                                            │
│   │ 是 → spawnSync(command,  │  stdin=CC 兼容 JSON ctx                    │
│   │       shell:true, 5s)    │  → 首行 stdout (+padding) 写终端           │
│   │ 否 → renderDefaultStatus │  纯函数：model · ⛁ used/window(pct%) ·    │
│   │       Line(ctx)          │           cwd · turn N                     │
│   └──────────────────────────┘                                           │
└──────────────────────────────────┬──────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ status-line.cjs     │
                          │  loadStatusLineConfig│  扫 .claude/settings.json
                          │  buildContext        │  CC 兼容 JSON + context/turn
                          │  renderStatusLine     │  自定义命令（spawnSync）
                          │  renderDefaultStatusLine│ 内置行（纯函数）
                          │  getStatusLine        │  load+render 便捷
                          └─────────────────────┘
```

`status-line.cjs` 复用 settings-loader 的 `settingsPaths`/`readSettingsFile`，依赖经 `_deps.spawnSync`/`readSettings` 注入便于测试。

## 命令参考

```bash
cc statusline preview     # 用当前会话上下文预览一行状态（自定义或内置）
cc statusline show        # 显示当前 statusLine 配置（来源/命令）
```

REPL 内：

```text
/statusline            # 查看状态栏开关状态
/statusline on|off      # 开/关内置上下文用量行
```

## 配置参考

### `.claude/settings.json` 自定义命令

```json
{
  "statusLine": {
    "type": "command",
    "command": "./scripts/status.sh",
    "padding": 0
  }
}
```

也可用裸字符串：`"statusLine": "./scripts/status.sh"`。高层级用 `"statusLine": false`（或 `null`）禁用低层配置。

### 自定义命令收到的 stdin JSON（CC 兼容）

```json
{
  "hook_event_name": "Status",
  "session_id": "…",
  "model": { "id": "claude-opus-4-8", "display_name": "Opus 4.8" },
  "provider": "anthropic",
  "workspace": { "current_dir": "…", "project_dir": "…" },
  "cwd": "…",
  "context": { "used_tokens": 12345, "window": 200000, "pct": 6 },
  "turn": 3
}
```

命令应把状态打印到 **stdout 首行**（保留 ANSI 颜色）。

### 内置行开关

| 方式 | 效果 |
|------|------|
| 默认 | 未配置自定义命令时**默认开启**内置行 |
| `CC_STATUSLINE=0`（环境变量） | 禁用内置行 |
| `settings.json` `"statusLine": false` | 禁用 |
| REPL `/statusline off` | 本会话禁用 |

> 自定义命令优先于内置行；两者上下文 JSON 均含 `context`/`turn`。

## 性能指标

- **内置行零进程开销**：纯函数渲染，每提示同步计算，无 spawn。
- **自定义命令 5s 超时**：`spawnSync(shell:true, timeout=5000)`，超时/出错则当轮静默跳过，不阻断 REPL。
- **窗口/用量实时**：每轮从用量事件末条 input+output 估算当前上下文 token，窗口取自压缩器。

## 测试覆盖率

共 **23** 个单元测试：

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `status-line.test.js` | 12 | 配置加载（层级 last-wins/禁用）、`buildContext`、`renderStatusLine`、`cc statusline` 命令 |
| `status-line-context.test.js` | 11 | `formatTokens`/`shortenPath`/`renderDefaultStatusLine`、`buildContext` 附加 `context`/`turn`、内置行开关 |

```bash
cd packages/cli
npx vitest run __tests__/unit/status-line.test.js __tests__/unit/status-line-context.test.js
```

> 内置行的**交互渲染**为运行时未验证（无 TTY 环境）；渲染纯函数与装配逻辑均已测试。

## 安全考虑

- **best-effort 不阻断**：自定义命令失败/超时只导致当轮不显示，绝不卡住或崩溃 REPL。
- **本地配置来源**：`statusLine` 仅来自 `.claude/settings.json` 层级文件，不从网络拉取。
- **命令即执行**：`statusLine` 命令会在每次提示前执行——只配置你信任的脚本；高层级可 `false` 禁用低层不可信配置。

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 状态行不显示 | 自定义命令冷启动 > 5s（Windows cmd 重负载下可达 2.4s+） | 用更轻量的脚本；机制本身 5s 超时正确 |
| 内置行不显示 | 被 `CC_STATUSLINE=0` / `statusLine:false` / `/statusline off` 禁用 | `/statusline on` 重新开启 |
| 内联 `node -e "…"` 命令在 Windows 挂 | cmd.exe 下嵌套引号易解析失败 | 改用脚本文件（`./status.sh`）而非内联命令 |
| 自定义配了却没生效 | 高层级 `statusLine:false` 禁用了它 | 检查各层 `.claude/settings.json`（last-wins，但 false 禁用） |
| 状态行没有颜色 | 命令输出被 trim 但 ANSI 保留 | 确认脚本输出 ANSI 转义；首行才被采用 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/status-line.cjs` | `loadStatusLineConfig` / `buildContext` / `renderStatusLine`（自定义）/ `renderDefaultStatusLine`（内置）/ `getStatusLine` |
| `packages/cli/src/repl/agent-repl.js` | REPL `prompt()` 每提示前渲染装配 + `/statusline` 命令 |
| `packages/cli/src/commands/statusline.js` | `cc statusline preview \| show` |
| `packages/cli/__tests__/unit/status-line.test.js` · `status-line-context.test.js` | 23 单元测试 |

## 使用示例

`.claude/settings.json`：

```json
{ "statusLine": { "type": "command", "command": "./scripts/status.sh" } }
```

`scripts/status.sh`（读 stdin JSON，打印一行）：

```bash
#!/usr/bin/env bash
ctx=$(cat)
model=$(echo "$ctx" | jq -r '.model.display_name')
branch=$(git branch --show-current 2>/dev/null)
echo "🤖 $model  ⎇ $branch"
```

```bash
# 预览/查看配置
cc statusline preview
cc statusline show

# 无自定义命令时，REPL 默认显示内置行：
#   Opus 4.8 · ⛁ 12.3k/200k (6%) · ~/code/chainlesschain · turn 3
# 在 REPL 中开关：
#   /statusline off
#   /statusline on
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [钩子系统](./hooks.md)
- [输出风格](./output-styles.md)
- [目标 / OKR 系统（cc goal）](./goal.md)
- [权限系统](./permissions.md)
