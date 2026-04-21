# function-caller

**Source**: `src/main/ai-engine/function-caller.js`

**Generated**: 2026-04-21T06:10:31.224Z

---

## const

```javascript
const
```

* Function Calling框架
 * 负责工具的注册、调用和管理
 *
 * 🔥 Manus 优化集成 (2026-01-17):
 * - Tool Masking: 通过掩码控制工具可用性，而非动态修改定义
 * - 保持工具定义不变以优化 KV-Cache
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## function normalizeToolSchema(schema =

```javascript
function normalizeToolSchema(schema =
```

* Normalize a tool schema to the canonical descriptor shape.
 *
 * Guarantees:
 * - `inputSchema` is preferred as source of truth; falls back to legacy `parameters`
 * - `parameters` is always mirrored from `inputSchema`
 * - Canonical fields (category, riskLevel, isReadOnly, plan-mode flags ...)
 *   survive the round-trip when present on the input

---

## function buildMaskingPayload(name, normalizedSchema, handler)

```javascript
function buildMaskingPayload(name, normalizedSchema, handler)
```

* Project a normalized schema into the argument shape expected by
 * `ToolMaskingSystem.registerTool`. Only keeps canonical fields plus the
 * synchronized handler — never leaks internal registry state.
 *
 * @param {string} name
 * @param {Object} normalizedSchema
 * @param {Function} handler
 * @returns {Object}

---

## _syncToolsToMaskingSystem()

```javascript
_syncToolsToMaskingSystem()
```

* 同步工具到掩码系统
   * @private

---

## setToolManager(toolManager)

```javascript
setToolManager(toolManager)
```

* 设置ToolManager（用于统计功能）
   * @param {ToolManager} toolManager - 工具管理器

---

## setVisionManager(visionManager)

```javascript
setVisionManager(visionManager)
```

* 设置 VisionManager（用于视觉工具）
   * @param {VisionManager} visionManager - Vision 管理器

---

## setPythonSandbox(pythonSandbox)

```javascript
setPythonSandbox(pythonSandbox)
```

* 设置 PythonSandbox（用于代码执行工具）
   * @param {PythonSandbox} pythonSandbox - Python 沙箱实例

---

## setMemGPTCore(memgptCore)

```javascript
setMemGPTCore(memgptCore)
```

* 设置 MemGPTCore（用于长期记忆工具）
   * @param {MemGPTCore} memgptCore - MemGPT 核心实例

---

## setImageGenManager(imageGenManager)

```javascript
setImageGenManager(imageGenManager)
```

* 设置 ImageGenManager（用于图像生成工具）
   * @param {ImageGenManager} imageGenManager - 图像生成管理器实例

---

## setTTSManager(ttsManager)

```javascript
setTTSManager(ttsManager)
```

* 设置 TTSManager（用于语音合成工具）
   * @param {TTSManager} ttsManager - 语音合成管理器实例

---

## setHookSystem(hookSystem)

```javascript
setHookSystem(hookSystem)
```

* 🔥 设置 HookSystem（用于工具调用钩子）
   * @param {HookSystem} hookSystem - Hooks 系统实例

---

## _wrapToolsWithHooks()

```javascript
_wrapToolsWithHooks()
```

* 使用 Hooks 中间件包装所有工具
   * @private

---

## registerBuiltInTools()

```javascript
registerBuiltInTools()
```

* 注册内置工具
   * @private

---

## getProjectStructure(type)

```javascript
getProjectStructure(type)
```

* 获取项目结构定义
   * @private

---

## registerTool(name, handler, schema)

```javascript
registerTool(name, handler, schema)
```

* 注册工具
   * @param {string} name - 工具名称
   * @param {Function} handler - 工具处理函数
   * @param {Object} schema - 工具schema

---

## unregisterTool(name)

```javascript
unregisterTool(name)
```

* 注销工具
   * @param {string} name - 工具名称

---

## async call(toolName, params =

```javascript
async call(toolName, params =
```

* 调用工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 工具执行结果

---

## getAvailableTools()

```javascript
getAvailableTools()
```

* 获取所有可用工具
   *
   * Returns canonical descriptors: `inputSchema` is source of truth,
   * `parameters` is a mirror, and any canonical fields (category, riskLevel,
   * isReadOnly, availableInPlanMode, ...) declared on the tool schema are
   * surfaced verbatim so downstream consumers don't need to re-read them
   * from a different registry.
   *
   * @returns {Array} 工具列表

---

## hasTool(name)

```javascript
hasTool(name)
```

* 检查工具是否存在
   * @param {string} name - 工具名称
   * @returns {boolean} 是否存在

---

## setToolAvailable(toolName, available)

```javascript
setToolAvailable(toolName, available)
```

* 设置工具可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用

---

## setToolsByPrefix(prefix, available)

```javascript
setToolsByPrefix(prefix, available)
```

* 按前缀设置工具可用性
   * @param {string} prefix - 工具前缀（如 file, git, html）
   * @param {boolean} available - 是否可用

---

## enableAllTools()

```javascript
enableAllTools()
```

* 启用所有工具

---

## disableAllTools()

```javascript
disableAllTools()
```

* 禁用所有工具

---

## setOnlyAvailable(toolNames)

```javascript
setOnlyAvailable(toolNames)
```

* 只启用指定的工具
   * @param {Array<string>} toolNames - 要启用的工具名称

---

## isToolAvailable(toolName)

```javascript
isToolAvailable(toolName)
```

* 检查工具是否可用（考虑掩码）
   * @param {string} toolName - 工具名称
   * @returns {boolean}

---

## getAllToolDefinitions()

```javascript
getAllToolDefinitions()
```

* 获取所有工具定义（用于 LLM 上下文，始终返回完整列表）
   * @returns {Array} 工具定义

---

## getAvailableToolDefinitions()

```javascript
getAvailableToolDefinitions()
```

* 获取当前可用工具定义（用于验证）
   * @returns {Array} 可用工具定义

---

## configureTaskPhases(config = null)

```javascript
configureTaskPhases(config = null)
```

* 配置任务阶段状态机
   * @param {Object} config - 状态机配置（可选，默认使用预定义配置）

---

## transitionToPhase(phase)

```javascript
transitionToPhase(phase)
```

* 切换到指定阶段
   * @param {string} phase - 阶段名称（planning, executing, validating, committing）
   * @returns {boolean} 是否成功

---

## getCurrentPhase()

```javascript
getCurrentPhase()
```

* 获取当前阶段
   * @returns {string|null}

---

## getToolGroups()

```javascript
getToolGroups()
```

* 获取工具分组信息
   * @returns {Object} 分组信息

---

## getMaskingStats()

```javascript
getMaskingStats()
```

* 获取工具掩码统计
   * @returns {Object} 统计数据

---

## resetMasking()

```javascript
resetMasking()
```

* 重置工具掩码

---

## _getCacheKey(toolName, params)

```javascript
_getCacheKey(toolName, params)
```

* 生成缓存键
   * @private

---

## _hashString(str)

```javascript
_hashString(str)
```

* 简单字符串哈希
   * @private

---

## _getFromCache(key)

```javascript
_getFromCache(key)
```

* 从缓存获取结果
   * @private

---

## _setCache(key, result)

```javascript
_setCache(key, result)
```

* 设置缓存
   * @private

---

## getCacheStats()

```javascript
getCacheStats()
```

* 获取缓存统计

---

## clearCache()

```javascript
clearCache()
```

* 清空缓存

---

## addCacheableTool(toolName)

```javascript
addCacheableTool(toolName)
```

* 手动添加可缓存工具

---

## static AGENT_CHAT_TOOL_NAMES = new Set([

```javascript
static AGENT_CHAT_TOOL_NAMES = new Set([
```

* Agent chat tool names — essential tools for autonomous code generation.
   * @private

---

## getAgentChatTools()

```javascript
getAgentChatTools()
```

* Get a curated subset of tools suitable for agent chat mode.
   * Returns OpenAI-compatible function definitions.
   * @returns {Array<Object>} tool definitions in OpenAI format

---

## async executeAgentTool(toolName, params)

```javascript
async executeAgentTool(toolName, params)
```

* Execute a tool by name (thin wrapper around call() for agent-chat).
   * @param {string} toolName
   * @param {Object} params
   * @returns {Promise<any>}

---

