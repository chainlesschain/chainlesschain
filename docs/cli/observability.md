# CLI — Observability & Code Intelligence

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: Code Generation Agent (Phase 86), AIOps (Phase 25), Multimodal Perception
> (Phase 84), Database Evolution (Phase 80), Federation Hardening (Phase 58),
> Natural Language Programming (Phase 28), Model Quantization (Phase 20).

## Code Generation Agent (Phase 86)

```bash
chainlesschain codegen templates [--json]                                       # 列出脚手架模板 (react/vue/express/fastapi/spring_boot)
chainlesschain codegen severities [--json]                                      # 列出评审严重级别
chainlesschain codegen rules [--json]                                           # 列出安全规则 (eval/sql_injection/xss/path_traversal/command_injection)
chainlesschain codegen platforms [--json]                                       # 列出 CI/CD 平台
chainlesschain codegen generate -p <prompt> [-l lang] [-f framework] [--code <code>] [--files N] [--tokens N]
chainlesschain codegen show <id> [--json]                                       # 查看生成详情
chainlesschain codegen list [-l lang] [-f framework] [--limit N] [--json]       # 列出代码生成记录
chainlesschain codegen review -c <code> [-g generation-id] [-l lang] [--json]   # 启发式安全代码评审
chainlesschain codegen review-show <id> [--json]                                # 查看评审详情与问题列表
chainlesschain codegen reviews [-l lang] [--limit N] [--json]                   # 列出代码评审
chainlesschain codegen scaffold -t <template> -n <name> [-o opts-json] [--files N] [--output path] [--json]
chainlesschain codegen scaffold-show <id> [--json]                              # 查看脚手架详情
chainlesschain codegen scaffolds [-t template] [--limit N] [--json]             # 列出脚手架
chainlesschain codegen stats [--json]                                           # 代码生成 Agent 统计
```

## Autonomous Ops / AIOps (Phase 25)

```bash
chainlesschain ops severities [--json]                                           # 列出严重级别 (P0-P3)
chainlesschain ops statuses [--json]                                             # 列出事件状态
chainlesschain ops algorithms [--json]                                           # 列出检测算法 (z_score/iqr)
chainlesschain ops rollback-types [--json]                                       # 列出回滚类型 (git/docker/config/service/custom)
chainlesschain ops baseline-update <metric> -v <csv-values> [--json]             # 根据样本值更新指标基线
chainlesschain ops baseline-show <metric> [--json]                               # 查看指标基线 (mean/stddev/Q1/Q3)
chainlesschain ops baselines [--json]                                            # 列出指标基线
chainlesschain ops detect <metric> <value> [-a z_score|iqr] [--json]             # 检测指标值是否异常
chainlesschain ops incident-create [-m metric] [-s P0-P3] [-d desc] [--json]     # 手动创建事件
chainlesschain ops incident-show <id> [--json]                                   # 查看事件详情
chainlesschain ops incident-ack <id> [--json]                                    # 确认事件
chainlesschain ops incident-resolve <id> [--json]                                # 解决事件
chainlesschain ops incident-close <id> [--json]                                  # 关闭已解决的事件
chainlesschain ops incidents [-s severity] [-S status] [--limit N] [--json]      # 列出事件
chainlesschain ops playbook-create -n <name> [-t trigger-json] [-s steps-json] [--json]
chainlesschain ops playbook-show <id> [--json]                                   # 查看 playbook 详情
chainlesschain ops playbook-toggle <id> <on|off> [--json]                        # 启用或禁用 playbook
chainlesschain ops playbook-record <id> <success|failure> [--json]               # 记录 playbook 执行结果
chainlesschain ops playbooks [-e|--enabled] [-d|--disabled] [--limit N] [--json] # 列出 playbook
chainlesschain ops postmortem <id> [--json]                                      # 为已解决事件生成事后复盘
chainlesschain ops stats [--json]                                                # AIOps 统计
```

### Phase 25 V2 — Playbook Maturity + Remediation Lifecycle

4-state playbook maturity (`draft` / `active` / `deprecated` / `retired`) + 5-state
remediation lifecycle (`pending` / `executing` / `succeeded` / `failed` / `aborted`),
per-owner active-playbook cap, per-owner pending-remediation cap, auto-retire stale
playbooks, auto-timeout stuck remediations. Legacy `ops` surface above is unchanged.

```bash
chainlesschain ops playbook-maturities-v2 | remediation-lifecycles-v2
chainlesschain ops default-max-active-playbooks-per-owner | max-active-playbooks-per-owner |
      set-max-active-playbooks-per-owner <n>
chainlesschain ops default-max-pending-remediations-per-owner | max-pending-remediations-per-owner |
      set-max-pending-remediations-per-owner <n>
chainlesschain ops default-playbook-stale-ms | playbook-stale-ms | set-playbook-stale-ms <ms>
chainlesschain ops default-remediation-timeout-ms | remediation-timeout-ms |
      set-remediation-timeout-ms <ms>
chainlesschain ops active-playbook-count [-o owner]
chainlesschain ops pending-remediation-count [-o owner]
chainlesschain ops register-playbook-v2 <playbook-id> -o <owner> [-n name] [-i initial-status] [-m metadata-json]
chainlesschain ops playbook-v2 <playbook-id>
chainlesschain ops set-playbook-maturity-v2 <playbook-id> <status> [-r reason] [-m metadata-json]
chainlesschain ops activate-playbook <playbook-id> [-r reason]
chainlesschain ops deprecate-playbook-v2 <playbook-id> [-r reason]
chainlesschain ops retire-playbook <playbook-id> [-r reason]
chainlesschain ops touch-playbook-activity <playbook-id>
chainlesschain ops submit-remediation-v2 <remediation-id> -o <owner> -p <playbook> [-i incident] [-m metadata-json]
chainlesschain ops remediation-v2 <remediation-id>
chainlesschain ops set-remediation-status-v2 <remediation-id> <status> [-r reason] [-m metadata-json]
chainlesschain ops start-remediation <remediation-id> [-r reason]
chainlesschain ops complete-remediation <remediation-id> [-r reason]
chainlesschain ops fail-remediation <remediation-id> [-r reason]
chainlesschain ops abort-remediation <remediation-id> [-r reason]
chainlesschain ops auto-retire-stale-playbooks
chainlesschain ops auto-timeout-stuck-remediations
chainlesschain ops stats-v2 [--json]
```

## Multimodal Perception Engine (Phase 84)

```bash
chainlesschain perception modalities [--json]                                    # 列出模态 (screen/voice/document/video)
chainlesschain perception voice-statuses [--json]                                # 列出语音会话状态
chainlesschain perception analysis-types [--json]                                # 列出分析类型 (ocr/object_detection/scene_recognition/action_detection)
chainlesschain perception record -m <modality> [-a analysis-type] [-i source] [-r result-json] [-c confidence] [--json]
chainlesschain perception show <id> [--json]                                     # 查看感知结果详情
chainlesschain perception results [-m modality] [-a analysis-type] [--limit N] [--json]
chainlesschain perception voice-start [-l language] [-m model] [--json]          # 启动语音会话
chainlesschain perception voice-status <id> <status> [--json]                    # 更新语音会话状态
chainlesschain perception voice-transcript <id> <text> [--json]                  # 设置语音会话转写
chainlesschain perception voice-show <id> [--json]                               # 查看语音会话详情
chainlesschain perception voice-sessions [-s status] [-l language] [--limit N] [--json]
chainlesschain perception index-add -m <modality> -s <source-id> [-c summary] [-t tags-csv] [--json]
chainlesschain perception index-show <id> [--json]                               # 查看索引条目详情
chainlesschain perception index-list [-m modality] [--limit N] [--json]          # 列出索引条目
chainlesschain perception index-remove <id> [--json]                             # 移除索引条目
chainlesschain perception query <text> [-m modalities-csv] [--limit N] [--json]  # 跨模态搜索
chainlesschain perception context [--json]                                       # 查看感知上下文
chainlesschain perception stats [--json]                                         # 感知引擎统计
```

## Database Evolution Framework (Phase 80)

```bash
chainlesschain dbevo migration-statuses [--json]                                 # 列出迁移状态 (success/failed/rolled_back)
chainlesschain dbevo directions [--json]                                         # 列出迁移方向 (up/down)
chainlesschain dbevo suggestion-types [--json]                                   # 列出索引建议类型
chainlesschain dbevo register <version> -u <up-sql> [-d <down-sql>] [--description text] [--json]
chainlesschain dbevo registered [--json]                                         # 列出已注册迁移
chainlesschain dbevo validate [--json]                                           # 校验迁移 (空洞、缺失 down)
chainlesschain dbevo status [--json]                                             # 查看当前迁移状态
chainlesschain dbevo up [-t version] [--json]                                    # 向上迁移 (应用待执行项)
chainlesschain dbevo down [-t version] [--json]                                  # 回滚迁移
chainlesschain dbevo history [--limit N] [--json]                                # 查看迁移历史
chainlesschain dbevo query-log <sql> <duration-ms> [-s source] [-p params-json] [--json]
chainlesschain dbevo query-stats [--json]                                        # 查询统计 (慢查询、平均/最大耗时)
chainlesschain dbevo slow-threshold <ms> [--json]                                # 设置慢查询阈值
chainlesschain dbevo query-clear [--json]                                        # 清空查询日志
chainlesschain dbevo analyze [--min-count N] [--json]                            # 分析慢查询 → 索引建议
chainlesschain dbevo suggestions [-a|--applied] [-p|--pending] [--json]          # 列出索引建议
chainlesschain dbevo suggestion-show <id> [--json]                               # 查看建议详情
chainlesschain dbevo apply <id> [--json]                                         # 应用索引建议
chainlesschain dbevo stats [--json]                                              # 数据库演进统计
```

### Phase 80 V2 — Schema Baseline + Migration Run 状态机

在原有 migration CRUD / query log / suggestion 基础上追加 V2 面：两条平行状态机 `SCHEMA_BASELINE_V2` (5 态：draft/validated/active/deprecated/retired) + `MIGRATION_RUN_V2` (5 态：queued/running/applied/failed/rolled_back；**2 个终态** failed/rolled_back；含 applied→rolled_back 恢复路径)。每 database 单 ACTIVE baseline 上限 + 每 database 单 RUNNING migration run 上限。`startedAt` 首次 RUNNING 跃迁一次性戳记并跨 applied→rolled_back 恢复路径保持。

**配置默认值**:
```
DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB   = 1
DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB = 1
DBEVO_DEFAULT_BASELINE_IDLE_MS              = 180 * 86400000   // 180 天
DBEVO_DEFAULT_MIGRATION_STUCK_MS            = 30 * 60000       // 30 分钟
```

**枚举 + 配置**:
```bash
cc dbevo schema-baselines-v2                                                     # 5 态
cc dbevo migration-runs-v2                                                       # 5 态
cc dbevo default-max-active-baselines-per-db | max-active-baselines-per-db | set-max-active-baselines-per-db <n>
cc dbevo default-max-running-migrations-per-db | max-running-migrations-per-db | set-max-running-migrations-per-db <n>
cc dbevo default-baseline-idle-ms | baseline-idle-ms | set-baseline-idle-ms <ms>
cc dbevo default-migration-stuck-ms | migration-stuck-ms | set-migration-stuck-ms <ms>
cc dbevo active-baseline-count [-d database]                                     # 仅 ACTIVE 计数
cc dbevo running-migration-count [-d database]                                   # 仅 RUNNING 计数
```

**Baseline 生命周期（throws on cap / invalid transition / terminal initial）**:
```bash
cc dbevo register-baseline-v2 <baseline-id> -d <database> -v <version> [-i initial] [--metadata json]
cc dbevo baseline-v2 <baseline-id>
cc dbevo set-baseline-status-v2 <baseline-id> <status> [-r reason] [--metadata json]
cc dbevo validate-baseline | activate-baseline | deprecate-baseline | retire-baseline <baseline-id> [-r reason]
cc dbevo touch-baseline-activity <baseline-id>                                   # 推进 lastTouchedAt
```

**Migration Run 生命周期（throws on cap / invalid transition / invalid direction）**:
```bash
cc dbevo enqueue-migration-run-v2 <run-id> -d <database> -m <migration-id> --direction up|down [--metadata json]
cc dbevo migration-run-v2 <run-id>
cc dbevo set-migration-run-status-v2 <run-id> <status> [-r reason] [--metadata json]
cc dbevo start-migration-run | apply-migration-run | fail-migration-run | rollback-migration-run <run-id> [-r reason]
```

**批量 auto-flip + 统计**:
```bash
cc dbevo auto-retire-idle-baselines          # DRAFT/VALIDATED/DEPRECATED → RETIRED（lastTouchedAt 超时）
cc dbevo auto-fail-stuck-migration-runs      # 仅 RUNNING → FAILED；基于 startedAt
cc dbevo stats-v2                            # 全枚举零初始化
```

> **未移植**: 真实 DDL 执行 (CLI 仅记录状态跃迁)；fluent QueryBuilder；EXPLAIN 查询计划分析；启动时自动迁移；迁移前数据库备份；周期性后台索引优化。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (baseline 成熟度 + 带 applied→rolled_back 恢复路径的 migration-run)、双维度上限 (per-db ACTIVE baseline + per-db RUNNING run)、throwing `registerBaselineV2`/`enqueueMigrationRunV2` + 8 shortcuts (stamp-once `startedAt` 跨恢复路径保持)、`touchBaselineActivity` + 2 批量 auto-flip、全枚举零初始化 `getDbEvoStatsV2`。

## Federation Hardening (Phase 58)

```bash
chainlesschain federation circuit-states [--json]                                # 列出熔断器状态 (closed/open/half_open)
chainlesschain federation health-statuses [--json]                               # 列出健康状态 (healthy/degraded/unhealthy/unknown)
chainlesschain federation health-metrics [--json]                                # 列出健康检查指标类型
chainlesschain federation register <node-id> [-f threshold] [-s success-threshold] [-t open-timeout-ms] [-m metadata-json] [--json]
chainlesschain federation remove <node-id> [--json]                              # 移除节点 (级联删除健康检查)
chainlesschain federation breaker-show <node-id> [--json]                        # 查看熔断器状态
chainlesschain federation breakers [-s state] [--limit N] [--json]               # 列出熔断器
chainlesschain federation failure <node-id> [--json]                             # 记录失败 (可能触发熔断)
chainlesschain federation success <node-id> [--json]                             # 记录成功 (可能恢复熔断)
chainlesschain federation half-open <node-id> [--json]                           # 尝试 open → half_open 转换
chainlesschain federation reset <node-id> [--json]                               # 重置熔断器到 closed
chainlesschain federation check <node-id> -t <type> -s <status> [-m metrics-json] [--json]
chainlesschain federation check-show <check-id> [--json]                         # 查看健康检查详情
chainlesschain federation checks [-n node] [-t type] [-s status] [--limit N] [--json]
chainlesschain federation node-health <node-id> [--json]                         # 聚合节点健康度
chainlesschain federation pool-init <node-id> [--min N] [--max N] [--idle-timeout ms] [--json]
chainlesschain federation pool-acquire <node-id> [--json]                        # 获取连接
chainlesschain federation pool-release <node-id> [--json]                        # 释放连接
chainlesschain federation pool-stats <node-id> [--json]                          # 查看连接池统计
chainlesschain federation pools [--json]                                         # 列出所有连接池
chainlesschain federation pool-destroy <node-id> [--json]                        # 销毁连接池
chainlesschain federation stats [--json]                                         # 联邦强化统计
```

## Natural Language Programming (Phase 28)

```bash
chainlesschain nlprog intents [--json]                                           # 列出 9 种意图类型
chainlesschain nlprog statuses [--json]                                          # 列出翻译状态 (draft/complete/refined)
chainlesschain nlprog style-categories [--json]                                  # 列出 6 种风格分析类别
chainlesschain nlprog classify <text> [--json]                                   # 启发式意图分类 (支持中英文)
chainlesschain nlprog extract <text> [--json]                                    # 提取实体 (引号/PascalCase/中文名词)
chainlesschain nlprog detect-stack <text> [--json]                               # 检测技术栈
chainlesschain nlprog translate <text> [-i intent] [-s spec-json] [-a ambiguities-json] [--json]
chainlesschain nlprog show <id> [--json]                                         # 查看翻译详情
chainlesschain nlprog list [-i intent] [-s status] [--limit N] [--json]          # 列出翻译记录
chainlesschain nlprog status <id> <status> [--json]                              # 更新翻译状态
chainlesschain nlprog refine <id> [-s spec-json] [-a ambiguities-json] [--json]  # 精化翻译规格
chainlesschain nlprog remove <id> [--json]                                       # 删除翻译
chainlesschain nlprog convention-add -c <category> -p <pattern> [-e examples-json] [-f confidence] [-s source-files-json] [--json]
chainlesschain nlprog convention-show <id> [--json]                              # 查看惯例详情
chainlesschain nlprog conventions [-c category] [--limit N] [--json]             # 列出项目惯例
chainlesschain nlprog convention-remove <id> [--json]                            # 删除惯例
chainlesschain nlprog stats [--json]                                             # NL Programming 统计
```

### Phase 28 V2 — Spec Maturity + Dialogue Turn Lifecycle

V2 strictly additive in-memory surface. 5-state spec maturity (draft/refining/approved/implemented/archived; implemented is non-active for cap-counting) + 4-state dialogue-turn lifecycle (pending/answered/dismissed/escalated with `escalated→answered` recovery path). Per-author active-spec cap, per-spec pending-turn cap, auto-archive idle specs, auto-dismiss stale pending turns.

```bash
# Enum catalog
cc nlprog spec-maturities-v2 | dialogue-turn-lifecycles-v2

# Config (per-author / per-spec caps, idle/pending timeouts)
cc nlprog default-max-active-specs-per-author | max-active-specs-per-author | set-max-active-specs-per-author <n>
cc nlprog default-max-pending-turns-per-spec  | max-pending-turns-per-spec  | set-max-pending-turns-per-spec <n>
cc nlprog default-spec-idle-ms    | spec-idle-ms    | set-spec-idle-ms <ms>
cc nlprog default-turn-pending-ms | turn-pending-ms | set-turn-pending-ms <ms>

# Counts
cc nlprog active-spec-count [-a <author>]
cc nlprog pending-turn-count [-s <spec>]

# Spec lifecycle
cc nlprog register-spec-v2 <spec-id> -a <author> [-t <title>] [-i <initial-status>] [-m <metadata>]
cc nlprog spec-v2 <spec-id>
cc nlprog set-spec-maturity-v2 <spec-id> <status> [-r <reason>] [-m <metadata>]
cc nlprog refine-spec | approve-spec | implement-spec | archive-spec <spec-id> [-r <reason>]
cc nlprog touch-spec-activity <spec-id>

# Dialogue turn lifecycle (escalated turns kept for human review — not auto-dismissed)
cc nlprog register-dialogue-turn-v2 <turn-id> -s <spec> [-R <role>] [-q <question>] [-i <initial>] [-m <metadata>]
cc nlprog dialogue-turn-v2 <turn-id>
cc nlprog set-dialogue-turn-status-v2 <turn-id> <status> [-a <answer>] [-r <reason>] [-m <metadata>]
cc nlprog answer-turn <turn-id> -a <answer> [-r <reason>]
cc nlprog dismiss-turn | escalate-turn <turn-id> [-r <reason>]

# Bulk auto-flips (use current clock)
cc nlprog auto-archive-idle-specs
cc nlprog auto-dismiss-stale-pending-turns

# All-enum-key zero-init stats
cc nlprog stats-v2
```

Defaults: 30 active specs/author, 20 pending turns/spec, 45d idle, 7d turn-pending. 102 tests cover legacy + V2.

## Model Quantization (Phase 20)

```bash
chainlesschain quantize statuses [--json]                                        # 列出任务状态 (pending/running/completed/failed/cancelled)
chainlesschain quantize types [--json]                                           # 列出量化类型 (gguf/gptq)
chainlesschain quantize levels [--json]                                          # 列出 14 级 GGUF 量化级别
chainlesschain quantize gptq-bits [--json]                                       # 列出 GPTQ 位宽 (2/3/4/8)
chainlesschain quantize create -i <path> -t <gguf|gptq> [-l level] [-o path] [-c config-json] [--json]
chainlesschain quantize start <id> [--json]                                      # 启动待处理任务 (模拟)
chainlesschain quantize progress <id> <percent> [--json]                         # 更新进度 (0-100)
chainlesschain quantize complete <id> [-o path] [-s bytes] [--json]              # 标记完成
chainlesschain quantize fail <id> [-e message] [--json]                          # 标记失败
chainlesschain quantize cancel <id> [--json]                                     # 取消任务
chainlesschain quantize delete <id> [--json]                                     # 删除非运行任务
chainlesschain quantize show <id> [--json]                                       # 查看任务详情
chainlesschain quantize list [-s status] [-t type] [--limit N] [--json]          # 列出量化任务
chainlesschain quantize stats [--json]                                           # 量化统计
```

### Phase 20 V2 — Model Maturity + Job Ticket Lifecycle

V2 strictly additive in-memory surface. 4-state model maturity (onboarding/active/deprecated/retired) + 5-state job-ticket lifecycle (queued/running/completed/failed/canceled, 3 terminals). Per-owner active-model cap, per-owner running-job cap, auto-retire idle models (active/deprecated), auto-fail stuck running tickets. `startedAt` stamped once on first RUNNING transition.

```bash
# Enum catalog
cc quantize model-maturities-v2 | job-ticket-lifecycles-v2

# Config (per-owner caps, idle/stuck timeouts)
cc quantize default-max-active-models-per-owner | max-active-models-per-owner | set-max-active-models-per-owner <n>
cc quantize default-max-running-jobs-per-owner  | max-running-jobs-per-owner  | set-max-running-jobs-per-owner <n>
cc quantize default-model-idle-ms | model-idle-ms | set-model-idle-ms <ms>
cc quantize default-job-stuck-ms  | job-stuck-ms  | set-job-stuck-ms <ms>

# Counts
cc quantize active-model-count [-o <owner>]
cc quantize running-job-count [-o <owner>]

# Model lifecycle
cc quantize register-model-v2 <model-id> -o <owner> [-f <family>] [-i <initial-status>] [-m <metadata>]
cc quantize model-v2 <model-id>
cc quantize set-model-maturity-v2 <model-id> <status> [-r <reason>] [-m <metadata>]
cc quantize activate-model | deprecate-model | retire-model <model-id> [-r <reason>]
cc quantize touch-model-usage <model-id>

# Job ticket lifecycle
cc quantize enqueue-job-ticket-v2 <ticket-id> -o <owner> -M <model> -t <type> [-l <level>] [-m <metadata>]
cc quantize job-ticket-v2 <ticket-id>
cc quantize set-job-ticket-status-v2 <ticket-id> <status> [-r <reason>] [-m <metadata>]
cc quantize start-job-ticket | complete-job-ticket | fail-job-ticket | cancel-job-ticket <ticket-id> [-r <reason>]

# Bulk auto-flips (use current clock)
cc quantize auto-retire-idle-models
cc quantize auto-fail-stuck-job-tickets

# All-enum-key zero-init stats
cc quantize stats-v2
```

Defaults: 50 active models/owner, 3 running jobs/owner, 120d idle, 6h stuck. 86 tests cover legacy + V2.
