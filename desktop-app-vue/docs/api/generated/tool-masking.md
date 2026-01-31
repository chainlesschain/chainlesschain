# tool-masking

**Source**: `src\main\ai-engine\tool-masking.js`

**Generated**: 2026-01-27T06:44:03.875Z

---

## const

```javascript
const
```

* 工具掩码系统
 *
 * 基于 Manus AI 的最佳实践：通过掩码控制工具可用性，而非动态修改工具定义。
 *
 * 核心原则：
 * 1. 工具定义保持不变 - 避免破坏 KV-Cache
 * 2. 通过掩码控制可用性 - 在推理时过滤
 * 3. 使用一致的命名前缀 - 便于批量控制
 * 4. 支持状态机驱动 - 根据任务阶段自动调整
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## class ToolMaskingSystem extends EventEmitter

```javascript
class ToolMaskingSystem extends EventEmitter
```

* 工具掩码管理器

---

## registerTool(tool)

```javascript
registerTool(tool)
```

* 注册工具
   * @param {Object} tool - 工具定义
   * @param {string} tool.name - 工具名称（建议使用前缀，如 browser_navigate）
   * @param {string} tool.description - 工具描述
   * @param {Object} tool.parameters - 参数定义
   * @param {Function} tool.handler - 处理函数

---

## registerTools(tools)

```javascript
registerTools(tools)
```

* 批量注册工具
   * @param {Array} tools - 工具数组

---

## _extractPrefix(name)

```javascript
_extractPrefix(name)
```

* 提取工具名称前缀
   * @private

---

## _updateAvailableCount()

```javascript
_updateAvailableCount()
```

* 更新可用工具计数
   * @private

---

## setToolAvailability(toolName, available)

```javascript
setToolAvailability(toolName, available)
```

* 设置单个工具的可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用

---

## setToolsByPrefix(prefix, available)

```javascript
setToolsByPrefix(prefix, available)
```

* 按前缀批量设置工具可用性
   * @param {string} prefix - 工具前缀（如 browser, file, git）
   * @param {boolean} available - 是否可用

---

## setMask(mask)

```javascript
setMask(mask)
```

* 设置多个工具的可用性
   * @param {Object} mask - 掩码对象 { toolName: boolean, ... }

---

## enableAll()

```javascript
enableAll()
```

* 启用所有工具

---

## disableAll()

```javascript
disableAll()
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

* 检查工具是否可用
   * @param {string} toolName - 工具名称
   * @returns {boolean}

---

## getAllToolDefinitions()

```javascript
getAllToolDefinitions()
```

* 获取工具定义（始终返回完整列表，用于 LLM 上下文）
   * @returns {Array} 所有工具定义

---

## getAvailableToolDefinitions()

```javascript
getAvailableToolDefinitions()
```

* 获取可用工具定义（用于验证）
   * @returns {Array} 可用工具定义

---

## getAvailabilityMask()

```javascript
getAvailabilityMask()
```

* 获取当前掩码
   * @returns {Set} 可用工具名称集合

---

## getToolGroups()

```javascript
getToolGroups()
```

* 获取所有工具分组
   * @returns {Object} 分组信息

---

## validateCall(toolName)

```javascript
validateCall(toolName)
```

* 验证工具调用是否被允许
   * @param {string} toolName - 工具名称
   * @returns {Object} 验证结果

---

## async executeWithMask(toolName, params, context)

```javascript
async executeWithMask(toolName, params, context)
```

* 执行工具调用（带掩码验证）
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 执行结果

---

## configureStateMachine(config)

```javascript
configureStateMachine(config)
```

* 配置状态机
   *
   * 状态机定义示例：
   * {
   *   states: {
   *     'planning': {
   *       availableTools: ['file_reader', 'info_searcher'],
   *       availablePrefixes: ['search']
   *     },
   *     'executing': {
   *       availableTools: ['file_writer', 'git_commit'],
   *       availablePrefixes: ['file', 'git']
   *     },
   *     'reviewing': {
   *       availableTools: ['file_reader'],
   *       availablePrefixes: ['search']
   *     }
   *   },
   *   transitions: {
   *     'planning': ['executing'],
   *     'executing': ['reviewing', 'planning'],
   *     'reviewing': ['executing', 'planning']
   *   }
   * }
   *
   * @param {Object} config - 状态机配置

---

## transitionTo(state)

```javascript
transitionTo(state)
```

* 切换到指定状态
   * @param {string} state - 目标状态

---

## getCurrentState()

```javascript
getCurrentState()
```

* 获取当前状态
   * @returns {string|null} 当前状态

---

## getAvailableTransitions()

```javascript
getAvailableTransitions()
```

* 获取可用的状态转换
   * @returns {Array<string>} 可转换的目标状态

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## exportConfig()

```javascript
exportConfig()
```

* 导出当前配置（用于调试）
   * @returns {Object} 配置快照

---

## reset()

```javascript
reset()
```

* 重置系统

---

## function getToolMaskingSystem(options =

```javascript
function getToolMaskingSystem(options =
```

* 获取工具掩码系统单例
 * @param {Object} options - 配置选项
 * @returns {ToolMaskingSystem}

---

