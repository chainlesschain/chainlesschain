# 工作流自动化引擎 CLI（Phase 96）

> `chainlesschain automation`（别名 `auto`）— SaaS 连接器 + 触发器 + DAG 工作流编排。
>
> 12 个 SaaS 连接器 + 5 种触发器类型 + DAG 拓扑排序 + 条件分支执行。
>
> **版本边界（2026-08-13）**：`0.163.6` 是 npm `latest` 与生产推荐版。`automation run-scheduled`、execution preflight/budget、scope-checked channel event 以及双 IDE Automation Center 均已进入公开安装契约。scheduler outcome-unknown 人工裁决仅在 `main` 源码中，尚未进入 npm 稳定版。

---

## 概述

Automation Engine 是面向非开发者的工作流自动化平台（区别于 `workflow` 的开发流水线）。
内置 12 个 SaaS 连接器（Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/Teams/
Airtable/Figma/Linear/Confluence），支持 webhook/schedule/email/form/manual 五种触发方式。

---

## 核心特性

- **12 个 SaaS 连接器** — Gmail / Slack / GitHub / Jira / Notion / Trello / Discord / Teams / Airtable / Figma / Linear / Confluence
- **5 种触发器** — webhook（HTTP 回调）、schedule（cron）、email（邮件入站）、form（表单提交）、manual（手动）
- **DAG 拓扑排序执行** — 支持条件分支、并行节点、步骤级超时
- **生命周期管理** — `draft → active → paused → archived`；`activate/pause/archive/delete` 状态机
- **模板共享** — 导出/导入自定义模板，`share --public` 公开
- **执行日志** — 每次执行记录步骤级详情、输入输出、错误堆栈
- **持久定时执行** — `automation run-scheduled` 将 active+scheduled flow 绑定为 immutable snapshot，使用 logical occurrence 去重、owner/fence lease 与确定性 execution id；只恢复可验证成功证据，不自动重放 outcome-unknown 副作用
- **执行前置检查与预算** — creator identity、`automation:execute`、连接器 RBAC、live revocation、flow run/action budget 与共享 scheduler policy revision 分层复验
- **Automation Center** — CLI 生成 versioned projection 和 exact argv；VS Code `0.37.50` / JetBrains `0.4.86` 通过 revision CAS 管理 flow 与 cron/once/webhook/GitHub Routine
- **V2 治理层** — `-v2` 后缀：4 态 automation maturity + 5 态 execution lifecycle，cap + auto-pause-idle + auto-fail-stuck

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│               chainlesschain automation               │
├──────────────────────────────────────────────────────┤
│  Triggers                 │  Orchestrator             │
│  webhook / schedule /     │  DAG topo-sort +          │
│  email / form / manual    │  conditional exec         │
├──────────────────────────────────────────────────────┤
│  Connectors (12)                                      │
│  Gmail │ Slack │ GitHub │ Jira │ Notion │ Trello ... │
├──────────────────────────────────────────────────────┤
│  Execution Log       │  Templates                    │
│  step-level, JSON    │  public share + import        │
├──────────────────────────────────────────────────────┤
│  SQLite (automation_flows / triggers / executions)    │
├──────────────────────────────────────────────────────┤
│  Scheduler Kernel (kernel-v1.sqlite)                  │
│  snapshot/CAS · occurrence dedup · lease · recovery   │
└──────────────────────────────────────────────────────┘
```

数据流：`create` flow → `add-trigger` → `activate` → 触发器触发 → DAG 执行 → 写 `executions` → `logs`。

---

## 配置参考

| 配置项                           | 含义                | 默认        |
| -------------------------------- | ------------------- | ----------- |
| `maxConcurrentExecutions`        | 并发执行数          | 10          |
| `executionTimeoutMs`             | 单次执行超时        | 300000 ms   |
| `logRetentionDays`               | 日志保留天数        | 30          |
| `maxStepsPerFlow`                | 单工作流最大步骤    | 100         |
| V2 `perOwnerActiveAutomationCap` | 每 owner 活跃工作流 | ~20         |
| V2 `perAutomationRunningExecCap` | 每工作流运行中执行  | ~10         |
| V2 `autoPauseIdleAfterMs`        | 闲置自动暂停阈值    | 86400000 ms |

查看：`chainlesschain auto config`、`auto trigger-types`、`auto statuses`。

---

## 性能指标

| 指标                         | 典型值                                    |
| ---------------------------- | ----------------------------------------- |
| 创建工作流                   | < 20 ms                                   |
| 添加触发器                   | < 15 ms                                   |
| DAG 拓扑排序（20 节点）      | < 10 ms                                   |
| 手动 execute（含连接器调用） | 依赖外部服务                              |
| V2 createExecV2 dispatch     | < 50 ms                                   |
| V2 cap (default)             | per-owner 20 active / per-auto 10 running |

---

## 测试覆盖率

```
__tests__/unit/automation-engine.test.js — 114 tests (1285 lines)
```

覆盖：flow CRUD、trigger 创建/enable/disable/fire、execute 串行/并行/条件、logs、
模板 import/export、`activate/pause/archive` 状态机、V2 治理（67 V2 tests 覆盖 cap/idle/stuck）。

---

## 安全考虑

1. **连接器凭证隔离** — 每个连接器凭证单独加密存储，按 flow 授权访问
2. **Webhook 签名** — 入站 webhook 建议配置 HMAC 签名验证 payload 完整性
3. **cron 频率限制** — schedule 触发器后端强制最小间隔，防止滥用
4. **步骤失败重试** — 指数退避重试，避免外部服务过载
5. **审计日志** — 所有 activate/pause/archive/delete 操作写入审计链
6. **失败闭合的无人值守权限** — 缺少 creator、`automation:execute`、连接器权限、预算或共享 scheduler policy 时拒绝运行；重试复用原 reservation
7. **作用域事件去重** — `dispatch-channel-event` 要求稳定 source event id，仅接受 webhook/Telegram origin，并在 durable scope check 后触发匹配 flow

---

## 故障排查

**Q: 触发器 fire 了但执行未启动?**

1. 确认 flow 已 `activate`（`draft/paused` 状态不会执行）
2. 检查 `auto show <flow-id>` 的 DAG 是否有孤立节点
3. 查看 `auto logs <flow-id>` 获取具体错误

**Q: 定时任务未按计划触发?**

1. 验证 cron 表达式语法（`auto schedule <id> --cron` 传入后会解析）
2. 确认已安装 `chainlesschain@0.163.6`，再运行 `chainlesschain auto run-scheduled --json`
3. 确认 flow 状态为 `active`；`draft/paused/archived` 不会被 scheduler 入队
4. V2 下检查是否被 `auto-pause-idle` 自动暂停

**Q: 连接器调用失败?**

1. 先运行连接器自带的 health check（通过 `execute` 单步测试）
2. 检查凭证是否过期（OAuth token refresh）
3. 查看 `logs --limit 10 --json` 的响应状态码

---

## 关键文件

- `packages/cli/src/commands/automation.js` — Commander 子命令（~924 行）
- `packages/cli/src/lib/automation-engine.js` — DAG 引擎与连接器
- `packages/cli/src/lib/scheduler-kernel/automation-adapter.js` — scheduled flow snapshot、occurrence 与恢复策略
- `packages/cli/src/lib/automation-execution-authority.js` — creator / connector RBAC / flow budget 前置检查与结算
- `packages/cli/src/lib/automation-center.js`、`automation-center-routines.js` — versioned projection、revision-CAS flow/Routine 控制面
- `packages/cli/src/lib/scheduler-kernel/automation-event-adapter.js` — channel event scope、去重与执行
- `packages/cli/src/lib/scheduler-kernel/runtime.js` — 共享 claim/lease/heartbeat/settlement runtime
- `packages/cli/__tests__/unit/automation-engine.test.js` — 单测（114 tests）
- 数据表：`automation_flows` / `automation_triggers` / `automation_executions`
- 设计文档：`docs/design/modules/61_工作流自动化引擎.md`

---

## 使用示例

```bash
# 1. 从模板创建 + 激活
tpl=$(chainlesschain auto templates --json | jq -r '.[0].id')
fid=$(chainlesschain auto import-template $tpl | grep flow-id)
chainlesschain auto activate $fid

# 2. 添加 webhook 触发器
chainlesschain auto add-trigger $fid --type webhook --config '{"path":"/hooks/foo"}'

# 3. 定时触发（工作日 9:00）
chainlesschain auto schedule $fid --cron "0 9 * * 1-5"

# npm 0.163.6：统一 Scheduler
chainlesschain auto run-scheduled
chainlesschain auto run-scheduled --json
chainlesschain auto run-scheduled --lease-ms 60000

# 4. 手动测试
chainlesschain auto execute $fid --input '{"subject":"test"}'
chainlesschain auto logs $fid --limit 5

# 5. 全局统计
chainlesschain auto stats --json
```

---

## 连接器与触发器目录

```bash
chainlesschain auto connectors      # 列出 12 个 SaaS 连接器
chainlesschain auto trigger-types   # 列出触发器类型
chainlesschain auto statuses        # 列出工作流状态
chainlesschain auto config          # 查看配置常量
```

---

## 工作流 CRUD

```bash
# 创建工作流
chainlesschain auto create --name "新 Issue 通知" --description "GitHub issue → Slack"

# 列出工作流
chainlesschain auto flows
chainlesschain auto flows --json

# 查看详情
chainlesschain auto show <flow-id>

# 生命周期管理
chainlesschain auto activate <flow-id>    # 激活
chainlesschain auto pause <flow-id>       # 暂停
chainlesschain auto archive <flow-id>     # 归档
chainlesschain auto delete <flow-id>      # 删除

# 定时调度
chainlesschain auto schedule <flow-id> --cron "0 9 * * 1-5"
# 运行所有当前到期的 active cron flow
chainlesschain auto run-scheduled [--json] [--lease-ms 60000]

# 分享与模板
chainlesschain auto share <flow-id> --public
chainlesschain auto templates                           # 列出模板
chainlesschain auto import-template <template-id>       # 导入模板
```

---

## 执行权限、预算与 channel event

无人值守执行前先为 flow 设置固定窗口预算，再查看 live RBAC 与剩余额度：

```bash
chainlesschain auto set-execution-budget <flow-id> \
  --window-ms 3600000 --max-runs 20 --max-action-steps 200
chainlesschain auto execution-preflight <flow-id> --json

# Webhook / Telegram 接入层传入稳定事件 ID；相同 ID 会被持久去重
chainlesschain auto dispatch-channel-event \
  --event-id webhook-20260812-001 --origin webhook \
  --sender build-service --text "production build failed" \
  --meta '{"repository":"acme/app"}' --json
```

`execution-preflight` 同时展示 principal、每个连接器权限以及剩余 run/action-step 配额。它通过不代表未来永久可用；实际执行仍会再次读取 live revocation、flow budget 与共享 scheduler policy revision。

## Automation Center 与 IDE

IDE 只消费 `center-projection`，不直接编辑 Automation/Routine 的 SQLite 或 JSON 文件。每个 mutation 都必须携带投影展示的 exact revision；投影过期时失败闭合并要求刷新。

```bash
# IDE/集成方读取版本化投影
chainlesschain auto center-projection --limit 100 --json

# Flow 动作：run_now | retry_failed | pause | resume | disable | delete
chainlesschain auto center-action <flow-id> pause \
  --expected-revision <revision> --json

# Routine 动作：run_now | retry_failed | pause | resume | disable | delete
chainlesschain auto center-routine-action <routine-id> run_now \
  --expected-revision <revision> --json

# PowerShell：定义由有界 JSON stdin 输入，禁止 shell 拼接
Get-Content routine.json | chainlesschain auto center-routine-create --expected-revision <catalog-revision> --json-stdin --json
Get-Content routine.json | chainlesschain auto center-routine-edit <routine-id> --expected-revision <item-revision> --json-stdin --json
```

VS Code 在 Activity Bar 打开 **ChainlessChain Automation**；JetBrains 在 **View → Tool Windows → ChainlessChain Automation** 打开。两端都显示 scope、preflight、运行历史与可用动作，最终权威仍由 CLI 持有。

---

## `main` 源码：outcome-unknown 人工裁决

当外部连接器可能已产生副作用、但本地终态无法证明时，scheduler 会写入 `*_OUTCOME_UNKNOWN` 死信并拒绝自动重放。源码版提供统一操作入口：

```bash
cc daemon scheduler adjudication list
cc daemon scheduler adjudication show <occurrence-id>

cc daemon scheduler adjudication decide <occurrence-id> \
  --decision confirmed_applied \
  --expected-evidence-digest sha256:<digest> \
  --expected-attempt <attempt> \
  --expected-fence <fence>
```

运行 `decide` 前必须停止每一个 scheduler host、排空已分发任务，并在目标 SaaS/外部系统核验真实结果。命令只接受交互式 TTY 和逐字 typed challenge；理由与操作员身份只保存摘要。选择 `confirmed_applied` 会从证据结算且绝不重放，选择 `confirmed_not_applied` 只授权一次有界执行。任何旧 digest、attempt/fence 变化、重复裁决或非 outcome-unknown 状态都会失败闭合。决策写入后再重启一个 scheduler host 应用。

这不是全局 exactly-once，也不是机器范围锁；`chainlesschain@0.163.6` 尚无这些子命令。生产安装在新 npm 版本完成三平台发布门前应继续保持死信并人工核验，不要绕过存储直接改状态。

## 触发器管理

```bash
chainlesschain auto add-trigger <flow-id> --type webhook --config '{"url":"..."}'
chainlesschain auto triggers <flow-id>
chainlesschain auto enable-trigger <trigger-id>
chainlesschain auto disable-trigger <trigger-id>
chainlesschain auto fire-trigger <trigger-id> --payload '{"key":"value"}'
```

---

## 执行与日志

`run-scheduled` 使用 occurrence 派生的确定性 execution id。若同一 occurrence 已有成功 execution evidence，只补齐 scheduler settlement；若只有 `running`、非成功终态或副作用后持久化结果未知，则失败闭合，不自动重跑连接器。该约束不等于外部 SaaS 的全局 exactly-once。

```bash
# 手动执行工作流
chainlesschain auto execute <flow-id> --input '{"data":"test"}'

# 查看执行详情
chainlesschain auto exec-show <execution-id>

# 执行日志
chainlesschain auto logs <flow-id>
chainlesschain auto logs <flow-id> --limit 50 --json
```

---

## 统计

```bash
chainlesschain auto stats          # 自动化引擎统计
chainlesschain auto stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/61_工作流自动化引擎.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [Workflow Engine V2 →](/chainlesschain/cli-workflow)
- [Pipeline Orchestrator →](/chainlesschain/cli-pipeline)
- [Hook Manager →](/chainlesschain/cli-hook)
