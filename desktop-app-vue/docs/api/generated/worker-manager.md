# worker-manager

**Source**: `src\renderer\utils\worker-manager.js`

**Generated**: 2026-01-27T06:44:03.893Z

---

## export class WorkerManager

```javascript
export class WorkerManager
```

* Web Worker Manager
 * 管理Web Workers的生命周期和通信

---

## async createWorker(name, workerPath, options =

```javascript
async createWorker(name, workerPath, options =
```

* 创建Worker
   * @param {string} name - Worker名称
   * @param {string} workerPath - Worker文件路径
   * @param {Object} options - Worker选项
   * @returns {Promise<Worker>}

---

## getWorker(name)

```javascript
getWorker(name)
```

* 获取Worker
   * @param {string} name - Worker名称
   * @returns {Worker|null}

---

## async sendTask(workerName, type, payload, options =

```javascript
async sendTask(workerName, type, payload, options =
```

* 向Worker发送任务
   * @param {string} workerName - Worker名称
   * @param {string} type - 任务类型
   * @param {Object} payload - 任务数据
   * @param {Object} options - 选项
   * @returns {Promise<any>}

---

## handleWorkerMessage(workerName, event)

```javascript
handleWorkerMessage(workerName, event)
```

* 处理Worker消息
   * @private

---

## handleWorkerError(workerName, error)

```javascript
handleWorkerError(workerName, error)
```

* 处理Worker错误
   * @private

---

## terminateWorker(name)

```javascript
terminateWorker(name)
```

* 终止Worker
   * @param {string} name - Worker名称

---

## terminateAll()

```javascript
terminateAll()
```

* 终止所有Workers

---

## getWorkerStats(name)

```javascript
getWorkerStats(name)
```

* 获取Worker统计信息
   * @param {string} name - Worker名称
   * @returns {Object|null}

---

## getAllStats()

```javascript
getAllStats()
```

* 获取所有Workers统计信息
   * @returns {Object}

---

## export class FileWorkerHelper

```javascript
export class FileWorkerHelper
```

* 文件处理Worker包装器
 * 提供便捷的文件处理方法

---

## async init()

```javascript
async init()
```

* 初始化Worker

---

## async parseFile(content, fileType, options =

```javascript
async parseFile(content, fileType, options =
```

* 解析文件
   * @param {string} content - 文件内容
   * @param {string} fileType - 文件类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async extractMetadata(content)

```javascript
async extractMetadata(content)
```

* 提取元数据
   * @param {string} content - 文件内容
   * @returns {Promise<Object>}

---

## async searchContent(content, pattern, flags = 'gi')

```javascript
async searchContent(content, pattern, flags = 'gi')
```

* 搜索文件内容
   * @param {string} content - 文件内容
   * @param {string} pattern - 搜索模式
   * @param {string} flags - 正则标志
   * @returns {Promise<Object>}

---

## destroy()

```javascript
destroy()
```

* 销毁Worker

---

## export class SyntaxWorkerHelper

```javascript
export class SyntaxWorkerHelper
```

* 语法高亮Worker包装器

---

## async init()

```javascript
async init()
```

* 初始化Worker

---

## async highlight(code, language, options =

```javascript
async highlight(code, language, options =
```

* 语法高亮
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async highlightHTML(code, language, options =

```javascript
async highlightHTML(code, language, options =
```

* 生成HTML高亮代码
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async extractStructure(code, language)

```javascript
async extractStructure(code, language)
```

* 提取代码结构
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @returns {Promise<Object>}

---

## destroy()

```javascript
destroy()
```

* 销毁Worker

---

