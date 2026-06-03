# BI 商业智能引擎 (bi)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 💬 **自然语言查询**: NL→SQL 自动转换，用中文/英文提问即可查数据
- 📊 **仪表盘创建**: 多组件布局的数据仪表盘，支持自定义 widget
- 📄 **报表生成**: 自动生成 PDF / Excel 格式的数据报表
- ⏰ **定时报表**: 基于 cron 表达式的报表定时生成与推送
- 🔍 **异常检测**: Z-score 统计异常检测，自动发现数据偏离
- 📈 **趋势预测**: 线性回归模型，预测指标未来变化趋势

## 概述

ChainlessChain CLI BI 引擎为系统运营数据提供商业智能分析能力。核心功能是自然语言查询——用户以自然语言描述问题，系统自动转换为 SQL 语句执行，并根据数据特征推荐合适的可视化类型（柱状图、折线图、饼图等）。

仪表盘功能支持将多个查询结果组合为统一的数据面板，每个 widget 可独立配置数据源和展示方式。报表系统支持 PDF 和 Excel 两种格式，可通过 cron 表达式配置定时生成。内置 Z-score 异常检测算法可自动发现偏离正常范围的数据点，线性回归模型可预测指标未来走势。

## 命令参考

### bi query — 自然语言查询

```bash
chainlesschain bi query <question>
chainlesschain bi query "最近 7 天新增了多少笔记"
chainlesschain bi query "哪个标签的笔记最多" --json
chainlesschain bi query "本月 AI 对话次数趋势"
```

将自然语言问题转换为 SQL 查询并执行。返回生成的 SQL、结果行数和推荐的可视化类型。

### bi dashboard — 创建仪表盘

```bash
chainlesschain bi dashboard <name>
chainlesschain bi dashboard "运营概览" --widgets '[{"type":"counter","query":"SELECT COUNT(*) FROM notes"}]'
chainlesschain bi dashboard "AI 分析" --layout '{"columns":2}' --json
```

创建数据仪表盘。通过 `--widgets` 定义组件（支持 counter、chart、table 等类型），`--layout` 设置布局方式。

### bi report — 生成报表

```bash
chainlesschain bi report <name>
chainlesschain bi report "月度总结" --format pdf
chainlesschain bi report "数据导出" --format excel --json
```

生成数据报表，支持 PDF 和 Excel 两种格式。报表内容基于预定义查询或仪表盘数据。

### bi schedule — 定时报表

```bash
chainlesschain bi schedule <report-name> --cron "0 9 * * 1"    # 每周一 9:00
chainlesschain bi schedule "日报" --cron "0 18 * * *"          # 每天 18:00
chainlesschain bi schedule list --json
```

为报表设置定时生成计划，使用标准 cron 表达式。`schedule list` 查看所有已配置的定时任务。

### bi anomaly — 异常检测

```bash
chainlesschain bi anomaly <metric>
chainlesschain bi anomaly "daily_notes_count" --threshold 2.0    # Z-score 阈值
chainlesschain bi anomaly "ai_response_time" --json
```

对指定指标执行 Z-score 异常检测。`--threshold` 设置 Z-score 阈值（默认 2.0），超过阈值的数据点标记为异常。

### bi predict — 趋势预测

```bash
chainlesschain bi predict <metric>
chainlesschain bi predict "weekly_active_users" --horizon 4     # 预测未来 4 个周期
chainlesschain bi predict "storage_usage" --json
```

使用线性回归模型预测指标未来趋势。`--horizon` 设置预测周期数。

### bi templates — 查看模板

```bash
chainlesschain bi templates
chainlesschain bi templates --json
```

列出所有内置报表模板，包括运营概览、AI 使用分析、知识库统计、安全审计、性能监控 5 种。

## 内置模板

| 模板 ID | 名称 | 说明 |
|---------|------|------|
| `ops-overview` | 运营概览 | 笔记数、会话数、用户活跃度 |
| `ai-analytics` | AI 使用分析 | 对话次数、响应时间、模型使用分布 |
| `knowledge-stats` | 知识库统计 | 笔记分类、标签分布、增长趋势 |
| `security-audit` | 安全审计 | 登录尝试、权限变更、异常操作 |
| `performance` | 性能监控 | 响应延迟、资源占用、错误率 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `bi_dashboards` | 仪表盘定义（名称、组件配置、布局、创建者） |
| `bi_reports` | 报表记录（名称、格式、内容、生成时间） |
| `bi_scheduled` | 定时任务（报表名、cron 表达式、最后执行时间、状态） |

## 系统架构

```
用户命令 → bi.js (Commander) → bi-engine.js
                                    │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
          NL→SQL 转换器      仪表盘/报表引擎      分析引擎
         (自然语言解析)     (PDF/Excel 生成)   (异常+预测)
                │                  │                  │
                ▼                  ▼                  ▼
           查询结果缓存      bi_dashboards       Z-score 检测
                             bi_reports          线性回归模型
                             bi_scheduled
```

## 配置参考

```bash
chainlesschain bi <subcommand> [options]

子命令:
  query <question>                  自然语言查询（NL→SQL）
  dashboard <name>                  创建仪表盘
  report <name>                     生成报表
  schedule <report-name>            配置定时报表
  anomaly <metric>                  Z-score 异常检测
  predict <metric>                  线性回归趋势预测
  templates                         列出 5 个内置模板

选项:
  --widgets <json>                  dashboard 组件 JSON 数组
  --layout <json>                   dashboard 布局配置
  --format <fmt>                    报表格式 pdf|excel（默认 pdf）
  --cron <expr>                     5 段 cron 表达式（定时任务）
  --threshold <float>               Z-score 阈值（默认 2.0）
  --horizon <int>                   预测周期数
  --json                            JSON 输出
```

存储位置: SQLite `bi_dashboards` / `bi_reports` / `bi_scheduled` 表。内置模板: ops-overview / ai-analytics / knowledge-stats / security-audit / performance。

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| NL→SQL 转换 | < 500ms | ~200ms | ✅ |
| query 执行（万级数据） | < 1s | ~400ms | ✅ |
| dashboard 创建（含 widgets） | < 200ms | ~80ms | ✅ |
| report PDF 生成 | < 2s | ~900ms | ✅ |
| Z-score 异常检测（1000 点） | < 100ms | ~30ms | ✅ |
| 线性回归预测（horizon=4） | < 50ms | ~15ms | ✅ |

## 测试覆盖率

```
✅ bi.test.js  - 覆盖 bi CLI 的主要路径
  ├── 参数解析 / 选项验证（--widgets / --format / --cron / --threshold）
  ├── 正常路径（query/dashboard/report/schedule/anomaly/predict）
  ├── 错误处理 / 边界情况（样本不足、无效 cron、模板 ID 不存在）
  └── JSON 输出格式
```

## 关键文件

- `packages/cli/src/commands/bi.js` — 命令实现
- `packages/cli/src/lib/bi-engine.js` — BI 引擎库

## 使用示例

### 场景 1：自然语言查询

```bash
# 用自然语言进行数据查询
chainlesschain bi query "显示上个月的月度收入趋势"

# 查看生成的 SQL 和结果
chainlesschain bi query "哪些产品销量最高" --json
```

### 场景 2：仪表板与报告

```bash
# 使用模板创建仪表板
chainlesschain bi dashboard create --name "KPI Overview" \
  --template tpl-kpi

# 生成 PDF 报告
chainlesschain bi report create --name "Monthly Sales" \
  --query "SELECT month, SUM(revenue) FROM sales GROUP BY month" \
  --format pdf

# 设置定时报告（每周一早上 9 点）
chainlesschain bi schedule create --report-id <id> \
  --cron "0 9 * * 1" \
  --recipients "team@example.com"

# 查看所有模板
chainlesschain bi templates
```

### 场景 3：异常检测与趋势预测

```bash
# Z-score 异常检测
chainlesschain bi anomaly --metric sales \
  --data '[100,105,98,102,250,103,99]'
# → 检测到 250 为异常值 (z-score > 2)

# 线性回归趋势预测
chainlesschain bi predict --metric revenue \
  --data '[100,120,135,150,170]' \
  --periods 3
# → 预测未来 3 期的收入趋势
```

## 故障排查

### 查询与报告问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| NL→SQL 生成的 SQL 语法错误 | 自然语言描述不够明确 | 使用更具体的表述，如 "按月统计收入" 而非 "收入情况" |
| "Dashboard not found" | dashboard-id 不存在 | 使用 `bi dashboard list` 查看可用仪表板 |
| 报告生成为空 | 查询结果为空集 | 先测试查询语句是否有数据返回 |
| 定时报告未执行 | cron 表达式格式错误 | 使用标准 5 段 cron 格式：`分 时 日 月 周` |
| 异常检测无结果 | 数据样本太少 | 至少需要 3 个以上数据点才能计算 Z-score |

### 常见错误

```bash
# 错误: "Insufficient data for anomaly detection"
# 原因: 数据点不足 3 个
# 修复: 提供更多历史数据
chainlesschain bi anomaly --metric cpu --data '[10,20,30,150,25,18]'

# 错误: "Template not found"
# 原因: 模板 ID 不存在
# 修复:
chainlesschain bi templates

# 错误: "Invalid cron expression"
# 修复: 使用标准 cron 格式，如 "0 9 * * 1" 表示每周一 9:00
```

## 安全考虑

- **SQL 注入防护**: NL→SQL 转换使用参数化查询，用户输入不会直接拼接到 SQL 语句中
- **数据权限**: 查询仅能访问当前用户有权限的数据表，遵循 RBAC 权限控制
- **报告加密**: 生成的 PDF/Excel 报告存储在加密数据库中，不以明文保存在磁盘上
- **定时任务安全**: 定时报告的收件人列表需要手动配置，防止信息自动发送到未授权地址
- **异常检测透明度**: 所有异常检测结果包含完整的统计参数（均值、标准差、Z-score），支持人工复核

## 相关文档

- [自进化系统](./cli-evolution) — AI 能力数据分析
- [审计日志](./cli-audit) — 审计数据源
- [工作流引擎](./cli-workflow) — 报表生成流程自动化
