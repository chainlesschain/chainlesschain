# 可靠性评测 — 任务成功率 + 趋势回归门（`cc eval`）

> **版本: Phase 7 (可靠性评测 / OTel) 核心落地 · 2026-07-04 | 状态: ✅ 生产就绪 | 8 客观任务类别 + OTel 遥测 + 发布趋势报告/回归门 | 39 测试（含 3 CLI 集成）**
>
> `cc eval` 用一套**自校验**的编码任务衡量 agent 的真实任务成功率——不是「有没有同名命令」，而是「给定起始代码，agent 改完后能不能通过一个**客观**检查（真跑脚本 / 真 import 校验 / exploit 探针）」。配套的 `--history` + `--trend` 把历次运行画成趋势并在回归时**退出码 1**，可直接接入发布流水线做质量门。

## 概述

可靠性评测框架解决的问题是：如何用**可验证的数字**而非主观印象来跟踪「agent 到底能不能可靠地完成真实编码任务」。

每个内置任务提供：一个 `setup(dir)`（在临时工作区铺起始文件）、一个 `prompt`（交给 agent）、一个 `check(dir)`（用**客观断言**判 pass/fail）。框架 `runEvalSuite` 为每个任务开一个全新临时工作区，把 `prompt` 交给无头 `cc agent -p`（`acceptEdits`，可写文件），然后运行 `check` 判定结果，产出可验证的任务成功率 `{ passed, total, passRate, ms }`。

关键设计——**check 是客观的，不是 LLM 模糊评分**：修语法错的任务会**真的运行**修后的脚本；补测试的任务会用**正确实现**和**变异实现**双跑，确保 agent 写的验证器既接受正解又拒绝错解（杜绝 `process.exit(0)` 橡皮图章）；安全修复的任务用 **exploit 探针**主动尝试路径穿越，修后必须**不泄漏**机密。

`runAgent` 是注入的，所以整个框架**离线可测**：`--dry-run` 换入一个 no-op agent（不需要模型即可跑通框架 + 报告链路），单测用 perfect-solver 得 100%、no-op 得 0%，证明 check 既接受正解又拒绝非解。

## 核心特性

- ✅ **8 客观任务类别**: 建档 / 修语法 / 加函数 / 修 bug / 跨文件重构 / 补测试 / API 迁移 / 安全修复——每个都用真跑脚本或 exploit 探针判定，非 LLM 评分。
- 🧪 **客观 check**: 真运行修后代码、真 import 校验、正确/变异双跑证验证器有意义、exploit 探针证漏洞真修。
- 📉 **发布趋势报告**: `--history` 追加每次运行记录，`--trend` 比较最新与上一次运行 → pass-rate 变化、**逐任务回归**、修复、掉的任务、sparkline 迷你图。
- 🚦 **回归门（CI）**: 任一任务从「过」变「败」即触门（即使总 pass-rate 持平也算回归），`--regression-threshold` 可为纯 pass-rate 下降设阈；回归时退出码 1。
- 📊 **OTel 遥测**: 零新增依赖记录 OpenTelemetry 同构 span/counter/失败分类，`--otlp <file>` 落 OTLP/JSON 供真 collector 摄入。
- 🔒 **安全防橡皮图章**: 补测试任务用变异实现验证「验证器不是空壳」；安全任务用 exploit 探针识破「naive replace('../')」式假修。
- 🏃 **离线可跑**: `--dry-run` 用 no-op agent 跑通框架 + 报告，无需模型；trend 报告纯逻辑离线可验。
- 🎯 **可插拔 runAgent**: 默认接无头 `cc agent -p` 子进程；`--model` / `--provider` 指定后端。

## 内置任务类别（8）

| 任务 id             | 类别       | check 如何客观判定                                                                   |
| ------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `create-file`       | 精确建档   | 断言文件被创建且内容精确匹配                                                         |
| `fix-syntax-error`  | 修语法错   | **真运行**修后脚本，退出 0 才算过                                                    |
| `add-function`      | 加函数     | **真 import** 模块并调用新函数校验返回                                               |
| `fix-failing-test`  | 修 bug     | 改 module 让 `run-checks.mjs` 真跑过 + **防改测试**守卫（不许改测试蒙混）            |
| `refactor-rename`   | 跨文件重构 | 两文件改名：旧名必消失 + 新名双现 + `node main.js` 行为不变                          |
| `write-test`        | 补测试     | agent 写验证器，对**正确实现**跑必过 + 对**变异实现**跑必败（杜绝空壳）              |
| `migrate-signature` | API 升级   | 函数签名 positional→options 对象 + 断言全部 caller 更新 + 运行输出不变               |
| `secure-path`       | 安全修复   | **exploit 探针** `readNote('../secret.txt')` 修后必不泄漏 `TOP_SECRET`，正常读仍工作 |

## 系统架构

```
┌────────────────────────────────────────────────────────────┐
│                        cc eval                              │
│                 (commands/eval.js)                          │
│  ┌──────────────┐   ┌─────────────┐   ┌──────────────────┐ │
│  │  普通模式     │   │  --dry-run   │   │  --trend 模式     │ │
│  │  真跑 suite   │   │  no-op agent │   │  读历史报趋势     │ │
│  └──────┬───────┘   └──────┬──────┘   └────────┬─────────┘ │
└─────────┼──────────────────┼───────────────────┼───────────┘
          │                  │                   │
   ┌──────▼──────────────────▼──────┐   ┌────────▼──────────┐
   │       runEvalSuite             │   │   computeTrend    │
   │      (lib/eval/runner.js)      │   │  (lib/eval/       │
   │  每任务：临时工作区 →           │   │   trend.js)       │
   │  setup() → runAgent() →        │   │  最新 vs 上次：    │
   │  check() 客观断言 → pass/fail   │   │  delta/regressions│
   └──────┬─────────────────┬───────┘   │  /fixed/sparkline │
          │                 │           └────────┬──────────┘
   ┌──────▼──────┐   ┌──────▼────────┐           │
   │ BUILTIN_    │   │  runAgent     │    ┌──────▼─────────┐
   │ TASKS (8)   │   │  = 无头        │    │  --history     │
   │ tasks.js    │   │  cc agent -p  │    │  JSONL 追加/读  │
   └─────────────┘   └───────────────┘    └────────────────┘
          │
   ┌──────▼──────────────────┐
   │  TelemetryRecorder      │   --otlp → OTLP/JSON 文件
   │  (span-recorder.js)     │   每任务 eval.task span + 失败分类
   └─────────────────────────┘
```

## 命令参考

```bash
cc eval [options]
```

| 旗标                           | 说明                                                   | 默认      |
| ------------------------------ | ------------------------------------------------------ | --------- |
| `--suite <name>`               | 要跑的套件                                             | `builtin` |
| `--model <model>`              | agent 运行使用的模型                                   | 默认模型  |
| `--provider <provider>`        | agent 运行使用的 provider                              | 默认      |
| `--json`                       | 以 JSON 输出摘要                                       | 关        |
| `--keep`                       | 保留每任务临时工作区（调试）                           | 关        |
| `--otlp <file>`                | 把本次运行的 OTLP/JSON span 写入文件                   | 关        |
| `--dry-run`                    | 用 no-op agent（无需模型跑通框架/报告）                | 关        |
| `--history <file>`             | 把本次运行摘要（JSONL）追加以做趋势跟踪                | 关        |
| `--label <label>`              | 给本次运行打标签（如版本/commit）                      | 无        |
| `--trend`                      | 从 `--history` 报 pass-rate 趋势而非运行（CI 门）      | 关        |
| `--regression-threshold <pct>` | 配合 `--trend`：单纯 pass-rate 下降多少点（pts）就触门 | `0`       |

> `--history` / `--trend` / `--label` / `--regression-threshold` 都是 `cc eval` 的**选项**，非新顶层命令。

## 配置参考

| 项         | 机制                                | 说明                                                                      |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------- |
| 套件       | `--suite builtin`                   | 目前内置 8 任务；`getSuite` 可扩展自定义套件                              |
| Agent 后端 | `--model` / `--provider`            | 默认接无头 `cc agent -p --permission-mode acceptEdits`                    |
| 任务超时   | runner `timeoutMs`（默认 120000ms） | 单任务超时记为失败，不中断整套                                            |
| 历史文件   | `--history <file>`（JSONL）         | 每行一条 `{ ranAt, label, passed, total, passRate, results:[{id,pass}] }` |
| 回归阈值   | `--regression-threshold <pts>`      | 纯 pass-rate 下降触门的点数；逐任务回归**总是**触门                       |
| 遥测输出   | `--otlp <file>`                     | OTLP/JSON（resourceSpans + typed attr），供真 collector 摄入              |

**回归门判定逻辑**：`regressed = 有任一任务回归 || pass-rate 下降 > 阈值`。一个任务修好、另一个坏掉会让总 pass-rate 持平——但那仍是**真回归**，门会触。

## 性能指标

| 维度     | 特性                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 隔离     | 每任务全新临时工作区，互不污染                                          |
| 容错     | agent 崩溃 → 该任务记失败（非中断整套）；坏任务定义 → 记 failed（非抛） |
| 客观性   | check 真跑脚本 / 真 import / exploit 探针，非 LLM 模糊评分              |
| 离线开销 | `--dry-run` 无模型即可跑通全链，趋势报告纯逻辑                          |
| 遥测开销 | 零新增依赖（不引 `@opentelemetry/*`），注入时钟确定性                   |
| 门稳定性 | 逐任务回归 + 阈值双判据，退出码 0/1 可直接做 CI 闸门                    |

## 测试覆盖

共 **39 测试**（含 3 CLI 集成），全绿。

| 测试文件                       | 数量 | 覆盖                                                                               |
| ------------------------------ | ---- | ---------------------------------------------------------------------------------- |
| `eval-runner.test.js`          | 14   | 框架计数（perfect=100%/no-op=0%）+ 8 任务的 rigor（变异拒/半迁移拒/exploit 探针）  |
| `eval-trend.test.js`           | 10   | 趋势逻辑：改善/率平含回归/阈值/排序/掉任务/空 + sparkline/format                   |
| `eval-trend-cli.test.js`       | 3    | **CLI 集成**：`--history` 追加往返 / 回归门 exit 1 / `--trend` 缺 `--history` 报错 |
| `telemetry-recorder.test.js`   | 7    | span/counter/失败分类 + `toOtlp()` typed attr                                      |
| `agent-core-telemetry.test.js` | 3    | agent-core 真埋点：模型 span token 属性 / 工具错误标记 / 无 recorder no-op         |
| `headless-runner-otlp.test.js` | 2    | `cc agent --otlp` 文件形状 + 无 otlp 干净路径                                      |

## 安全考虑

- **沙箱式工作区**：每个任务在独立临时目录执行，check 完清理（`--keep` 保留供调试）。任务运行会真实执行 agent 的编辑——评测应在受信环境运行。
- **exploit 探针即安全断言**：`secure-path` 任务的 check 主动跑路径穿越（`readNote('../secret.txt')`），确保 agent 的修复真的堵住漏洞而非 naive `replace('../')` 式假修——把「安全修复」变成客观可判。
- **防橡皮图章**：`write-test` 用变异实现验证 agent 写的测试「不是空壳」，杜绝 `process.exit(0)` 蒙混过关。
- **回归门作闸**：接入发布流水线后，任务成功率回归会让 CI 失败，防止「悄悄退化」的 agent 变更上线。

## 故障排除

| 现象                         | 原因                                          | 处理                                               |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `--dry-run` 报告 0/8         | 预期——no-op agent 什么都不做，所有 check 失败 | 正常，用于验证框架/报告链路                        |
| 真跑全 0%                    | 无模型/provider 凭据，或子进程 agent 崩溃     | 配置 `--model`/`--provider` 与凭据（见 `cc auth`） |
| `--trend requires --history` | 用了 `--trend` 但没给历史文件                 | 补 `--history <file>`                              |
| 趋势显示 `only one run`      | 历史里只有一次运行                            | 至少两次运行才有 delta                             |
| 回归门意外触发               | 某任务从过变败（即使总率持平）                | 查 `regressions` 列出的任务 id；这是真回归         |
| OTLP 文件写失败              | 目标路径不可写                                | 检查 `--otlp` 路径权限（写失败不改退出码）         |

## 关键文件

| 文件                                              | 职责                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/cli/src/commands/eval.js`               | `cc eval` CLI：普通/dry-run/trend 三模式、history 追加/读取、OTLP 输出 |
| `packages/cli/src/lib/eval/runner.js`             | `runEvalSuite`——临时工作区 + setup/runAgent/check 编排 + 遥测接线      |
| `packages/cli/src/lib/eval/tasks.js`              | `BUILTIN_TASKS`——8 个确定性任务定义 + `getSuite`                       |
| `packages/cli/src/lib/eval/trend.js`              | `computeTrend` / `sparkline` / `formatTrend`——趋势 + 回归门（纯逻辑）  |
| `packages/cli/src/lib/telemetry/span-recorder.js` | `TelemetryRecorder`——OTel 同构 span/counter/失败分类 + `toOtlp()`      |

## 使用示例

### 1. 离线跑通框架（无需模型）

```bash
cc eval --dry-run
#   ✗ create-file (12ms) — ...
#   ...
# Eval: 0/8 passed (0.0%) in 240ms      ← dry-run 恒 0%（no-op agent）
```

### 2. 真实评测 + OTel 遥测

```bash
cc eval --model claude-sonnet-5 --otlp eval-spans.json
#   ✔ create-file (1840ms)
#   ✔ fix-syntax-error (3210ms)
#   ...
# Eval: 7/8 passed (87.5%) in 22140ms
# eval.task n=8 avg=… p95=…   failures 1 (check_failed=1)
```

### 3. 记录历史用于趋势

```bash
# 每次发布前跑并追加历史，打上版本标签
cc eval --model claude-sonnet-5 --history .eval-history.jsonl --label v5.0.3.135
```

### 4. 趋势报告 + 回归门（CI）

```bash
cc eval --trend --history .eval-history.jsonl
# Eval trend over 5 run(s)  ▆▇▇█▅
#   latest: 6/8 (75.0%) [v5.0.3.136]
#   vs previous: ▼ -25.0 pts
#   ✗ regressions: fix-failing-test, secure-path
#   RESULT: REGRESSED (gate fails)
# → 退出码 1（CI 失败）

# 容忍小幅波动：只有下降超过 20 点才触门（但逐任务回归仍触门）
cc eval --trend --history .eval-history.jsonl --regression-threshold 20
```

### 5. 典型 CI 流水线接法

```bash
# 发布前：真跑 + 记历史
cc eval --model "$MODEL" --history eval-history.jsonl --label "$GIT_SHA" || true
# 门：若相比上次回归则失败
cc eval --trend --history eval-history.jsonl   # 回归 → exit 1 → CI 红
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — `cc agent -p` 无头执行（评测的 runAgent 底层，含 `--otlp` / `--auto-rewake`）
- [Agent Team `cc team`](./cli-team.md) — 声明式任务图团队编排（同 Phase 4/7 CI 门思路）
- [Checkpoint](./checkpoint.md) — agent 执行的检查点/回滚
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN) Phase 7（可靠性评测 / OTel）
