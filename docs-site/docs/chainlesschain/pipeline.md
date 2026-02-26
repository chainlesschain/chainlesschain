# 流水线编排系统

> v1.1.0 新功能

## 系统概述

流水线编排系统（Dev Pipeline）为 ChainlessChain 提供完整的 CI/CD 流水线管理能力，支持多阶段编排、门控审批、自动化部署和指标监控。

### 核心能力

- **多阶段流水线**：支持构建、测试、安全扫描、部署等多阶段编排
- **门控审批**：关键阶段前设置人工审批门控，确保质量
- **模板系统**：预置流水线模板，快速创建标准化流程
- **实时监控**：实时跟踪流水线状态、阶段进度、耗时指标
- **产物管理**：自动收集和管理构建产物

## IPC 通道

| 通道                            | 说明           |
| ------------------------------- | -------------- |
| `dev-pipeline:create`           | 创建流水线     |
| `dev-pipeline:start`            | 启动流水线     |
| `dev-pipeline:pause`            | 暂停流水线     |
| `dev-pipeline:resume`           | 恢复流水线     |
| `dev-pipeline:cancel`           | 取消流水线     |
| `dev-pipeline:get-status`       | 获取流水线状态 |
| `dev-pipeline:get-all`          | 获取所有流水线 |
| `dev-pipeline:approve-gate`     | 批准门控       |
| `dev-pipeline:reject-gate`      | 拒绝门控       |
| `dev-pipeline:get-artifacts`    | 获取构建产物   |
| `dev-pipeline:get-stage-detail` | 获取阶段详情   |
| `dev-pipeline:get-metrics`      | 获取指标       |
| `dev-pipeline:get-templates`    | 获取模板列表   |
| `dev-pipeline:configure`        | 更新配置       |

### 事件通道

| 事件                         | 说明         |
| ---------------------------- | ------------ |
| `dev-pipeline:stage-updated` | 阶段状态变更 |
| `dev-pipeline:gate-pending`  | 门控等待审批 |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "devPipeline": {
    "enabled": true,
    "defaultTemplate": "feature",
    "parallelLimit": 3,
    "artifactRetention": 30,
    "notifications": {
      "onGatePending": true,
      "onFailure": true
    }
  }
}
```

## 使用示例

### 创建并启动流水线

1. 打开「流水线监控」页面
2. 点击「新建流水线」按钮
3. 选择模板（如 `feature`、`bugfix`、`release`）
4. 流水线自动按阶段执行
5. 遇到门控阶段时，在待审批列表中进行审批

### 流水线模板

- **feature**：代码检查 → 构建 → 单元测试 → 集成测试 → 部署预发 → 审批 → 部署生产
- **bugfix**：构建 → 测试 → 审批 → 热修复部署
- **release**：完整构建 → 全量测试 → 安全扫描 → 审批 → 发布

## 故障排除

| 问题             | 解决方案                                      |
| ---------------- | --------------------------------------------- |
| 流水线卡在某阶段 | 检查阶段日志，确认是否有门控等待审批          |
| 构建产物丢失     | 检查 `artifactRetention` 配置，默认保留 30 天 |
| 并行流水线超限   | 调整 `parallelLimit` 配置                     |

## 相关文档

- [Cowork 多智能体协作](/chainlesschain/cowork)
- [自主运维](/chainlesschain/autonomous-ops)
