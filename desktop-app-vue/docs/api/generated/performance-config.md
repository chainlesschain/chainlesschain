# performance-config

**Source**: `src/main/remote/logging/performance-config.js`

**Generated**: 2026-02-15T08:42:37.195Z

---

## const PerformanceConfig =

```javascript
const PerformanceConfig =
```

* 远程控制系统性能配置
 *
 * 集中管理性能相关的配置参数
 *
 * @module remote/logging/performance-config

---

## const PerformanceConfig =

```javascript
const PerformanceConfig =
```

* 性能配置

---

## function getConfig(path, defaultValue = undefined)

```javascript
function getConfig(path, defaultValue = undefined)
```

* 获取配置值
 * @param {string} path - 配置路径，如 'logging.batchSize'
 * @param {*} defaultValue - 默认值
 * @returns {*} 配置值

---

## function setConfig(path, value)

```javascript
function setConfig(path, value)
```

* 设置配置值
 * @param {string} path - 配置路径
 * @param {*} value - 配置值

---

## function applyDatabaseOptimizations(database)

```javascript
function applyDatabaseOptimizations(database)
```

* 应用数据库优化设置
 * @param {Object} database - better-sqlite3 数据库实例

---

## function getConfigSummary()

```javascript
function getConfigSummary()
```

* 获取性能配置摘要
 * @returns {Object} 配置摘要

---

