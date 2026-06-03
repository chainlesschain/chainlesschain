# 基础设施编排 (terraform)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📁 **工作区管理**: 查看 Terraform 工作区列表及状态
- ➕ **创建工作区**: 创建新工作区，配置 Terraform 版本和自动应用
- 📋 **执行计划**: 运行 Terraform plan/apply/destroy 操作
- 📊 **运行记录**: 查看历史运行记录，包含资源变更统计

## 概述

ChainlessChain CLI 基础设施编排模块提供 Terraform 风格的基础设施即代码（IaC）管理能力。通过 `workspaces` 管理隔离的工作空间，每个工作区独立维护状态版本和 Terraform 配置。

`create` 创建新工作区，支持指定 Terraform 版本和自动应用模式。`plan` 执行基础设施变更计划，支持 plan（预览）、apply（应用）和 destroy（销毁）三种运行类型，返回资源的新增、变更和销毁统计。`runs` 查看历史运行记录。

## 命令参考

### terraform workspaces — 工作区列表

```bash
chainlesschain terraform workspaces
chainlesschain terraform workspaces --status active
chainlesschain terraform workspaces --json
```

列出所有 Terraform 工作区，支持按状态过滤。

### terraform create — 创建工作区

```bash
chainlesschain terraform create <name>
chainlesschain terraform create "production" -d "生产环境" --tf-version 1.9.0
chainlesschain terraform create "staging" -d "测试环境" --auto-apply
```

创建 Terraform 工作区。`--tf-version` 指定 Terraform 版本（默认 1.9.0），`--auto-apply` 启用自动应用。

### terraform plan — 执行计划

```bash
chainlesschain terraform plan <workspace-id>
chainlesschain terraform plan ws-001 -t plan
chainlesschain terraform plan ws-001 -t apply
chainlesschain terraform plan ws-001 -t destroy
```

在指定工作区执行运行。运行类型：`plan`（预览变更）、`apply`（应用变更）、`destroy`（销毁资源）。

### terraform runs — 运行记录

```bash
chainlesschain terraform runs
chainlesschain terraform runs -w ws-001
chainlesschain terraform runs --json
```

列出历史运行记录，支持按工作区过滤。显示运行类型、状态和资源变更统计（+新增 ~变更 -销毁）。

## 数据库表

| 表名 | 说明 |
|------|------|
| `terraform_workspaces` | 工作区（名称、描述、Terraform 版本、自动应用、状态版本、状态） |
| `terraform_runs` | 运行记录（工作区 ID、运行类型、状态、新增/变更/销毁数、计划输出） |

## 系统架构

```
用户命令 → terraform.js (Commander) → terraform-manager.js
                                              │
                ┌────────────────────────────┼────────────────────────┐
                ▼                            ▼                        ▼
          工作区管理                    运行引擎                  记录查询
    (创建/列出/状态)          (plan/apply/destroy)          (历史/过滤)
                ▼                            ▼
     terraform_workspaces           terraform_runs
```

## 配置参考

```bash
# 命令选项
chainlesschain terraform workspaces                            # 列出工作区
chainlesschain terraform workspaces --status active --json     # 按状态过滤
chainlesschain terraform create <name> -d <desc> \
  --tf-version 1.9.0 --auto-apply                              # 创建工作区
chainlesschain terraform plan <workspace-id> -t plan|apply|destroy
chainlesschain terraform runs [-w <workspace-id>] [--json]     # 运行记录

# 相关环境变量
export TF_VERSION=1.9.0                     # 默认 Terraform 版本
export CHAINLESSCHAIN_DB_PATH=~/.chainlesschain/db.sqlite
```

## 性能指标

| 操作         | 目标    | 实际      | 状态 |
| ------------ | ------- | --------- | ---- |
| 创建工作区   | < 100ms | 20–80ms   | ✅   |
| 列出工作区   | < 50ms  | 10–40ms   | ✅   |
| 执行 plan    | < 500ms | 100–400ms | ✅   |
| 执行 apply   | < 1s    | 200–800ms | ✅   |
| 查询运行记录 | < 100ms | 20–80ms   | ✅   |

## 测试覆盖率

```
✅ terraform.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/terraform.js` — 命令实现
- `packages/cli/src/lib/terraform-manager.js` — Terraform 管理库

## 测试

```bash
npx vitest run __tests__/unit/terraform-manager.test.js
```

## 使用示例

### 场景 1：创建工作区并执行计划

```bash
# 创建生产工作区
chainlesschain terraform create "production" \
  -d "生产环境基础设施" \
  --tf-version 1.9.0

# 预览变更
chainlesschain terraform plan ws-001 -t plan

# 应用变更
chainlesschain terraform plan ws-001 -t apply

# 查看运行记录
chainlesschain terraform runs -w ws-001 --json
```

### 场景 2：多环境管理

```bash
# 创建多个工作区
chainlesschain terraform create "staging" -d "测试环境" --auto-apply
chainlesschain terraform create "production" -d "生产环境"

# 查看所有工作区
chainlesschain terraform workspaces --json

# 在测试环境执行
chainlesschain terraform plan ws-staging -t apply

# 查看所有运行记录
chainlesschain terraform runs
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No workspaces" | 未创建工作区 | 使用 `terraform create` |
| "No runs found" | 工作区无运行记录 | 使用 `terraform plan` 执行运行 |
| plan 失败 | 工作区 ID 不存在 | 使用 `terraform workspaces` 确认有效 ID |

## 安全考虑

- **工作区隔离**: 每个工作区独立维护状态，防止环境间干扰
- **状态版本控制**: 每次运行自动递增状态版本，支持回溯
- **destroy 保护**: destroy 操作需明确指定运行类型，防止误操作
- **审计记录**: 所有运行记录完整保存，支持变更审计

## 相关文档

- [安全加固](./cli-hardening) — 安全基线与审计
- [合规管理](./cli-compliance) — 合规框架
- [Docker 服务](./cli-services) — 容器化服务管理
