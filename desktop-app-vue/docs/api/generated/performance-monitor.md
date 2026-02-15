# performance-monitor

**Source**: `src/main/monitoring/performance-monitor.js`

**Generated**: 2026-02-15T10:10:53.402Z

---

## class PerformanceMonitor

```javascript
class PerformanceMonitor
```

* 性能监控系统 (Performance Monitor)
 * 记录和分析AI Pipeline各阶段的性能指标
 *
 * 核心功能:
 * 1. 记录各阶段耗时 (意图识别、任务规划、工具执行、RAG检索、LLM调用)
 * 2. 生成性能报告 (P50/P90/P95/P99分位数)
 * 3. 识别性能瓶颈
 * 4. 生成优化建议
 * 5. 长期趋势分析

---

## async initDatabase()

```javascript
async initDatabase()
```

* 初始化数据库表
   * @private

---

## async recordPhase(

```javascript
async recordPhase(
```

* 记录阶段性能
   * @param {string} phase - 阶段名称
   * @param {number} duration - 耗时（毫秒）
   * @param {Object} metadata - 元数据
   * @param {string} userId - 用户ID
   * @param {string} sessionId - 会话ID

---

## checkThreshold(phase, duration, metadata)

```javascript
checkThreshold(phase, duration, metadata)
```

* 检查性能阈值
   * @private

---

## async generateReport(timeRange = 7 * 24 * 60 * 60 * 1000)

```javascript
async generateReport(timeRange = 7 * 24 * 60 * 60 * 1000)
```

* 生成性能报告
   * @param {number} timeRange - 时间范围（毫秒），默认7天
   * @returns {Promise<Object>} 性能报告

---

## async generatePhaseReport(phase, since)

```javascript
async generatePhaseReport(phase, since)
```

* 生成单个阶段的报告
   * @private

---

## async findBottlenecks(threshold = 5000, limit = 20)

```javascript
async findBottlenecks(threshold = 5000, limit = 20)
```

* 识别性能瓶颈
   * @param {number} threshold - 慢查询阈值（毫秒），默认5秒
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 慢查询列表

---

## generateOptimizationSuggestions(report)

```javascript
generateOptimizationSuggestions(report)
```

* 生成优化建议
   * @param {Object} report - 性能报告
   * @returns {Array} 优化建议列表

---

## async getSessionPerformance(sessionId)

```javascript
async getSessionPerformance(sessionId)
```

* 获取会话性能详情
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 会话性能数据

---

## async comparePerformance(period1Start, period1End, period2Start, period2End)

```javascript
async comparePerformance(period1Start, period1End, period2Start, period2End)
```

* 比较两个时间段的性能
   * @param {number} period1Start - 时期1开始时间
   * @param {number} period1End - 时期1结束时间
   * @param {number} period2Start - 时期2开始时间
   * @param {number} period2End - 时期2结束时间
   * @returns {Promise<Object>} 对比结果

---

## async getPhaseStats(phase, startTime, endTime)

```javascript
async getPhaseStats(phase, startTime, endTime)
```

* 获取阶段统计
   * @private

---

## calculateImprovement(before, after)

```javascript
calculateImprovement(before, after)
```

* 计算性能提升百分比
   * @private

---

## average(arr)

```javascript
average(arr)
```

* 计算平均值
   * @private

---

## percentile(arr, p)

```javascript
percentile(arr, p)
```

* 计算分位数
   * @private

---

## formatTimeRange(ms)

```javascript
formatTimeRange(ms)
```

* 格式化时间范围
   * @private

---

## async cleanOldData(keepDays = 30)

```javascript
async cleanOldData(keepDays = 30)
```

* 清理旧数据
   * @param {number} keepDays - 保留天数

---

## async exportData(timeRange = 7 * 24 * 60 * 60 * 1000)

```javascript
async exportData(timeRange = 7 * 24 * 60 * 60 * 1000)
```

* 导出性能数据（用于外部分析）
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Array>} 原始性能数据

---

