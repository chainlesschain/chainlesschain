# CLI-Anything 集成 (cli-anything)

> 将 [CLI-Anything](https://github.com/HKUDS/CLI-Anything) 生成的 Agent 原生 CLI 工具自动注册为 ChainlessChain 技能，Agent REPL 即刻可用。

## 概述

CLI-Anything 是一个 Python 工具（GitHub 11.8k+ Stars），能为任何桌面软件自动生成 Agent 可控的 CLI 接口。ChainlessChain 的 `cli-anything` 命令组作为桥接层：

1. **发现**已安装的 `cli-anything-*` 工具
2. **注册**为 ChainlessChain managed 层技能（SKILL.md + handler.js）
3. **Agent REPL** 通过 `run_skill` 工具自动发现并调用

## 前置条件

```bash
# 1. 安装 Python 3.8+
python --version

# 2. 安装 CLI-Anything
pip install cli-anything

# 3. 为目标软件生成 CLI 工具
/cli-anything ./gimp          # 生成 cli-anything-gimp
/cli-anything ./blender       # 生成 cli-anything-blender
```

## 命令列表

### `chainlesschain cli-anything doctor`

检测 Python 和 CLI-Anything 环境状态。无需数据库。

```bash
chainlesschain cli-anything doctor
# 输出:
#   CLI-Anything Environment
#   ✓ Python 3.12.10 (python)
#   ✓ CLI-Anything 0.2.1
#   ✓ 2 tool(s) on PATH
#     cli-anything-gimp → /usr/local/bin/cli-anything-gimp
#     cli-anything-blender → /usr/local/bin/cli-anything-blender

chainlesschain cli-anything doctor --json
# JSON 输出: { python, cliAnything, toolsOnPath }
```

### `chainlesschain cli-anything scan`

扫描系统 PATH 中已生成的 `cli-anything-*` 工具。

```bash
chainlesschain cli-anything scan
# 输出:
#   Found 2 tool(s):
#   gimp
#     Command: cli-anything-gimp
#     Path:    /usr/local/bin/cli-anything-gimp
#     Desc:    Agent-native CLI for GIMP image editor
#     Subs:    project, filter, export

chainlesschain cli-anything scan --json
```

### `chainlesschain cli-anything register <name>`

将指定工具注册为 ChainlessChain 技能。

```bash
chainlesschain cli-anything register gimp
# ✓ Registered gimp as skill cli-anything-gimp
#   Skill dir: <userData>/skills/cli-anything-gimp
#   Subcommands: project, filter, export
#   Use in Agent: /skill cli-anything-gimp <subcommand> [args]

# 覆盖已有注册
chainlesschain cli-anything register gimp --force
```

注册后生成的文件：
- `<userData>/skills/cli-anything-gimp/SKILL.md` — 技能元数据
- `<userData>/skills/cli-anything-gimp/handler.js` — 执行处理器

### `chainlesschain cli-anything list`

列出所有已注册的 CLI-Anything 工具（默认子命令）。

```bash
chainlesschain cli-anything list
# 输出:
#   2 registered tool(s):
#   gimp [registered] → cli-anything-gimp
#     GIMP image editor CLI
#   blender [registered] → cli-anything-blender
#     Blender 3D creation suite

chainlesschain cli-anything list --json
```

### `chainlesschain cli-anything remove <name>`

移除已注册的工具及其技能文件。

```bash
chainlesschain cli-anything remove gimp
# ✓ Removed tool gimp
```

## 集成流程

```
用户操作                          系统行为
──────────                       ────────
pip install cli-anything         安装 Python 工具
/cli-anything ./gimp             CLI-Anything 生成 cli-anything-gimp

chainlesschain cli-anything doctor    检查环境 ✓/✗
chainlesschain cli-anything scan      发现 cli-anything-gimp
chainlesschain cli-anything register gimp
  → 解析 cli-anything-gimp --help
  → 生成 SKILL.md + handler.js
  → 写入 DB cli_anything_tools 表

chainlesschain agent
  > "用 GIMP 创建一个 1920x1080 的项目"
  → LLM 调用 run_skill("cli-anything-gimp", "project new --width 1920 ...")
  → handler.js 执行 execSync("cli-anything-gimp project new ...")
  → 返回结果给 LLM
```

## 技能层级

注册的工具放在 **managed 层**（`<userData>/skills/`），优先级：

```
bundled (内置) < marketplace (市场) < managed (用户管理) < workspace (项目)
```

CLI-Anything 技能不会覆盖内置或市场层技能，但会被项目级 workspace 层覆盖。

## 数据库表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一标识 |
| name | TEXT UNIQUE | 工具名（如 gimp） |
| software_path | TEXT | 原始软件路径 |
| cli_command | TEXT | CLI 命令（如 cli-anything-gimp） |
| version | TEXT | 版本号 |
| description | TEXT | 描述 |
| subcommands | TEXT | 子命令 JSON 数组 |
| skill_name | TEXT | 关联的技能名 |
| status | TEXT | 状态（discovered/registered） |

## 选项说明

| 选项 | 命令 | 说明 |
|------|------|------|
| `--json` | 所有子命令 | 以 JSON 格式输出 |
| `--force` | register | 覆盖已有注册 |

## 故障排除

### Python 未检测到

```bash
# 确保 Python 3.8+ 在 PATH 中
python3 --version
# 或
python --version
```

### CLI-Anything 未安装

```bash
pip install cli-anything
# 或指定 Python
python3 -m pip install cli-anything
```

### 工具注册后 Agent 找不到

技能加载器有缓存，重启 Agent 会话即可：

```bash
chainlesschain agent  # 新会话自动扫描 managed 层
```
