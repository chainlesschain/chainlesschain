# response-parser

**Source**: `src\main\ai-engine\response-parser.js`

**Generated**: 2026-01-27T06:44:03.877Z

---

## function parseAIResponse(responseText, operations = [])

```javascript
function parseAIResponse(responseText, operations = [])
```

* AI响应解析器
 * 从AI的响应中提取文件操作指令

---

## function parseAIResponse(responseText, operations = [])

```javascript
function parseAIResponse(responseText, operations = [])
```

* 解析AI响应，提取文件操作
 *
 * @param {string} responseText - AI的响应文本
 * @param {Array} operations - 后端已解析的操作列表（如果有）
 * @returns {Object} 解析结果

---

## function extractJSONOperations(text)

```javascript
function extractJSONOperations(text)
```

* 从响应中提取JSON格式的操作指令
 *
 * @param {string} text - 响应文本
 * @returns {Array} 操作列表

---

## function extractFileBlocks(text)

```javascript
function extractFileBlocks(text)
```

* 从响应中提取文件代码块
 *
 * 支持格式：
 * ```file:path/to/file.js
 * [content]
 * ```
 *
 * 或：
 * ```javascript:src/app.js
 * [content]
 * ```
 *
 * @param {string} text - 响应文本
 * @returns {Array} 操作列表

---

## function detectLanguage(filePath)

```javascript
function detectLanguage(filePath)
```

* 根据文件扩展名检测语言类型
 *
 * @param {string} filePath - 文件路径
 * @returns {string} 语言类型

---

## function normalizeOperations(operations)

```javascript
function normalizeOperations(operations)
```

* 标准化操作格式
 *
 * @param {Array} operations - 原始操作列表
 * @returns {Array} 标准化后的操作列表

---

## function validateOperation(operation, projectPath)

```javascript
function validateOperation(operation, projectPath)
```

* 验证操作的安全性
 *
 * @param {Object} operation - 文件操作
 * @param {string} projectPath - 项目根目录路径
 * @returns {Object} 验证结果 { valid: boolean, error: string }

---

## function validateOperations(operations, projectPath)

```javascript
function validateOperations(operations, projectPath)
```

* 批量验证操作
 *
 * @param {Array} operations - 操作列表
 * @param {string} projectPath - 项目路径
 * @returns {Object} { valid: boolean, errors: Array }

---

