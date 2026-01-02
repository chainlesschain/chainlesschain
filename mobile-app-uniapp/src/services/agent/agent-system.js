/**
 * Agent系统框架 (移动端版本)
 *
 * 功能:
 * - 任务规划和分解
 * - 工具调用链
 * - 记忆管理（短期/长期）
 * - 自主决策循环
 * - ReAct模式（Reasoning + Acting）
 */

import { getLLMManager } from '../llm/llm-manager.js'
import { getFunctionCallingManager } from '../llm/function-calling-manager.js'
import { getRetryManager } from '../common/retry-manager.js'

/**
 * Agent系统类
 */
class AgentSystem {
  constructor(config = {}) {
    this.config = {
      // Agent名称
      name: config.name || 'AI Assistant',

      // 系统提示词
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),

      // 最大迭代次数
      maxIterations: config.maxIterations || 10,

      // 最大工具调用次数
      maxToolCalls: config.maxToolCalls || 5,

      // 是否启用记忆
      enableMemory: config.enableMemory !== false,

      // 短期记忆窗口
      shortTermMemorySize: config.shortTermMemorySize || 10,

      // 长期记忆大小
      longTermMemorySize: config.longTermMemorySize || 100,

      // 是否启用自我反思
      enableReflection: config.enableReflection !== false,

      // LLM配置
      llm: config.llm || {},

      ...config
    }

    // 服务
    this.llmManager = getLLMManager(this.config.llm)
    this.functionCalling = getFunctionCallingManager()
    this.retryManager = getRetryManager()

    // 记忆
    this.shortTermMemory = [] // 对话历史
    this.longTermMemory = []  // 重要信息
    this.workingMemory = {}   // 工作记忆（当前任务）

    // 初始化状态
    this.isInitialized = false
    this.isRunning = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalToolCalls: 0,
      totalIterations: 0
    }
  }

  /**
   * 获取默认系统提示词
   * @returns {string}
   * @private
   */
  getDefaultSystemPrompt() {
    return `你是一个有用的AI助手，名叫${this.config.name}。

你的能力:
- 你可以调用工具来完成任务
- 你可以将复杂任务分解为子任务
- 你可以记住对话历史
- 你应该始终解释你的推理过程

工作流程:
1. 思考(Thought): 分析用户需求，规划如何完成任务
2. 行动(Action): 决定调用哪个工具或采取什么行动
3. 观察(Observation): 查看工具调用的结果
4. 反思(Reflection): 评估结果，决定下一步

重要原则:
- 明确说明你的推理过程
- 一步步完成任务，不要跳跃
- 如果任务失败，尝试其他方法
- 完成任务后，给出清晰的总结

请按照Thought -> Action -> Observation -> Reflection的循环工作。`
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
      console.log('[AgentSystem] 初始化Agent系统...')

      // 初始化LLM
      await this.llmManager.initialize()

      // 初始化Function Calling
      await this.functionCalling.initialize()

      this.isInitialized = true

      console.log('[AgentSystem] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[AgentSystem] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 执行任务
   * @param {string} task - 任务描述
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async executeTask(task, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (this.isRunning) {
      throw new Error('Agent正在执行任务，请稍后再试')
    }

    this.isRunning = true
    this.stats.totalTasks++

    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)

    try {
      console.log('[AgentSystem] 开始执行任务:', task)

      this.emit('task-start', { taskId, task })

      // 初始化工作记忆
      this.workingMemory = {
        taskId,
        task,
        startTime: Date.now(),
        steps: [],
        status: 'running'
      }

      // 添加到短期记忆
      this.addToShortTermMemory({
        role: 'user',
        content: task
      })

      // ReAct循环
      const result = await this.reactLoop(task, options)

      // 更新工作记忆
      this.workingMemory.status = 'completed'
      this.workingMemory.endTime = Date.now()
      this.workingMemory.result = result

      // 保存到长期记忆
      if (this.config.enableMemory) {
        this.saveToLongTermMemory(this.workingMemory)
      }

      this.stats.completedTasks++

      console.log('[AgentSystem] ✅ 任务完成:', taskId)

      this.emit('task-complete', { taskId, result })

      return {
        success: true,
        taskId,
        task,
        result,
        steps: this.workingMemory.steps,
        duration: this.workingMemory.endTime - this.workingMemory.startTime
      }
    } catch (error) {
      this.stats.failedTasks++

      console.error('[AgentSystem] 任务失败:', error)

      this.emit('task-error', { taskId, error })

      return {
        success: false,
        taskId,
        task,
        error: error.message,
        steps: this.workingMemory.steps
      }
    } finally {
      this.isRunning = false
    }
  }

  /**
   * ReAct循环（Reasoning + Acting）
   * @param {string} task - 任务
   * @param {Object} options - 选项
   * @returns {Promise<string>}
   * @private
   */
  async reactLoop(task, options = {}) {
    const {
      maxIterations = this.config.maxIterations,
      maxToolCalls = this.config.maxToolCalls
    } = options

    let iteration = 0
    let toolCallCount = 0
    let finalAnswer = null

    while (iteration < maxIterations) {
      iteration++
      this.stats.totalIterations++

      console.log(`[AgentSystem] 迭代 ${iteration}/${maxIterations}`)

      this.emit('iteration-start', { iteration, maxIterations })

      // 1. Thought: 思考下一步
      const thought = await this.think()

      console.log('[AgentSystem] Thought:', thought.reasoning)

      // 记录步骤
      this.workingMemory.steps.push({
        iteration,
        type: 'thought',
        content: thought.reasoning,
        timestamp: Date.now()
      })

      // 2. Action: 决定行动
      if (thought.action === 'answer') {
        // 得出最终答案
        finalAnswer = thought.content
        console.log('[AgentSystem] 得出最终答案')
        break
      } else if (thought.action === 'tool_call') {
        // 调用工具
        if (toolCallCount >= maxToolCalls) {
          console.warn('[AgentSystem] 达到最大工具调用次数')
          finalAnswer = '抱歉，我无法完成这个任务，已达到最大工具调用次数。'
          break
        }

        console.log('[AgentSystem] Action: 调用工具', thought.tool)

        this.workingMemory.steps.push({
          iteration,
          type: 'action',
          action: 'tool_call',
          tool: thought.tool,
          args: thought.args,
          timestamp: Date.now()
        })

        // 3. Observation: 执行工具并观察结果
        const observation = await this.executeAction(thought)

        toolCallCount++
        this.stats.totalToolCalls++

        console.log('[AgentSystem] Observation:', observation.result)

        this.workingMemory.steps.push({
          iteration,
          type: 'observation',
          result: observation.result,
          timestamp: Date.now()
        })

        // 添加到记忆
        this.addToShortTermMemory({
          role: 'assistant',
          content: `工具调用结果: ${JSON.stringify(observation.result)}`
        })

        // 4. Reflection: 反思结果
        if (this.config.enableReflection) {
          const reflection = await this.reflect(observation)

          console.log('[AgentSystem] Reflection:', reflection)

          this.workingMemory.steps.push({
            iteration,
            type: 'reflection',
            content: reflection,
            timestamp: Date.now()
          })
        }
      } else {
        console.warn('[AgentSystem] 未知行动:', thought.action)
        break
      }

      this.emit('iteration-complete', { iteration })
    }

    if (!finalAnswer) {
      finalAnswer = '抱歉，我无法完成这个任务。'
    }

    return finalAnswer
  }

  /**
   * 思考下一步
   * @returns {Promise<Object>}
   * @private
   */
  async think() {
    // 构建提示词
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.getRecentMemory(),
      {
        role: 'user',
        content: `请分析当前情况，决定下一步行动。

可用工具:
${this.getToolsList()}

请按以下格式回答:
Thought: [你的推理过程]
Action: [answer/tool_call]
Tool: [如果是tool_call，指定工具名称]
Args: [如果是tool_call，指定参数JSON]
Content: [如果是answer，给出最终答案]

现在请开始思考。`
      }
    ]

    // 调用LLM
    const response = await this.retryManager.execute(async () => {
      return await this.llmManager.chat(messages, {
        temperature: 0.7,
        maxTokens: 1000
      })
    }, {
      key: 'agent-think',
      maxRetries: 2
    })

    // 解析响应
    return this.parseThought(response.content)
  }

  /**
   * 解析思考结果
   * @param {string} text - LLM响应
   * @returns {Object}
   * @private
   */
  parseThought(text) {
    const result = {
      reasoning: '',
      action: 'answer',
      tool: null,
      args: null,
      content: text
    }

    // 提取Thought
    const thoughtMatch = text.match(/Thought:\s*(.+?)(?=\nAction:|$)/s)
    if (thoughtMatch) {
      result.reasoning = thoughtMatch[1].trim()
    }

    // 提取Action
    const actionMatch = text.match(/Action:\s*(\w+)/i)
    if (actionMatch) {
      result.action = actionMatch[1].toLowerCase()
    }

    // 提取Tool
    const toolMatch = text.match(/Tool:\s*(\w+)/i)
    if (toolMatch) {
      result.tool = toolMatch[1]
    }

    // 提取Args
    const argsMatch = text.match(/Args:\s*({.+?})/s)
    if (argsMatch) {
      try {
        result.args = JSON.parse(argsMatch[1])
      } catch (e) {
        console.error('[AgentSystem] 解析参数失败:', e)
      }
    }

    // 提取Content
    const contentMatch = text.match(/Content:\s*(.+?)$/s)
    if (contentMatch) {
      result.content = contentMatch[1].trim()
    }

    return result
  }

  /**
   * 执行行动
   * @param {Object} thought - 思考结果
   * @returns {Promise<Object>}
   * @private
   */
  async executeAction(thought) {
    try {
      const result = await this.functionCalling.executeFunction(
        thought.tool,
        thought.args || {}
      )

      return {
        success: true,
        tool: thought.tool,
        result: result.result
      }
    } catch (error) {
      return {
        success: false,
        tool: thought.tool,
        error: error.message
      }
    }
  }

  /**
   * 反思结果
   * @param {Object} observation - 观察结果
   * @returns {Promise<string>}
   * @private
   */
  async reflect(observation) {
    const prompt = `请评估以下工具调用的结果:

工具: ${observation.tool}
结果: ${JSON.stringify(observation.result)}

请简要评估:
1. 结果是否符合预期？
2. 是否需要调整策略？
3. 下一步应该做什么？`

    const response = await this.llmManager.chat([
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ], {
      temperature: 0.5,
      maxTokens: 200
    })

    return response.content
  }

  /**
   * 获取工具列表
   * @returns {string}
   * @private
   */
  getToolsList() {
    const tools = this.functionCalling.getTools(true)
    return tools.map(tool =>
      `- ${tool.name}: ${tool.description}`
    ).join('\n')
  }

  /**
   * 添加到短期记忆
   * @param {Object} message - 消息
   * @private
   */
  addToShortTermMemory(message) {
    this.shortTermMemory.push(message)

    // 限制大小
    if (this.shortTermMemory.length > this.config.shortTermMemorySize * 2) {
      this.shortTermMemory = this.shortTermMemory.slice(-this.config.shortTermMemorySize)
    }
  }

  /**
   * 获取近期记忆
   * @returns {Array}
   * @private
   */
  getRecentMemory() {
    return this.shortTermMemory.slice(-this.config.shortTermMemorySize)
  }

  /**
   * 保存到长期记忆
   * @param {Object} memory - 记忆对象
   * @private
   */
  saveToLongTermMemory(memory) {
    this.longTermMemory.push({
      ...memory,
      timestamp: Date.now()
    })

    // 限制大小
    if (this.longTermMemory.length > this.config.longTermMemorySize) {
      this.longTermMemory.shift()
    }
  }

  /**
   * 清除记忆
   * @param {string} type - 记忆类型 (short/long/all)
   */
  clearMemory(type = 'short') {
    if (type === 'short' || type === 'all') {
      this.shortTermMemory = []
      console.log('[AgentSystem] 短期记忆已清除')
    }

    if (type === 'long' || type === 'all') {
      this.longTermMemory = []
      console.log('[AgentSystem] 长期记忆已清除')
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      shortTermMemorySize: this.shortTermMemory.length,
      longTermMemorySize: this.longTermMemory.length,
      successRate: this.stats.totalTasks > 0
        ? ((this.stats.completedTasks / this.stats.totalTasks) * 100).toFixed(2) + '%'
        : '0%',
      avgIterationsPerTask: this.stats.totalTasks > 0
        ? (this.stats.totalIterations / this.stats.totalTasks).toFixed(2)
        : 0
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
        console.error('[AgentSystem] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.clearMemory('all')
    this.workingMemory = {}
    this.isInitialized = false
    this.isRunning = false
    console.log('[AgentSystem] 资源已清理')
  }
}

// 创建单例
let agentSystemInstance = null

/**
 * 获取Agent系统实例
 * @param {Object} config - 配置
 * @returns {AgentSystem}
 */
export function getAgentSystem(config) {
  if (!agentSystemInstance) {
    agentSystemInstance = new AgentSystem(config)
  }
  return agentSystemInstance
}

export default AgentSystem
