# 开发流水线编排 CLI（Phase 26）

> `chainlesschain pipeline`（别名 `pipe`）— AI 开发流水线的 7 阶段全生命周期管理。
>
> 4 种模板 + 6 种部署策略 + 双门审批 + 制品管理 + 监控记录。

---

## 概述

Pipeline 模块编排 AI 辅助的开发流水线，覆盖从需求分析到生产监控的完整流程。
7 个阶段：需求 → 架构 → 编码 → 测试 → 审查 → 部署 → 监控。
内置 feature/bugfix/refactor/security-audit 四种模板。

---

## 核心特性

- **7 阶段全生命周期** — 需求 → 架构 → 编码 → 测试 → 审查 → 部署 → 监控
- **4 种模板** — feature / bugfix / refactor / security-audit，一条命令创建
- **6 种部署策略** — blue-green / canary / rolling / recreate / shadow / dark-launch
- **双门审批** — 每个 gate（如 code-review、security-review）需显式 approve，带理由追踪
- **制品管理** — 支持 binary / docker-image / report / log 等类型，关联到 pipeline
- **监控记录** — 每个 metric 事件（error_rate / latency / cpu 等）持久化，可做回归
- **V2 治理层** — 41 V2 tests；4 态 pipeline（archived terminal, paused↔active）+ 5 态 run lifecycle

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│         chainlesschain pipeline (Phase 26)            │
├──────────────────────────────────────────────────────┤
│  Template Library                                     │
│  feature / bugfix / refactor / security-audit         │
├──────────────────────────────────────────────────────┤
│  7-Stage DAG                                          │
│  req → arch → code → test → review → deploy → mon    │
├──────────────────────────────────────────────────────┤
│  Approval Gates      │  Artifact Store                │
│  code-review /       │  binary / docker / report      │
│  security-review     │                                │
├──────────────────────────────────────────────────────┤
│  Deployment Mgr      │  Monitoring Log                │
│  6 strategies        │  metric/value events           │
│  rollback            │                                │
├──────────────────────────────────────────────────────┤
│  SQLite: pipelines / artifacts / deploys / monitors   │
└──────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                 | 含义                    | 默认              |
| ---------------------- | ----------------------- | ----------------- |
| 模板                   | feature/bugfix/refactor/security-audit | |
| 阶段                   | 7 stages (req → monitor) |                  |
| 部署策略               | blue-green/canary/rolling/recreate/shadow/dark-launch | |
| 状态                   | created/running/paused/completed/failed/cancelled | |
| V2 per-owner active cap| per memory 文件         | 10                |
| V2 per-pipeline run cap| per memory 文件         | 20                |
| V2 auto-pause-idle     |                         | 见 `pipeline_orchestrator_v2_cli.md` |

查看：`chainlesschain pipe config`、`pipe stages`、`pipe deploy-strategies`、`pipe statuses`。

---

## 性能指标

| 操作                          | 典型耗时           |
| ----------------------------- | ------------------ |
| create（从模板）              | < 30 ms            |
| start / pause / resume        | < 10 ms            |
| stage 推进                    | < 15 ms            |
| approve / reject gate         | < 10 ms            |
| artifact-add                  | < 15 ms            |
| deploy 启动（不含实际部署）   | < 20 ms            |
| V2 createRunV2 dispatch       | < 50 ms            |

---

## 测试覆盖率

```
__tests__/unit/pipeline-orchestrator.test.js — 67 tests (672 lines)
```

覆盖：create 从 4 种模板、start/pause/resume/cancel/complete/fail/retry 状态机、
stage 顺序推进、gate approve/reject、artifact add/query、deploy 6 种策略 + rollback、
monitor-record + monitor-status。V2 surface：41 V2 tests（见 `pipeline_orchestrator_v2_cli.md`）。

---

## 安全考虑

1. **gate 审批不可绕过** — 未 approve 的 gate 不能推进到下一 stage
2. **部署回滚幂等** — `rollback <deploy-id>` 只对已部署的记录生效，可重复调用
3. **artifact 不可篡改** — 加入后只能追加新版本，不能修改历史
4. **监控事件留痕** — 所有 metric 事件不可删除，便于故障复盘
5. **V2 治理** — per-owner 活跃流水线上限防止资源滥用，auto-pause-idle 自动休眠长时间无操作的流水线

---

## 故障排查

**Q: `stage <id> testing` 报 gate not approved?**

1. 前一阶段需要的 gate 必须先 `approve`
2. 查看 `pipe show <id>` 的当前 gate 状态
3. reject 后需重新 `retry` 或重置

**Q: `deploy --strategy canary` 卡住?**

1. CLI 侧 deploy 只是记录策略；实际部署由外部执行方处理
2. 检查 `deploy-show <deploy-id>` 的状态字段
3. 可直接 `rollback <deploy-id>` 还原

**Q: V2 下 createPipelineV2 报 cap exceeded?**

1. `pipe gov-stats-v2` 查看当前 owner 的活跃流水线数
2. archive 不需要的流水线腾出 cap
3. 调整 V2 配置中的 `perOwnerActivePipelineCap`

---

## 关键文件

- `packages/cli/src/commands/pipeline.js` — Commander 子命令（~505 行）
- `packages/cli/src/lib/pipeline-orchestrator.js` — 7 阶段 DAG + deploy + monitor
- `packages/cli/__tests__/unit/pipeline-orchestrator.test.js` — 单测（67 tests）
- 数据表：`pipelines` / `pipeline_artifacts` / `pipeline_deploys` / `pipeline_monitors`
- 设计文档：`docs/design/modules/26_开发流水线编排.md`

---

## 使用示例

```bash
# 1. 从模板创建 + 启动
pid=$(chainlesschain pipe create --name "用户认证" --template feature --json | jq -r .id)
chainlesschain pipe start $pid

# 2. 阶段推进 + 双门审批
chainlesschain pipe stage $pid code
chainlesschain pipe stage $pid review
chainlesschain pipe approve $pid --gate code-review

# 3. 制品 + 部署（canary）
chainlesschain pipe artifact-add $pid --name build.zip --type binary --path ./dist/build.zip
chainlesschain pipe deploy $pid --strategy canary --target production

# 4. 监控 + 回滚
chainlesschain pipe monitor-record $pid --metric error_rate --value 0.02
chainlesschain pipe rollback <deploy-id>

# 5. 统计 + V2 治理
chainlesschain pipe stats --json
chainlesschain pipe gov-stats-v2
```

---

## 目录/枚举

```bash
chainlesschain pipe config              # 查看配置常量
chainlesschain pipe templates           # 列出流水线模板
chainlesschain pipe stages              # 列出 7 个阶段
chainlesschain pipe deploy-strategies   # 列出部署策略（blue-green/canary/rolling 等）
chainlesschain pipe statuses            # 列出流水线状态
```

---

## 流水线生命周期

```bash
# 创建流水线（从模板）
chainlesschain pipe create --name "用户认证" --template feature

# 启动 / 暂停 / 恢复 / 取消 / 完成 / 失败 / 重试
chainlesschain pipe start <pipeline-id>
chainlesschain pipe pause <pipeline-id>
chainlesschain pipe resume <pipeline-id>
chainlesschain pipe cancel <pipeline-id>
chainlesschain pipe complete <pipeline-id>
chainlesschain pipe fail <pipeline-id> --reason "测试未通过"
chainlesschain pipe retry <pipeline-id>

# 查看 / 列出
chainlesschain pipe show <pipeline-id>
chainlesschain pipe list
chainlesschain pipe list --json
```

---

## 阶段管理 & 审批

```bash
# 推进到指定阶段
chainlesschain pipe stage <pipeline-id> testing

# 双门审批
chainlesschain pipe approve <pipeline-id> --gate code-review
chainlesschain pipe reject <pipeline-id> --gate code-review --reason "安全问题"
```

---

## 制品 & 部署

```bash
# 添加制品
chainlesschain pipe artifact-add <pipeline-id> --name "build.zip" --type binary --path ./dist/build.zip
chainlesschain pipe artifacts <pipeline-id>

# 部署
chainlesschain pipe deploy <pipeline-id> --strategy canary --target production
chainlesschain pipe deploys <pipeline-id>
chainlesschain pipe deploy-show <deploy-id>
chainlesschain pipe rollback <deploy-id>
```

---

## 监控 & 导出

```bash
# 记录监控事件
chainlesschain pipe monitor-record <pipeline-id> --metric error_rate --value 0.02
chainlesschain pipe monitor-events <pipeline-id>
chainlesschain pipe monitor-status <pipeline-id>

# 导出流水线数据
chainlesschain pipe export <pipeline-id> --format json
```

---

## 统计

```bash
chainlesschain pipe stats          # 流水线统计
chainlesschain pipe stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/26_开发流水线编排.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [Workflow Engine →](/chainlesschain/cli-workflow)
- [Automation →](/chainlesschain/cli-automation)
- [Codegen →](/chainlesschain/cli-codegen)
