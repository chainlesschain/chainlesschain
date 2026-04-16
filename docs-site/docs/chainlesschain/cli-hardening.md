# 安全加固 (hardening)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📊 **性能基线**: 收集系统性能基线数据，作为回归检测的参考
- 🔍 **回归检测**: 对比基线与当前性能，检测性能回归（可配置阈值）
- 📋 **基线列表**: 查看所有已收集的基线及采样数据
- 🛡️ **安全审计**: 运行安全加固检查，生成评分和修复建议
- 📄 **审计报告**: 查看和管理安全审计报告

## 概述

ChainlessChain CLI 安全加固模块提供性能基线管理和安全审计两大功能。`baseline` 子命令管理性能基线：`collect` 收集基线数据，`compare` 对比两个基线检测回归，`list` 查看所有基线。

回归检测使用比率阈值（ratio），当性能指标偏差超过阈值时标记为回归。`audit` 子命令运行安全加固检查，生成评分（百分制）、通过/失败项数和修复建议。`reports` 管理审计报告历史。

## 命令参考

### hardening baseline collect — 收集基线

```bash
chainlesschain hardening baseline collect <name>
chainlesschain hardening baseline collect "v1.0-baseline" -v 1.0.0
chainlesschain hardening baseline collect "release-check" -v 2.0.0
```

收集当前系统性能基线。`--version` 指定基线版本标签。

### hardening baseline compare — 对比基线

```bash
chainlesschain hardening baseline compare <baseline-id>
chainlesschain hardening baseline compare bl-001 -c bl-002
chainlesschain hardening baseline compare bl-001 --json
```

对比基线与当前性能（或另一个基线）。返回是否存在回归、回归详情和摘要。

### hardening baseline list — 基线列表

```bash
chainlesschain hardening baseline list
chainlesschain hardening baseline list --json
```

列出所有已收集的基线，显示名称、版本、状态和采样数。

### hardening audit run — 运行安全审计

```bash
chainlesschain hardening audit run <name>
chainlesschain hardening audit run "季度安全检查"
```

运行安全加固审计，返回评分、通过/失败项数、检查详情和修复建议。

### hardening audit reports — 审计报告列表

```bash
chainlesschain hardening audit reports
chainlesschain hardening audit reports --json
```

列出所有审计报告，显示名称、评分、通过和失败项数。

### hardening audit report — 查看审计报告

```bash
chainlesschain hardening audit report <audit-id>
chainlesschain hardening audit report aud-001 --json
```

查看指定审计报告的详细检查结果。

## 数据库表

| 表名 | 说明 |
|------|------|
| `performance_baselines` | 性能基线（名称、版本、状态、采样数、指标数据、创建时间） |
| `hardening_audits` | 安全审计（名称、评分、通过数、失败数、检查项、建议、创建时间） |

## 系统架构

```
用户命令 → hardening.js (Commander) → hardening-manager.js
                                             │
                ┌───────────────────────────┼───────────────────────┐
                ▼                           ▼                       ▼
          基线管理                     回归检测                 安全审计
    (收集/列出/对比)          (阈值比较/报告)          (检查/评分/建议)
                ▼                           ▼                       ▼
     performance_baselines        performance_baselines     hardening_audits
```

## 配置参考

```bash
# hardening baseline collect
<name>                         # 基线名称（必填）
-v, --version <ver>            # 基线版本标签

# hardening baseline compare
<baseline-id>                  # 基线 ID（必填）
-c, --compare <other-id>       # 对比目标基线
--json                         # JSON 输出

# hardening audit run
<name>                         # 审计名称（必填）

# hardening audit report
<audit-id>                     # 审计报告 ID
--json

# 数据库表
# - performance_baselines (基线指标)
# - hardening_audits (审计记录)
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| baseline collect 采样 | < 3s | ~2.1s | ✅ |
| baseline compare 对比 | < 500ms | ~280ms | ✅ |
| audit run 完整检查 | < 10s | ~6.5s | ✅ |
| report 读取渲染 | < 200ms | ~120ms | ✅ |
| baseline list (100 条) | < 300ms | ~150ms | ✅ |

## 测试覆盖率

```
✅ hardening.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/hardening.js` | hardening 命令主入口（baseline / audit 子命令组） |
| `packages/cli/src/lib/hardening-manager.js` | 基线采集、回归检测、安全审计核心实现 |
| `packages/cli/__tests__/unit/hardening-manager.test.js` | 核心单元测试（21 tests） |
| `packages/cli/__tests__/unit/hardening.test.js` | CLI 命令层测试 |

## 测试

```bash
npx vitest run __tests__/unit/hardening-manager.test.js
# 21 tests, all pass
```

## 使用示例

### 场景 1：性能基线管理

```bash
# 收集发布前基线
chainlesschain hardening baseline collect "pre-release" -v 1.0.0

# 发布后收集新基线
chainlesschain hardening baseline collect "post-release" -v 1.1.0

# 对比检测回归
chainlesschain hardening baseline compare bl-001 -c bl-002

# 查看所有基线
chainlesschain hardening baseline list --json
```

### 场景 2：安全审计

```bash
# 运行安全审计
chainlesschain hardening audit run "2024 Q1 安全检查"

# 查看审计报告列表
chainlesschain hardening audit reports

# 查看详细报告
chainlesschain hardening audit report aud-001 --json
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No baselines collected" | 未收集基线 | 使用 `baseline collect` 收集 |
| "No audit reports" | 未运行审计 | 使用 `audit run` 执行审计 |
| 回归误报 | 阈值过低 | 调整检测阈值参数 |
| 审计评分偏低 | 系统存在安全配置缺陷 | 按建议逐项修复 |

## 安全考虑

- **基线完整性**: 基线数据一经收集不可修改，防止篡改
- **回归自动化**: 可集成到 CI/CD 流水线，自动检测性能回归
- **审计标准化**: 安全检查项覆盖常见安全加固规范
- **建议可操作**: 每个失败项附带具体修复建议

## 相关文档

- [合规管理](./cli-compliance) — 合规框架与扫描
- [审计日志](./cli-audit) — 审计事件记录
- [SIEM 集成](./cli-siem) — 安全日志导出
