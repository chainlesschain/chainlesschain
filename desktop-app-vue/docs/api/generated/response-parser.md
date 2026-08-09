# response-parser

**Source**: `src/main/ai-engine/response-parser.js`

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

## function extractBalancedJsonCandidates(text)

```javascript
function extractBalancedJsonCandidates(text)
```

* 宽松解析 LLM 返回的 JSON。
 *
 * 先尝试直接 JSON.parse；失败时从 ```json 围栏内容、否则从第一个 { … } / [ … ]
 * 跨度中抽出 JSON 再解析。LLM 常把 JSON 包进 markdown 围栏或前后加解释文字，
 * 直接 JSON.parse(response) 会抛错，调用方据此回退就会丢弃本可用的结果。
 *
 * @param {string} text - LLM 响应文本
 * @returns {any} 解析后的值
 * @throws {TypeError} text 非字符串
 * @throws {SyntaxError} 文本中找不到可解析的 JSON（调用方据此决定回退）

---

## function extractBalancedJsonCandidates(text)

```javascript
function extractBalancedJsonCandidates(text)
```

* 从文本中按从左到右顺序提取所有「括号配对完整」的 JSON 候选子串（每个从某个
 * `{`/`[` 起，跟踪深度并正确跳过字符串字面量与转义）。
 *
 * 比贪婪正则 `/\{[\s\S]*\}/`（首 `{` 到末 `}`）更稳健：当 LLM 在 JSON 之后追加
 * 散文且其中含有落单的 `}`（很常见）、一次输出多个对象、或对象前另有 `[标签]`
 * 之类的括号时，贪婪匹配会过度捕获或命中错误片段导致 JSON.parse 抛错。逐个
 * 完整结构提取后由调用方各自尝试解析，取首个成功者。
 *
 * @param {string} text
 * @returns {string[]} 候选子串（可能为空）

---

