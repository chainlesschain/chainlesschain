# 知识蒸馏阈值调优指南

## 概述

知识蒸馏是 P2 优化的核心功能之一，通过智能选择小模型 (qwen2.5:1.5b) 或大模型 (qwen2.5:7b) 来执行任务，可实现 **69.6% 的成本节省**，同时保持任务质量。

**当前配置**:
- 小模型: `qwen2.5:1.5b`
- 大模型: `qwen2.5:7b`
- 当前阈值: `0.35`
- 目标小模型使用率: `40-60%` (理想值 45%)
- 目标成本节省: `>= 50%` (理想值 69.6%)

## 工作原理

### 复杂度评估

系统为每个任务计算复杂度分数 (0-1 之间):

```javascript
complexity_score = (
  intent_complexity * 0.3 +      // 意图复杂度
  context_complexity * 0.25 +    // 上下文复杂度
  history_complexity * 0.2 +     // 历史复杂度
  tools_complexity * 0.25        // 工具复杂度
)
```

### 模型选择逻辑

```javascript
if (complexity_score < threshold) {
  // 使用小模型 (qwen2.5:1.5b)
  // 适合简单任务：基础对话、简单查询、常规操作
  selectedModel = 'qwen2.5:1.5b';
} else {
  // 使用大模型 (qwen2.5:7b)
  // 适合复杂任务：多步骤规划、复杂推理、创意生成
  selectedModel = 'qwen2.5:7b';
}
```

### 复杂度级别分类

- **simple** (0.0 - 0.3): 简单任务，优先小模型
- **medium** (0.3 - 0.5): 中等任务，根据阈值选择
- **complex** (0.5 - 0.7): 复杂任务，优先大模型
- **very_complex** (0.7 - 1.0): 极复杂任务，强制大模型

## 调优工具使用

### 1. 分析当前数据

```bash
node tune-distillation-threshold.js analyze
```

**输出内容**:
- 基本统计（总任务数、平均复杂度）
- 模型使用分布（小模型 vs 大模型比例）
- 复杂度级别分布
- 阈值附近任务分析
- 当前效果评估（小模型使用率、成本节省）

**何时运行**:
- 系统运行 1 周后（至少 100 个任务）
- 每月定期检查
- 发现性能或成本问题时

### 2. 模拟不同阈值

```bash
node tune-distillation-threshold.js simulate 0.4
```

**用途**:
- 在不实际修改配置的情况下测试新阈值
- 预测小模型使用率和成本节省效果
- 比较不同阈值的表现

**示例**:
```bash
# 测试更保守的阈值（增加大模型使用）
node tune-distillation-threshold.js simulate 0.3

# 测试更激进的阈值（增加小模型使用）
node tune-distillation-threshold.js simulate 0.45
```

### 3. 推荐最佳阈值

```bash
node tune-distillation-threshold.js recommend
```

**功能**:
- 自动测试多个阈值 (0.25, 0.30, 0.35, 0.40, 0.45, 0.50)
- 基于目标指标计算综合评分
- 推荐得分最高的阈值
- 提供实施步骤

**评分标准**:
- 小模型使用率在 40-60% 范围内: +50 分
- 成本节省 >= 50%: +50 分
- 总分: 100 分

## 调优策略

### 数据收集阶段 (第 1-2 周)

**目标**: 收集足够的生产数据

- ✅ 保持当前阈值 0.35
- ✅ 确保 `enableKnowledgeDistillation = true`
- ✅ 每天运行监控脚本: `node monitor-production.js 7`
- ✅ 观察用户使用模式

**成功标准**: 至少 100 个任务记录

### 初步分析阶段 (第 3 周)

**目标**: 评估当前阈值效果

```bash
# 1. 分析数据
node tune-distillation-threshold.js analyze

# 2. 获取推荐
node tune-distillation-threshold.js recommend
```

**决策树**:

```
小模型使用率 < 40%
  └─> 阈值偏低，尝试提高到 0.40-0.45

小模型使用率 40-60%
  └─> 阈值合适，保持当前值

小模型使用率 > 60%
  └─> 阈值偏高，尝试降低到 0.25-0.30
```

### 调整实施阶段 (第 4 周)

**步骤**:

1. **模拟验证**
   ```bash
   node tune-distillation-threshold.js simulate <new_threshold>
   ```

2. **修改配置**

   编辑 `src/main/ai-engine/ai-engine-config.js`:
   ```javascript
   distillationConfig: {
     enableDistillation: true,
     smallModel: 'qwen2.5:1.5b',
     largeModel: 'qwen2.5:7b',
     complexityThreshold: 0.40,  // 修改这里
     // ...
   }
   ```

3. **重新构建**
   ```bash
   npm run build:main
   ```

4. **重启应用**

5. **观察效果**

   1 周后运行分析:
   ```bash
   node tune-distillation-threshold.js analyze
   ```

### 持续优化阶段 (长期)

**监控频率**: 每月一次

**指标追踪**:
- 小模型使用率趋势
- 成本节省趋势
- 用户满意度（来自反馈系统）
- 任务成功率

**调整触发条件**:
- 小模型使用率偏离目标范围超过 10%
- 成本节省低于 50%
- 用户反馈质量下降
- 复杂度分布发生重大变化

## 实战案例

### 案例 1: 小模型使用率过低

**症状**:
```
分析结果:
  小模型使用率: 28%
  成本节省: 35%
```

**诊断**: 阈值过低 (0.35)，大部分任务都被分配给大模型

**解决方案**:
1. 模拟更高的阈值:
   ```bash
   node tune-distillation-threshold.js simulate 0.45
   ```

2. 如果模拟结果显示小模型使用率达到 45-50%，则应用新阈值

3. 观察 1 周，检查任务质量是否下降

### 案例 2: 小模型使用率过高

**症状**:
```
分析结果:
  小模型使用率: 72%
  用户反馈: 任务失败率增加
```

**诊断**: 阈值过高，很多复杂任务被错误分配给小模型

**解决方案**:
1. 检查失败任务的复杂度分布
2. 降低阈值到 0.30
3. 重点监控用户满意度指标

### 案例 3: 阈值附近任务过多

**症状**:
```
阈值附近的任务 (0.30 - 0.40):
  0.33: qwen2.5:1.5b (45 次)
  0.34: qwen2.5:1.5b (52 次)
  0.35: qwen2.5:7b (48 次)    ← 阈值
  0.36: qwen2.5:7b (51 次)
```

**诊断**: 大量任务集中在阈值附近，模型选择不稳定

**解决方案**:
1. 分析 0.33-0.36 范围内任务的实际表现
2. 如果小模型表现良好，提高阈值到 0.37
3. 如果小模型表现不佳，降低阈值到 0.32

## 配置参数详解

### distillationConfig

```javascript
{
  enableDistillation: true,           // 是否启用知识蒸馏
  smallModel: 'qwen2.5:1.5b',        // 小模型名称
  largeModel: 'qwen2.5:7b',          // 大模型名称
  complexityThreshold: 0.35,         // 复杂度阈值（核心参数）
  fallbackToLarge: true,             // 小模型失败时回退到大模型
  cacheEnabled: true,                // 启用复杂度评估缓存
  logDistillationDecisions: true     // 记录每次决策（用于分析）
}
```

### 阈值调整建议

| 阈值范围 | 小模型使用率 | 成本节省 | 适用场景 |
|---------|------------|---------|---------|
| 0.20-0.30 | 65-75% | 70-75% | 用户主要执行简单任务 |
| 0.30-0.40 | 45-60% | 60-70% | 任务复杂度均衡（推荐） |
| 0.40-0.50 | 30-45% | 50-60% | 用户经常执行复杂任务 |
| 0.50-0.60 | 15-30% | 35-50% | 极高质量要求场景 |

## 监控指标

### 关键性能指标 (KPI)

1. **小模型使用率**
   - 目标: 40-60%
   - 查询:
     ```sql
     SELECT
       actual_model,
       COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
     FROM knowledge_distillation_history
     WHERE created_at >= datetime('now', '-7 days')
     GROUP BY actual_model;
     ```

2. **成本节省率**
   - 目标: >= 50%
   - 计算公式:
     ```
     成本节省 = (全大模型成本 - 实际成本) / 全大模型成本 * 100%
     ```

3. **任务成功率**
   - 目标: >= 95%
   - 查询:
     ```sql
     SELECT
       AVG(CASE WHEN final_success = 1 THEN 1.0 ELSE 0.0 END) * 100 as success_rate
     FROM self_correction_history
     WHERE created_at >= datetime('now', '-7 days');
     ```

4. **用户满意度**
   - 目标: >= 4.0/5.0
   - 查询:
     ```sql
     SELECT AVG(overall_satisfaction) as avg_satisfaction
     FROM satisfaction_surveys
     WHERE created_at >= datetime('now', '-30 days');
     ```

### 监控脚本

**每日监控**:
```bash
node monitor-production.js 1
```

**每周分析**:
```bash
node tune-distillation-threshold.js analyze
```

**每月调优**:
```bash
node tune-distillation-threshold.js recommend
```

## 故障排查

### 问题: 没有知识蒸馏记录

**可能原因**:
1. 功能未启用
2. AI Engine 未运行
3. 数据库连接问题

**检查步骤**:
```bash
# 1. 检查配置
node -e "console.log(require('./src/main/ai-engine/ai-engine-config').getAIEngineConfig().enableKnowledgeDistillation)"

# 2. 检查数据库表
node -e "
const DatabaseManager = require('./src/main/database');
const db = new DatabaseManager('./data/chainlesschain.db', {encryptionEnabled: false});
db.initialize().then(() => {
  const tables = db.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_distillation_history'\").all();
  console.log('Tables:', tables);
  db.close();
});
"

# 3. 运行测试
npm run test:db
```

### 问题: 小模型使用率异常

**诊断**:
```bash
# 查看复杂度分布
node tune-distillation-threshold.js analyze
```

**可能原因**:
- 复杂度评估算法需要调整
- 用户使用模式变化
- 阈值设置不当

### 问题: 成本节省不达标

**分析步骤**:
1. 检查小模型使用率是否过低
2. 检查是否有大量回退到大模型的情况
3. 分析失败任务的复杂度分布

## 最佳实践

### ✅ DO (应该做)

1. **定期监控**: 每周至少运行一次分析
2. **小步调整**: 每次阈值调整不超过 ±0.05
3. **A/B 测试**: 在调整前先用 simulate 命令验证
4. **记录变更**: 保留每次调整的原因和效果
5. **关注反馈**: 结合用户满意度调整策略
6. **数据驱动**: 基于至少 100 个任务的数据做决策

### ❌ DON'T (不应该做)

1. **频繁调整**: 不要每天修改阈值
2. **大幅变动**: 不要一次调整超过 0.1
3. **忽视用户**: 不要只看成本忽视用户体验
4. **过度优化**: 不要为了节省成本牺牲质量
5. **盲目调整**: 不要在数据不足时调整阈值

## 附录

### A. 阈值调优时间表

| 阶段 | 时间 | 任务 | 目标 |
|-----|------|------|------|
| 数据收集 | 第 1-2 周 | 保持默认配置，运行系统 | 收集 >= 100 个任务 |
| 初步分析 | 第 3 周 | 运行 analyze 和 recommend | 评估当前效果 |
| 调整实施 | 第 4 周 | 应用推荐阈值 | 优化指标 |
| 持续监控 | 第 5 周起 | 每月运行 analyze | 保持稳定 |

### B. 相关文件

- **配置文件**: `src/main/ai-engine/ai-engine-config.js`
- **调优工具**: `tune-distillation-threshold.js`
- **监控脚本**: `monitor-production.js`
- **数据库表**: `knowledge_distillation_history`
- **部署指南**: `P0_P1_P2_PRODUCTION_DEPLOYMENT_GUIDE.md`

### C. 参考资源

- **知识蒸馏论文**: [DistilBERT, a distilled version of BERT](https://arxiv.org/abs/1910.01108)
- **复杂度评估**: 基于任务意图、上下文、历史和工具需求的多维度分析
- **成本优化**: [大模型成本优化最佳实践](https://docs.qwenlm.ai/docs/optimization/)

---

**最后更新**: 2026-01-02
**版本**: v1.0
**作者**: ChainlessChain Team
