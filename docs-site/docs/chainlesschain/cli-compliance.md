# 合规管理 (compliance)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📋 **证据收集**: 按框架收集合规证据，支持多种证据类型和来源
- 📊 **合规报告**: 自动生成合规评估报告，包含评分和摘要
- 🏷️ **数据分类**: 自动识别敏感数据（PII、信用卡、SSN 等）并分类
- 🔍 **合规扫描**: 根据策略扫描合规态势，计算通过率
- 📜 **策略管理**: 创建和管理合规策略，按框架和严重级别过滤
- 🔐 **访问检查**: 基于 RBAC 的权限验证，检查角色对资源的操作权限

## 概述

ChainlessChain CLI 合规管理模块支持多种国际合规框架（GDPR、SOC2、HIPAA、ISO27001）。通过 `evidence` 命令收集合规证据，`report` 生成评估报告。`classify` 使用内置规则自动识别内容中的敏感数据类型。

`scan` 命令根据已配置的策略扫描当前合规状态，计算通过率和失败项。`policies` 管理合规策略库，支持按框架过滤。`check-access` 提供快速的 RBAC 权限检查，验证角色是否有权执行特定操作。

## 命令参考

### compliance evidence — 收集合规证据

```bash
chainlesschain compliance evidence <framework>
chainlesschain compliance evidence gdpr -t "data-processing" -d "用户数据处理记录" -s "audit-log"
chainlesschain compliance evidence soc2 -t "access-control" -d "访问控制策略变更"
```

按指定框架收集合规证据。支持的框架：gdpr、soc2、hipaa、iso27001。

### compliance report — 生成合规报告

```bash
chainlesschain compliance report <framework>
chainlesschain compliance report gdpr -t "2024 Q1 GDPR 评估"
chainlesschain compliance report soc2 --json
```

生成指定框架的合规评估报告，包含合规评分和摘要分析。

### compliance classify — 数据分类

```bash
chainlesschain compliance classify <content>
chainlesschain compliance classify "用户邮箱 test@example.com 和信用卡 4111-1111-1111-1111"
chainlesschain compliance classify "John's SSN is 123-45-6789" --json
```

自动识别内容中的敏感数据类型，返回分类结果和敏感度等级。

### compliance scan — 合规扫描

```bash
chainlesschain compliance scan <framework>
chainlesschain compliance scan gdpr --json
chainlesschain compliance scan hipaa
```

根据已配置策略扫描合规态势，返回通过率、通过项数和失败项数。

### compliance policies — 策略管理

```bash
chainlesschain compliance policies
chainlesschain compliance policies --framework gdpr
chainlesschain compliance policies --json
```

列出所有合规策略，支持按框架过滤。

### compliance check-access — 访问权限检查

```bash
chainlesschain compliance check-access <resource> <action> <role>
chainlesschain compliance check-access "patient-records" "read" "doctor"
chainlesschain compliance check-access "financial-data" "write" "auditor" --json
```

检查指定角色对资源的操作权限是否被授予。

## 数据库表

| 表名 | 说明 |
|------|------|
| `compliance_evidence` | 合规证据（框架、类型、描述、来源、收集时间） |
| `compliance_reports` | 合规报告（框架、标题、评分、摘要、生成时间） |
| `compliance_policies` | 合规策略（名称、类型、框架、严重级别、规则） |

## 系统架构

```
用户命令 → compliance.js (Commander) → compliance-manager.js
                                              │
                ┌────────────────────────────┼────────────────────────┐
                ▼                            ▼                        ▼
          证据收集                      报告生成                  策略引擎
    (gdpr/soc2/hipaa)              (评分/摘要)           (扫描/分类/RBAC)
                ▼                            ▼                        ▼
     compliance_evidence          compliance_reports         compliance_policies
```

## 关键文件

- `packages/cli/src/commands/compliance.js` — 命令实现
- `packages/cli/src/lib/compliance-manager.js` — 合规管理库

## 测试

```bash
npx vitest run __tests__/unit/compliance-manager.test.js
# 30 tests, all pass
```

## 使用示例

### 场景 1：GDPR 合规评估

```bash
# 收集 GDPR 证据
chainlesschain compliance evidence gdpr \
  -t "data-processing" \
  -d "用户数据处理协议已签署" \
  -s "legal-team"

chainlesschain compliance evidence gdpr \
  -t "consent" \
  -d "用户同意书收集流程已启用"

# 生成 GDPR 合规报告
chainlesschain compliance report gdpr -t "2024 年度 GDPR 评估"

# 扫描合规状态
chainlesschain compliance scan gdpr --json
```

### 场景 2：数据分类与访问控制

```bash
# 分类敏感数据
chainlesschain compliance classify "用户 ID: 12345, 邮箱: user@example.com"

# 检查访问权限
chainlesschain compliance check-access "user-data" "read" "admin"
chainlesschain compliance check-access "user-data" "delete" "viewer"

# 查看策略列表
chainlesschain compliance policies --framework hipaa
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Database not available" | 数据库未初始化 | 先运行 `chainlesschain db init` |
| 报告评分为 0 | 未收集证据 | 先使用 `evidence` 收集合规证据 |
| 扫描无策略 | 策略库为空 | 需先配置合规策略 |
| 分类结果为空 | 内容无敏感数据 | 系统仅识别已知模式（邮箱、信用卡、SSN 等） |

## 安全考虑

- **证据完整性**: 合规证据一经收集不可修改，保证审计轨迹可靠
- **报告加密**: 合规报告存储在加密数据库中，防止未授权访问
- **多框架支持**: 同时支持 GDPR、SOC2、HIPAA、ISO27001 四大框架
- **RBAC 集成**: 访问检查与系统 RBAC 权限引擎集成

## 相关文档

- [审计日志](./cli-audit) — 审计事件记录
- [权限管理](./cli-auth) — RBAC 角色与权限
- [数据防泄漏](./cli-dlp) — DLP 内容扫描
