# 流水线编排系统

> v1.1.0 新功能

## 概述

流水线编排系统为 ChainlessChain 提供完整的 CI/CD 流水线管理能力，支持构建、测试、安全扫描、部署等多阶段 DAG 编排。系统内置 feature/bugfix/release 三种流水线模板，提供门控审批机制确保代码质量和安全合规，并支持实时状态监控和构建产物管理。

## 核心特性

- 🔄 **多阶段流水线**: 构建、测试、安全扫描、部署等多阶段 DAG 编排，支持并行和串行执行
- 🚦 **门控审批机制**: 关键阶段前设置人工审批门控，确保代码质量和安全合规
- 📋 **模板系统**: 预置 feature/bugfix/release 流水线模板，快速创建标准化流程
- 📊 **实时监控**: 实时跟踪流水线状态、阶段进度和耗时指标，支持事件推送
- 📦 **产物管理**: 自动收集和管理构建产物，支持 30 天保留策略

## 系统架构

```
用户/开发者
    │
    ▼
┌──────────────┐    ┌──────────────┐
│  流水线模板   │───▶│ Pipeline     │
│  (feature/   │    │ Orchestrator │
│   bugfix/    │    │  (DAG编排)   │
│   release)   │    └──────┬───────┘
└──────────────┘           │
                    ┌──────▼───────┐
                    │   阶段执行器  │
                    │  Stage Runner │
                    └──┬───┬───┬───┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 构建/测试 │ │ 门控审批  │ │ 部署/监控 │
        └──────────┘ └──────────┘ └──────────┘
                           │
                    ┌──────▼───────┐
                    │  产物管理器   │
                    │  Artifacts   │
                    └──────────────┘
```

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

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/cowork/pipeline-orchestrator.js` | DAG 流水线编排核心引擎 |
| `src/main/ai-engine/cowork/pipeline-ipc.js` | 流水线 IPC 处理器（14 个） |
| `src/main/ai-engine/cowork/requirement-parser.js` | NL→Spec JSON 需求解析 |
| `src/main/ai-engine/cowork/deploy-agent.js` | 多环境部署代理 |
| `src/main/ai-engine/cowork/post-deploy-monitor.js` | 部署后健康监控 |
| `src/main/ai-engine/cowork/rollback-manager.js` | 多策略自动回滚 |
| `src/renderer/pages/DeploymentMonitorPage.vue` | 流水线监控前端页面 |
| `src/renderer/stores/deployment.ts` | Pinia 部署状态管理 |

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 流水线卡在某阶段 | 该阶段有门控等待审批 | 检查 `dev-pipeline:gate-pending` 事件，在待审批列表中批准或拒绝 |
| 构建产物丢失 | 超过保留期限被自动清理 | 检查 `artifactRetention` 配置（默认 30 天），重要产物手动备份 |
| 并行流水线超限 | 同时运行数超过 `parallelLimit` | 等待前序流水线完成，或调整 `parallelLimit`（默认 3） |
| 阶段执行失败 | 构建/测试命令执行出错 | 通过 `dev-pipeline:get-stage-detail` 查看详细日志和错误信息 |
| 流水线创建失败 | 模板名称不存在 | 使用 `dev-pipeline:get-templates` 确认可用模板列表 |
| 门控审批后未继续 | 审批事件未正确触发 | 重新调用 `dev-pipeline:approve-gate`，确认传入正确的 gate ID |
| 指标数据为空 | 流水线尚未完成首次运行 | 至少完成一次完整流水线运行后，指标数据才会生成 |

---

## 配置参考

以下为完整配置项说明：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用流水线编排系统 |
| `defaultTemplate` | string | `"feature"` | 新建流水线时默认使用的模板（`feature` / `bugfix` / `release`） |
| `parallelLimit` | number | `3` | 同时运行的最大并行流水线数量 |
| `artifactRetention` | number | `30` | 构建产物保留天数，超期自动清理 |
| `notifications.onGatePending` | boolean | `true` | 门控等待审批时是否发送通知 |
| `notifications.onFailure` | boolean | `true` | 流水线失败时是否发送通知 |
| `stageTimeout` | number | `1800` | 单阶段最大执行时间（秒），超时自动中止 |
| `retryPolicy.maxAttempts` | number | `2` | 失败阶段自动重试次数（0 表示不重试） |
| `retryPolicy.backoffSeconds` | number | `30` | 重试前等待时间（秒） |

示例完整配置：

```json
{
  "devPipeline": {
    "enabled": true,
    "defaultTemplate": "feature",
    "parallelLimit": 3,
    "artifactRetention": 30,
    "stageTimeout": 1800,
    "retryPolicy": {
      "maxAttempts": 2,
      "backoffSeconds": 30
    },
    "notifications": {
      "onGatePending": true,
      "onFailure": true
    }
  }
}
```

---

## 性能指标

流水线编排系统在典型工作负载下的基准数据：

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 流水线创建延迟 | < 50ms | 从 `dev-pipeline:create` 调用到流水线就绪 |
| 阶段调度延迟 | < 20ms | 前序阶段完成到下一阶段启动的时间 |
| 最大并行阶段数 | 8 | 单条流水线内可同时运行的最大阶段数 |
| 最大并行流水线数 | 可配置（默认 3） | 受 `parallelLimit` 控制 |
| 产物写入吞吐 | ~200MB/s | 本地磁盘构建产物写入速度（SSD） |
| 门控通知延迟 | < 200ms | 门控触发到前端收到 `gate-pending` 事件的时间 |
| 状态推送频率 | 实时（事件驱动） | 阶段变更即时推送，无轮询开销 |
| DAG 最大节点数 | 50 个阶段 | 单条流水线支持的最大阶段数量 |

**性能调优建议**：
- 将 `parallelLimit` 设置为 CPU 核心数的一半，避免构建任务争抢资源导致整体变慢
- 对耗时超过 10 分钟的阶段设置合理的 `stageTimeout`，防止僵死阶段占用并行槽位
- 生产部署阶段建议串行执行（不设置 `parallel: true`），确保回滚时状态可追溯

---

## 测试覆盖率

| 测试类型 | 文件 | 用例数 | 覆盖场景 |
| --- | --- | --- | --- |
| 单元测试 | `tests/unit/ai-engine/pipeline-orchestrator.test.js` | 38 | DAG 编排、阶段状态机、并发控制 |
| 单元测试 | `tests/unit/ai-engine/pipeline-ipc.test.js` | 24 | 14 个 IPC 通道入参校验与响应格式 |
| 单元测试 | `tests/unit/ai-engine/pipeline-gate.test.js` | 16 | 门控审批流程、权限校验、拒绝回滚 |
| 单元测试 | `tests/unit/ai-engine/pipeline-artifacts.test.js` | 12 | 产物收集、哈希校验、保留期清理 |
| 集成测试 | `tests/integration/pipeline-e2e.test.js` | 9 | feature/bugfix/release 三模板端到端流程 |
| **合计** | — | **99** | — |

**核心测试用例**：
- `PipelineOrchestrator` — 并行阶段调度、DAG 依赖解析、失败传播与自动重试
- `GateApproval` — 审批通过后恢复执行、拒绝后标记流水线失败并通知
- `ArtifactManager` — 产物哈希校验防篡改、30 天保留期到期清理
- `MetricsCollector` — 阶段耗时统计、首次运行后指标可用性

---

## 安全考虑

1. **门控审批**: 关键阶段（部署生产、发布）强制设置人工审批门控，防止未经审查的变更上线
2. **权限控制**: 门控审批需要具备对应权限的用户操作，普通用户无法跳过审批
3. **产物完整性**: 构建产物自动计算哈希校验值，确保部署阶段使用的是未篡改的产物
4. **运行隔离**: 每条流水线在独立上下文中执行，不同流水线之间互不干扰
5. **审计日志**: 所有流水线操作（创建/启动/审批/取消）均记录到审计系统
6. **安全扫描**: release 模板内置安全扫描阶段，自动检测依赖漏洞和代码安全问题

---

## 相关文档

- [Cowork 多智能体协作](/chainlesschain/cowork)
- [自主运维](/chainlesschain/autonomous-ops)
