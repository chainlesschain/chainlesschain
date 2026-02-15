# stats-cleaner

**Source**: `src/main/skill-tool-system/stats-cleaner.js`

**Generated**: 2026-02-15T08:42:37.188Z

---

## const

```javascript
const
```

* 统计数据清理器
 * 定期清理过期的统计数据,优化数据库性能

---

## initialize()

```javascript
initialize()
```

* 初始化并启动定时清理任务

---

## scheduleDailyCleanup()

```javascript
scheduleDailyCleanup()
```

* 每日清理任务

---

## scheduleWeeklyAggregation()

```javascript
scheduleWeeklyAggregation()
```

* 每周汇总任务

---

## scheduleMonthlyCleanup()

```javascript
scheduleMonthlyCleanup()
```

* 每月清理任务

---

## async cleanupUsageLogs()

```javascript
async cleanupUsageLogs()
```

* 清理过期的使用日志

---

## async cleanupExecutionLogs()

```javascript
async cleanupExecutionLogs()
```

* 清理过期的执行日志

---

## async aggregateDailyStats()

```javascript
async aggregateDailyStats()
```

* 汇总每日统计数据

---

## async aggregateSkillStats(date)

```javascript
async aggregateSkillStats(date)
```

* 汇总技能统计

---

## async aggregateToolStats(date)

```javascript
async aggregateToolStats(date)
```

* 汇总工具统计

---

## async aggregateWeeklyStats()

```javascript
async aggregateWeeklyStats()
```

* 汇总每周统计数据

---

## async cleanupOldStats()

```javascript
async cleanupOldStats()
```

* 清理旧的统计数据

---

## async optimizeDatabase()

```javascript
async optimizeDatabase()
```

* 优化数据库

---

## async vacuumDatabase()

```javascript
async vacuumDatabase()
```

* 执行数据库VACUUM

---

## extractErrorType(errorMessage)

```javascript
extractErrorType(errorMessage)
```

* 提取错误类型

---

## async manualCleanup()

```javascript
async manualCleanup()
```

* 手动触发清理

---

## async getCleanupStats()

```javascript
async getCleanupStats()
```

* 获取清理统计

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置

---

## stopAll()

```javascript
stopAll()
```

* 停止所有定时任务

---

