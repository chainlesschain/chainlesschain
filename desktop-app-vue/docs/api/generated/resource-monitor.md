# resource-monitor

**Source**: `src/main/utils/resource-monitor.js`

**Generated**: 2026-02-21T22:45:05.239Z

---

## const

```javascript
const
```

* 资源监控工具
 * 提供内存、磁盘空间监控和优雅降级策略

---

## getMemoryStatus()

```javascript
getMemoryStatus()
```

* 获取当前内存状态

---

## async getDiskStatus(dirPath)

```javascript
async getDiskStatus(dirPath)
```

* 获取磁盘空间状态
   * @param {string} dirPath - 要检查的目录路径

---

## async _getWindowsDiskSpace(dirPath)

```javascript
async _getWindowsDiskSpace(dirPath)
```

* Windows 平台磁盘空间检查

---

## async _getUnixDiskSpace(dirPath)

```javascript
async _getUnixDiskSpace(dirPath)
```

* Unix/Linux/macOS 平台磁盘空间检查

---

## assessResourceLevel()

```javascript
assessResourceLevel()
```

* 评估当前资源水平

---

## updateResourceLevel()

```javascript
updateResourceLevel()
```

* 更新资源水平并触发事件

---

## getDegradationStrategy(category)

```javascript
getDegradationStrategy(category)
```

* 获取当前降级策略
   * @param {string} category - 策略类别（imageProcessing, ocrProcessing, batchImport）

---

## async checkDiskSpace(dirPath, requiredSpace)

```javascript
async checkDiskSpace(dirPath, requiredSpace)
```

* 检查是否有足够的磁盘空间
   * @param {string} dirPath - 目标目录
   * @param {number} requiredSpace - 需要的空间（字节）

---

## forceGarbageCollection()

```javascript
forceGarbageCollection()
```

* 强制垃圾回收（如果可用）

---

## startMonitoring(interval = 10000)

```javascript
startMonitoring(interval = 10000)
```

* 启动定期监控
   * @param {number} interval - 监控间隔（毫秒）

---

## stopMonitoring()

```javascript
stopMonitoring()
```

* 停止定期监控

---

## async getReport(dirPath)

```javascript
async getReport(dirPath)
```

* 获取资源报告

---

## let globalMonitor = null;

```javascript
let globalMonitor = null;
```

* 单例实例

---

## function getResourceMonitor(options)

```javascript
function getResourceMonitor(options)
```

* 获取全局资源监控器实例

---

