# 工作流自动化引擎 CLI（Phase 96）

> `chainlesschain automation`（别名 `auto`）— SaaS 连接器 + 触发器 + DAG 工作流编排。
>
> 12 个 SaaS 连接器 + 5 种触发器类型 + DAG 拓扑排序 + 条件分支执行。

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
└──────────────────────────────────────────────────────┘
```

数据流：`create` flow → `add-trigger` → `activate` → 触发器触发 → DAG 执行 → 写 `executions` → `logs`。

---

## 配置参考

| 配置项                          | 含义                | 默认         |
| ------------------------------- | ------------------- | ------------ |
| `maxConcurrentExecutions`       | 并发执行数          | 10           |
| `executionTimeoutMs`            | 单次执行超时        | 300000 ms    |
| `logRetentionDays`              | 日志保留天数        | 30           |
| `maxStepsPerFlow`               | 单工作流最大步骤    | 100          |
| V2 `perOwnerActiveAutomationCap`| 每 owner 活跃工作流 | ~20          |
| V2 `perAutomationRunningExecCap`| 每工作流运行中执行  | ~10          |
| V2 `autoPauseIdleAfterMs`       | 闲置自动暂停阈值    | 86400000 ms  |

查看：`chainlesschain auto config`、`auto trigger-types`、`auto statuses`。

---

## 性能指标

| 指标                        | 典型值        |
| --------------------------- | ------------- |
| 创建工作流                  | < 20 ms       |
| 添加触发器                  | < 15 ms       |
| DAG 拓扑排序（20 节点）     | < 10 ms       |
| 手动 execute（含连接器调用）| 依赖外部服务  |
| V2 createExecV2 dispatch    | < 50 ms       |
| V2 cap (default)            | per-owner 20 active / per-auto 10 running |

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

---

## 故障排查

**Q: 触发器 fire 了但执行未启动?**

1. 确认 flow 已 `activate`（`draft/paused` 状态不会执行）
2. 检查 `auto show <flow-id>` 的 DAG 是否有孤立节点
3. 查看 `auto logs <flow-id>` 获取具体错误

**Q: 定时任务未按计划触发?**

1. 验证 cron 表达式语法（`auto schedule <id> --cron` 传入后会解析）
2. 是否超过 `maxConcurrentExecutions`（触发器会跳过并记录）
3. V2 下检查是否被 `auto-pause-idle` 自动暂停

**Q: 连接器调用失败?**

1. 先运行连接器自带的 health check（通过 `execute` 单步测试）
2. 检查凭证是否过期（OAuth token refresh）
3. 查看 `logs --limit 10 --json` 的响应状态码

---

## 关键文件

- `packages/cli/src/commands/automation.js` — Commander 子命令（~924 行）
- `packages/cli/src/lib/automation-engine.js` — DAG 引擎与连接器
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

# 分享与模板
chainlesschain auto share <flow-id> --public
chainlesschain auto templates                           # 列出模板
chainlesschain auto import-template <template-id>       # 导入模板
```

---

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
