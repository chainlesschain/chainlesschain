# 自主运维

> v1.1.0 新功能

## 概述

自主运维系统为 ChainlessChain 提供自动化故障检测与修复能力。系统包含多维阈值告警引擎、P0-P3 四级事故分类管理、预定义 Playbook 自动修复策略、修复失败自动回滚机制，以及 AI 驱动的根因分析和事故报告生成。

## 核心特性

- 🚨 **事故管理**: P0-P3 四级优先级分类，状态跟踪与自动升级
- 🔧 **Playbook 修复**: 预定义修复策略，自动触发执行修复步骤
- 📊 **多维告警**: CPU/内存/错误率等可配置阈值告警
- ↩️ **自动回滚**: 修复失败自动回滚到安全状态
- 📝 **事故报告**: AI 生成根因分析、时间线与改进建议

## 系统架构

```
┌──────────────────────────────────────────────────┐
│                自主运维系统                         │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ Alert    │  │ Incident │  │ Playbook     │   │
│  │ Engine   │  │ Manager  │  │ Executor     │   │
│  │ (告警)   │  │ (事故)   │  │ (自动修复)    │   │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘   │
│       │              │               │             │
│  ┌────▼──────────────▼───────────────▼─────────┐  │
│  │         Remediation Engine                  │  │
│  │   检测异常 → 匹配Playbook → 执行修复        │  │
│  │        → 验证恢复 → 失败则回滚              │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │                               │
│  ┌──────────┐  ┌───▼──────┐  ┌────────────────┐  │
│  │ Baseline │  │ Rollback │  │ Postmortem    │  │
│  │ Manager  │  │ Engine   │  │ Generator     │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 系统概述

自主运维系统（Autonomous Ops）提供智能化的事故检测、自动修复、告警管理和事故报告能力，实现 AI 驱动的运维自动化。

### 核心能力

- **事故管理**：P0-P3 优先级分类、状态跟踪、自动升级
- **Playbook 自动修复**：预定义修复策略，自动触发执行
- **告警系统**：CPU/内存/错误率等多维度告警，可配置阈值
- **自动回滚**：修复失败时自动回滚到安全状态
- **事故报告**：AI 生成根因分析、时间线、改进建议

## IPC 通道

| 通道                      | 说明               |
| ------------------------- | ------------------ |
| `ops:get-incidents`       | 获取事故列表       |
| `ops:get-incident-detail` | 获取事故详情       |
| `ops:acknowledge`         | 确认事故           |
| `ops:resolve`             | 解决事故           |
| `ops:get-playbooks`       | 获取 Playbook 列表 |
| `ops:create-playbook`     | 创建 Playbook      |
| `ops:trigger-remediation` | 触发修复           |
| `ops:rollback`            | 回滚操作           |
| `ops:get-alerts`          | 获取告警列表       |
| `ops:configure-alerts`    | 配置告警规则       |
| `ops:generate-postmortem` | 生成事故报告       |
| `ops:get-baseline`        | 获取性能基线       |
| `ops:update-baseline`     | 更新性能基线       |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "autonomousOps": {
    "enabled": true,
    "alertThresholds": {
      "cpu": 80,
      "memory": 85,
      "errorRate": 5
    },
    "autoRemediation": true,
    "rollbackOnFailure": true,
    "postmortemAutoGenerate": false,
    "sla": {
      "P0": { "responseMins": 5, "resolveMins": 30 },
      "P1": { "responseMins": 15, "resolveMins": 120 },
      "P2": { "responseMins": 60, "resolveMins": 480 },
      "P3": { "responseMins": 240, "resolveMins": 1440 }
    }
  }
}
```

## 使用示例

### 事故处理流程

1. 系统检测到异常，自动创建事故并发出告警
2. 运维人员在「自主运维」页面查看事故列表
3. 点击「确认」标记事故已知
4. 选择合适的 Playbook 点击「修复」
5. 系统自动执行修复步骤
6. 修复成功则自动标记为已解决；失败则自动回滚
7. 点击「报告」生成事故报告

### Playbook 示例

- **CPU 过载修复**：检查进程 → 终止异常进程 → 验证 CPU 恢复
- **内存泄漏修复**：识别泄漏进程 → 重启服务 → 验证内存回收
- **服务不可用修复**：健康检查 → 重启服务 → 验证可用性 → 通知

## 故障排除

| 问题                   | 解决方案                       |
| ---------------------- | ------------------------------ |
| 修复 Playbook 执行失败 | 检查 Playbook 步骤配置和权限   |
| 告警过多               | 调整告警阈值，避免误报         |
| 事故报告缺少根因       | 确保事故有足够的日志和监控数据 |

### 自动修复执行失败详细排查

**现象**: Playbook 触发后步骤执行失败，事故未能自动解决。

**排查步骤**:
1. 通过 `ops:get-incident-detail` 查看事故详情和修复执行日志
2. 确认 Playbook 中的每个步骤是否有足够的系统权限（如重启服务需要管理员权限）
3. 检查 `autoRemediation` 是否为 `true`，以及 `rollbackOnFailure` 是否开启
4. 若修复步骤涉及外部服务（如 Docker 重启），确认相关服务可用
5. 修复失败后系统会自动回滚，查看回滚结果确认系统恢复到安全状态

### 告警误报过多

**现象**: 系统频繁触发告警，但实际服务运行正常。

**排查步骤**:
1. 检查 `alertThresholds` 配置，CPU/内存/错误率阈值是否设置过低
2. 确认是否存在短暂的瞬时波动触发了告警（建议设置持续时间窗口）
3. 通过 `ops:get-baseline` 查看性能基线，确认基线数据是否准确反映正常状态
4. 更新基线数据（`ops:update-baseline`）以匹配当前系统的正常运行状态
5. 对于已知的安全波动（如定时任务峰值），添加维护窗口或白名单规则

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/cowork/incident-classifier.js` | 事故分类与优先级判定 |
| `desktop-app-vue/src/main/ai-engine/cowork/auto-remediator.js` | Playbook 自动修复引擎 |
| `desktop-app-vue/src/main/ai-engine/cowork/rollback-manager.js` | 回滚管理器 |
| `desktop-app-vue/src/main/ai-engine/cowork/alert-manager.js` | 告警规则与通知 |
| `desktop-app-vue/src/main/ai-engine/cowork/postmortem-generator.js` | 事故报告生成 |
| `desktop-app-vue/src/main/ai-engine/cowork/anomaly-detector.js` | 异常检测引擎 |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 自动修复误操作导致服务中断 | 修复策略过于激进或匹配规则不精确 | 启用 `dryRun` 模式验证，收紧修复规则匹配条件 |
| 告警风暴大量重复告警 | 告警去重窗口过短或阈值过低 | 增大 `deduplicationWindow`，调整告警阈值 |
| 资源检测误报频繁 | 基线数据不准确或采样间隔过长 | 重新采集基线 `ops baseline-reset`，缩短采样间隔 |
| 自动扩缩容未触发 | 扩缩容策略条件未满足或权限不足 | 检查策略条件表达式，确认服务账号权限 |
| 事后报告生成不完整 | 关联数据源缺失或时间窗口不匹配 | 检查数据源连接，扩大报告时间范围 |

### 常见错误修复

**错误: `AUTO_REMEDIATION_FAILED` 自动修复执行失败**

```bash
# 查看修复历史和失败原因
chainlesschain evolution ops-history --status failed

# 以 dry-run 模式重新执行修复
chainlesschain evolution ops-remediate --incident-id <id> --dry-run
```

**错误: `ALERT_STORM_DETECTED` 告警风暴**

```bash
# 临时静默告警（15 分钟）
chainlesschain evolution ops-silence --duration 15m

# 调整去重窗口
chainlesschain evolution ops-config --dedup-window 300s
```

**错误: `FALSE_POSITIVE_ANOMALY` 异常检测误报**

```bash
# 重置基线数据
chainlesschain evolution ops-baseline-reset --metric <metric-name>

# 调整检测灵敏度
chainlesschain evolution ops-config --sensitivity medium
```

## 安全考虑

1. **Playbook 权限控制**: 修复 Playbook 中的命令应限制在允许的操作范围内，禁止执行任意系统命令
2. **回滚安全性**: 回滚操作前自动保存当前状态快照，确保回滚本身可逆
3. **告警防误报**: 合理设置告警阈值和持续时间窗口，避免瞬时波动触发不必要的自动修复
4. **事故升级策略**: P0/P1 高优先级事故应同时通知人工运维人员，不完全依赖自动修复
5. **修复操作审计**: 所有自动修复操作记录完整日志，包括执行时间、修复步骤和结果
6. **SLA 合规**: 配置的 SLA 响应时间和解决时间应符合业务要求，定期审查调整
7. **访问控制**: 事故管理和 Playbook 配置界面应限制为运维角色访问
8. **敏感数据保护**: 事故报告和日志中可能包含敏感系统信息，导出前应进行脱敏处理
9. **基线更新审核**: 性能基线的更新应经过审核，防止恶意篡改基线导致异常检测失效

## 相关文档

- [流水线编排](/chainlesschain/pipeline)
- [Cowork 多智能体协作](/chainlesschain/cowork)
