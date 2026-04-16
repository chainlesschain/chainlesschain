# 工作流引擎 (workflow)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔄 **DAG 工作流**: 有向无环图驱动，自动检测循环依赖
- 📐 **拓扑排序执行**: 按依赖关系自动确定阶段执行顺序
- 📋 **5 种内置模板**: 数据流水线、代码审查、内容生成、员工入职、事件响应
- ⏸️ **暂停/恢复**: 支持运行中的工作流暂停和恢复
- ↩️ **回滚支持**: 工作流执行失败后支持逆向回滚
- ✅ **审批节点**: 支持 action（自动）和 approval（人工审批）两种阶段类型

## 概述

ChainlessChain CLI 工作流引擎提供基于 DAG（有向无环图）的流程编排能力。每个工作流由多个阶段（Stage）组成，阶段之间通过依赖关系连接。引擎在执行前会进行循环检测，并使用拓扑排序确定执行顺序。

系统内置 5 种常用模板，覆盖数据处理、代码审查、内容创作、HR 流程、事件响应等场景。每个阶段可以是自动执行的 action 类型或需要人工确认的 approval 类型，满足复杂业务流程需求。

## 命令参考

### workflow create — 创建工作流

```bash
chainlesschain workflow create <name>
chainlesschain workflow create "CI/CD Pipeline" -d "Build and deploy" -t data-pipeline
chainlesschain workflow create "Review" --stages '[{"name":"lint","type":"action"},{"name":"review","type":"approval"}]'
chainlesschain workflow create "Deploy" --template code-review --json
```

创建新工作流。可通过 `--template` 使用内置模板，或通过 `--stages` 传入自定义阶段定义（JSON 数组）。

### workflow list — 列出所有工作流

```bash
chainlesschain workflow list
chainlesschain workflow list --json
```

显示所有已创建的工作流及其状态。

### workflow run — 运行工作流

```bash
chainlesschain workflow run <workflow-id>
chainlesschain workflow run <id> --input '{"branch":"main"}'
chainlesschain workflow run <id> --json
```

启动指定工作流的一次执行。可通过 `--input` 传入执行参数。

### workflow status — 查看执行状态

```bash
chainlesschain workflow status <execution-id>
chainlesschain workflow status <id> --json
```

查看某次工作流执行的详细状态，包括各阶段进度、输出、耗时等。

### workflow pause — 暂停执行

```bash
chainlesschain workflow pause <execution-id>
```

暂停正在运行的工作流执行，保留当前阶段进度。

### workflow resume — 恢复执行

```bash
chainlesschain workflow resume <execution-id>
```

恢复已暂停的工作流执行，从暂停点继续。

### workflow rollback — 回滚执行

```bash
chainlesschain workflow rollback <execution-id>
chainlesschain workflow rollback <id> --json
```

回滚已完成或失败的工作流执行，逆序撤销各阶段操作。

### workflow templates — 列出内置模板

```bash
chainlesschain workflow templates
chainlesschain workflow templates --json
```

列出所有内置工作流模板及其包含的阶段定义。

### workflow delete — 删除工作流

```bash
chainlesschain workflow delete <workflow-id>
```

删除指定工作流及其所有执行记录。

## 内置模板

| 模板 ID | 名称 | 阶段数 | 说明 |
|---------|------|--------|------|
| `data-pipeline` | 数据流水线 | 4 | 采集 → 清洗 → 转换 → 加载 |
| `code-review` | 代码审查 | 3 | 静态分析 → 人工审查 → 合并 |
| `content-generation` | 内容生成 | 3 | 草稿 → 审核 → 发布 |
| `employee-onboarding` | 员工入职 | 5 | 信息收集 → 账号创建 → 权限 → 培训 → 确认 |
| `incident-response` | 事件响应 | 4 | 检测 → 分类 → 处置 → 复盘 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `workflows` | 工作流定义（名称、描述、阶段配置、DAG 结构） |
| `workflow_executions` | 执行记录（状态、输入输出、各阶段进度、耗时） |

## 系统架构

```
用户命令 → workflow.js (Commander) → workflow-engine.js
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
                    DAG 验证器       拓扑排序执行器     模板引擎
                   (循环检测)        (依赖调度)       (5 种模板)
                         │                │                │
                         ▼                ▼                ▼
                    workflows 表   workflow_executions 表
```

## 关键文件

- `packages/cli/src/commands/workflow.js` — 命令实现
- `packages/cli/src/lib/workflow-engine.js` — 工作流引擎库

## 使用示例

### 场景 1：使用内置模板创建 ETL 流水线

```bash
# 从模板创建工作流
chainlesschain workflow create --name "daily-etl" \
  --template data-pipeline

# 查看工作流详情
chainlesschain workflow list --json

# 执行工作流
chainlesschain workflow run <workflow-id> \
  --input '{"source":"sales_db","target":"warehouse"}'

# 查看执行状态
chainlesschain workflow status <execution-id>
```

### 场景 2：自定义审批流程

```bash
# 创建包含审批节点的 DAG
chainlesschain workflow create --name "code-deploy" \
  --stages '[
    {"id":"build","name":"Build","type":"action","next":["test"]},
    {"id":"test","name":"Test","type":"action","next":["review"]},
    {"id":"review","name":"Review","type":"approval","next":["deploy"]},
    {"id":"deploy","name":"Deploy","type":"action","next":[]}
  ]'
```

### 场景 3：故障回滚

```bash
# 执行失败后回滚
chainlesschain workflow rollback <execution-id>

# 暂停正在运行的工作流
chainlesschain workflow pause <execution-id>

# 修复后恢复执行
chainlesschain workflow resume <execution-id>
```

## 故障排查

### DAG 验证失败

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Invalid DAG: cycle detected" | stage 的 `next` 引用形成环 | 检查 DAG 拓扑，确保无循环依赖 |
| "Invalid DAG: missing reference" | `next` 引用了不存在的 stage ID | 核对所有 stage ID 是否一致 |
| "Invalid DAG: empty stages" | stages 数组为空 | 至少提供一个 stage |
| 工作流执行卡住 | approval 类型的 stage 等待人工审批 | 使用 `workflow resume` 通过审批节点 |

### 常见错误

```bash
# 错误: "Workflow not found"
# 原因: workflow-id 不存在
# 修复: 查看可用工作流
chainlesschain workflow list

# 错误: "Execution already completed"
# 原因: 尝试暂停/恢复已完成的执行
# 修复: 创建新的执行
chainlesschain workflow run <workflow-id>

# 错误: "Cannot rollback: no stages executed"
# 原因: 工作流还没开始执行
# 修复: 确认执行已开始且有可回滚的 stage
chainlesschain workflow status <execution-id>
```

## 配置参考

```bash
# 命令选项
chainlesschain workflow create <name> [-d <desc>] [-t <template>] [--stages <json>]
chainlesschain workflow list [--json]
chainlesschain workflow run <workflow-id> [--input <json>] [--json]
chainlesschain workflow status <execution-id> [--json]
chainlesschain workflow pause <execution-id>
chainlesschain workflow resume <execution-id>
chainlesschain workflow rollback <execution-id> [--json]
chainlesschain workflow templates [--json]
chainlesschain workflow delete <workflow-id>

# 相关环境变量
export CHAINLESSCHAIN_WORKFLOW_TIMEOUT=300000   # 单 stage 超时（毫秒）
export CHAINLESSCHAIN_DB_PATH=~/.chainlesschain/db.sqlite
```

## 性能指标

| 操作              | 目标    | 实际      | 状态 |
| ----------------- | ------- | --------- | ---- |
| DAG 验证（环检测） | < 50ms  | 5–30ms    | ✅   |
| 拓扑排序          | < 20ms  | 1–10ms    | ✅   |
| 创建工作流        | < 100ms | 20–80ms   | ✅   |
| 启动执行          | < 200ms | 50–150ms  | ✅   |
| 单 stage 调度开销 | < 50ms  | 10–30ms   | ✅   |
| 回滚执行          | < 500ms | 100–400ms | ✅   |

## 测试覆盖率

```
✅ workflow.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- **DAG 完整性**: 工作流 DAG 在创建时进行 DFS 环检测，防止无限循环执行
- **审批门控制**: `approval` 类型 stage 强制人工确认，防止自动化流程中的误操作
- **输入验证**: 工作流输入参数应在 action handler 中进行验证，避免注入攻击
- **执行日志审计**: 每次执行的所有 stage 结果都写入 `workflow_executions.log` 字段，支持事后审计
- **回滚安全**: 回滚操作按逆拓扑序撤销 stage，确保数据一致性

## 相关文档

- [Hook 管理](./cli-hook) — 生命周期事件钩子
- [A2A 协议](./cli-a2a) — 智能体间协作
- [自进化系统](./cli-evolution) — AI 自我诊断与修复
