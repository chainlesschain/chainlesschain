# 自动权限模式检视 — 分类器与生效配置（`cc auto-mode`）

> **版本: Claude Code 平价 · 状态: ✅ 生产就绪（只读检视）| 别名 `automode` | 预览 `--permission-mode auto` 下的风险等级 → allow/ask/deny 分类，以及 `.claude/settings.json` 各层合并后的 `autoMode` 生效配置**
>
> `cc auto-mode` 是一个**只读检视命令**——它不改变任何行为、不跑 Agent。它把内建的自动权限模式分类默认值、以及从 settings.json 各层解析出的**生效** `autoMode` 配置打印出来，让你在真正跑 Agent 之前就看清「auto 模式会自动放行什么、会拦下什么」。

## 概述

`cc agent`（及无头运行）用 `--permission-mode` 选择权限档位，`auto` 是其中之一。当 Agent 运行在 `--permission-mode auto` 下，每次工具调用会按**风险等级**（`low` / `medium` / `high`）被分类成 `allow` / `ask` / `deny`：

- 默认下 `auto` 与 **trusted**（受信）ApprovalGate 档位**逐字节等价**：low/medium 自动放行，high 仍然要问。
- 用户可在 settings.json 里写 `autoMode.decisions` 覆盖这套映射（细到某个工具、某条 shell 命令模式）。

`cc auto-mode` 就是这套分类器的**预览窗口**：

- `cc auto-mode defaults` —— 打印内建分类默认值（JSON）。
- `cc auto-mode config` —— 打印各层合并后的**生效**配置（人类摘要或 `--json`）。

> ⚠️ 本命令只**看**，不**开**。真正开启 auto 模式是 `--permission-mode auto`（或 REPL 内的权限档位切换 / Shift+Tab 循环）。

## 核心特性

- 🔎 **纯检视、零副作用**：不跑 Agent、不改配置，只解析并打印。
- 🧮 **风险三分类**：`low → allow`、`medium → allow`（映射 trusted）、`high → ask`（非交互场景 `deny`）——「危险执行仍需批准」。
- 🎯 **细粒度覆盖**：`autoMode.decisions` 支持对象形（按风险等级覆盖）与数组形（按 `tool` 精确名 / `commandPattern` 的 `*`-glob 覆盖，声明序先匹配先赢）。
- 🛡️ **打字错误绝不放松闸门**：非法风险等级 / 非法决定值 / 非字符串模式一律**忽略并回退默认**——配置写错「既不会放松、也不会静默失效」。
- 🧱 **不可越权硬 deny**：shell-policy 的硬性 deny 在闸门之前短路，分类器无法把它升权放行。
- 🪜 **各层生效解析**：从内建默认 → `settings.json` 各层 → **managed 托管设置（优先级最高，最后合并、不可绕过）**；`--settings <file>` 可临时并入一层预览。

## 系统架构

```
                 cc auto-mode config
                        │
                        ▼
 ┌───────────────────────────────────────────────────────────┐
 │ loadAutoModeConfig  (lib/auto-mode-config.js)              │
 │  AUTO_MODE_DEFAULTS.settings                               │
 │   → 合并各层 autoMode 块（settingsPaths 顺序）              │
 │   → managed 托管设置最后并入（最高优先级）                  │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────┐
 │ resolveAutoModeDecisions → 编译生效决策映射                 │
 │  low  → allow     ┐                                        │
 │  medium → allow   ├─ 默认（= trusted 档位，逐字节等价）      │
 │  high → ask/deny  ┘                                        │
 │  + 细粒度规则（match.tool / match.commandPattern）优先命中   │
 │  非法值 → 忽略 → 回退默认（永不放松闸门）                    │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
        运行期：createAutoModeApprovalGate 包住 ApprovalGate
        （仅当 customized=true 时安装；未配置走原生 trusted 路径）
        allow → 放行 · deny → 拒绝 · ask → 交给 confirmer

 settings 层序（近者胜；managed 最高）：
  ~/.claude/settings.json → 项目 .claude/settings.json → .local.json
   → cwd .claude/settings.json → .local.json → --settings <file> → managed
```

## 命令参考

### `cc auto-mode defaults`

打印内建分类默认值（JSON）——`schema: chainlesschain.auto-mode/v1`、`mode: auto`、`sessionPolicy: trusted`、三条决策 + 文档化的 `precedence`（评估顺序）。

```bash
cc auto-mode defaults
```

### `cc auto-mode config`

打印各层合并后的**生效**配置。

```bash
cc automode config                              # 人类摘要
cc auto-mode config --json                      # 机器可读（含 resolved 决策 + 规则 + customized 标志）
cc auto-mode config --settings ./ci/strict.json # 额外并入一个显式 settings 文件预览
```

| 旗标                | 说明                                   | 默认 |
| ------------------- | -------------------------------------- | ---- |
| `--json`            | 机器可读输出（否则人类摘要）           | 关   |
| `--settings <file>` | 额外并入一个显式 settings 文件一起解析 | 无   |

> 解析失败时打印红色 `auto-mode config failed: <msg>` 并置退出码 1。

## 配置参考

在 `.claude/settings.json` 的 `autoMode` 块下：

| 键                          | 类型        | 默认     | 说明                                                                                                     |
| --------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `autoMode.decisions`        | 数组 / 对象 | 内建三条 | 覆盖风险等级 → 决定的映射；对象形按等级覆盖，数组形可带 `match.tool` / `match.commandPattern` 细粒度规则 |
| `autoMode.classifyAllShell` | 布尔        | `false`  | 把内建校验白名单也走 shell-policy 分类（Claude Code 2.1.193 平价）；读取失败 fail-open 为 false          |

决定值合法集：`allow` / `ask` / `deny`（`confirm` 是 `ask` 的别名）。非法值一律忽略回退默认。

**权限模式档位**（`--permission-mode` 取值，供对照）：

| 模式                   | 会话策略          | 交互批准 | 语义                                                             |
| ---------------------- | ----------------- | -------- | ---------------------------------------------------------------- |
| `manual` / `default`   | strict            | 允许     | 每个有风险动作都问                                               |
| `auto` / `acceptEdits` | trusted           | 允许     | low/medium 自动放行，high 仍问（本命令检视的对象）               |
| `dontAsk`              | strict            | **禁止** | 任何会弹窗的动作直接拒绝（无提示）                               |
| `plan`                 | strict + readOnly | —        | 只读预演                                                         |
| `bypassPermissions`    | autopilot         | allow    | 全部自动放行（可被 managed `disableBypassPermissionsMode` 封禁） |

**相关环境变量**（作用于更广的权限系统，非本命令直接解析）：`CC_PERMISSIONS_ALLOW` / `CC_PERMISSIONS_ASK` / `CC_PERMISSIONS_DENY`（kill-switch 规则列表）、`CC_MANAGED_SETTINGS`（托管设置路径）。

## 性能指标

| 维度         | 特性                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| 解析开销     | 一次性读取并合并 settings 各层，O(层数 × 规则数)                              |
| glob 编译    | 仅 `*` 通配、**大小写敏感**——刻意收紧以防子串过度授权                         |
| 规则匹配     | 细粒度规则声明序先匹配先赢；否则落风险等级映射                                |
| 未知风险等级 | 一律当作 `low` 处理                                                           |
| 运行期安装   | 仅当 `customized=true` 才包 ApprovalGate；未配置走原生 trusted 路径（零开销） |

## 测试覆盖

| 测试文件                                            | 覆盖                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/unit/auto-mode-config.test.js`（~20 例） | `defaults` 文档 · `loadAutoModeConfig` 各层合并优先级 · `resolveAutoModeDecisions` 数组/对象覆盖形 · 非法值回退 · 细粒度规则排序 · fail-closed confirmer · `createAutoModeApprovalGate` 决策 |
| `__tests__/unit/headless-runner.test.js`            | `resolvePermissionMode` 档位映射                                                                                                                                                             |
| `__tests__/unit/permission-tier.test.js`            | REPL 档位别名解析                                                                                                                                                                            |
| `__tests__/unit/permission-chain.test.js`           | 权限链评估                                                                                                                                                                                   |

> 覆盖集中在底层 lib（`auto-mode-config.js`）；命令层是薄封装。

## 安全考虑

- **Fail-closed 设计**：无头默认拒绝 MEDIUM/HIGH 风险 shell。auto 闸门里，`ask` 决定若**没有 confirmer** 返回 deny（`via: no-confirmer`），confirmer 抛错也返回 deny（`via: confirm-error`）。
- **默认只自动放行 low/medium**；**high 恒问**（非交互恒 deny）。破坏性/危险执行按设计始终受闸门管制。
- **打字错误无法放松闸门**：非法风险等级/决定值/模式忽略回退默认。
- **硬 deny 不可升权**：shell-policy 的 deny 在闸门之前短路；细粒度 glob 锚定 + 大小写敏感，防子串过度匹配（如 `npm *` 不会命中 `pnpm install`）。
- **托管设置不可绕过**、最后合并优先级最高；managed `disableBypassPermissionsMode` 可封住 autopilot 逃生门。
- 唯一有意的 **fail-open**：`classifyAllShell` 读取失败时默认 false——只影响是否重新分类白名单，不影响危险操作是否放行。

## 故障排除

| 现象                             | 原因                                    | 处理                                                          |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| 改了 `autoMode.decisions` 不生效 | 值非法被忽略回退默认                    | `cc auto-mode config --json` 看 `customized` 与 resolved 决策 |
| `auto-mode config failed`        | 某层 settings.json 解析失败             | 定位报错的 settings 文件修正 JSON                             |
| 期望 high 自动放行但仍在问       | 设计如此——high 恒 `ask`                 | 需要放行请显式写数组形细粒度规则，并评估风险                  |
| 分类器像没生效                   | 未配置时走原生 trusted 路径（不包闸门） | 正常；`customized:false` 即等于默认 trusted 映射              |
| 想看某次运行到底拒了什么         | 检视命令不含运行历史                    | 跑 `cc permissions recent`（别名 `cc perms denials`）         |

## 关键文件

| 文件                                          | 职责                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/auto-mode.js`      | `cc auto-mode defaults / config`（纯检视）                                                              |
| `packages/cli/src/lib/auto-mode-config.js`    | `AUTO_MODE_DEFAULTS` · `loadAutoModeConfig` · `resolveAutoModeDecisions` · `createAutoModeApprovalGate` |
| `packages/cli/src/lib/settings-loader.cjs`    | settings.json 各层加载 + 托管设置优先级                                                                 |
| `packages/cli/src/repl/permission-tier.js`    | REPL 档位别名（`auto`/`dontAsk`/`trusted`/`strict`/`autopilot`）+ Shift+Tab 循环                        |
| `packages/cli/src/runtime/headless-runner.js` | `resolvePermissionMode` + auto 闸门运行期接线 + `classifyAllShell`                                      |
| `packages/cli/src/commands/permissions.js`    | 姊妹命令 `cc permissions`（规则引擎 + 近期拒绝）                                                        |

## 使用示例

### 1. 看内建分类默认值

```bash
cc auto-mode defaults
# schema chainlesschain.auto-mode/v1 · mode auto · sessionPolicy trusted
# decisions: low→allow, medium→allow, high→ask（非交互 deny）
```

### 2. 看当前项目的生效配置（人类摘要）

```bash
cc automode config
#   classifyAllShell: false
#   classifier:       trusted policy (defaults)
#   low    risk → allow ；medium risk → allow ；high risk → ask
#   sources: defaults only
```

### 3. 生效配置的 JSON（含 resolved 决策与 customized 标志）

```bash
cc auto-mode config --json
```

### 4. 预览一个更严的 CI settings 会怎么改分类器

```bash
cc auto-mode config --settings ./ci/strict-settings.json
#   （settings 里 autoMode.decisions {"high":{"decision":"deny"}} →）
#   classifier: autoMode.decisions (customized)
#   high risk → deny
```

### 5. 配套：跑 Agent 后回看它拒了什么

```bash
cc agent -p "..." --permission-mode auto
cc permissions recent --limit 20     # 别名 cc perms denials
cc permissions test run_shell "git push"   # 单条调用对着规则空跑
```

## 相关文档

- [权限系统 `cc permissions`](./cli-permissions.md) — settings.json 权限规则、近期拒绝日志、`test` 空跑（规则在分类器**之前**评估）
- [CLI Agent 模式](./cli-agent.md) — `--permission-mode auto` 的实际开启点
- [配置管理 `cc config`](./cli-config.md) — `.claude/settings.json` 与 `autoMode` 块
