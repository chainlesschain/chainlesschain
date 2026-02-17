# mcp-function-executor

**Source**: `src/main/mcp/mcp-function-executor.js`

**Generated**: 2026-02-17T10:13:18.225Z

---

## class MCPFunctionExecutor

```javascript
class MCPFunctionExecutor
```

* MCP Function Executor
 *
 * Bridges MCP tools to LLM Function Calling.
 * Converts MCP tools to OpenAI function format and proxies execution.
 *
 * @module MCPFunctionExecutor

---

## class MCPFunctionExecutor

```javascript
class MCPFunctionExecutor
```

* MCP 函数执行器类
 * 将 MCP 工具转换为 LLM Function Calling 格式，并代理执行

---

## constructor(mcpClientManager, mcpToolAdapter)

```javascript
constructor(mcpClientManager, mcpToolAdapter)
```

* @param {Object} mcpClientManager - MCP 客户端管理器
   * @param {Object} mcpToolAdapter - MCP 工具适配器

---

## async getFunctions()

```javascript
async getFunctions()
```

* 获取所有 MCP 工具的 OpenAI function 格式
   * @returns {Promise<Array>} OpenAI function 格式的工具列表

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存（当 MCP 服务器连接/断开时调用）

---

## async execute(functionName, args)

```javascript
async execute(functionName, args)
```

* 执行 MCP 工具
   * @param {string} functionName - 函数名称（格式: mcp_${serverName}_${toolName}）
   * @param {Object} args - 函数参数
   * @returns {Promise<Object>} 执行结果

---

## hasTools()

```javascript
hasTools()
```

* 检查是否有可用的 MCP 工具
   * @returns {boolean}

---

## getConnectedServerCount()

```javascript
getConnectedServerCount()
```

* 获取已连接的服务器数量
   * @returns {number}

---

## _parseFunctionName(name)

```javascript
_parseFunctionName(name)
```

* 解析函数名获取服务器和工具名
   * @private
   * @param {string} name - 函数名称（格式: mcp_${serverName}_${toolName}）
   * @returns {Object|null} { serverName, toolName } 或 null

---

## async _convertToOpenAIFunction(mcpToolInfo)

```javascript
async _convertToOpenAIFunction(mcpToolInfo)
```

* 将 MCP 工具转换为 OpenAI function 格式
   * @private
   * @param {Object} mcpToolInfo - MCP 工具信息
   * @returns {Promise<Object|null>} OpenAI function 格式

---

## _transformResult(mcpResult)

```javascript
_transformResult(mcpResult)
```

* 转换 MCP 结果为统一格式
   * @private
   * @param {Object} mcpResult - MCP 工具返回结果
   * @returns {Object} 统一格式的结果

---

## _extractContent(content)

```javascript
_extractContent(content)
```

* 从 MCP content 数组中提取内容
   * @private
   * @param {Array} content - MCP content 数组
   * @returns {*} 提取的内容

---

## _extractTextContent(content)

```javascript
_extractTextContent(content)
```

* 从 MCP content 数组中提取文本内容
   * @private
   * @param {Array} content - MCP content 数组
   * @returns {string} 提取的文本

---

