/**
 * Function Calling管理器 (移动端版本)
 *
 * 功能:
 * - 工具注册和管理
 * - 函数调用执行
 * - 参数验证
 * - 结果格式化
 * - 内置工具集成
 *
 * 支持OpenAI和Anthropic的Function Calling格式
 */

/**
 * Function Calling管理器类
 */
class FunctionCallingManager {
  constructor(config = {}) {
    this.config = {
      // 是否自动执行函数
      autoExecute: config.autoExecute !== false,

      // 最大调用链深度
      maxCallChain: config.maxCallChain || 5,

      // 超时时间
      timeout: config.timeout || 30000,

      ...config
    }

    // 注册的工具
    this.tools = new Map()

    // 内置工具
    this.builtinTools = new Map()

    // 调用历史
    this.callHistory = []

    // 初始化状态
    this.isInitialized = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0
    }
  }

  /**
   * 初始化
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true }
    }

    try {
      console.log('[FunctionCalling] 初始化Function Calling管理器...')

      // 注册内置工具
      this.registerBuiltinTools()

      this.isInitialized = true

      console.log('[FunctionCalling] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[FunctionCalling] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 注册内置工具
   * @private
   */
  registerBuiltinTools() {
    // 知识库搜索工具
    this.registerBuiltinTool('search_knowledge', {
      description: '在知识库中搜索相关内容',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询'
          },
          limit: {
            type: 'number',
            description: '返回结果数量限制',
            default: 5
          }
        },
        required: ['query']
      },
      handler: async (params) => {
        // 这里需要集成实际的知识库搜索
        console.log('[FunctionCalling] 搜索知识库:', params.query)

        // TODO: 调用实际的RAG搜索
        return {
          results: [],
          total: 0,
          query: params.query
        }
      }
    })

    // 创建笔记工具
    this.registerBuiltinTool('create_note', {
      description: '创建一条新笔记',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '笔记标题'
          },
          content: {
            type: 'string',
            description: '笔记内容'
          },
          tags: {
            type: 'string',
            description: '笔记标签（逗号分隔）'
          }
        },
        required: ['title', 'content']
      },
      handler: async (params) => {
        console.log('[FunctionCalling] 创建笔记:', params.title)

        // TODO: 调用实际的笔记创建
        return {
          success: true,
          noteId: 'note_' + Date.now(),
          title: params.title
        }
      }
    })

    // 获取当前时间工具
    this.registerBuiltinTool('get_current_time', {
      description: '获取当前日期和时间',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: '时间格式 (datetime, date, time)',
            default: 'datetime'
          }
        }
      },
      handler: async (params) => {
        const now = new Date()
        const format = params.format || 'datetime'

        let result
        switch (format) {
          case 'date':
            result = now.toLocaleDateString('zh-CN')
            break
          case 'time':
            result = now.toLocaleTimeString('zh-CN')
            break
          default:
            result = now.toLocaleString('zh-CN')
        }

        return { time: result, timestamp: now.getTime() }
      }
    })

    // 计算器工具
    this.registerBuiltinTool('calculator', {
      description: '执行数学计算',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式'
          }
        },
        required: ['expression']
      },
      handler: async (params) => {
        try {
          // 安全的数学计算（简单实现）
          const sanitized = params.expression.replace(/[^0-9+\-*/().\s]/g, '')
          const result = eval(sanitized)

          return {
            expression: params.expression,
            result: result
          }
        } catch (error) {
          throw new Error(`计算失败: ${error.message}`)
        }
      }
    })
  }

  /**
   * 注册内置工具
   * @param {string} name - 工具名称
   * @param {Object} tool - 工具定义
   * @private
   */
  registerBuiltinTool(name, tool) {
    this.builtinTools.set(name, tool)
    console.log('[FunctionCalling] 注册内置工具:', name)
  }

  /**
   * 注册自定义工具
   * @param {string} name - 工具名称
   * @param {Object} tool - 工具定义
   * @returns {boolean}
   */
  registerTool(name, tool) {
    if (this.builtinTools.has(name)) {
      console.warn('[FunctionCalling] 工具名称与内置工具冲突:', name)
      return false
    }

    if (!tool.description || !tool.handler) {
      console.error('[FunctionCalling] 工具定义不完整:', name)
      return false
    }

    this.tools.set(name, tool)

    console.log('[FunctionCalling] 注册自定义工具:', name)

    return true
  }

  /**
   * 取消注册工具
   * @param {string} name - 工具名称
   * @returns {boolean}
   */
  unregisterTool(name) {
    if (this.builtinTools.has(name)) {
      console.warn('[FunctionCalling] 不能取消注册内置工具:', name)
      return false
    }

    return this.tools.delete(name)
  }

  /**
   * 获取工具
   * @param {string} name - 工具名称
   * @returns {Object|null}
   */
  getTool(name) {
    return this.tools.get(name) || this.builtinTools.get(name) || null
  }

  /**
   * 获取所有工具列表
   * @param {boolean} includeBuiltin - 是否包含内置工具
   * @returns {Array}
   */
  getTools(includeBuiltin = true) {
    const tools = []

    if (includeBuiltin) {
      for (const [name, tool] of this.builtinTools.entries()) {
        tools.push({
          name,
          description: tool.description,
          parameters: tool.parameters,
          builtin: true
        })
      }
    }

    for (const [name, tool] of this.tools.entries()) {
      tools.push({
        name,
        description: tool.description,
        parameters: tool.parameters,
        builtin: false
      })
    }

    return tools
  }

  /**
   * 将工具列表转换为OpenAI格式
   * @returns {Array}
   */
  getToolsForOpenAI() {
    const tools = this.getTools(true)

    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))
  }

  /**
   * 将工具列表转换为Anthropic格式
   * @returns {Array}
   */
  getToolsForAnthropic() {
    const tools = this.getTools(true)

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }))
  }

  /**
   * 验证参数
   * @param {Object} parameters - 参数定义
   * @param {Object} args - 实际参数
   * @returns {Object} 验证结果
   * @private
   */
  validateParameters(parameters, args) {
    const errors = []

    // 检查必需参数
    if (parameters.required) {
      for (const requiredParam of parameters.required) {
        if (!(requiredParam in args)) {
          errors.push(`缺少必需参数: ${requiredParam}`)
        }
      }
    }

    // 类型检查
    if (parameters.properties) {
      for (const [paramName, paramDef] of Object.entries(parameters.properties)) {
        if (paramName in args) {
          const value = args[paramName]
          const expectedType = paramDef.type

          let actualType = typeof value
          if (Array.isArray(value)) actualType = 'array'

          if (actualType !== expectedType) {
            errors.push(`参数 ${paramName} 类型错误: 期望 ${expectedType}, 实际 ${actualType}`)
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 执行函数调用
   * @param {string} functionName - 函数名
   * @param {Object} args - 参数
   * @returns {Promise<Object>}
   */
  async executeFunction(functionName, args = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.stats.totalCalls++

    const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)

    try {
      console.log('[FunctionCalling] 执行函数:', functionName)

      this.emit('function-call-start', { callId, functionName, args })

      // 获取工具
      const tool = this.getTool(functionName)
      if (!tool) {
        throw new Error(`工具不存在: ${functionName}`)
      }

      // 验证参数
      const validation = this.validateParameters(tool.parameters, args)
      if (!validation.valid) {
        throw new Error(`参数验证失败: ${validation.errors.join(', ')}`)
      }

      // 执行函数
      const startTime = Date.now()

      const result = await Promise.race([
        tool.handler(args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('函数执行超时')), this.config.timeout)
        )
      ])

      const duration = Date.now() - startTime

      // 记录历史
      this.callHistory.push({
        callId,
        functionName,
        args,
        result,
        duration,
        timestamp: Date.now(),
        success: true
      })

      this.stats.successCalls++

      console.log('[FunctionCalling] ✅ 函数执行成功:', functionName, `(${duration}ms)`)

      this.emit('function-call-complete', {
        callId,
        functionName,
        result,
        duration
      })

      return {
        success: true,
        callId,
        functionName,
        result,
        duration
      }
    } catch (error) {
      this.stats.failedCalls++

      console.error('[FunctionCalling] 函数执行失败:', functionName, error)

      // 记录失败历史
      this.callHistory.push({
        callId,
        functionName,
        args,
        error: error.message,
        timestamp: Date.now(),
        success: false
      })

      this.emit('function-call-error', { callId, functionName, error })

      throw error
    }
  }

  /**
   * 执行多个函数调用
   * @param {Array} calls - 函数调用列表 [{name, args}, ...]
   * @returns {Promise<Array>}
   */
  async executeFunctions(calls) {
    const results = []

    for (const call of calls) {
      try {
        const result = await this.executeFunction(call.name, call.args)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          functionName: call.name,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * 解析LLM的函数调用响应
   * @param {Object} response - LLM响应
   * @param {string} format - 格式 (openai | anthropic)
   * @returns {Array} 函数调用列表
   */
  parseFunctionCalls(response, format = 'openai') {
    const calls = []

    if (format === 'openai') {
      // OpenAI格式
      if (response.tool_calls) {
        for (const toolCall of response.tool_calls) {
          calls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments)
          })
        }
      }
    } else if (format === 'anthropic') {
      // Anthropic格式
      if (response.content) {
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            calls.push({
              id: block.id,
              name: block.name,
              args: block.input
            })
          }
        }
      }
    }

    return calls
  }

  /**
   * 格式化函数调用结果（for LLM）
   * @param {Array} results - 函数调用结果
   * @param {string} format - 格式
   * @returns {Array}
   */
  formatFunctionResults(results, format = 'openai') {
    if (format === 'openai') {
      return results.map(result => ({
        tool_call_id: result.callId,
        role: 'tool',
        name: result.functionName,
        content: JSON.stringify(result.result || { error: result.error })
      }))
    } else if (format === 'anthropic') {
      return results.map(result => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: JSON.stringify(result.result || { error: result.error })
      }))
    }

    return results
  }

  /**
   * 获取调用历史
   * @param {Object} options - 选项
   * @returns {Array}
   */
  getCallHistory(options = {}) {
    const { limit = 50, functionName = null, success = null } = options

    let history = [...this.callHistory]

    // 过滤
    if (functionName) {
      history = history.filter(call => call.functionName === functionName)
    }

    if (success !== null) {
      history = history.filter(call => call.success === success)
    }

    // 排序（最新的在前）
    history.sort((a, b) => b.timestamp - a.timestamp)

    // 限制数量
    return history.slice(0, limit)
  }

  /**
   * 清理历史记录
   * @param {number} maxAge - 最大保留时间（ms）
   */
  cleanupHistory(maxAge = 86400000) {
    const now = Date.now()

    this.callHistory = this.callHistory.filter(
      call => (now - call.timestamp) < maxAge
    )
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalCalls: this.stats.totalCalls,
      successCalls: this.stats.successCalls,
      failedCalls: this.stats.failedCalls,
      successRate: this.stats.totalCalls > 0
        ? ((this.stats.successCalls / this.stats.totalCalls) * 100).toFixed(2) + '%'
        : '0%',
      registeredTools: this.tools.size,
      builtinTools: this.builtinTools.size,
      totalTools: this.tools.size + this.builtinTools.size
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    for (const callback of callbacks) {
      try {
        callback(data)
      } catch (error) {
        console.error('[FunctionCalling] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.callHistory = []
    this.isInitialized = false
    console.log('[FunctionCalling] 资源已清理')
  }
}

// 创建单例
let functionCallingManagerInstance = null

/**
 * 获取Function Calling管理器实例
 * @param {Object} config - 配置
 * @returns {FunctionCallingManager}
 */
export function getFunctionCallingManager(config) {
  if (!functionCallingManagerInstance) {
    functionCallingManagerInstance = new FunctionCallingManager(config)
  }
  return functionCallingManagerInstance
}

export default FunctionCallingManager
