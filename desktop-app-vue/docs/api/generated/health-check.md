# health-check

**Source**: `src/main/monitoring/health-check.js`

**Generated**: 2026-02-21T22:45:05.277Z

---

## const

```javascript
const
```

* 系统健康检查模块
 * 定期检查各个服务和组件的健康状态,并尝试自动修复问题

---

## setupChecks()

```javascript
setupChecks()
```

* 设置所有健康检查

---

## start()

```javascript
start()
```

* 启动健康检查

---

## stop()

```javascript
stop()
```

* 停止健康检查

---

## async runChecks()

```javascript
async runChecks()
```

* 运行所有检查

---

## async checkDatabase()

```javascript
async checkDatabase()
```

* 检查数据库

---

## async checkOllama()

```javascript
async checkOllama()
```

* 检查Ollama服务

---

## async checkQdrant()

```javascript
async checkQdrant()
```

* 检查Qdrant服务

---

## async checkProjectService()

```javascript
async checkProjectService()
```

* 检查Project Service

---

## async checkAIService()

```javascript
async checkAIService()
```

* 检查AI Service

---

## async checkDiskSpace()

```javascript
async checkDiskSpace()
```

* 检查磁盘空间

---

## async checkMemory()

```javascript
async checkMemory()
```

* 检查内存使用

---

## async checkUKey()

```javascript
async checkUKey()
```

* 检查U-Key

---

## async checkNetwork()

```javascript
async checkNetwork()
```

* 检查网络连接

---

## getLastResults()

```javascript
getLastResults()
```

* 获取最后的检查结果

---

## getHealthSummary()

```javascript
getHealthSummary()
```

* 获取健康状况摘要

---

## async logResults(results)

```javascript
async logResults(results)
```

* 记录结果到日志

---

## sleep(ms)

```javascript
sleep(ms)
```

* 工具函数: 睡眠

---

