# stats-collector

**Source**: `src/main/project/stats-collector.js`

**Generated**: 2026-02-15T07:37:13.797Z

---

## const

```javascript
const
```

* 项目统计收集器
 * 功能：实时收集项目统计数据

---

## startWatching(projectId, projectPath)

```javascript
startWatching(projectId, projectPath)
```

* 启动项目监听

---

## scheduleUpdate(projectId, event, filePath)

```javascript
scheduleUpdate(projectId, event, filePath)
```

* 调度更新（防抖）

---

## async updateStats(projectId, event, filePath)

```javascript
async updateStats(projectId, event, filePath)
```

* 更新统计数据

---

## async calculateStats(projectId)

```javascript
async calculateStats(projectId)
```

* 计算项目统计数据

---

## async getAllFiles(dir, files = [])

```javascript
async getAllFiles(dir, files = [])
```

* 获取所有文件

---

## async analyzeCodeLines(filePath)

```javascript
async analyzeCodeLines(filePath)
```

* 分析代码行数

---

## isCommentLine(trimmed, ext, inBlockComment)

```javascript
isCommentLine(trimmed, ext, inBlockComment)
```

* 判断是否为注释行

---

## isCodeFile(filePath)

```javascript
isCodeFile(filePath)
```

* 判断是否为代码文件

---

## stopWatching(projectId)

```javascript
stopWatching(projectId)
```

* 停止监听

---

## stopAll()

```javascript
stopAll()
```

* 停止所有监听

---

## getStats(projectId)

```javascript
getStats(projectId)
```

* 获取项目统计数据

---

## function getStatsCollector(db)

```javascript
function getStatsCollector(db)
```

* 获取统计收集器单例
 * @param {Object} db - 数据库实例（首次调用时需要）
 * @returns {ProjectStatsCollector}

---

