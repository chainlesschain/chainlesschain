# Advanced Features Guide

本指南介绍ChainlessChain P2优化后的三大高级特性：自适应阈值调整、模型在线学习和高级优化器。

## 目录

1. [自适应阈值调整系统](#1-自适应阈值调整系统)
2. [模型在线学习系统](#2-模型在线学习系统)
3. [高级优化器](#3-高级优化器)
4. [集成使用场景](#4-集成使用场景)
5. [常见问题与故障排查](#5-常见问题与故障排查)

---

## 1. 自适应阈值调整系统

### 1.1 概述

自适应阈值调整系统通过持续监控系统性能指标,自动调整知识蒸馏的复杂度阈值,无需人工干预即可维持最优的小模型使用率。

**核心特性**:
- 多目标优化(小模型使用率、成本节约、质量分数)
- 梯度下降算法寻找最优阈值
- 安全机制(冷却期、边界限制、最小样本量)
- 0-100评分系统评估阈值性能

### 1.2 安装与配置

```bash
cd desktop-app-vue
node adaptive-threshold.js
```

**配置参数**(在 `adaptive-threshold.js` 中修改):

```javascript
this.config = {
  targets: {
    smallModelRate: { min: 40, max: 60, ideal: 45 },  // 小模型使用率目标
    successRate: { min: 85, ideal: 95 },              // 成功率目标
    costSavings: { min: 50, ideal: 70 },              // 成本节约目标(%)
    qualityScore: { min: 0.8, ideal: 0.9 }            // 质量分数目标
  },
  adjustment: {
    minSampleSize: 50,           // 最小样本量
    windowSize: 100,             // 滑动窗口大小
    learningRate: 0.05,          // 学习率
    maxAdjustment: 0.1,          // 最大单次调整幅度
    minAdjustment: 0.01,         // 最小调整阈值
    cooldownPeriod: 3600000,     // 冷却期(1小时)
    convergenceThreshold: 0.005   // 收敛阈值
  }
};
```

### 1.3 命令使用

#### 1.3.1 监控当前性能

```bash
node adaptive-threshold.js monitor [--days=7]
```

**输出示例**:
```
当前阈值性能监控
==================
监控周期: 7天
样本数量: 234

当前指标:
- 小模型使用率: 42.3% (目标: 45%)
- 成功率: 98.1% (优秀)
- 平均成本节约: 68.5%
- 平均质量分数: 0.91

综合评分: 87/100

评估结果: 良好 (建议微调)
建议调整: +0.02 (0.52 → 0.54)
```

#### 1.3.2 模拟调整

在不实际修改阈值的情况下,预览调整效果:

```bash
node adaptive-threshold.js simulate
```

**输出示例**:
```
模拟阈值调整
============
当前阈值: 0.52
建议阈值: 0.54 (调整 +0.02)

预期效果:
- 小模型使用率: 42.3% → 44.8%
- 成本节约: 68.5% → 70.2%
- 综合评分: 87 → 92

是否执行调整?请运行: node adaptive-threshold.js adjust
```

#### 1.3.3 执行调整

实际应用计算出的最优阈值:

```bash
node adaptive-threshold.js adjust
```

**安全检查**:
- ✅ 样本量充足(>= 50)
- ✅ 距上次调整超过冷却期(1小时)
- ✅ 调整幅度在安全范围内(<= 0.1)
- ✅ 新阈值在合理边界内(0.3-0.8)

**输出示例**:
```
✓ 阈值调整成功
旧阈值: 0.52
新阈值: 0.54
调整幅度: +0.02
调整原因: 小模型使用率偏低

下次可调整时间: 2026-01-02 15:30:00
```

#### 1.3.4 自动调整模式

启动后台自动调整进程:

```bash
node adaptive-threshold.js auto [--interval=60]
```

**参数**:
- `--interval`: 检查间隔(分钟),默认60分钟

**行为**:
- 每隔指定时间检查性能
- 如果评分 < 80,自动执行调整
- 遵守所有安全规则和冷却期
- 记录所有自动调整历史

**日志示例**:
```
[2026-01-02 14:30:00] 自动监控启动
[2026-01-02 14:30:05] 当前评分: 87,状态良好
[2026-01-02 15:30:05] 当前评分: 76,执行调整
[2026-01-02 15:30:10] 阈值调整: 0.52 → 0.54
[2026-01-02 16:30:05] 当前评分: 91,状态优秀
```

### 1.4 评分算法详解

总分100分,分三部分计算:

**1. 小模型使用率得分(40分)**:
```javascript
if (rate >= targets.smallModelRate.min && rate <= targets.smallModelRate.max) {
  score = 40;  // 在目标范围内
} else {
  const deviation = Math.min(
    Math.abs(rate - targets.smallModelRate.min),
    Math.abs(rate - targets.smallModelRate.max)
  );
  score = Math.max(0, 40 - deviation);  // 每偏离1%扣1分
}
```

**2. 成本节约得分(30分)**:
```javascript
if (costSavings >= targets.costSavings.ideal) {
  score = 30;  // 达到理想值
} else if (costSavings >= targets.costSavings.min) {
  const range = targets.costSavings.ideal - targets.costSavings.min;
  const actual = costSavings - targets.costSavings.min;
  score = 30 * (actual / range);  // 线性插值
} else {
  score = 0;  // 低于最低要求
}
```

**3. 稳定性得分(30分)**:
```javascript
const successScore = Math.min(30, (successRate - 85) * 2);  // 成功率 >85%
const qualityScore = Math.min(30, (qualityScore - 0.8) * 150);  // 质量 >0.8
score = (successScore + qualityScore) / 2;
```

**评级标准**:
- 90-100分: 优秀(Excellent)
- 80-89分: 良好(Good)
- 70-79分: 需改进(Needs Improvement)
- <70分: 需立即调整(Critical)

### 1.5 最佳实践

1. **初次部署**:
   - 运行 `monitor` 收集至少7天数据
   - 确保样本量 >= 100
   - 使用 `simulate` 预览效果后再执行

2. **生产环境**:
   - 启用 `auto` 模式保持持续优化
   - 设置监控告警(评分 < 70)
   - 定期检查调整历史

3. **调优建议**:
   - 如果小模型使用率过低: 增大阈值(+0.05~0.1)
   - 如果成功率下降: 减小阈值(-0.05)
   - 如果质量分数低: 检查模型能力或降低复杂度阈值

4. **安全考虑**:
   - 不要手动修改数据库中的阈值记录
   - 保持冷却期至少1小时
   - 单次调整幅度不超过0.1

---

## 2. 模型在线学习系统

### 2.1 概述

模型在线学习系统从生产环境的实际数据中持续学习,改进四个关键预测模型,无需离线重新训练即可提升系统性能。

**四个子模型**:
1. **复杂度估计器**: 预测任务复杂度
2. **意图识别器**: 识别用户意图类型
3. **工具选择器**: 推荐最佳工具
4. **用户偏好模型**: 学习用户习惯

### 2.2 模型架构

#### 2.2.1 复杂度估计器

**权重向量**(可通过学习自动调整):
```javascript
weights: {
  intentComplexity: 0.3,    // 意图复杂度
  contextComplexity: 0.25,  // 上下文复杂度
  historyComplexity: 0.2,   // 历史复杂度
  toolsComplexity: 0.25     // 工具需求复杂度
}
```

**学习算法**: 梯度下降权重更新
```javascript
const error = actualComplexity - predictedComplexity;
if (Math.abs(error) > 0.1) {  // 误差阈值
  const adjustment = learningRate * error;
  // 按比例更新权重
  weights.intentComplexity += adjustment * intentComplexity;
  weights.contextComplexity += adjustment * contextComplexity;
  // ...
  // 归一化权重和为1
}
```

#### 2.2.2 意图识别器

**模式学习**: N-gram关键词匹配
```javascript
patterns: Map {
  "创建" => {
    intents: Map { "create_project": 15, "create_note": 8 },
    totalCount: 23
  },
  "分析" => {
    intents: Map { "analyze_code": 12, "analyze_data": 5 },
    totalCount: 17
  }
}
```

**学习过程**:
1. 提取用户输入的关键词
2. 统计每个关键词关联的意图类型
3. 计算置信度: `confidence = intentCount / totalCount`
4. 阈值过滤(默认 >= 0.7)

#### 2.2.3 工具选择器

**偏好评分计算**:
```javascript
preferenceScore =
  successRate * 0.7 +              // 成功率占70%
  Math.min(usageCount/100, 1) * 0.2 +  // 使用频率占20%
  (1 - Math.min(avgDuration/5000, 1)) * 0.1;  // 速度占10%
```

**指数移动平均更新**:
```javascript
newPreference = currentPreference + (preferenceScore - currentPreference) * learningRate;
```

#### 2.2.4 用户偏好模型

**学习内容**:
- 功能评分(基于用户反馈)
- 响应风格偏好
- 使用习惯模式

**更新策略**: 增量平均
```javascript
newRating = ((currentRating * usageCount) + newRating) / (usageCount + 1);
```

### 2.3 命令使用

#### 2.3.1 训练模型

```bash
node online-learning.js train [--days=30]
```

**训练过程**:
1. 从4个数据源收集训练数据
2. 训练复杂度估计器(权重调整)
3. 训练意图识别器(模式学习)
4. 训练工具选择器(偏好更新)
5. 训练用户偏好模型(评分汇总)
6. 保存模型权重到数据库

**输出示例**:
```
在线学习训练完成
================
训练数据周期: 30天

数据收集:
- 复杂度样本: 456条
- 意图模式: 234条
- 工具使用: 567条
- 用户反馈: 123条

模型更新:
✓ 复杂度估计器: 权重更新 (12次调整)
  intentComplexity: 0.30 → 0.32
  contextComplexity: 0.25 → 0.24
  historyComplexity: 0.20 → 0.19
  toolsComplexity: 0.25 → 0.25

✓ 意图识别器: 新增89个模式
  总模式数: 345
  平均置信度: 0.78

✓ 工具选择器: 更新56个工具偏好
  最高偏好: ReadFile (0.92)
  最低偏好: ComplexQuery (0.45)

✓ 用户偏好模型: 评分更新
  最受欢迎功能: RAG搜索 (4.8/5.0)
  改进最大: 知识蒸馏 (+0.6)

模型已保存到数据库
```

#### 2.3.2 评估模型性能

```bash
node online-learning.js evaluate
```

**评估指标**:
- 复杂度预测准确率
- 意图识别准确率
- 工具推荐采纳率
- 用户满意度

**输出示例**:
```
模型性能评估
============
评估数据: 最近7天

1. 复杂度估计器
   - MAE (平均绝对误差): 0.08
   - 准确率 (±0.1范围): 87.3%
   - 权重稳定性: 收敛

2. 意图识别器
   - Top-1准确率: 82.5%
   - Top-3准确率: 94.1%
   - 平均置信度: 0.78
   - 模式覆盖率: 91.2%

3. 工具选择器
   - 推荐采纳率: 76.8%
   - 平均执行时长: 1234ms
   - 成功率: 95.6%

4. 用户偏好模型
   - 平均用户评分: 4.3/5.0
   - 功能满意度: 89.2%
   - 响应风格匹配度: 4.5/5.0

总体评估: 优秀
建议: 继续保持当前学习策略
```

#### 2.3.3 查看学习统计

```bash
node online-learning.js stats
```

**输出示例**:
```
学习统计信息
============

复杂度估计器:
- 训练样本总数: 1,234
- 最近更新: 2026-01-02 14:30:00
- 权重变化趋势: 稳定收敛
- 当前学习率: 0.01

意图识别器:
- 已学习模式: 345个
- 关键词覆盖: 567个
- 平均模式强度: 23次/模式
- 新增模式 (24h): 5个

工具选择器:
- 跟踪工具数: 56个
- 偏好更新次数: 234
- 最常用工具: ReadFile (89次)
- 最新优化工具: ParallelExecution

用户偏好模型:
- 跟踪功能数: 23个
- 反馈收集数: 456条
- 总体满意度: 4.3/5.0
- 改进趋势: ↑ +0.2 (vs上周)
```

### 2.4 数据来源

**1. knowledge_distillation_history**:
- 任务复杂度(actual_complexity)
- 实际执行结果(is_success)
- 执行时长(execution_time_ms)

**2. multi_intent_history**:
- 用户输入文本(user_input)
- 识别意图类型(detected_intents)
- 处理成功率(is_success)

**3. feature_usage_tracking**:
- 功能使用记录(feature_name)
- 执行耗时(execution_time_ms)
- 成功率统计(is_success)

**4. user_feedback**:
- 用户评分(rating)
- 功能反馈(feature_name)
- 改进建议(feedback_text)

### 2.5 最佳实践

1. **训练频率**:
   - 每周训练1次(使用30天数据)
   - 重大功能更新后立即训练
   - 用户反馈激增时加训

2. **数据质量**:
   - 确保至少1000条训练样本
   - 删除异常数据(execution_time > 60s)
   - 平衡不同类型的训练数据

3. **模型监控**:
   - 每天运行 `evaluate` 检查性能
   - 关注准确率下降趋势(警报阈值 < 80%)
   - 定期查看 `stats` 了解学习进度

4. **参数调优**:
   - 如果模型变化太快: 降低学习率(0.01 → 0.005)
   - 如果模型不收敛: 增加学习率(0.01 → 0.02)
   - 如果过拟合: 增加数据窗口(30天 → 60天)

5. **集成建议**:
   ```javascript
   // 在AI引擎中使用学习后的模型
   const complexity = await onlineLearning.predictComplexity(userInput);
   const intents = await onlineLearning.recognizeIntent(userInput);
   const tools = await onlineLearning.recommendTools(taskType);
   ```

---

## 3. 高级优化器

### 3.1 概述

高级优化器提供四种智能优化策略,超越基础的缓存和重试机制,实现预测性优化和自动瓶颈检测。

**四大优化功能**:
1. **预测性缓存**: 基于用户行为预加载数据
2. **并行任务优化**: 识别并自动并行化独立任务
3. **智能重试机制**: 自适应重试策略优化
4. **瓶颈检测**: 自动识别性能瓶颈

### 3.2 预测性缓存

#### 3.2.1 原理

通过N-gram模式分析用户行为序列,预测下一步操作并提前加载数据。

**示例场景**:
```
用户行为序列:
打开项目 → 查看文件列表 → 打开README.md → 查看Git历史

模式学习:
"打开项目 → 查看文件列表" (100次) → "打开README.md" (78次, 78%)
                                      → "打开package.json" (15次, 15%)
                                      → "其他" (7次, 7%)

预测结果:
当用户执行"打开项目 → 查看文件列表"时,预加载README.md (置信度78%)
```

#### 3.2.2 命令使用

```bash
node advanced-optimizer.js predict [--days=30] [--confidence=0.6]
```

**参数**:
- `--days`: 分析历史数据天数(默认30)
- `--confidence`: 最低置信度阈值(默认0.6)

**输出示例**:
```
预测性缓存分析
==============
分析周期: 30天
行为序列: 1,234条

已识别模式: 23个
高置信度模式 (>60%): 18个

Top 5 预测模式:
1. [打开项目, 查看文件] → [打开README.md]
   置信度: 78% | 出现次数: 78次

2. [创建笔记, 输入标题] → [选择模板]
   置信度: 85% | 出现次数: 102次

3. [RAG搜索, 查看结果] → [打开相关文档]
   置信度: 72% | 出现次数: 89次

4. [Git同步, 发现冲突] → [打开冲突解决]
   置信度: 91% | 出现次数: 67次

5. [导入文件, 选择PDF] → [启动OCR]
   置信度: 88% | 出现次数: 56次

预加载建议:
✓ 已预加载 12 个高频资源
  - README.md (缓存大小: 45KB)
  - 常用模板列表 (缓存大小: 12KB)
  - 搜索索引 (缓存大小: 2.3MB)
  ...

预期收益:
- 减少等待时间: 平均 1.2s → 0.3s (-75%)
- 缓存命中率提升: 52% → 74% (+22%)
```

#### 3.2.3 配置参数

```javascript
predictiveCache: {
  lookAheadWindow: 5,          // 向前预测窗口大小
  confidenceThreshold: 0.6,    // 最低置信度
  maxPredictions: 10,          // 最多预测数量
  cacheExpiry: 1800000,        // 预缓存过期时间(30分钟)
  minPatternFrequency: 10      // 最小模式频率
}
```

### 3.3 并行任务优化

#### 3.3.1 原理

分析任务依赖关系,识别可并行执行的独立任务组,计算并行化收益。

**示例**:
```
顺序执行:
Task A (2s) → Task B (3s) → Task C (1s) → Task D (2s)
总耗时: 8s

依赖分析:
- Task A: 无依赖
- Task B: 依赖 Task A
- Task C: 无依赖
- Task D: 无依赖

并行执行:
Group 1 (并行): [Task A, Task C, Task D]  // 耗时 max(2s, 1s, 2s) = 2s
Group 2 (顺序): [Task B]                   // 耗时 3s (依赖Task A)
总耗时: 2s + 3s = 5s

时间节约: 8s - 5s = 3s (37.5%)
```

#### 3.3.2 命令使用

```bash
node advanced-optimizer.js parallel [--days=7]
```

**输出示例**:
```
并行任务优化分析
================
分析周期: 7天
任务记录: 456条

可并行化任务组: 12个

Group 1: 项目初始化流程
  独立任务:
  - 创建数据库表 (1.2s)
  - 初始化配置文件 (0.8s)
  - 下载依赖资源 (3.5s)
  - 生成默认模板 (0.6s)

  顺序执行: 6.1s
  并行执行: 3.5s (最慢任务)
  时间节约: 2.6s (42.6%)
  推荐并行度: 4

Group 2: RAG文档处理
  独立任务:
  - 文本提取 (2.1s)
  - 图片OCR (4.5s)
  - 元数据解析 (0.9s)

  顺序执行: 7.5s
  并行执行: 4.5s
  时间节约: 3.0s (40.0%)
  推荐并行度: 3

...

总体收益:
- 总任务数: 456
- 可并行化: 234 (51.3%)
- 平均时间节约: 38.5%
- 推荐最大并行数: 4
```

#### 3.3.3 配置参数

```javascript
parallelOptimization: {
  maxParallelTasks: 4,         // 最大并行任务数
  minTaskDuration: 100,        // 最小任务时长(ms)
  dependencyAnalysis: true,    // 启用依赖分析
  cpuThreshold: 0.8            // CPU使用率阈值
}
```

### 3.4 智能重试机制

#### 3.4.1 原理

分析失败任务的恢复模式,自动调整重试策略(次数、延迟、退避算法)。

**退避策略**:
```javascript
// 线性退避(适合瞬时故障)
delay = initialDelay + (attemptNumber * increment);
// 例: 1s, 2s, 3s, 4s, 5s

// 指数退避(适合过载故障)
delay = initialDelay * Math.pow(2, attemptNumber);
// 例: 1s, 2s, 4s, 8s, 16s (限制最大10s)

// 随机抖动(避免雷鸣群效应)
delay = baseDelay + random(0, jitterRange);
```

#### 3.4.2 命令使用

```bash
node advanced-optimizer.js retry [--days=7]
```

**输出示例**:
```
智能重试机制分析
================
分析周期: 7天

失败任务统计:
- 总失败次数: 89次
- 重试成功: 67次 (75.3% 恢复率)
- 最终失败: 22次 (24.7%)

失败类型分布:
1. 网络超时 (45次)
   - 平均恢复次数: 2.1次
   - 最佳策略: 指数退避
   - 建议延迟: 初始2s,最大10s
   - 建议次数: 3次

2. LLM服务过载 (23次)
   - 平均恢复次数: 1.3次
   - 最佳策略: 线性退避 + 随机抖动
   - 建议延迟: 初始5s,增量3s
   - 建议次数: 2次

3. 数据库锁定 (12次)
   - 平均恢复次数: 3.5次
   - 最佳策略: 指数退避
   - 建议延迟: 初始0.5s,最大5s
   - 建议次数: 5次

4. 文件读写错误 (9次)
   - 恢复率: 22.2% (低)
   - 建议: 不重试,直接报错

当前策略评估:
- 配置: 最大3次,指数退避,初始1s
- 适配度: 中等 (67/100)
- 优化建议: 按失败类型定制策略

优化后预期:
- 恢复率: 75.3% → 85.1% (+9.8%)
- 平均重试耗时: 4.2s → 3.1s (-26.2%)
- 用户体验得分: 72 → 88 (+16)
```

#### 3.4.3 自适应调整

系统自动根据恢复率调整策略:

```javascript
if (recoveryRate > 0.8) {
  strategy.maxRetries = Math.min(5, current + 1);  // 增加重试次数
  strategy.backoffStrategy = 'linear';              // 快速重试
} else if (recoveryRate < 0.3) {
  strategy.maxRetries = Math.max(1, current - 1);  // 减少重试次数
  strategy.backoffStrategy = 'exponential';         // 慢速重试
}
```

### 3.5 瓶颈检测

#### 3.5.1 检测类型

**1. 慢任务瓶颈**:
- 阈值: 执行时长 > 2000ms
- 影响: 用户等待时间长
- 解决方案: 优化算法、增加缓存、异步处理

**2. 高失败率瓶颈**:
- 阈值: 失败率 > 20%
- 影响: 系统可靠性差
- 解决方案: 增强错误处理、改进重试策略

**3. 缓存未命中瓶颈**:
- 阈值: 命中率 < 50%
- 影响: 重复计算浪费资源
- 解决方案: 扩大缓存、优化缓存键、预测性缓存

#### 3.5.2 命令使用

```bash
node advanced-optimizer.js bottleneck [--days=7] [--threshold-slow=2000]
```

**输出示例**:
```
性能瓶颈检测
============
检测周期: 7天

检测到 8 个瓶颈:

【严重】慢任务瓶颈
-----------------
1. RAG向量搜索
   - 平均耗时: 4,567ms (阈值: 2000ms)
   - 执行次数: 234次
   - 累计浪费: 10.2分钟
   - 影响用户: 89人

   建议优化:
   ✓ 建立向量索引 (预计提速60%)
   ✓ 启用查询缓存
   ✓ 限制返回结果数量

2. PDF文档OCR
   - 平均耗时: 8,234ms
   - 执行次数: 67次
   - 累计浪费: 6.9分钟

   建议优化:
   ✓ 分页并行处理
   ✓ 降低OCR精度(准确率要求不高时)
   ✓ 缓存已处理页面

【中等】高失败率瓶颈
------------------
3. Git远程同步
   - 失败率: 28.5% (阈值: 20%)
   - 尝试次数: 123次
   - 失败次数: 35次

   建议优化:
   ✓ 增加超时时间(10s → 30s)
   ✓ 改进冲突检测
   ✓ 添加离线队列

【轻微】缓存命中瓶颈
------------------
4. LLM响应缓存
   - 命中率: 42.3% (阈值: 50%)
   - 查询次数: 567次
   - 未命中: 327次

   建议优化:
   ✓ 规范化用户输入(提高匹配率)
   ✓ 使用语义相似度匹配
   ✓ 扩大缓存容量(100 → 500条)

综合建议:
=========
1. 优先级排序: RAG搜索 > PDF OCR > Git同步
2. 预期收益: 优化后可节省 18.5分钟/周
3. 实施难度: 中等
4. 建议开始: RAG索引优化(收益最高,难度较低)
```

### 3.6 综合优化

#### 3.6.1 一键优化

```bash
node advanced-optimizer.js optimize
```

执行所有优化并生成综合报告:

```
高级优化执行报告
================

[1/4] 预测性缓存
✓ 已识别 18 个高置信度模式
✓ 已预加载 12 个资源
✓ 预期命中率提升: +22%

[2/4] 并行任务优化
✓ 已识别 12 个可并行任务组
✓ 预期时间节约: 38.5%
✓ 已应用配置优化

[3/4] 智能重试机制
✓ 已分析 4 种失败类型
✓ 已调整重试策略
✓ 预期恢复率提升: +9.8%

[4/4] 瓶颈检测
✓ 已检测 8 个性能瓶颈
✓ 已生成优化建议
✓ 预期总体性能提升: 35.2%

优化建议已保存到数据库
运行以下命令查看详情:
  node advanced-optimizer.js predict
  node advanced-optimizer.js parallel
  node advanced-optimizer.js retry
  node advanced-optimizer.js bottleneck
```

### 3.7 最佳实践

1. **定期优化**:
   - 每周运行一次 `optimize` 获取全局视图
   - 关键功能发布后立即检测瓶颈
   - 用户反馈性能问题时深度分析

2. **预测性缓存**:
   - 从高频操作开始(置信度 > 80%)
   - 监控缓存命中率变化
   - 定期清理过期预缓存(避免内存浪费)

3. **并行优化**:
   - 优先并行化耗时 > 1s的任务
   - 注意CPU/IO密集型任务平衡
   - 设置合理的并行度(通常 = CPU核心数)

4. **重试策略**:
   - 瞬时故障: 快速重试(线性退避)
   - 过载故障: 慢速重试(指数退避)
   - 永久故障: 不重试(快速失败)

5. **瓶颈优化优先级**:
   ```
   高优先级:
   - 影响用户多(>100人)
   - 频率高(>100次/天)
   - 耗时长(>5s)

   中优先级:
   - 失败率高(>30%)
   - 缓存命中低(<40%)

   低优先级:
   - 偶发问题
   - 影响范围小
   ```

---

## 4. 集成使用场景

### 4.1 场景1: 新系统部署

**步骤**:

1. **第1周: 数据收集**
   ```bash
   # 仅运行监控,不执行调整
   node adaptive-threshold.js monitor
   node online-learning.js stats
   node advanced-optimizer.js bottleneck
   ```

2. **第2周: 基线建立**
   ```bash
   # 训练初始模型
   node online-learning.js train --days=7

   # 模拟阈值调整
   node adaptive-threshold.js simulate
   ```

3. **第3周: 启用自动化**
   ```bash
   # 启动自适应阈值
   node adaptive-threshold.js auto --interval=120

   # 定期训练模型(cron任务)
   0 2 * * 0 cd /path/to/app && node online-learning.js train --days=30
   ```

4. **第4周: 全面优化**
   ```bash
   # 运行综合优化
   node advanced-optimizer.js optimize

   # 应用优化建议
   # (根据报告手动实施)
   ```

### 4.2 场景2: 性能问题排查

**问题**: 用户反馈系统响应慢

**排查流程**:

```bash
# Step 1: 检测瓶颈
node advanced-optimizer.js bottleneck --days=1

# 输出显示: "RAG向量搜索平均耗时4.5s"

# Step 2: 分析并行化机会
node advanced-optimizer.js parallel --days=1

# 输出显示: "RAG处理可并行化,预期提速40%"

# Step 3: 检查缓存效率
node advanced-optimizer.js predict --days=7

# 输出显示: "RAG缓存命中率仅35%"

# 解决方案:
# 1. 建立向量索引(解决慢查询)
# 2. 并行处理多文档(提升吞吐量)
# 3. 启用预测性缓存(提高命中率)
```

### 4.3 场景3: 成本优化

**目标**: 降低LLM API成本

**优化流程**:

```bash
# Step 1: 检查当前小模型使用率
node adaptive-threshold.js monitor

# 输出: "小模型使用率38%(目标45%)"

# Step 2: 调整阈值增加小模型使用
node adaptive-threshold.js adjust

# 输出: "阈值调整 0.52→0.56,预期成本降低12%"

# Step 3: 训练复杂度估计器提高准确性
node online-learning.js train --days=30

# 输出: "复杂度预测准确率提升至87%"

# Step 4: 验证成本节约
node adaptive-threshold.js monitor --days=7

# 输出: "平均成本节约72%(↑4%)"
```

### 4.4 场景4: A/B测试验证

**场景**: 测试新的缓存策略效果

```bash
# 对照组: 使用当前策略运行7天
# 记录基线指标

# 实验组: 启用预测性缓存
node advanced-optimizer.js predict
# 应用预加载建议

# 7天后对比
# 指标: 响应时间、缓存命中率、用户满意度

# 如果实验组表现更好,推广到全部用户
# 否则,回滚并分析失败原因
```

---

## 5. 常见问题与故障排查

### 5.1 自适应阈值相关

**Q1: 阈值一直在震荡,不收敛**

A: 可能原因和解决方案:
```bash
# 原因1: 学习率过高
# 解决: 修改配置 learningRate: 0.05 → 0.02

# 原因2: 样本量不足
# 解决: 增加 minSampleSize: 50 → 100

# 原因3: 数据质量差(异常值多)
# 解决: 清理异常数据
sqlite3 data/chainlesschain.db "DELETE FROM knowledge_distillation_history
WHERE execution_time_ms > 60000 OR execution_time_ms < 10;"
```

**Q2: 调整后性能反而下降**

A: 回滚操作:
```bash
# 查看调整历史
sqlite3 data/chainlesschain.db "SELECT * FROM threshold_adjustment_history
ORDER BY created_at DESC LIMIT 5;"

# 手动回滚到之前的阈值
sqlite3 data/chainlesschain.db "UPDATE ai_engine_config
SET config_value='0.52' WHERE config_key='complexity_threshold';"

# 重启应用使配置生效
```

**Q3: 评分一直很低(<70)**

A: 诊断步骤:
```bash
# 检查各项指标
node adaptive-threshold.js monitor --days=30

# 如果小模型使用率过低: 增大阈值
# 如果成功率低: 检查模型能力,考虑降低阈值
# 如果质量分数低: 分析具体失败案例

# 查看失败案例
sqlite3 data/chainlesschain.db "SELECT user_input, actual_complexity,
selected_model, is_success FROM knowledge_distillation_history
WHERE is_success=0 ORDER BY created_at DESC LIMIT 10;"
```

### 5.2 在线学习相关

**Q1: 训练后准确率没有提升**

A: 检查清单:
```bash
# 1. 数据量是否充足
node online-learning.js stats
# 如果训练样本 < 500,收集更多数据

# 2. 数据是否有偏差
sqlite3 data/chainlesschain.db "SELECT actual_complexity, COUNT(*)
FROM knowledge_distillation_history GROUP BY actual_complexity;"
# 确保各复杂度等级分布均匀

# 3. 学习率是否合适
# 过高: 模型震荡,修改为 learningRate: 0.05 → 0.01
# 过低: 收敛慢,修改为 learningRate: 0.01 → 0.05

# 4. 检查模型权重变化
# 如果权重几乎不变,可能已收敛或学习率过低
```

**Q2: 意图识别准确率低**

A: 优化策略:
```bash
# 1. 降低置信度阈值
# 修改配置 confidenceThreshold: 0.7 → 0.5

# 2. 增加训练数据
node online-learning.js train --days=60

# 3. 分析常见误判
sqlite3 data/chainlesschain.db "SELECT user_input, detected_intents,
actual_intent FROM multi_intent_history WHERE is_success=0 LIMIT 20;"

# 4. 手动添加关键模式
# 在代码中添加种子模式(bootstrap)
```

**Q3: 工具推荐采纳率低**

A: 可能原因:
```bash
# 1. 推荐不相关工具
# 检查偏好评分逻辑,可能需要调整权重:
#   successRate * 0.7 → 0.8 (更重视成功率)

# 2. 用户习惯未被学习
# 检查 user_feedback 表是否有数据
sqlite3 data/chainlesschain.db "SELECT COUNT(*) FROM user_feedback;"

# 3. 工具使用数据不足
# 等待更多数据积累,或人工设置初始偏好
```

### 5.3 高级优化器相关

**Q1: 预测性缓存内存占用过高**

A: 调整配置:
```javascript
// 减少预测数量
maxPredictions: 10 → 5

// 缩短缓存过期时间
cacheExpiry: 1800000 → 600000  // 30分钟 → 10分钟

// 提高置信度阈值(只缓存高置信度预测)
confidenceThreshold: 0.6 → 0.8
```

**Q2: 并行优化后反而变慢**

A: 诊断:
```bash
# 1. 检查CPU使用率
# 如果CPU已满载,并行反而增加上下文切换开销
# 解决: 降低 maxParallelTasks: 4 → 2

# 2. 检查是否有资源竞争
# 例如: 多个任务同时访问数据库
# 解决: 使用连接池或改为顺序执行

# 3. 检查任务是否真的独立
# 可能存在隐式依赖
# 解决: 手动标记依赖关系
```

**Q3: 重试策略不生效**

A: 检查:
```bash
# 1. 确认重试配置已应用
sqlite3 data/chainlesschain.db "SELECT * FROM ai_engine_config
WHERE config_key LIKE '%retry%';"

# 2. 检查错误类型是否可重试
# 某些错误(如参数错误)不应重试
# 修改代码添加错误类型判断

# 3. 查看重试日志
# 确认重试逻辑确实执行
tail -f logs/retry.log
```

### 5.4 集成问题

**Q1: 三个系统配置冲突**

A: 协调原则:
```
优先级: 自适应阈值 > 在线学习 > 高级优化器

冲突示例:
- 自适应阈值建议提高复杂度阈值(使用更多小模型)
- 在线学习发现小模型准确率下降

解决: 听从自适应阈值,但监控质量分数
如果质量下降超过阈值,手动干预
```

**Q2: 数据库锁定冲突**

A: 如果多个工具同时运行导致数据库锁定:
```bash
# 使用串行执行
node adaptive-threshold.js auto &
sleep 60
node online-learning.js train &
sleep 60
node advanced-optimizer.js optimize &

# 或使用数据库WAL模式(Write-Ahead Logging)
sqlite3 data/chainlesschain.db "PRAGMA journal_mode=WAL;"
```

### 5.5 性能调优

**Q1: 工具运行太慢**

A: 优化建议:
```bash
# 1. 限制数据查询范围
--days=30 → --days=7

# 2. 添加数据库索引
sqlite3 data/chainlesschain.db "CREATE INDEX IF NOT EXISTS
idx_kd_created ON knowledge_distillation_history(created_at);"

# 3. 定期清理历史数据(保留90天)
sqlite3 data/chainlesschain.db "DELETE FROM knowledge_distillation_history
WHERE created_at < datetime('now', '-90 days');"
```

**Q2: 监控开销大**

A: 异步化监控:
```bash
# 使用后台任务代替实时监控
# Cron配置示例:

# 每小时运行一次自适应阈值检查
0 * * * * cd /app && node adaptive-threshold.js auto --interval=60 >> logs/adaptive.log 2>&1

# 每天凌晨2点训练模型
0 2 * * * cd /app && node online-learning.js train --days=30 >> logs/learning.log 2>&1

# 每周日早上4点全面优化
0 4 * * 0 cd /app && node advanced-optimizer.js optimize >> logs/optimizer.log 2>&1
```

---

## 6. 附录

### 6.1 数据库表结构

**threshold_adjustment_history**:
```sql
CREATE TABLE threshold_adjustment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_threshold REAL,
  new_threshold REAL,
  adjustment_amount REAL,
  reason TEXT,
  metrics_before TEXT,  -- JSON
  metrics_after TEXT,   -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**online_learning_models**:
```sql
CREATE TABLE online_learning_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_type TEXT,  -- 'complexity_estimator', 'intent_recognizer', etc.
  model_weights TEXT,  -- JSON
  training_examples_count INTEGER,
  last_trained_at DATETIME,
  performance_metrics TEXT,  -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**optimization_cache**:
```sql
CREATE TABLE optimization_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_type TEXT,  -- 'predictive', 'parallel', 'retry'
  cache_key TEXT,
  cache_value TEXT,  -- JSON
  confidence_score REAL,
  hit_count INTEGER DEFAULT 0,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.2 API参考

**adaptive-threshold.js**:
```javascript
// 编程接口
const AdaptiveThresholdManager = require('./adaptive-threshold');
const manager = new AdaptiveThresholdManager(db);

// 监控性能
const result = await manager.monitorPerformance(days=7);

// 计算最优阈值
const optimalThreshold = await manager.calculateOptimalThreshold(data);

// 评分
const score = manager.scoreThreshold(metrics);
```

**online-learning.js**:
```javascript
const OnlineLearningManager = require('./online-learning');
const manager = new OnlineLearningManager(db);

// 训练所有模型
await manager.trainAllModels(days=30);

// 预测复杂度
const complexity = manager.predictComplexity(features);

// 识别意图
const intents = manager.recognizeIntent(userInput);

// 推荐工具
const tools = manager.recommendTools(taskType);
```

**advanced-optimizer.js**:
```javascript
const AdvancedOptimizer = require('./advanced-optimizer');
const optimizer = new AdvancedOptimizer(db);

// 预测性缓存
const predictions = await optimizer.predictiveCaching();

// 并行优化
const parallelGroups = await optimizer.parallelOptimization();

// 智能重试
const retryStrategy = await optimizer.smartRetry();

// 瓶颈检测
const bottlenecks = await optimizer.bottleneckDetection();
```

### 6.3 配置文件示例

**config/advanced-features.json**:
```json
{
  "adaptiveThreshold": {
    "enabled": true,
    "autoAdjust": true,
    "interval": 60,
    "targets": {
      "smallModelRate": {"min": 40, "max": 60, "ideal": 45},
      "successRate": {"min": 85, "ideal": 95},
      "costSavings": {"min": 50, "ideal": 70}
    }
  },
  "onlineLearning": {
    "enabled": true,
    "autoTrain": true,
    "trainSchedule": "0 2 * * 0",
    "models": {
      "complexityEstimator": {"learningRate": 0.01},
      "intentRecognizer": {"confidenceThreshold": 0.7},
      "toolSelector": {"learningRate": 0.1},
      "userPreference": {"learningRate": 0.05}
    }
  },
  "advancedOptimizer": {
    "enabled": true,
    "features": {
      "predictiveCache": true,
      "parallelOptimization": true,
      "smartRetry": true,
      "bottleneckDetection": true
    },
    "config": {
      "maxParallelTasks": 4,
      "cacheExpiry": 1800000,
      "retryMaxAttempts": 3
    }
  }
}
```

### 6.4 监控仪表板

访问 http://localhost:3000/dashboard 查看可视化监控面板,包含:

- 阈值调整历史曲线
- 模型训练性能趋势
- 优化效果对比图表
- 实时瓶颈告警

### 6.5 参考资料

- [梯度下降算法](https://en.wikipedia.org/wiki/Gradient_descent)
- [N-gram语言模型](https://en.wikipedia.org/wiki/N-gram)
- [指数退避算法](https://en.wikipedia.org/wiki/Exponential_backoff)
- [多目标优化](https://en.wikipedia.org/wiki/Multi-objective_optimization)
- [在线机器学习](https://en.wikipedia.org/wiki/Online_machine_learning)

---

**文档版本**: 1.0.0
**最后更新**: 2026-01-02
**维护者**: ChainlessChain Team
