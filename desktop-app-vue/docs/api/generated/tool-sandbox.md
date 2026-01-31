# tool-sandbox

**Source**: `src\main\ai-engine\tool-sandbox.js`

**Generated**: 2026-01-27T06:44:03.875Z

---

## const

```javascript
const
```

* 工具执行沙箱 (Tool Sandbox)
 * 为工具调用提供安全执行环境
 *
 * 核心功能:
 * 1. 超时保护 (Timeout Protection)
 * 2. 自动重试 (Auto Retry with Exponential Backoff)
 * 3. 结果校验 (Result Validation)
 * 4. 快照回滚 (Snapshot & Rollback)
 * 5. 错误日志记录

---

## async executeSafely(toolName, params =

```javascript
async executeSafely(toolName, params =
```

* 安全执行工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 执行结果

---

## async executeWithRetries(toolName, params, context, config)

```javascript
async executeWithRetries(toolName, params, context, config)
```

* 带重试的执行
   * @private

---

## isRetryableError(error)

```javascript
isRetryableError(error)
```

* 判断错误是否可重试
   * @private

---

## timeoutPromise(ms, toolName)

```javascript
timeoutPromise(ms, toolName)
```

* 创建超时Promise
   * @private

---

## async validateResult(result, toolName)

```javascript
async validateResult(result, toolName)
```

* 校验结果
   * @private

---

## async createSnapshot(toolName, params, context)

```javascript
async createSnapshot(toolName, params, context)
```

* 创建快照
   * @private

---

## async rollback(snapshot)

```javascript
async rollback(snapshot)
```

* 回滚快照
   * @private

---

## isFileOperationTool(toolName)

```javascript
isFileOperationTool(toolName)
```

* 判断是否为文件操作工具
   * @private

---

## resolveFilePath(filePath, context)

```javascript
resolveFilePath(filePath, context)
```

* 解析文件路径
   * @private

---

## async logExecution(toolName, params, success, duration, error)

```javascript
async logExecution(toolName, params, success, duration, error)
```

* 记录执行日志
   * @private

---

## classifyError(error)

```javascript
classifyError(error)
```

* 错误分类
   * @private

---

## registerValidator(toolName, validator)

```javascript
registerValidator(toolName, validator)
```

* 注册自定义校验器
   * @param {string} toolName - 工具名称
   * @param {Function} validator - 校验函数 (result) => boolean

---

## async getExecutionStats(timeRange = 24 * 60 * 60 * 1000)

```javascript
async getExecutionStats(timeRange = 24 * 60 * 60 * 1000)
```

* 获取执行统计
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Object>} 统计数据

---

## sleep(ms)

```javascript
sleep(ms)
```

* 睡眠函数
   * @private

---

