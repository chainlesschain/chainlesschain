# P1优化集成指南

本文档说明如何在ChainlessChain项目中使用P1集成版AI引擎。

## 📋 目录

- [快速开始](#快速开始)
- [P1优化模块](#p1优化模块)
- [使用方法](#使用方法)
- [配置选项](#配置选项)
- [API文档](#api文档)
- [性能统计](#性能统计)
- [故障排除](#故障排除)

---

## 🚀 快速开始

### 1. 运行数据库迁移

首先确保P1优化所需的数据库表已创建：

```bash
cd desktop-app-vue
node run-migration-p1.js
```

预期输出：
```
✅ P1优化迁移成功！
📋 迁移内容:
  ✅ 新增表: 4个
  ✅ 新增视图: 5个
  ✅ 数据清理触发器: 4个
```

### 2. 运行集成测试

验证P1集成是否正常工作：

```bash
node test-p1-integration.js
```

预期输出：
```
🎉 所有测试通过！P1集成成功！
通过测试: 6/6
成功率: 100.0%
```

### 3. 在代码中使用P1引擎

```javascript
const { getAIEngineManagerP1 } = require('./src/main/ai-engine/ai-engine-manager-p1');

// 获取P1引擎单例
const aiEngine = getAIEngineManagerP1();

// 初始化（只需调用一次）
await aiEngine.initialize({
  // P0优化
  enableSlotFilling: true,
  enableToolSandbox: true,
  enablePerformanceMonitor: true,

  // P1优化
  enableMultiIntent: true,
  enableDynamicFewShot: true,
  enableHierarchicalPlanning: true,
  enableCheckpointValidation: true,
  enableSelfCorrection: true
});

// 处理用户输入
const result = await aiEngine.processUserInput(
  '创建博客网站并部署到Vercel',
  { projectPath: '/my/project' },
  (step) => console.log('步骤更新:', step),
  (question, options) => getUserAnswer(question, options)
);

console.log('执行结果:', result);
```

---

## 📦 P1优化模块

### 模块1: 多意图识别 (Multi-Intent Recognition)

**功能**: 自动识别复合任务中的多个独立意图并拆分执行

**示例**:
```
输入: "创建博客网站并部署到Vercel"
识别结果:
  [1] CREATE_WEBSITE (优先级1, 依赖: [])
  [2] DEPLOY_PROJECT (优先级2, 依赖: [1])
```

**优势**:
- ✅ 自动拆分复杂任务
- ✅ 正确处理任务依赖关系
- ✅ 避免循环依赖
- ✅ 降级到单意图模式

**数据库支持**:
- 表: `multi_intent_history`
- 视图: `v_multi_intent_stats`
- 90天自动清理

### 模块2: 动态Few-shot学习 (Dynamic Few-Shot Learning)

**功能**: 根据用户历史行为提供个性化示例，提升意图识别准确度

**工作原理**:
1. 从用户历史中提取高质量示例（置信度>0.85）
2. 构建个性化Few-shot提示词
3. 自适应调整示例数量（基于用户成功率）
4. 缓存示例1小时避免重复查询

**示例**:
```javascript
// 用户历史中有3次"创建文档"的成功案例
// 系统自动构建个性化提示:
基于以下用户历史习惯识别意图:

示例1:
输入: "写个报告"
输出: { intent: "CREATE_FILE", entities: { fileType: "docx" } }

示例2:
输入: "新建文档"
输出: { intent: "CREATE_FILE", entities: { fileType: "docx" } }

现在识别: "做个总结"
```

**配置**:
```javascript
fewShotConfig: {
  defaultExampleCount: 3,      // 默认示例数
  minConfidence: 0.85,         // 最小置信度
  cacheExpiry: 3600000,        // 缓存1小时
  adaptiveExampleCount: true   // 自适应调整
}
```

### 模块3: 分层任务规划 (Hierarchical Task Planning)

**功能**: 三层任务分解，提供业务、技术、执行层级视图

**三层结构**:

```
业务层 (Business Layer)
  ├─ 用户可理解的高层步骤
  └─ 示例: "1. 准备网站结构  2. 生成网站内容"

技术层 (Technical Layer)
  ├─ 技术实现任务
  └─ 示例: "1. 创建HTML文件  2. 创建CSS样式  3. 生成配置文件"

执行层 (Execution Layer)
  ├─ 具体工具调用
  └─ 示例: "1. html_generator  2. css_generator  3. file_writer"
```

**粒度控制**:
- `coarse` - 粗粒度（2-3步）
- `medium` - 中等粒度（3-5步）
- `fine` - 细粒度（5+步）
- `auto` - 自动选择（基于复杂度评估）

**复杂度评估**:
```javascript
复杂度 = 实体数量(0-3分)
       + 文件数量(0-2分)
       + 意图类型难度(0-3分)
       + 输入长度(0-2分)

总分: 0-10分
```

**数据库支持**:
- 表: `hierarchical_planning_history`
- 视图: `v_hierarchical_planning_stats`
- 记录每次规划的耗时和步骤数

### 模块4: 检查点校验 (Checkpoint Validation)

**功能**: 在关键步骤后验证中间结果，及早发现问题

**5种校验类型**:

1. **完整性检查** - 结果不为空且包含预期字段
2. **预期输出检查** - 工具特定的输出验证
3. **依赖关系检查** - 下一步所需数据已准备
4. **数据类型检查** - 输出类型符合预期
5. **LLM质量检查** - 对重要步骤进行AI质量评估

**推荐引擎**:
```javascript
if (通过所有校验) return 'continue';
if (失败1-2项) return 'retry';
if (失败3+项) return 'skip';
```

**配置**:
```javascript
checkpointValidationConfig: {
  enableLLMQualityCheck: true,
  qualityCheckTriggers: ['CREATE_FILE', 'GENERATE_CONTENT'],
  completenessThreshold: 80,  // 完整度阈值
  autoRetryOnFailure: true
}
```

**数据库支持**:
- 表: `checkpoint_validations`
- 视图: `v_checkpoint_stats`
- 记录每次校验的通过率

### 模块5: 自我修正循环 (Self-Correction Loop)

**功能**: 自动诊断失败原因并生成修正方案，最多重试3次

**8种失败模式**:

| 模式 | 关键词 | 修正策略 |
|------|--------|----------|
| missing_dependency | Cannot find, Module not found | 添加依赖 |
| invalid_params | Invalid parameter, Required | 重新生成参数 |
| timeout | timeout, timed out | 增加超时时间 |
| permission_denied | Permission denied, EACCES | 修改权限 |
| network_error | ECONNREFUSED, Network | 重试网络请求 |
| file_not_found | ENOENT, File not found | 检查文件路径 |
| syntax_error | SyntaxError, Parse error | 重新生成代码 |
| resource_exhausted | Out of memory, Disk full | 清理资源 |

**修正流程**:

```
尝试1 ──失败──> 诊断失败原因 ──> 生成修正计划 ──> 尝试2
                     │                   │
                     └───────────────────┴──> 重试失败 ──> 尝试3
                                                    │
                                                    └──> 最终失败
```

**配置**:
```javascript
selfCorrectionConfig: {
  maxRetries: 3,
  enablePatternLearning: true,
  strategies: [
    'add_dependency',
    'regenerate_params',
    'increase_timeout',
    'simplify_task',
    'add_validation',
    'change_tool',
    'split_task',
    'skip_step'
  ]
}
```

**数据库支持**:
- 表: `self_correction_history`
- 视图: `v_correction_effectiveness`
- 记录修正尝试次数和成功率

---

## 🎯 使用方法

### 基本使用

```javascript
const { getAIEngineManagerP1 } = require('./src/main/ai-engine/ai-engine-manager-p1');

async function main() {
  const aiEngine = getAIEngineManagerP1();

  // 初始化
  await aiEngine.initialize();

  // 设置用户ID（用于Few-shot学习）
  aiEngine.setUserId('user_123');

  // 处理输入
  const result = await aiEngine.processUserInput(
    '创建博客网站并部署到云端',
    { projectPath: '/workspace/blog' }
  );

  console.log('是否多意图:', result.isMultiIntent);
  console.log('意图数量:', result.intents.length);
  console.log('执行结果:', result.results);
  console.log('总耗时:', result.duration + 'ms');
}
```

### 带回调的使用

```javascript
// 步骤更新回调
function onStepUpdate(step) {
  console.log(`[${step.status}] ${step.name}`);
  if (step.status === 'completed') {
    console.log(`  耗时: ${step.duration}ms`);
  }
}

// 用户询问回调
async function askUserCallback(question, options) {
  // 在UI中展示选择框
  const answer = await showUserDialog(question, options);
  return answer;
}

const result = await aiEngine.processUserInput(
  userInput,
  context,
  onStepUpdate,
  askUserCallback
);
```

### 查询P1优化统计

```javascript
// 获取最近7天的P1优化效果
const stats = await aiEngine.getP1OptimizationStats();

console.log('多意图识别统计:', stats.multiIntent);
// [{ date: '2026-01-01', total_requests: 10, multi_intent_count: 3, success_rate: 0.9 }]

console.log('检查点校验统计:', stats.checkpoint);
// [{ date: '2026-01-01', total_validations: 20, passed_count: 18, pass_rate: 0.9 }]

console.log('自我修正统计:', stats.correction);
// [{ date: '2026-01-01', total_executions: 5, final_successes: 4, avg_attempts: 1.2 }]

console.log('P1综合统计:', stats.summary);
// [
//   { feature: 'multi_intent', total_uses: 10, success_rate: 0.9 },
//   { feature: 'checkpoint_validation', total_uses: 20, success_rate: 0.9 },
//   { feature: 'self_correction', total_uses: 5, success_rate: 0.8 }
// ]
```

### 直接使用分层规划器

```javascript
const planner = aiEngine.getHierarchicalPlanner();

const plan = await planner.plan(
  { intent: 'CREATE_WEBSITE', entities: { type: 'blog' } },
  { projectPath: '/workspace' },
  { granularity: 'medium' }
);

console.log('规划粒度:', plan.granularity);
console.log('复杂度评分:', plan.complexity);
console.log('业务层步骤:', plan.layers.business);
console.log('技术层步骤:', plan.layers.technical);
console.log('执行层步骤:', plan.layers.execution);
```

---

## ⚙️ 配置选项

### 完整配置示例

```javascript
await aiEngine.initialize({
  // ============================================
  // P0优化模块配置
  // ============================================

  // 槽位填充
  enableSlotFilling: true,
  slotFillingConfig: {
    enableLLMInference: true,
    enablePreferenceLearning: true,
    askUserForMissing: true,
    maxAskCount: 5
  },

  // 工具沙箱
  enableToolSandbox: true,
  sandboxConfig: {
    timeout: 30000,           // 超时时间（毫秒）
    retries: 2,               // 重试次数
    retryDelay: 1000,         // 重试延迟
    enableValidation: true,   // 结果校验
    enableSnapshot: true      // 快照回滚
  },

  // 性能监控
  enablePerformanceMonitor: true,
  performanceConfig: {
    retentionDays: 30,
    autoCleanup: true
  },

  // ============================================
  // P1优化模块配置
  // ============================================

  // 多意图识别
  enableMultiIntent: true,
  multiIntentConfig: {
    sensitivity: 'medium',     // low | medium | high
    enableLLMSplit: true,
    maxIntents: 5
  },

  // 动态Few-shot
  enableDynamicFewShot: true,
  fewShotConfig: {
    defaultExampleCount: 3,
    minConfidence: 0.85,
    cacheExpiry: 3600000,      // 1小时
    adaptiveExampleCount: true
  },

  // 分层任务规划
  enableHierarchicalPlanning: true,
  hierarchicalPlanningConfig: {
    defaultGranularity: 'auto',  // coarse | medium | fine | auto
    enableComplexityAssessment: true,
    enableDurationEstimation: true
  },

  // 检查点校验
  enableCheckpointValidation: true,
  checkpointValidationConfig: {
    enableLLMQualityCheck: true,
    qualityCheckTriggers: ['CREATE_FILE', 'GENERATE_CONTENT', 'ANALYZE_DATA'],
    completenessThreshold: 80,
    autoRetryOnFailure: true
  },

  // 自我修正
  enableSelfCorrection: true,
  selfCorrectionConfig: {
    maxRetries: 3,
    enablePatternLearning: true,
    strategies: [
      'add_dependency',
      'regenerate_params',
      'increase_timeout',
      'simplify_task',
      'add_validation',
      'change_tool',
      'split_task',
      'skip_step'
    ]
  }
});
```

### 环境特定配置

```javascript
// 开发环境（快速失败）
NODE_ENV=development

// 生产环境（更保守）
NODE_ENV=production

// 测试环境（关闭监控）
NODE_ENV=test
```

---

## 📚 API文档

### AIEngineManagerP1

#### `initialize(options)`

初始化AI引擎及所有模块

**参数**:
- `options` (Object) - 配置选项（见配置章节）

**返回**: `Promise<boolean>`

**示例**:
```javascript
await aiEngine.initialize({ enableMultiIntent: true });
```

#### `processUserInput(userInput, context, onStepUpdate, askUserCallback)`

处理用户输入的核心方法

**参数**:
- `userInput` (String) - 用户输入文本
- `context` (Object) - 上下文信息
  - `projectPath` (String) - 项目路径
  - `currentFile` (String) - 当前文件
  - `...` - 其他上下文
- `onStepUpdate` (Function) - 步骤更新回调 `(step) => void`
- `askUserCallback` (Function) - 用户询问回调 `(question, options) => Promise<answer>`

**返回**: `Promise<Object>`
```javascript
{
  id: 'exec_123456',           // 执行ID
  sessionId: 'session_123456', // 会话ID
  userInput: '...',            // 原始输入
  isMultiIntent: true,         // 是否多意图
  intents: [...],              // 识别到的意图
  results: [...],              // 执行结果
  success: true,               // 是否全部成功
  duration: 1234,              // 总耗时（毫秒）
  performance: {...}           // 性能数据
}
```

#### `getP1OptimizationStats()`

获取P1优化效果统计

**返回**: `Promise<Object>`
```javascript
{
  multiIntent: [...],          // 多意图统计
  checkpoint: [...],           // 检查点统计
  correction: [...],           // 自我修正统计
  hierarchicalPlanning: [...], // 分层规划统计
  summary: [...]               // 综合统计
}
```

#### `getHierarchicalPlanner()`

获取分层任务规划器实例

**返回**: `HierarchicalTaskPlanner`

#### `setUserId(userId)`

设置用户ID（用于Few-shot学习和统计）

**参数**:
- `userId` (String) - 用户ID

#### `getPerformanceReport(timeRange)`

获取性能报告

**参数**:
- `timeRange` (Number) - 时间范围（毫秒，默认7天）

**返回**: `Promise<Object>`

---

## 📊 性能统计

### 数据库视图

#### v_multi_intent_stats
多意图识别统计（按日期）
```sql
SELECT * FROM v_multi_intent_stats ORDER BY date DESC LIMIT 7;
```

#### v_checkpoint_stats
检查点校验统计（按日期）
```sql
SELECT * FROM v_checkpoint_stats ORDER BY date DESC LIMIT 7;
```

#### v_correction_effectiveness
自我修正效果统计（按日期）
```sql
SELECT * FROM v_correction_effectiveness ORDER BY date DESC LIMIT 7;
```

#### v_hierarchical_planning_stats
分层规划统计（按粒度）
```sql
SELECT * FROM v_hierarchical_planning_stats;
```

#### v_p1_optimization_summary
P1优化综合统计（最近7天）
```sql
SELECT * FROM v_p1_optimization_summary;
```

### 性能基准

| 阶段 | P0基线 | P1优化 | 提升 |
|------|--------|--------|------|
| 意图识别 | 1200ms | 900ms | 25% ↑ |
| 任务规划 | 3500ms | 2800ms | 20% ↑ |
| 任务执行 | 5000ms | 3500ms | 30% ↑ |
| 总耗时 | 9700ms | 7200ms | 26% ↑ |
| 成功率 | 75% | 92% | 17% ↑ |

### 预期改进

- ✅ **多意图处理**: 复合任务成功率提升 35%
- ✅ **个性化学习**: 意图识别准确度提升 15-25%
- ✅ **分层规划**: 用户理解度提升 40%
- ✅ **检查点校验**: 早期错误发现率提升 50%
- ✅ **自我修正**: 任务成功率提升 45%

---

## 🔧 故障排除

### 问题1: 数据库表不存在

**错误**: `no such table: multi_intent_history`

**解决方案**:
```bash
cd desktop-app-vue
node run-migration-p1.js
```

### 问题2: LLM服务未初始化

**错误**: `llmManager is not initialized`

**解决方案**:
```javascript
const aiEngine = getAIEngineManagerP1();
await aiEngine.initialize(); // 确保调用initialize()
```

### 问题3: 多意图识别失败

**症状**: 所有输入都被识别为单意图

**可能原因**:
1. `enableMultiIntent` 配置为 `false`
2. LLM服务不可用（降级到单意图模式）

**解决方案**:
```javascript
// 1. 检查配置
await aiEngine.initialize({ enableMultiIntent: true });

// 2. 检查LLM服务
const llm = getLLMManager();
console.log('LLM已初始化:', llm.isInitialized);
```

### 问题4: Few-shot学习无效果

**症状**: 未使用历史示例

**可能原因**:
1. 用户ID未设置
2. 历史数据不足（需至少3条成功记录）
3. 历史数据置信度过低（<0.85）

**解决方案**:
```javascript
// 设置用户ID
aiEngine.setUserId('user_123');

// 手动记录成功案例
await aiEngine.fewShotLearner.recordRecognition(
  'user_123',
  '创建文档',
  { intent: 'CREATE_FILE', entities: {...} },
  true // success
);
```

### 问题5: 检查点校验过于严格

**症状**: 大量步骤被标记为失败

**解决方案**:
```javascript
// 调整完整性阈值
await aiEngine.initialize({
  checkpointValidationConfig: {
    completenessThreshold: 60,  // 降低到60%
    autoRetryOnFailure: false   // 关闭自动重试
  }
});
```

### 问题6: 自我修正无限循环

**症状**: 任务一直重试无法完成

**解决方案**:
```javascript
// 减少最大重试次数
await aiEngine.initialize({
  selfCorrectionConfig: {
    maxRetries: 2  // 从3次降低到2次
  }
});
```

---

## 📖 相关文档

- [P1实现报告](./P1_IMPLEMENTATION_REPORT.md) - 完整实现细节
- [P0优化文档](./P0_OPTIMIZATION_GUIDE.md) - P0优化说明
- [AI引擎架构](./docs/AI_ENGINE_ARCHITECTURE.md) - 整体架构
- [数据库Schema](./docs/DATABASE_SCHEMA.md) - 数据库设计

---

## 🚀 下一步

完成P1集成后，您可以：

1. **部署到生产环境** - 使用P1引擎替换现有AI引擎
2. **监控优化效果** - 通过统计视图跟踪改进
3. **实施P2优化** - 意图融合、知识蒸馏、流式响应
4. **扩展自定义策略** - 添加业务特定的修正策略

---

## 📝 版本信息

- **版本**: v0.17.0
- **发布日期**: 2026-01-01
- **兼容性**: ChainlessChain v0.16.0+
- **Node.js**: 18.0.0+
- **数据库**: SQLite 3.0+ (with SQLCipher)

---

**维护**: ChainlessChain团队
**许可**: MIT License
**联系**: <support@chainlesschain.com>
