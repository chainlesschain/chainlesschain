# StatsCleaner API 文档

统计数据清理器 - 定期清理过期数据和优化数据库

**文件路径**: `src\main\skill-tool-system\stats-cleaner.js`

## 类概述

```javascript
class StatsCleaner {
  db; // 
  skillManager; // 
  toolManager; // 
  cleanupTasks; // 
  config; // 
}
```

## 构造函数

```javascript
new StatsCleaner()
```

## 方法

### 公开方法

#### `initialize()`

---

#### `scheduleDailyCleanup()`

初始化并启动定时清理任务

---

#### `catch(error)`

每日清理任务

---

#### `scheduleWeeklyAggregation()`

---

#### `catch(error)`

每周汇总任务

---

#### `scheduleMonthlyCleanup()`

---

#### `catch(error)`

每月清理任务

---

#### `async cleanupUsageLogs()`

---

#### `async cleanupExecutionLogs()`

清理过期的使用日志

---

#### `async aggregateDailyStats()`

清理过期的执行日志

---

#### `async aggregateSkillStats(date)`

汇总每日统计数据

---

#### `for(const skill of skills)`

汇总技能统计

---

#### `if(logs.length === 0)`

---

#### `async aggregateToolStats(date)`

---

#### `for(const tool of tools)`

汇总工具统计

---

#### `if(logs.length === 0)`

---

#### `async aggregateWeeklyStats()`

---

#### `async cleanupOldStats()`

汇总每周统计数据

---

#### `async optimizeDatabase()`

---

#### `async vacuumDatabase()`

优化数据库

---

#### `extractErrorType(errorMessage)`

优化数据库

---

#### `if(!errorMessage)`

优化数据库

---

#### `async manualCleanup()`

提取错误类型

---

#### `catch(error)`

手动触发清理

---

#### `async getCleanupStats()`

---

#### `updateConfig(newConfig)`

---

#### `stopAll()`

更新配置

---


## 事件

如果该类继承自EventEmitter,可以监听以下事件:

(无)

## 示例

```javascript
const statscleaner = new StatsCleaner();

// 初始化并启动定时清理任务
const result = statscleaner.scheduleDailyCleanup();

// 每日清理任务
const result = statscleaner.catch(/* error */);

// 每周汇总任务
const result = statscleaner.catch(/* error */);

```

---

> 自动生成时间: 2026/2/8 20:25:18
