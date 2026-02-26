# 自主运维

> v1.1.0 新功能

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

## 相关文档

- [流水线编排](/chainlesschain/pipeline)
- [Cowork 多智能体协作](/chainlesschain/cowork)
