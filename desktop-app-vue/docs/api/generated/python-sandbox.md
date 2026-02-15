# python-sandbox

**Source**: `src/main/sandbox/python-sandbox.js`

**Generated**: 2026-02-15T10:10:53.378Z

---

## const

```javascript
const
```

* Python Sandbox Manager
 *
 * 安全的 Python 代码执行环境
 * 使用 Docker 隔离，支持资源限制和超时保护
 *
 * @module python-sandbox
 * @version 1.0.0
 *
 * 安全特性:
 * - 网络隔离 (NetworkMode: 'none')
 * - 内存限制 (默认 512MB)
 * - CPU 限制 (默认 50%)
 * - 超时保护 (默认 30s)
 * - 文件系统只读

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## const ExecutionStatus =

```javascript
const ExecutionStatus =
```

* 执行状态

---

## class PythonSandbox extends EventEmitter

```javascript
class PythonSandbox extends EventEmitter
```

* Python Sandbox 类

---

## async initialize()

```javascript
async initialize()
```

* 初始化沙箱

---

## async execute(code, options =

```javascript
async execute(code, options =
```

* 执行 Python 代码
   * @param {string} code - Python 代码
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果

---

## async _runInContainer(executionId, workDir, options =

```javascript
async _runInContainer(executionId, workDir, options =
```

* 在 Docker 容器中运行代码
   * @private

---

## async _killContainer(containerName)

```javascript
async _killContainer(containerName)
```

* 终止容器
   * @private

---

## async killExecution(executionId)

```javascript
async killExecution(executionId)
```

* 终止指定执行
   * @param {string} executionId - 执行 ID

---

## async _checkDocker()

```javascript
async _checkDocker()
```

* 检查 Docker 是否可用
   * @private

---

## async _checkImage()

```javascript
async _checkImage()
```

* 检查镜像是否存在
   * @private

---

## async _pullImage()

```javascript
async _pullImage()
```

* 拉取 Docker 镜像
   * @private

---

## async _cleanup(workDir)

```javascript
async _cleanup(workDir)
```

* 清理工作目录
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计数据

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查状态

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置

---

## async close()

```javascript
async close()
```

* 关闭沙箱

---

## function getPythonSandbox(config =

```javascript
function getPythonSandbox(config =
```

* 获取 PythonSandbox 单例
 * @param {Object} config - 配置
 * @returns {PythonSandbox}

---

