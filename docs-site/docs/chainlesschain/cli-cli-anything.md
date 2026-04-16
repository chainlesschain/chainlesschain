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

## 核心特性

- **自动发现**: 扫描系统 PATH 中所有 `cli-anything-*` 可执行文件，自动识别工具名、路径和子命令
- **一键注册**: 解析工具 `--help` 输出，自动生成 SKILL.md 元数据和 handler.js 执行处理器
- **版本检测**: 通过 `doctor` 子命令检测 Python 版本、CLI-Anything 版本和已安装工具数量
- **健康检查**: 环境诊断覆盖 Python 解释器、pip 包状态、PATH 工具三个维度
- **Agent 可调用**: 注册后的工具自动出现在 managed 技能层，Agent REPL 通过 `run_skill` 工具直接调用
- **参数验证**: 生成的 handler.js 通过 `execSync` 调用原始 CLI 工具，输入参数由外部工具自身校验

## 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI-Anything (Python)         ChainlessChain CLI Bridge         │
│  ──────────────────           ────────────────────────           │
│  /cli-anything ./gimp         chainlesschain cli-anything scan   │
│        │                              │                          │
│        ▼                              ▼                          │
│  cli-anything-gimp ───────── scanPathForTools() 扫描 PATH        │
│  (生成到 PATH)                        │                          │
│                                       ▼                          │
│                              parseToolHelp(command)               │
│                              解析 --help 输出                     │
│                                       │                          │
│                                       ▼                          │
│                              registerTool(db, name, opts)        │
│                              ├─ 生成 SKILL.md (元数据)            │
│                              ├─ 生成 handler.js (execSync 包装)   │
│                              └─ 写入 cli_anything_tools 表        │
│                                       │                          │
│                                       ▼                          │
│                              <userData>/skills/cli-anything-gimp/ │
│                              (managed 层，skill-loader 自动加载)   │
│                                       │                          │
│                                       ▼                          │
│                              Agent REPL → run_skill 调用          │
└──────────────────────────────────────────────────────────────────┘
```

核心流程: **scan** (发现 PATH 中工具) → **detect** (解析 --help 获取描述和子命令) → **register** (生成 SKILL.md + handler.js + 写入 DB) → **skill wrapper** (managed 层技能) → **Agent 调用** (通过 `run_skill`)

## 配置参考

```bash
chainlesschain cli-anything <subcommand> [options]

子命令:
  doctor                    检查 Python + CLI-Anything 环境
  scan                      扫描 PATH 中的 cli-anything-* 工具
  register <name>           将工具注册为 managed 层技能
  list                      列出已注册工具（默认子命令）
  remove <name>             移除已注册工具

选项:
  --json                    所有子命令均支持 JSON 输出
  --force                   register 专用，覆盖已有注册

前置条件:
  - Python 3.8+ 在 PATH 中（python / python3 / py 任一可用）
  - pip install cli-anything
  - 运行 /cli-anything ./<software> 生成 cli-anything-* 可执行文件
```

注册后生成: `<userData>/skills/cli-anything-<name>/SKILL.md` + `handler.js`。子进程超时 60 秒。

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| doctor 环境探测 | < 500ms | ~180ms | ✅ |
| scan PATH 扫描 | < 300ms | ~120ms | ✅ |
| register 解析 --help | < 800ms | ~350ms | ✅ |
| register 生成 SKILL.md + handler.js | < 100ms | ~40ms | ✅ |
| list 查询（含 DB） | < 50ms | ~20ms | ✅ |
| Agent 调用已注册工具（execSync） | < 60s 上限 | 取决于工具 | ✅ |

## 测试覆盖率

```
✅ cli-anything.test.js  - 覆盖 cli-anything CLI 的主要路径
  ├── 参数解析 / 选项验证（--force / --json）
  ├── 正常路径（doctor/scan/register/list/remove 完整链路）
  ├── 错误处理 / 边界情况（Python 缺失、工具不在 PATH、重复注册、help 解析失败）
  └── JSON 输出格式
```

## 使用示例

### 完整工作流

```bash
# 1. 检查环境是否就绪
chainlesschain cli-anything doctor

# 2. 扫描系统中已有的 CLI-Anything 工具
chainlesschain cli-anything scan

# 3. 注册特定工具为 ChainlessChain 技能
chainlesschain cli-anything register gimp

# 4. 查看已注册工具
chainlesschain cli-anything list

# 5. 在 Agent 中使用
chainlesschain agent
> "用 GIMP 把这张图片裁剪为 800x600"

# 6. 移除不需要的注册
chainlesschain cli-anything remove gimp
```

### JSON 输出 (适合脚本集成)

```bash
chainlesschain cli-anything doctor --json
chainlesschain cli-anything scan --json
chainlesschain cli-anything list --json
```

### LibreOffice 注册示例 (与 ai-doc-creator 配合)

```bash
# 注册 soffice 命令行工具
chainlesschain cli-anything register soffice

# Agent 即可调用 LibreOffice 进行文档转换
chainlesschain skill run cli-anything-soffice "convert-to pdf document.docx"
```

## 故障排查

### Python 未检测到

```bash
# 确保 Python 3.8+ 在 PATH 中
python3 --version
# 或
python --version

# Windows 用户可能需要使用 py 启动器
py --version
```

`detectPython()` 按顺序尝试 `python`/`python3`/`py` (Windows) 或 `python3`/`python` (Linux/macOS)，找到第一个可用的解释器即返回。

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

### 注册冲突 (工具已注册)

```
Error: Tool "gimp" already registered. Use --force to overwrite.
```

使用 `--force` 选项覆盖已有注册：

```bash
chainlesschain cli-anything register gimp --force
```

### 工具不在 PATH 中

`scan` 返回空列表时，确认 CLI-Anything 生成的可执行文件在系统 PATH 中：

```bash
# 检查 PATH 中是否有 cli-anything-* 前缀的可执行文件
which cli-anything-gimp    # Linux/macOS
where cli-anything-gimp    # Windows
```

### 版本不匹配

如果工具更新后行为异常，重新注册以刷新 SKILL.md 和 handler.js：

```bash
chainlesschain cli-anything register gimp --force
```

## 安全考虑

- **PATH 限定**: 只扫描和注册系统 PATH 中已存在的 `cli-anything-*` 可执行文件，不会下载或安装任何外部程序
- **参数透传**: handler.js 通过 `execSync` 将用户输入作为命令行参数传递给原始工具，由工具自身负责参数校验和权限控制
- **超时保护**: 所有子进程调用设置 60 秒超时（`timeout: 60000`），防止工具挂起
- **工作目录隔离**: 执行时使用 `context.projectRoot` 或 `process.cwd()` 作为工作目录
- **无特权提升**: 注册的技能以当前用户权限运行，不涉及 sudo 或管理员提权
- **数据库记录**: 所有注册操作记录在 `cli_anything_tools` 表中，可通过 `list` 和 `remove` 审计和清理

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/cli-anything.js` | 命令注册入口（doctor/scan/register/list/remove 五个子命令） |
| `packages/cli/src/lib/cli-anything-bridge.js` | 核心桥接库（Python 检测、PATH 扫描、--help 解析、技能生成、DB 操作） |
| `packages/cli/src/lib/paths.js` | `getElectronUserDataDir()` 提供 managed 层技能目录路径 |
| `<userData>/skills/cli-anything-*/SKILL.md` | 生成的技能元数据文件 |
| `<userData>/skills/cli-anything-*/handler.js` | 生成的执行处理器（CJS，execSync 包装） |

## 相关文档

- [技能系统](./cli-skill) — 完整技能命令参考，包括四层加载和 `run_skill` 调用
- [CLI 指令技能包](./cli-skill-packs) — 另一种技能包生成机制（9 域 CLI 指令包装）
- [AI 文档创作模板](../design/modules/72-ai-doc-creator) — LibreOffice (soffice) 作为 cli-anything 注册示例
- [代理模式](./cli-agent) — Agent REPL 中使用注册的技能
