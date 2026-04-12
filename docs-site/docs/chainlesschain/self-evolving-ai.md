# 自进化 AI 系统

> **Phase 100 | v5.0.1 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表**

ChainlessChain 自进化 AI 系统实现了 AI 模型的自主进化能力，包括自动架构搜索（NAS for Edge）、持续学习（无灾难性遗忘）、自诊断与自修复、行为预测与主动服务、能力自评估与自动升级，并通过进化成长日志可视化追踪 AI 的演进轨迹。

## 概述

自进化 AI 系统是 ChainlessChain 的智能演进引擎，使 AI 模型具备自主进化能力。该系统通过定期能力评估发现薄弱维度，自动触发 EWC/蒸馏增量训练提升能力，同时内置自诊断与自修复机制保障模型质量，并基于用户行为预测实现主动服务，完整的进化成长日志支持可视化追踪 AI 的每一步演进。

## 核心特性

- 🧠 **自动架构搜索（NAS for Edge）**: 针对边缘设备自动搜索最优模型架构，平衡精度与推理速度，支持 ONNX/TFLite 导出
- 📚 **持续学习（无灾难性遗忘）**: 基于 EWC（弹性权重巩固）+ 知识蒸馏的增量学习方案，新知识不覆盖旧知识
- 🔧 **自诊断与自修复**: 自动检测模型退化（精度下降/延迟升高/异常输出），触发自修复流程（重训练/回滚/降级）
- 🔮 **行为预测与主动服务**: 基于用户行为序列预测下一步操作，提前准备资源、预加载数据、主动推荐
- 📊 **能力自评估与自动升级**: 定期评估模型在各维度的能力得分，低于阈值时自动触发升级流程
- 📈 **进化成长日志**: 完整记录 AI 每次进化的触发原因、变更内容、效果对比，支持时间线可视化

## 系统架构

```
┌─────────────────────────────────────────────────┐
│           SelfEvolvingAIManager                 │
│    (调度 / 配置 / 进化成长日志 / 模型导出)       │
└───┬──────┬──────┬──────┬──────┬────────────────┘
    │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────────┐
│ NAS  ││持续  ││自诊断││行为  ││ 能力     │
│ 架构 ││学习  ││自修复││预测  ││ 评估     │
│ 搜索 ││(EWC) ││引擎  ││引擎  ││ + 升级   │
└──┬───┘└──┬───┘└──┬───┘└──┬───┘└────┬─────┘
   │       │       │       │         │
   ▼       ▼       ▼       ▼         ▼
┌─────────────────────────────────────────────────┐
│  SQLite 持久化 (assessments / training_logs /    │
│  growth_log) + ONNX/TFLite 模型导出              │
└─────────────────────────────────────────────────┘
```

---

## 关键文件

| 文件                                                    | 职责                         |
| ------------------------------------------------------- | ---------------------------- |
| `src/main/ai-engine/evolution/self-evolving-manager.js` | 自进化核心管理器             |
| `src/main/ai-engine/evolution/capability-assessor.js`   | 多维度能力评估               |
| `src/main/ai-engine/evolution/continual-learner.js`     | EWC/蒸馏增量学习             |
| `src/main/ai-engine/evolution/self-diagnosis.js`        | 自诊断与自修复引擎           |
| `src/main/ai-engine/evolution/behavior-predictor.js`    | 用户行为预测与主动服务       |
| `src/main/ai-engine/evolution/evolution-ipc.js`         | IPC 处理器（8 个）           |
| `src/renderer/pages/ai/EvolutionDashboardPage.vue`      | 进化成长日志可视化页面       |
| `src/renderer/stores/evolution.ts`                      | Pinia 状态管理               |

---

## 能力评估流程

```
定时评估任务
    │
    ▼
┌──────────────┐    评分 ≥ 阈值    ┌──────────┐
│  能力评估    │ ─────────────────▶ │  记录日志 │
│  (多维度)    │                    └──────────┘
└──────┬───────┘
       │ 评分 < 阈值
       ▼
┌──────────────┐    成功    ┌──────────────┐
│  自动升级    │ ─────────▶ │  A/B 验证    │
│  (增量训练)  │            │  + 灰度发布  │
└──────┬───────┘            └──────┬───────┘
       │ 失败                      │ 通过
       ▼                           ▼
┌──────────────┐            ┌──────────────┐
│  自诊断      │            │  正式发布    │
│  + 自修复    │            │  + 记录进化  │
└──────────────┘            └──────────────┘
```

---

## 能力评估

```javascript
// 评估 AI 当前各维度能力
const assessment = await window.electron.ipcRenderer.invoke(
  "evolution:assess-capability",
  {
    dimensions: [
      "reasoning",
      "coding",
      "writing",
      "translation",
      "summarization",
      "qa",
    ],
    benchmarkSuite: "standard-v2",
    sampleSize: 100,
  },
);
// assessment = {
//   modelId: "chainless-ai-v4.5",
//   timestamp: 1710000000,
//   overall: 0.87,
//   dimensions: [
//     { name: "reasoning", score: 0.91, threshold: 0.85, status: "pass", trend: "+0.03" },
//     { name: "coding", score: 0.89, threshold: 0.85, status: "pass", trend: "+0.05" },
//     { name: "writing", score: 0.85, threshold: 0.85, status: "borderline", trend: "-0.01" },
//     { name: "translation", score: 0.82, threshold: 0.85, status: "below", trend: "-0.04" },
//     { name: "summarization", score: 0.93, threshold: 0.85, status: "pass", trend: "+0.02" },
//     { name: "qa", score: 0.84, threshold: 0.85, status: "borderline", trend: "0.00" },
//   ],
//   recommendations: [
//     { dimension: "translation", action: "incremental-training", priority: "high" },
//     { dimension: "qa", action: "data-augmentation", priority: "medium" },
//   ]
// }
```

## 增量训练

```javascript
// 触发无灾难性遗忘的增量训练
const training = await window.electron.ipcRenderer.invoke(
  "evolution:train-incremental",
  {
    targetDimensions: ["translation", "qa"],
    strategy: "ewc", // "ewc" (弹性权重巩固) | "distillation" (知识蒸馏) | "replay" (经验回放)
    dataSource: {
      type: "curated", // "curated" | "user-feedback" | "synthetic"
      samples: 5000,
    },
    constraints: {
      maxDegradation: 0.02, // 其他维度最大允许退化 2%
      maxDuration: 3600000, // 最大训练时长 1h
      deviceTarget: "edge", // "edge" | "cloud" | "hybrid"
    },
  },
);
// training = {
//   trainingId: "train-001",
//   status: "completed",
//   duration: 2400000,
//   results: {
//     translation: { before: 0.82, after: 0.88, improvement: "+0.06" },
//     qa: { before: 0.84, after: 0.87, improvement: "+0.03" },
//     reasoning: { before: 0.91, after: 0.90, degradation: "-0.01", withinLimit: true },
//   },
//   modelVersion: "chainless-ai-v4.5.1",
//   exportFormats: ["onnx", "tflite"]
// }
```

## 自诊断

```javascript
// AI 系统自诊断
const diagnosis = await window.electron.ipcRenderer.invoke(
  "evolution:self-diagnose",
  {
    checks: [
      "accuracy",
      "latency",
      "memory",
      "output-quality",
      "hallucination-rate",
    ],
  },
);
// diagnosis = {
//   status: "degraded",
//   issues: [
//     {
//       check: "latency",
//       status: "warning",
//       current: 1200,
//       baseline: 800,
//       message: "推理延迟较基线升高 50%",
//       suggestedFix: "quantize-model",
//     },
//     {
//       check: "hallucination-rate",
//       status: "critical",
//       current: 0.08,
//       baseline: 0.03,
//       message: "幻觉率异常升高",
//       suggestedFix: "rollback-to-stable",
//     },
//   ],
//   healthy: ["accuracy", "memory", "output-quality"]
// }
```

## 自修复

```javascript
// 根据诊断结果执行自修复
const repair = await window.electron.ipcRenderer.invoke(
  "evolution:self-repair",
  {
    issues: ["latency", "hallucination-rate"],
    strategy: "auto", // "auto" | "rollback" | "retrain" | "quantize" | "degrade-gracefully"
    dryRun: false,
  },
);
// repair = {
//   repairId: "repair-001",
//   actions: [
//     { issue: "latency", action: "quantize-model", status: "completed", result: "延迟从 1200ms 降至 650ms" },
//     { issue: "hallucination-rate", action: "rollback-to-stable", status: "completed", result: "回滚至 v4.5.0，幻觉率恢复至 0.03" },
//   ],
//   newModelVersion: "chainless-ai-v4.5.0-patched",
//   verificationPassed: true
// }
```

## 行为预测

```javascript
// 预测用户下一步行为并主动准备
const prediction = await window.electron.ipcRenderer.invoke(
  "evolution:predict-behavior",
  {
    userId: "user-001",
    contextWindow: 20, // 最近 20 个行为作为上下文
    predictionHorizon: 3, // 预测未来 3 步
  },
);
// prediction = {
//   userId: "user-001",
//   predictions: [
//     { action: "open-knowledge-base", confidence: 0.92, preload: ["kb-index", "recent-notes"] },
//     { action: "search-notes", confidence: 0.78, preload: ["search-index"] },
//     { action: "ask-ai-question", confidence: 0.65, preload: ["llm-session", "rag-context"] },
//   ],
//   proactiveActions: [
//     { type: "preload-data", target: "kb-index", estimatedSavings: "800ms" },
//     { type: "warm-cache", target: "llm-session", estimatedSavings: "1200ms" },
//   ]
// }
```

## 进化成长日志

```javascript
// 查看 AI 进化历史
const growthLog = await window.electron.ipcRenderer.invoke(
  "evolution:get-growth-log",
  {
    fromDate: "2026-01-01",
    toDate: "2026-03-10",
    includeMetrics: true,
  },
);
// growthLog = {
//   entries: [
//     {
//       id: "evo-001",
//       date: "2026-01-15",
//       type: "incremental-training",
//       trigger: "capability-assessment",
//       description: "翻译能力低于阈值，触发 EWC 增量训练",
//       before: { translation: 0.78, overall: 0.84 },
//       after: { translation: 0.86, overall: 0.87 },
//       duration: 2400000,
//     },
//     {
//       id: "evo-002",
//       date: "2026-02-03",
//       type: "self-repair",
//       trigger: "self-diagnosis",
//       description: "检测到幻觉率升高，自动回滚至稳定版本",
//       before: { hallucinationRate: 0.08 },
//       after: { hallucinationRate: 0.03 },
//       duration: 30000,
//     },
//     {
//       id: "evo-003",
//       date: "2026-03-01",
//       type: "architecture-search",
//       trigger: "scheduled",
//       description: "NAS 搜索到更优的 Edge 架构，推理速度提升 25%",
//       before: { latencyMs: 800, modelSizeMB: 450 },
//       after: { latencyMs: 600, modelSizeMB: 380 },
//       duration: 7200000,
//     },
//   ],
//   summary: {
//     totalEvolutions: 12,
//     overallImprovement: "+15.2%",
//     topImprovedDimension: "coding (+12%)",
//     evolutionFrequency: "4.0/month"
//   }
// }
```

## 进化配置

```javascript
const config = await window.electron.ipcRenderer.invoke("evolution:configure", {
  autoAssessment: { enabled: true, interval: 604800000 }, // 每周评估
  autoUpgrade: { enabled: true, minScoreThreshold: 0.85 },
  selfDiagnosis: { enabled: true, interval: 86400000 }, // 每天诊断
  selfRepair: { autoRepair: true, requireApproval: false },
  behaviorPrediction: { enabled: true, contextWindow: 20 },
});
```

## 模型导出

```javascript
// 导出进化后的模型
const exported = await window.electron.ipcRenderer.invoke(
  "evolution:export-model",
  {
    modelVersion: "chainless-ai-v4.5.1",
    format: "onnx", // "onnx" | "tflite" | "coreml" | "openvino"
    quantization: "int8", // "fp32" | "fp16" | "int8" | "int4"
    targetDevice: "edge", // "edge" | "mobile" | "server"
  },
);
// exported = { modelVersion: "chainless-ai-v4.5.1", format: "onnx", quantization: "int8", sizeMB: 125, path: "/models/chainless-ai-v4.5.1-int8.onnx", accuracy: 0.86 }
```

---

## 成长可视化

进化成长日志支持以下可视化模式：

| 可视化模式     | 说明                                   |
| -------------- | -------------------------------------- |
| **时间线视图** | 按时间轴展示每次进化事件，支持钻取详情 |
| **雷达图**     | 多维度能力得分雷达图，对比不同版本     |
| **趋势折线图** | 各维度能力得分随时间的变化趋势         |
| **热力图**     | 进化频率与维度关联热力图，识别薄弱环节 |
| **对比瀑布图** | 单次进化前后各指标变化的瀑布图         |

---

## IPC 通道

| 通道                          | 参数                                              | 返回值   |
| ----------------------------- | ------------------------------------------------- | -------- |
| `evolution:assess-capability` | `{ dimensions?, benchmarkSuite?, sampleSize? }`   | 评估结果 |
| `evolution:train-incremental` | `{ targetDimensions, strategy, dataSource, ... }` | 训练结果 |
| `evolution:self-diagnose`     | `{ checks? }`                                     | 诊断报告 |
| `evolution:self-repair`       | `{ issues, strategy?, dryRun? }`                  | 修复结果 |
| `evolution:predict-behavior`  | `{ userId, contextWindow?, predictionHorizon? }`  | 行为预测 |
| `evolution:get-growth-log`    | `{ fromDate?, toDate?, includeMetrics? }`         | 进化日志 |
| `evolution:configure`         | `{ autoAssessment?, autoUpgrade?, ... }`          | 配置结果 |
| `evolution:export-model`      | `{ modelVersion, format, quantization?, ... }`    | 导出结果 |

---

## 数据库表

### evolution_assessments

| 字段            | 类型    | 说明           |
| --------------- | ------- | -------------- |
| id              | TEXT PK | 评估 ID        |
| model_id        | TEXT    | 模型标识       |
| overall_score   | REAL    | 综合得分       |
| dimensions      | JSON    | 各维度评分详情 |
| recommendations | JSON    | 升级建议       |
| benchmark_suite | TEXT    | 使用的评测集   |
| created_at      | INTEGER | 评估时间戳     |

### evolution_training_logs

| 字段              | 类型    | 说明                       |
| ----------------- | ------- | -------------------------- |
| id                | TEXT PK | 训练 ID                    |
| type              | TEXT    | incremental/nas/repair     |
| trigger           | TEXT    | 触发原因                   |
| strategy          | TEXT    | ewc/distillation/replay    |
| before_metrics    | JSON    | 训练前指标                 |
| after_metrics     | JSON    | 训练后指标                 |
| model_version_in  | TEXT    | 输入模型版本               |
| model_version_out | TEXT    | 输出模型版本               |
| duration          | INTEGER | 训练时长（ms）             |
| status            | TEXT    | completed/failed/cancelled |
| created_at        | INTEGER | 创建时间戳                 |

### evolution_growth_log

| 字段         | 类型    | 说明              |
| ------------ | ------- | ----------------- |
| id           | TEXT PK | 日志 ID           |
| type         | TEXT    | 进化类型          |
| trigger      | TEXT    | 触发来源          |
| description  | TEXT    | 变更描述          |
| before_state | JSON    | 进化前状态        |
| after_state  | JSON    | 进化后状态        |
| duration     | INTEGER | 耗时（ms）        |
| verified     | INTEGER | 是否已验证（0/1） |
| created_at   | INTEGER | 创建时间戳        |

---

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "selfEvolvingAI": {
    "enabled": true,
    "autoAssessment": {
      "enabled": true,
      "interval": 604800000,
      "dimensions": [
        "reasoning",
        "coding",
        "writing",
        "translation",
        "summarization",
        "qa"
      ],
      "minScoreThreshold": 0.85
    },
    "continualLearning": {
      "strategy": "ewc",
      "maxDegradation": 0.02,
      "maxTrainingDuration": 3600000,
      "dataSourcePriority": ["user-feedback", "curated", "synthetic"]
    },
    "selfDiagnosis": {
      "enabled": true,
      "interval": 86400000,
      "checks": [
        "accuracy",
        "latency",
        "memory",
        "output-quality",
        "hallucination-rate"
      ]
    },
    "selfRepair": {
      "enabled": true,
      "autoRepair": true,
      "requireApproval": false,
      "strategies": ["quantize", "rollback", "retrain", "degrade-gracefully"]
    },
    "behaviorPrediction": {
      "enabled": true,
      "contextWindow": 20,
      "predictionHorizon": 3,
      "minConfidence": 0.6
    },
    "nas": {
      "enabled": false,
      "targetDevice": "edge",
      "searchBudgetHours": 4,
      "exportFormats": ["onnx", "tflite"]
    }
  }
}
```

---

## 故障排查

| 问题 | 原因分析 | 解决方案 |
|------|---------|---------|
| 能力评估耗时过长 | `sampleSize` 设置过大或评测集过于复杂 | 减小 `sampleSize`（建议 50-100），使用 `standard-v2` 轻量评测集 |
| 增量训练后其他维度退化严重 | `maxDegradation` 阈值过高或训练数据质量差 | 降低 `maxDegradation`（建议 0.02），检查训练数据质量；切换到 `distillation` 策略 |
| 自诊断误报频繁 | 基线指标过于严格或系统负载波动 | 重新校准基线指标，增加诊断采样次数；在系统低负载时段进行诊断 |
| 自修复失败 | 修复策略不适用或回滚目标版本不存在 | 检查可用的修复策略列表，确认历史版本存在；使用 `dryRun: true` 先模拟修复 |
| 行为预测准确率低 | 用户行为数据不足或模式变化 | 增大 `contextWindow`（建议 20-50），积累更多历史行为数据后预测准确率会提升 |
| NAS 搜索未找到更优架构 | 搜索预算不足或搜索空间过小 | 增大 `searchBudgetHours`，扩展模型搜索空间参数；确认目标设备配置正确 |
| 模型导出格式不支持 | 目标格式缺少对应的转换器 | 确认 `format` 在支持列表中（onnx/tflite/coreml/openvino），检查导出依赖是否已安装 |

## 安全考虑

### 训练数据安全
- **数据不出域**: 所有增量训练在本地设备上完成，训练数据不上传到外部服务器，保护用户隐私
- **数据来源验证**: `curated` 数据经过人工审核，`user-feedback` 数据经过去标识化处理，`synthetic` 数据由本地模型生成
- **训练沙箱**: 增量训练在隔离环境中执行，训练过程无法访问非训练相关的系统资源

### 模型安全
- **版本回滚**: 每次进化保留完整的前后版本，自修复失败时可立即回滚到最后已知的稳定版本
- **A/B 验证**: 进化后的模型上线前通过 A/B 测试验证，避免有缺陷的模型直接进入生产环境
- **退化检测**: 自动监控所有维度的能力得分，任何维度退化超过 `maxDegradation` 阈值立即告警

### 自修复安全
- **审批控制**: 通过 `requireApproval` 配置是否需要用户确认才能执行自修复操作，防止自动修复引入新问题
- **修复范围限制**: 自修复仅允许执行预定义的策略（quantize/rollback/retrain/degrade-gracefully），不执行任意代码
- **修复审计**: 每次自修复操作完整记录到 `evolution_growth_log`，包含触发原因、执行动作和效果对比

### 行为预测隐私
- **本地推理**: 行为预测模型在本地运行，用户行为序列不上传到外部服务，所有预测在设备端完成
- **数据最小化**: 仅收集必要的行为类型和时间戳用于预测，不记录具体的用户输入内容
- **用户控制**: 用户可随时通过 `evolution:configure` 关闭行为预测功能（`behaviorPrediction.enabled: false`）

## 使用示例

### NAS 架构搜索（边缘设备优化）

```bash
# 1. 启用 NAS 搜索更优的 Edge 模型架构
# IPC: evolution:configure { nas: { enabled: true, targetDevice: "edge", searchBudgetHours: 4 } }

# 2. 搜索完成后导出为轻量模型
# IPC: evolution:export-model { modelVersion: "chainless-ai-v4.5.1", format: "tflite", quantization: "int8", targetDevice: "mobile" }
# → sizeMB: 125, accuracy: 0.86, 推理速度提升 25%
```

### 持续学习流程

```bash
# 1. 评估当前能力，发现翻译维度低于阈值
# IPC: evolution:assess-capability { dimensions: ["translation", "qa"], benchmarkSuite: "standard-v2" }
# → translation: 0.82 (threshold: 0.85, status: "below")

# 2. 触发 EWC 增量训练（保护其他维度不退化）
# IPC: evolution:train-incremental { targetDimensions: ["translation"], strategy: "ewc", constraints: { maxDegradation: 0.02 } }
# → translation: 0.82 → 0.88, reasoning 退化仅 -0.01（在允许范围内）
```

### 自我修复流程

```bash
# 1. 自诊断发现幻觉率异常升高
# IPC: evolution:self-diagnose { checks: ["hallucination-rate", "latency"] }
# → hallucination-rate: critical (0.08 vs baseline 0.03)

# 2. 先模拟修复确认安全
# IPC: evolution:self-repair { issues: ["hallucination-rate"], strategy: "auto", dryRun: true }

# 3. 确认无误后执行修复（自动回滚到稳定版本）
# IPC: evolution:self-repair { issues: ["hallucination-rate"], strategy: "auto", dryRun: false }
# → 回滚至 v4.5.0，幻觉率恢复至 0.03
```

## 相关文档

- [模型量化系统](/chainlesschain/quantization) - GGUF/GPTQ 模型量化与本地推理
- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2) - 插件自动发现与升级
- [统一应用运行时](/chainlesschain/universal-runtime) - 运行时热更新与性能监控
- [工作流自动化引擎](/chainlesschain/workflow-automation) - AI 驱动的工作流编排
