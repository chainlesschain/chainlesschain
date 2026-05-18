# Persona 管理 (persona)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🎭 **项目级 AI 角色**: 每个项目可配置独立的 AI 人设，替换默认编码助手
- 🔧 **工具权限控制**: 通过 `toolsDisabled` 禁用特定工具，`toolsPriority` 设置优先工具
- 📋 **行为约束**: 定义 AI 的行为规则列表
- 🔄 **随时切换**: `persona set` 修改，`persona reset` 恢复默认

## 系统架构

```
persona 命令 → persona.js (Commander) → project-detector.js
                                              │
               ┌──────────────────────────────┼───────────────┐
               ▼                              ▼               ▼
           persona show               persona set        persona reset
         读取 config.json           更新 persona 字段    删除 persona 字段
         显示角色信息               支持增量修改         恢复默认编码助手
```

## 概述

管理项目级 AI Persona 配置。Persona 定义了 Agent 模式下 AI 的角色身份、行为约束和工具权限。配置存储在 `.chainlesschain/config.json` 的 `persona` 字段中。

当项目配置了 Persona 时，`agent` 命令启动的 AI 会使用自定义角色而非默认的编码助手。

## 前提条件

需要先初始化项目（`.chainlesschain/` 目录存在）：

```bash
chainlesschain init --bare
# 或
chainlesschain init --template medical-triage --yes
```

## 命令参考

```bash
chainlesschain persona show                          # 显示当前 Persona
chainlesschain persona set --name "My Bot" --role "Helper"  # 设置角色
chainlesschain persona set -b "Always be polite"     # 添加行为约束
chainlesschain persona set --tools-disabled run_shell,run_code  # 禁用工具
chainlesschain persona set --tools-priority read_file,search_files  # 设置优先工具
chainlesschain persona reset                         # 移除 Persona，恢复默认
```

## 子命令

### persona show

显示当前项目的 Persona 配置。

```bash
chainlesschain persona show
```

输出示例（有 Persona 时）：

```
Persona: 智能分诊助手
Role: 你是一个医疗分诊AI助手...
Behaviors:
  - 始终先询问患者症状再给出建议
  - 使用标准分诊分类 (ESI 1-5)
Preferred tools: read_file, search_files
Disabled tools: (none)
```

输出示例（无 Persona 时）：

```
No persona configured for this project.
```

### persona set

创建或更新 Persona 配置。支持增量修改，未指定的字段保持不变。

```bash
chainlesschain persona set [options]
```

| 选项 | 说明 |
|------|------|
| `--name <name>` | AI 角色名称 |
| `--role <role>` | 系统级角色描述 |
| `-b, --behavior <text>` | 添加行为约束（可重复使用，追加到现有列表） |
| `--tools-priority <list>` | 优先工具（逗号分隔） |
| `--tools-disabled <list>` | 禁用工具（逗号分隔） |

### persona reset

移除项目的 Persona 配置，Agent 将恢复为默认的编码助手角色。

```bash
chainlesschain persona reset
```

## Persona 配置结构

```json
{
  "persona": {
    "name": "智能分诊助手",
    "role": "你是一个医疗分诊AI助手，帮助诊所工作人员根据症状和紧急程度对患者进行优先级分类。",
    "behaviors": [
      "始终先询问患者症状再给出建议",
      "使用标准分诊分类 (ESI 1-5)",
      "绝不提供确定性诊断，建议专业评估"
    ],
    "toolsPriority": ["read_file", "search_files"],
    "toolsDisabled": ["run_shell"]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | AI 角色名称，显示在系统 prompt 中 |
| `role` | string | 角色描述，替换默认的 "agentic coding assistant" prompt |
| `behaviors` | string[] | 行为约束列表，注入到系统 prompt |
| `toolsPriority` | string[] | 优先使用的工具，在 prompt 中提示 AI 偏好这些工具 |
| `toolsDisabled` | string[] | 禁用的工具，从 LLM 工具定义中移除，`executeTool` 也会拦截 |

## 配置参考

```bash
# CLI 命令选项
persona show
  # 无参数 — 读取当前项目 .chainlesschain/config.json 的 persona 字段

persona set [options]
  --name <name>                 # AI 角色名称
  --role <role>                 # 系统角色描述 (取代默认编码助手 prompt)
  -b, --behavior <text>         # 行为约束 (可重复追加)
  --tools-priority <list>       # 优先工具 (逗号分隔)
  --tools-disabled <list>       # 禁用工具 (逗号分隔)

persona reset
  # 移除 persona 字段，恢复默认编码助手

# 全局通用
--json                          # JSON 输出

# 配置文件位置
<project>/.chainlesschain/config.json
  {
    "persona": {
      "name": "...",
      "role": "...",
      "behaviors": ["...", "..."],
      "toolsPriority": ["read_file", "search_files"],
      "toolsDisabled": ["run_shell"]
    }
  }

# 环境变量
CC_PERSONA_DISABLED=1           # 忽略项目 persona，强制使用默认编码助手
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| persona show (读取 JSON) | < 30ms | ~10ms | ✅ |
| persona set (写入 JSON) | < 50ms | ~20ms | ✅ |
| buildSystemPrompt 注入 | < 10ms | ~3ms | ✅ |
| Agent 启动 + persona 加载 | < 200ms | ~120ms | ✅ |
| toolsDisabled 工具过滤 | < 5ms | ~1ms | ✅ |

## 测试覆盖率

```
packages/cli/__tests__/unit/
├── ✅ persona-command.test.js       # show / set / reset 三个子命令
├── ✅ agent-core-persona.test.js    # buildSystemPrompt / _loadProjectPersona
└── ✅ persona-tools-disabled.test.js # toolsDisabled 守卫与 LLM 工具过滤
```

- **命令层**: show 空/有 persona、set 增量/全量、reset 幂等
- **集成**: Agent 启动时 persona 正确注入 prompt
- **工具守卫**: toolsDisabled 工具被 LLM 选中时 executeTool 拦截
- **模板**: medical-triage / ai-doc-creator 等内置模板加载

## 安全考虑

### 1. 输入验证

- **字段白名单**: `name` / `role` / `behaviors` / `toolsPriority` / `toolsDisabled` 外的字段写入时被忽略
- **字符串长度**: `role` 默认上限 4000 字符，`behavior` 单条上限 500 字符，防止 prompt 爆炸
- **工具名校验**: `toolsPriority` / `toolsDisabled` 中的工具名与 CLI 注册的工具 ID 比对，未知工具静默忽略

### 2. 权限控制

- **项目范围**: persona 仅作用于当前项目（`.chainlesschain/config.json`），不会影响全局
- **工具禁用强制生效**: `toolsDisabled` 同时在两处拦截：LLM 工具定义过滤 + `executeTool` 入口守卫
- **防越权 prompt**: `role` 字段仅用于系统 prompt，不会触发 shell 或文件操作
- **`CC_PERSONA_DISABLED=1`**: 运维/审计场景可强制禁用项目 persona，以默认编码助手启动 Agent

### 3. 审计

- **变更可追溯**: `persona set` / `persona reset` 所有写入通过 `config.json` 提交，可纳入 git 历史审计
- **Agent 启动日志**: persona 激活时在启动日志中记录 `persona.loaded: <name>`，方便追溯行为偏移
- **敏感字段脱敏**: persona JSON 不存储密钥 / PII；若用户误写入 API Key 会在 `show` 时给出警告

## 故障排查

**Q: `persona show` 显示 "No persona configured"，但 config.json 里有 persona 字段?**

检查 `.chainlesschain/config.json` 的 JSON 格式是否合法（尾随逗号、注释都会导致解析失败）。运行 `node -e "JSON.parse(require('fs').readFileSync('.chainlesschain/config.json'))"` 快速校验。

**Q: Agent 启动时仍是默认编码助手，未应用 persona?**

1. 确认在项目根目录运行（`.chainlesschain/` 可见）
2. 检查环境变量 `CC_PERSONA_DISABLED` 是否被意外设置
3. 运行 `chainlesschain agent --verbose` 查看启动日志中的 `persona.loaded` 标记
4. 若使用 `--bundle`，bundle 中的 AGENTS.md 会优先于项目 persona

**Q: `--tools-disabled` 设置后，LLM 仍然调用被禁用的工具?**

LLM 工具定义过滤 + executeTool 拦截是两层守卫；LLM 若"尝试"调用被禁用工具，会收到 `tool_disabled` 错误响应。检查是否使用了旧版 agent-core（< v5.0.2）—升级 CLI 到最新版本即可。

**Q: 多条 `-b` behavior 追加后顺序错乱?**

`persona set -b` 每次调用追加到数组末尾；若需重置后重新定义，先 `persona reset`，再逐条 `persona set -b "..."`。

**Q: 模板 persona 和自定义 persona 冲突?**

`init --template medical-triage` 在初始化时写入模板 persona；之后执行 `persona set` 会增量覆盖。如需完全切换，先 `persona reset` 再使用新模板重新 init。

## 与 Agent 模式的集成

Persona 通过 `buildSystemPrompt(cwd)` 函数集成到 Agent 模式：

1. **System Prompt 替换**: 有 Persona 时，使用自定义角色 prompt 替代默认编码助手
2. **工具过滤**: `toolsDisabled` 中的工具从 LLM 可用工具列表中移除
3. **执行守卫**: 即使 LLM 尝试调用被禁用的工具，`executeTool` 也会返回错误
4. **自动激活 Skill**: Persona 模板创建的 `activation: auto` Skill 自动注入到 prompt

优先级顺序：
1. `config.json` 中的 `persona` 字段 → 替换 base system prompt
2. 自动激活的 Persona Skill → 追加到 prompt
3. `rules.md` → 始终追加
4. 默认编码助手 prompt → 无 persona 时使用

## 使用示例

### 场景 1：创建医疗分诊项目

```bash
chainlesschain init --template medical-triage --yes
chainlesschain persona show
chainlesschain agent  # AI 以分诊助手身份启动
```

### 场景 2：为现有项目添加 Persona

```bash
chainlesschain persona set --name "Code Review Bot" --role "You are a strict code reviewer"
chainlesschain persona set -b "Always check for security vulnerabilities"
chainlesschain persona set -b "Suggest unit tests for new code"
chainlesschain persona set --tools-disabled run_shell
```

### 场景 3：恢复默认编码助手

```bash
chainlesschain persona reset
chainlesschain agent  # AI 恢复为默认编码助手
```

## 关键文件

- `packages/cli/src/commands/persona.js` — persona 命令实现
- `packages/cli/src/lib/agent-core.js` — `buildSystemPrompt()` / `_loadProjectPersona()` / `_buildPersonaPrompt()`
- `packages/cli/src/lib/project-detector.js` — 项目检测与配置加载

## 相关文档

- [项目初始化 (init)](./cli-init) — 使用 Persona 模板初始化项目
- [代理模式 (agent)](./cli-agent) — Agent 自动加载 Persona 配置
- [技能系统 (skill)](./cli-skill) — 自动激活的 Persona Skill
