# 权限规则（cc permissions）

> **状态: ✅ 生产可用 | Claude-Code `permissions.{allow,ask,deny}` 平价 | deny > ask > allow | 65 测试全绿**
>
> `cc permissions`（别名 `cc perms`）查看、干跑、编辑 `.claude/settings.json` 的权限规则集。规则引擎已接入 agent 工具循环（`executeTool` seam）：`deny` 硬拦截、`ask` 弹确认（headless 无确认器时 fail-closed）、`allow` 预授权短路 plan-mode 拦截与 run_shell 审批门——但**永不**重开 shell 硬黑名单。注意与 `cc perm`（[RBAC V2 治理](./cli-perm.md)）是两套完全独立的系统。

## 概述

Claude-Code 风格的权限规则让你用声明式字符串精确控制 agent 能做什么。一条规则形如 `Tool(pattern)`（或裸 `Tool` 匹配该工具的所有调用）：

```
Bash(git push:*)              → 命令以 "git push" 开头的 run_shell
Bash(npm run test:*)          → 以 "npm run test" 开头
Read(./src/**)                → <cwd>/src 下的 read_file / list_dir
Edit(//etc/**)                → /etc 下的 edit_file（// 为绝对路径标记）
WebFetch(domain:example.com)  → 抓取 example.com 的 web_fetch
Bash                          → 所有 run_shell 调用
```

工具名可写 Claude-Code 伞名（`Bash`/`Read`/`Write`/`Edit`/`WebFetch`/`Task`…）或本 CLI 自有名（`run_shell`/`read_file`…），双向解析到同一工具族。规则集由 settings-loader 按层级合并（user < project < local < `--settings` < env），引擎按 **deny > ask > allow** 判定；无命中返回 null，回落到既有的 risk-tier / `--permission-mode` 逻辑，默认行为零变化。

## 核心特性

- 📜 **声明式规则语法**：`Tool(pattern)` / 裸 `Tool`；命令前缀 `prefix:*`、路径 glob（`./` 相对 cwd、`//` 绝对、`~/` home）、URL `domain:host`，glob 引擎自写零依赖（`*`/`**`/`?`）
- 🔀 **伞名双向别名**：`Bash↔run_shell`、`Read↔read_file+list_dir`、`Grep/Glob↔search_files`、`Edit↔edit_file+edit_file_hashed`、`WebFetch↔web_fetch`、`Task↔spawn_sub_agent`、`Skill↔run_skill+list_skills` 等（13 组 `TOOL_GROUPS`）；未知 token（如 `mcp__srv__do`）退化为大小写不敏感精确匹配
- 🥞 **五层合并**：`~/.claude/settings.json` < `<project>/.claude/settings.json` < `<project>/.claude/settings.local.json` < `--settings <file>` < `CC_PERMISSIONS_ALLOW/_ASK/_DENY` 环境变量；规则数组跨层**并集**——上层只能加规则，**永远不能移除下层的 deny**（deny 只增不减）
- ⚖️ **最严者胜的判定链**（agent `executeTool` 内，按此精确顺序）：settings `deny` → host `deny`（桌面 host 策略；settings `allow` 永不松弛 host deny）→ settings `ask`（确认；两层 deny 都过了才会到，被 deny 的工具不浪费确认往返）→ settings `allow`（`ruleAllowed` 预授权，短路 plan-mode 拦截 + run_shell ApprovalGate）
- 🧪 **干跑**：`cc permissions test <tool> <args...>` 显示哪条规则做了决定、来自哪个文件，不真正执行任何工具
- ✍️ **幂等写入**：`cc permissions add` / REPL「always allow」流共用 `addRule`——已存在不重复追加；目标文件是坏 JSON 时**拒绝覆盖**（抛错而非静默清空）
- 🤝 **交互 always-allow**：REPL 风险确认升级为 `[y]es once / [a]lways allow / [N]o`，选 `[a]` 经 `suggestAllowRule` 推导规则（命令 → `Bash(git push:*)`，对 git/npm/docker 等 16 个分发器保留 2 token 前缀；路径 → `<Umbrella>(<dir>/**)`；URL → `WebFetch(domain:host)`）写入 `.claude/settings.local.json`，本会话即时生效
- 🛡️ **fail-open 加载 / fail-closed 执行**：坏 settings 文件警告后跳过（绝不卡死 agent，回落既有风险逻辑）；`ask` 规则在 headless 无确认器时直接拒绝
- ⚙️ **附带配置覆盖**：同一批 settings 文件还可携带 `model` 与 `env`（`loadSettingsConfig`，后读覆盖先读），一次性覆盖运行配置

## 命令参考

```bash
cc permissions list [--json] [--settings <file>]     # 合并后规则集 + 各规则来源文件
cc permissions ls                                    # list 的别名
cc permissions test <tool> [args...] [--json]        # 干跑：哪条规则决定？决定是什么？
cc permissions add <allow|ask|deny> <rule>           # 追加规则（默认写 project 文件）
    [--local]                                        #   写 .claude/settings.local.json（个人，gitignored）
    [--user]                                         #   写 ~/.claude/settings.json（全项目）
```

`.claude/settings.json` 中的规则块：

```json
{
  "permissions": {
    "allow": ["Bash(npm run test:*)", "Read(./src/**)"],
    "ask":   ["Bash(git push:*)"],
    "deny":  ["Read(./.env)", "Bash(curl:*)"]
  }
}
```

agent 侧用法：`cc agent --settings <file>`（显式额外层）；规则自动在 headless、stream、REPL 三个入口装配。

## 系统架构

```
~/.claude/settings.json            (user，最低)
<project>/.claude/settings.json    (project，签入)
<project>/.claude/settings.local.json (个人覆盖，gitignored)
--settings <file>                  (显式)
CC_PERMISSIONS_ALLOW/_ASK/_DENY    (env kill-switch，最高)
        │
        ▼  settings-loader.cjs  loadSettings()
   { rules: {allow[],ask[],deny[]}, sources{kind:rule→file}, files[] }
   （数组跨层并集；坏文件 warn+跳过 fail-open）
        │
        ├──────────────► cc permissions list / test / add
        │                （test 调引擎干跑；add 经 addRule 幂等写入）
        ▼
   permission-rules.cjs  evaluatePermissionRules({tool,args,cwd,rules})
   解析 Tool(pattern) → 伞名解析 → 按 deny→ask→allow 顺序首条命中
        │  { decision: deny|ask|allow|null, rule }
        ▼
   agent-core.js executeTool()（每次工具调用前）
     1. settings deny  → 硬拦截返回 error
     2. host deny      → 硬拦截（allow 不可松弛）
     3. settings ask   → permissionConfirm 确认（headless 无确认器 → 拒绝）
     4. settings allow → ruleAllowed=true：短路 plan-mode 拦截 +
                         run_shell ApprovalGate（shell 硬黑名单仍然生效）
     null → 既有 risk-tier / --permission-mode 逻辑原样运行
```

## 配置参考

| 配置面 | 键 / Flag | 说明 |
|--------|-----------|------|
| settings 文件 | `permissions.allow` / `permissions.ask` / `permissions.deny` | 规则字符串数组 |
| settings 文件 | `model` / `env` | 附带配置覆盖（`loadSettingsConfig`，last-write-wins） |
| 环境变量 | `CC_PERMISSIONS_ALLOW` / `CC_PERMISSIONS_ASK` / `CC_PERMISSIONS_DENY` | 逗号/换行分隔的规则列表，最高优先级 kill-switch |
| CLI flag | `cc agent --settings <file>` | 在层级里追加一个显式 settings 文件 |
| CLI flag | `cc permissions add --local / --user` | 写入目标：local（个人）/ user（全项目）/ 默认 project |

路径模式语义：`./x` 与 `x` 相对 cwd 解析；`//abs/x` 绝对路径（Claude-Code 约定，首个 `/` 去掉）；`~/x` 解析到 home。命令模式：`prefix:*` 前缀匹配；含 `*` 走 glob；否则全等。URL 模式：`domain:host`（host 可含 glob）或对整个 URL 的 glob。

## 性能指标

- **纯内存判定**：规则在进程启动时一次加载，单次判定是对 deny→ask→allow 三个数组的线性扫描 + 正则测试，无 I/O。
- **零依赖 glob**：`globToRegExp` 内置实现，不引入 minimatch/picomatch（规避 CLI 未声明依赖全局装机崩的陷阱）。
- **deny 短路省 spawn**：判定发生在工具执行前，被 deny 的调用既不执行工具也不触发确认往返，settings/host deny 还会短路 PreToolUse hook（hook 进程都不 spawn）。
- 无吞吐基准——判定成本相对工具执行可忽略。基准数据待补。

## 测试覆盖

共 **65** 个测试（统计 `it(`/`test(`）：

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `packages/cli/__tests__/unit/permission-rules.test.js` | 32 | 引擎：解析、伞名、命令/路径/URL 匹配、优先级、`suggestAllowRule` |
| `packages/cli/__tests__/unit/settings-loader.test.js` | 14 | 五层合并、并集累加、来源标注、坏文件 fail-open、`addRule` 幂等 |
| `packages/cli/__tests__/unit/permissions-command.test.js` | 9 | `list`/`test`/`add` 命令行为 |
| `packages/cli/__tests__/unit/agent-core-permission-rules.test.js` | 10 | `executeTool` 接线：deny/ask/allow/无规则零变化/host 优先级 |

```bash
cd packages/cli
npx vitest run __tests__/unit/permission-rules.test.js __tests__/unit/settings-loader.test.js __tests__/unit/permissions-command.test.js
```

## 安全考虑

- **deny 只增不减**：跨层合并是并集——任何上层（含 local/env）都无法移除下层的 deny；引擎的 deny > ask > allow 再保证继承的 deny 永远压过本地加的 allow。
- **allow 不是万能钥匙**：settings `allow` 短路的是 plan-mode 拦截与 ApprovalGate，**shell 硬黑名单（如危险 `rm`、`curl` 管道执行类命令）依然生效**；同样，allow 永不松弛桌面 host 策略的 deny。
- **headless fail-closed**：`ask` 命中而无确认器（非交互运行）时直接拒绝，不会静默放行。
- **加载 fail-open、不破坏可用性**：坏 settings 文件只警告并跳过——损坏的配置文件绝不让 agent 卡死，回落到默认风险逻辑（仍然有保护）。
- **写入拒绝践踏坏文件**：`addRule` 发现目标文件是非法 JSON 时抛错拒写，防止把用户手写配置静默清空。
- **显式 UTF-8 读写**，规避 Windows GBK 编码陷阱。

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 规则没生效 | 写错文件/层级，或规则语法不被解析 | `cc permissions list` 看合并结果与来源；`cc permissions test <tool> <args>` 干跑验证 |
| `decision: fallthrough` | 没有任何规则命中 | 预期：回落 risk-tier / `--permission-mode` 逻辑；需要硬决定就补规则 |
| allow 了还是被拦 | 命中的是 host deny 或 shell 硬黑名单（allow 不可松弛二者）；或同时存在 deny/ask 规则（优先级更高） | `test` 干跑看实际命中链；deny > ask > allow |
| headless 下 ask 全被拒绝 | 无确认器 fail-closed 是设计行为 | 改成 allow 规则，或交互式运行 |
| `settings: ignoring malformed <file>` 警告 | settings 文件 JSON 语法错误 | 修复 JSON；该文件在修复前被整体跳过 |
| `permissions add` 报 refusing to overwrite | 目标文件已存在但是坏 JSON | 手工修复或删除该文件后重试 |
| Windows 下路径规则不匹配 | 模式与目标都会斜杠归一化；常见问题是忘了 `./` 前缀导致按 cwd 之外解析 | 用 `cc permissions test read_file <路径>` 验证；相对模式以 cwd 为基准 |
| 想全局临时禁某工具 | — | 用 env kill-switch：`CC_PERMISSIONS_DENY="Bash(curl:*)" cc agent ...` |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/permissions.js` | `cc permissions list/test/add` 命令 |
| `packages/cli/src/lib/permission-rules.cjs` | 规则引擎（解析、glob、匹配、`evaluatePermissionRules`、`suggestAllowRule`） |
| `packages/cli/src/lib/settings-loader.cjs` | 五层发现合并、来源追踪、`addRule` 幂等写入、`loadSettingsConfig` |
| `packages/cli/src/runtime/agent-core.js` | `executeTool` 权限判定链（settings deny → host deny → ask → allow） |
| `packages/cli/__tests__/unit/permission-rules.test.js` | 引擎单测（32） |

## 使用示例

```bash
# 1) 看当前合并后的规则集（含每条规则来自哪个文件）
cc permissions list

# 2) 干跑：这条 shell 命令会被怎么判？
cc permissions test run_shell "git push origin main"
#    decision: ask
#    rule:     Bash(git push:*)
#    source:   C:\proj\.claude\settings.json

# 3) 项目级禁读 .env
cc permissions add deny "Read(./.env)"

# 4) 个人级放行测试命令（不进 git）
cc permissions add allow "Bash(npm run test:*)" --local

# 5) 全项目放行某域名抓取
cc permissions add allow "WebFetch(domain:docs.github.com)" --user

# 6) 一次性 env kill-switch（CI 里禁外呼）
CC_PERMISSIONS_DENY="WebFetch,Bash(curl:*)" cc agent -p "运行测试并总结"

# 7) 带显式 settings 文件跑 agent
cc agent --settings ./ci-permissions.json -p "构建并部署到 staging"
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [RBAC V2 权限治理（cc perm）](./cli-perm.md)
- [Hooks 系统](./hooks.md)
- [计划模式](./plan-mode.md)
- [后台 Shell 执行](./run-shell-background.md)
- [桌面权限系统（RBAC）](./permissions.md)
