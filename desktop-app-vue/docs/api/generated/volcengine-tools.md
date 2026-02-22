# volcengine-tools

**Source**: `src/main/llm/volcengine-tools.js`

**Generated**: 2026-02-22T01:23:36.713Z

---

## const

```javascript
const
```

* 火山引擎豆包工具调用客户端
 *
 * 支持以下工具调用功能：
 * 1. 联网搜索 (Web Search)
 * 2. 图像处理 (Image Process)
 * 3. 私域知识库搜索 (Knowledge Search)
 * 4. 函数调用 (Function Calling)
 * 5. MCP (Model Context Protocol)

---

## const ToolTypes =

```javascript
const ToolTypes =
```

* 工具类型枚举

---

## class VolcengineToolsClient

```javascript
class VolcengineToolsClient
```

* 火山引擎工具调用客户端

---

## async _callAPI(endpoint, body, options =

```javascript
async _callAPI(endpoint, body, options =
```

* 通用 API 调用方法
   * @private

---

## async _callStreamAPI(endpoint, body, onChunk, options =

```javascript
async _callStreamAPI(endpoint, body, onChunk, options =
```

* 流式 API 调用
   * @private

---

## async chatWithWebSearch(messages, options =

```javascript
async chatWithWebSearch(messages, options =
```

* 启用联网搜索的对话
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   * @param {string} options.searchMode - 搜索模式: 'auto' | 'always' | 'never'
   * @param {boolean} options.stream - 是否流式输出
   * @param {Function} options.onChunk - 流式输出回调
   * @returns {Promise<Object>} API响应

---

## async chatWithImageProcess(messages, options =

```javascript
async chatWithImageProcess(messages, options =
```

* 启用图像处理的对话
   * @param {Array} messages - 消息数组（需包含图像URL）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async understandImage(prompt, imageUrl, options =

```javascript
async understandImage(prompt, imageUrl, options =
```

* 图像理解（简化接口）
   * @param {string} prompt - 提示词
   * @param {string|Array} imageUrl - 图片URL或URL数组
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 理解结果

---

## async setupKnowledgeBase(knowledgeBaseId, documents)

```javascript
async setupKnowledgeBase(knowledgeBaseId, documents)
```

* 配置知识库（上传文档）
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Array} documents - 文档数组
   * @returns {Promise<Object>} 上传结果

---

## async chatWithKnowledgeBase(messages, knowledgeBaseId, options =

```javascript
async chatWithKnowledgeBase(messages, knowledgeBaseId, options =
```

* 使用知识库增强的对话
   * @param {Array} messages - 消息数组
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithFunctionCalling(messages, functions, options =

```javascript
async chatWithFunctionCalling(messages, functions, options =
```

* Function Calling 对话
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async executeFunctionCalling(

```javascript
async executeFunctionCalling(
```

* 执行完整的 Function Calling 流程（包括函数执行）
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} functionExecutor - 函数执行器（包含execute方法）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 最终响应

---

## async chatWithMCP(messages, mcpConfig, options =

```javascript
async chatWithMCP(messages, mcpConfig, options =
```

* 使用 Remote MCP
   * @param {Array} messages - 消息数组
   * @param {Object} mcpConfig - MCP配置
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithMultipleTools(messages, toolConfig =

```javascript
async chatWithMultipleTools(messages, toolConfig =
```

* 同时启用多个工具的对话
   * @param {Array} messages - 消息数组
   * @param {Object} toolConfig - 工具配置
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## isConfigured()

```javascript
isConfigured()
```

* 检查API Key是否配置
   * @returns {boolean}

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置
   * @returns {Object}

---

## updateConfig(config =

```javascript
updateConfig(config =
```

* 更新配置
   * @param {Object} config - 新配置

---

