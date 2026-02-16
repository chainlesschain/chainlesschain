# tool-stats-dashboard

**Source**: `src/main/skill-tool-system/tool-stats-dashboard.js`

**Generated**: 2026-02-16T13:44:34.612Z

---

## const

```javascript
const
```

* 工具使用统计仪表板
 * 提供工具使用情况的实时统计和分析

---

## async getOverview()

```javascript
async getOverview()
```

* 获取工具使用概览

---

## async getToolRankings(limit = 10)

```javascript
async getToolRankings(limit = 10)
```

* 获取工具排行榜

---

## async getCategoryStats()

```javascript
async getCategoryStats()
```

* 获取分类统计

---

## async getRecentlyUsedTools(limit = 20)

```javascript
async getRecentlyUsedTools(limit = 20)
```

* 获取最近使用的工具

---

## async getDailyStats(days = 7)

```javascript
async getDailyStats(days = 7)
```

* 获取每日统计

---

## async getPerformanceMetrics()

```javascript
async getPerformanceMetrics()
```

* 获取性能指标

---

## async getDashboardDataWithFilters(filters =

```javascript
async getDashboardDataWithFilters(filters =
```

* 获取完整仪表板数据（带筛选）
   * @param {Object} filters - 筛选条件
   * @param {Array} filters.dateRange - 时间范围 [startDate, endDate] (ISO格式)
   * @param {Array} filters.categories - 分类筛选
   * @param {String} filters.searchKeyword - 搜索关键词

---

## async getDashboardData()

```javascript
async getDashboardData()
```

* 获取完整仪表板数据（无筛选，保持向后兼容）

---

## async _getFilteredOverview(whereClause, params, dateRange)

```javascript
async _getFilteredOverview(whereClause, params, dateRange)
```

* 获取筛选后的概览数据（内部方法）

---

## async _getFilteredRankings(whereClause, params, limit)

```javascript
async _getFilteredRankings(whereClause, params, limit)
```

* 获取筛选后的排行榜（内部方法）

---

## async _getFilteredCategoryStats(whereClause, params)

```javascript
async _getFilteredCategoryStats(whereClause, params)
```

* 获取筛选后的分类统计（内部方法）

---

## async _getFilteredRecentTools(whereClause, params, limit, dateRange)

```javascript
async _getFilteredRecentTools(whereClause, params, limit, dateRange)
```

* 获取筛选后的最近使用工具（内部方法）

---

## async _getFilteredDailyStats(days, dateRange, categories, searchKeyword)

```javascript
async _getFilteredDailyStats(days, dateRange, categories, searchKeyword)
```

* 获取筛选后的每日统计（内部方法）

---

## async _getFilteredPerformanceMetrics(whereClause, params)

```javascript
async _getFilteredPerformanceMetrics(whereClause, params)
```

* 获取筛选后的性能指标（内部方法）

---

## async generateTextDashboard()

```javascript
async generateTextDashboard()
```

* 生成文本格式的仪表板

---

## _formatTimeSince(timestamp)

```javascript
_formatTimeSince(timestamp)
```

* 格式化时间差

---

## async function showDashboard()

```javascript
async function showDashboard()
```

* CLI工具

---

