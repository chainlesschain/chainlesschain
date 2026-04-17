# CLI — Observability & Code Intelligence

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: Code Generation Agent (Phase 86), AIOps (Phase 25), Multimodal Perception
> (Phase 84), Database Evolution (Phase 80), Federation Hardening (Phase 58).

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
