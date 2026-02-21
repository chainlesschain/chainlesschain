# trading-analytics

**Source**: `src/main/trade/trading-analytics.js`

**Generated**: 2026-02-21T22:04:25.768Z

---

## const

```javascript
const
```

* 交易分析模块
 *
 * 提供交易数据分析和可视化功能，包括：
 * - 交易统计和趋势分析
 * - 资产表现分析
 * - 风险评估
 * - 收益分析
 * - 市场洞察

---

## const TimeRange =

```javascript
const TimeRange =
```

* 时间范围

---

## const AnalysisType =

```javascript
const AnalysisType =
```

* 分析类型

---

## class TradingAnalytics extends EventEmitter

```javascript
class TradingAnalytics extends EventEmitter
```

* 交易分析引擎类

---

## async initialize()

```javascript
async initialize()
```

* 初始化分析引擎

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## async getTradingOverview(timeRange = TimeRange.MONTH)

```javascript
async getTradingOverview(timeRange = TimeRange.MONTH)
```

* 获取交易概览
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 交易概览数据

---

## async getTransactionStats(startTime, endTime)

```javascript
async getTransactionStats(startTime, endTime)
```

* 获取交易统计

---

## async getAssetStats(startTime, endTime)

```javascript
async getAssetStats(startTime, endTime)
```

* 获取资产统计

---

## async getOrderStats(startTime, endTime)

```javascript
async getOrderStats(startTime, endTime)
```

* 获取订单统计

---

## async getProfitLossAnalysis(timeRange = TimeRange.MONTH)

```javascript
async getProfitLossAnalysis(timeRange = TimeRange.MONTH)
```

* 获取盈亏分析
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 盈亏数据

---

## async getIncome(startTime, endTime)

```javascript
async getIncome(startTime, endTime)
```

* 获取收入

---

## async getExpenses(startTime, endTime)

```javascript
async getExpenses(startTime, endTime)
```

* 获取支出

---

## async getAssetPerformance(assetId = null, timeRange = TimeRange.MONTH)

```javascript
async getAssetPerformance(assetId = null, timeRange = TimeRange.MONTH)
```

* 获取资产表现分析
   * @param {string} assetId - 资产ID（可选）
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 资产表现数据

---

## async getRiskAssessment()

```javascript
async getRiskAssessment()
```

* 获取风险评估
   * @returns {Promise<Object>} 风险评估数据

---

## async getConcentrationRisk()

```javascript
async getConcentrationRisk()
```

* 获取资产集中度风险

---

## async getLiquidityRisk()

```javascript
async getLiquidityRisk()
```

* 获取流动性风险

---

## async getCounterpartyRisk()

```javascript
async getCounterpartyRisk()
```

* 获取交易对手风险

---

## calculateOverallRisk(risks)

```javascript
calculateOverallRisk(risks)
```

* 计算综合风险评分

---

## getRiskLevel(score)

```javascript
getRiskLevel(score)
```

* 获取风险等级

---

## generateRiskRecommendations(score)

```javascript
generateRiskRecommendations(score)
```

* 生成风险建议

---

## async getMarketTrend(timeRange = TimeRange.MONTH)

```javascript
async getMarketTrend(timeRange = TimeRange.MONTH)
```

* 获取市场趋势
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 市场趋势数据

---

## async getVolumeTrend(startTime, endTime)

```javascript
async getVolumeTrend(startTime, endTime)
```

* 获取交易量趋势

---

## async getPriceTrend(startTime, endTime)

```javascript
async getPriceTrend(startTime, endTime)
```

* 获取价格趋势

---

## async getActivityTrend(startTime, endTime)

```javascript
async getActivityTrend(startTime, endTime)
```

* 获取活跃度趋势

---

## getTimeRange(range)

```javascript
getTimeRange(range)
```

* 获取时间范围

---

## getInterval(startTime, endTime)

```javascript
getInterval(startTime, endTime)
```

* 获取时间间隔（用于分组）

---

## getCache(key)

```javascript
getCache(key)
```

* 获取缓存

---

## setCache(key, data)

```javascript
setCache(key, data)
```

* 设置缓存

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## async destroy()

```javascript
async destroy()
```

* 销毁分析引擎

---

