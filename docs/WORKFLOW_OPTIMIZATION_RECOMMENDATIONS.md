# ChainlessChain 工作流程优化建议

**文档版本**: v1.0.0
**生成日期**: 2026-01-27
**基于**: PC_PROJECT_WORKFLOW_REPORT.md

---

## 目录

1. [当前流程痛点分析](#1-当前流程痛点分析)
2. [优化建议（15项）](#2-优化建议15项)
3. [优化实施计划](#3-优化实施计划)
4. [预期效果](#4-预期效果)

---

## 1. 当前流程痛点分析

### 1.1 任务规划阶段

#### 痛点1: RAG检索串行执行，速度慢

**当前实现**:
```javascript
// 串行检索 3 个数据源
const ragContext = await this.retrieveRAGContext(userRequest, projectContext)
// 包括: projectFiles, knowledgeDocs, conversations
// 总耗时: ~2-3秒
```

**问题**:
- 3个数据源串行查询，总耗时累加
- 用户等待时间长
- 无法充分利用多核CPU

**影响**: 用户感知延迟 2-3秒

---

#### 痛点2: LLM规划失败后的降级方案过于简单

**当前实现**:
```javascript
try {
  taskPlan = this.parseTaskPlan(response.text)
} catch (error) {
  // 降级: 创建单步任务
  taskPlan = this.createFallbackPlan(userRequest)
}
```

**问题**:
- 降级后只有1个步骤，功能严重退化
- 没有尝试修复JSON格式错误
- 没有尝试使用其他LLM模型

**影响**: 约10-15%的请求会降级，用户体验差

---

#### 痛点3: 任务计划缓存策略简单

**当前实现**:
```javascript
const cacheKey = this.getCacheKey(userRequest, projectContext)
if (this.cache.has(cacheKey)) {
  return this.cache.get(cacheKey)
}
```

**问题**:
- 使用简单的Map缓存，无过期机制
- 无法处理相似请求（如"创建React项目" vs "创建React应用"）
- 内存可能无限增长

**影响**: 缓存命中率低（<20%），内存可能泄漏

---

### 1.2 多代理决策阶段

#### 痛点4: 决策逻辑基于硬编码规则

**当前实现**:
```javascript
function shouldUseMultiAgent(task, context) {
  // 规则1: 上下文 > 10000 字符
  const hasContextPollution = context.length > 10000

  // 规则2: 子任务 ≥ 2 个
  const canParallelize = task.subtasks.length >= 2

  // 规则3: 需要 ≥ 2 个高分技能
  const needsSpecialization = getRequiredSkills(task).length >= 2
}
```

**问题**:
- 阈值（10000, 2）缺乏自适应性
- 无法学习历史决策效果
- 无法处理边界情况（如子任务数=1但很耗时）

**影响**: 多代理利用率不足，约30%的适合多代理的任务仍用单代理

---

#### 痛点5: 多代理创建开销大

**当前实现**:
```javascript
// 每次都创建新团队和代理
const team = await teammateTool.spawnTeam({ ... })

for (const subtask of task.subtasks) {
  const agentId = `agent_step${subtask.step}`
  await teammateTool.requestJoin(team.id, agentId, { ... })
}
```

**问题**:
- 团队和代理是临时的，用完即销毁
- 无法复用已有代理
- 创建开销约500ms-1s

**影响**: 多代理模式比单代理慢1-2秒（创建开销）

---

### 1.3 任务执行阶段

#### 痛点6: 固定并发数，资源利用不充分

**当前实现**:
```javascript
this.MAX_CONCURRENCY = options.maxConcurrency || 3
```

**问题**:
- 固定并发数3，无法根据系统负载调整
- 轻量级任务（文件读取）和重量级任务（LLM调用）并发数相同
- CPU/内存空闲时无法提高并发

**影响**: CPU利用率约50-60%，任务执行效率不高

---

#### 痛点7: 任务重试策略过于简单

**当前实现**:
```javascript
if (taskData.retries < this.MAX_RETRIES) {
  taskData.retries++
  taskData.status = 'pending'
  return this.executeTask(taskId, task, executor)
}
```

**问题**:
- 固定最大重试2次，无指数退避
- 所有错误类型都重试（包括参数错误）
- 无法区分暂时性故障（网络超时）和永久性故障（工具不存在）

**影响**: 约20%的失败任务本可通过更好的重试策略成功

---

#### 痛点8: 依赖解析无优化

**当前实现**:
```javascript
const deps = this.dependencyGraph.get(taskId) || []
const allDepsCompleted = deps.every(depId =>
  this.completedTasks.has(depId)
)
```

**问题**:
- 每次都遍历所有任务检查依赖
- 无法预测关键路径（Critical Path）
- 无法优先执行关键任务

**影响**: 总执行时间比最优路径慢15-20%

---

### 1.4 工具调用阶段

#### 痛点9: 工具调用结果无缓存

**当前实现**:
```javascript
async call(toolName, params, context = {}) {
  const result = await tool.function(params, context)
  return result
}
```

**问题**:
- 相同参数的工具调用每次都重新执行
- 如"读取同一文件"可能被多次调用
- 浪费计算资源和时间

**影响**: 约10-15%的工具调用是重复的

---

#### 痛点10: 工具掩码阶段转换手动触发

**当前实现**:
```javascript
// 需要手动调用
functionCaller.transitionToPhase('executing')
```

**问题**:
- 依赖开发者记得调用阶段转换
- 容易遗忘或调用时机错误
- 无法自动根据任务进度切换

**影响**: 人为错误风险，可能导致工具调用失败

---

### 1.5 质量门禁阶段

#### 痛点11: 质量门禁检查在阶段结束后执行

**当前实现**:
```javascript
if (status === 'completed') {
  await this.checkQualityGates(workflowId, stageId)
}
```

**问题**:
- 发现问题时已经完成了大量工作
- 返工成本高
- 无法及早介入

**影响**: 发现质量问题后平均返工时间 30-60分钟

---

#### 痛点12: 质量门禁检查串行执行

**当前实现**:
```javascript
for (const gate of stage.qualityGates) {
  const result = await ipcRenderer.invoke('workflow:check-quality-gate', { ... })
  gate.status = result.passed ? 'passed' : 'failed'
}
```

**问题**:
- 多个门禁串行检查（如代码质量、测试覆盖率、安全扫描）
- 总耗时累加，约5-10分钟
- 即使并行执行也不影响结果

**影响**: 质量检查耗时长，阻塞项目进度

---

### 1.6 前端交互阶段

#### 痛点13: 实时消息推送过于频繁

**当前实现**:
```javascript
// 每个任务事件都推送
mainWindow.webContents.send('task:start', { taskId, task })
mainWindow.webContents.send('task:progress', { taskId, progress })
mainWindow.webContents.send('task:complete', { taskId, result })
```

**问题**:
- 大量任务时消息轰炸（如50个子任务 = 150+条消息）
- 前端渲染压力大
- 用户体验不好（信息过载）

**影响**: 多任务项目时前端可能卡顿 1-2秒

---

#### 痛点14: 文件树加载全量文件

**当前实现**:
```javascript
// 加载项目所有文件
const files = await listAllFiles(project.path)
```

**问题**:
- 大项目（如node_modules有几万文件）加载慢
- 一次性加载所有文件到内存
- 无懒加载机制

**影响**: 大项目打开需要 5-10秒

---

### 1.7 长时任务管理

#### 痛点15: 检查点保存频率固定

**当前实现**:
```javascript
// 固定5分钟保存一次
this.checkpointInterval = 5 * 60 * 1000
```

**问题**:
- 快速任务（2分钟完成）也每5分钟保存，浪费IO
- 慢速任务（30分钟）5分钟可能丢失较多进度
- 无法根据任务类型调整

**影响**: IO开销大，任务崩溃时最多丢失5分钟进度

---

## 2. 优化建议（15项）

### 优化1: RAG检索并行化 ⚡⚡⚡

**优先级**: 高
**预期提升**: 减少 60% 检索时间（2-3秒 → 1秒）

**优化方案**:
```javascript
async retrieveRAGContext(userRequest, projectContext) {
  // 并行检索 3 个数据源
  const [projectResults, knowledgeResults, conversationResults] = await Promise.all([
    this.projectRAG.query(projectContext.projectId, userRequest, { limit: 3 }),
    this.knowledgeRAG.query(userRequest, { limit: 2 }),
    this.conversationRAG.query(userRequest, { limit: 2 })
  ])

  return {
    projectFiles: projectResults.map(r => ({
      path: r.filePath,
      content: r.content.substring(0, 500),
      score: r.score
    })),
    knowledgeDocs: knowledgeResults.map(r => ({ ... })),
    conversations: conversationResults.map(r => ({ ... }))
  }
}
```

**实施难度**: 低
**风险**: 低

---

### 优化2: LLM规划多层降级策略 ⚡⚡

**优先级**: 高
**预期提升**: 降级成功率从 60% 提升到 90%

**优化方案**:
```javascript
async decomposeTask(userRequest, projectContext) {
  // 尝试1: 主LLM（如GPT-4）
  try {
    const response = await this.llmManager.query({ model: 'gpt-4', ... })
    return this.parseTaskPlan(response.text)
  } catch (error) {
    console.warn('主LLM失败，尝试降级', error)
  }

  // 尝试2: 修复JSON格式错误
  try {
    const cleaned = this.cleanAndFixJSON(response.text)
    return JSON.parse(cleaned)
  } catch (error) {
    console.warn('JSON修复失败', error)
  }

  // 尝试3: 备用LLM（如Claude）
  try {
    const response = await this.llmManager.query({ model: 'claude', ... })
    return this.parseTaskPlan(response.text)
  } catch (error) {
    console.warn('备用LLM失败', error)
  }

  // 尝试4: 本地LLM（Ollama）
  try {
    const response = await this.llmManager.query({ model: 'ollama', ... })
    return this.parseTaskPlan(response.text)
  } catch (error) {
    console.warn('本地LLM失败', error)
  }

  // 尝试5: 基于规则的分解
  return this.ruleBasedDecompose(userRequest, projectContext)
}

// 新增: 基于规则的任务分解
ruleBasedDecompose(userRequest, projectContext) {
  const keywords = {
    'react': ['tool_npm_project_setup', 'file_writer', 'code_generator'],
    'express': ['tool_npm_project_setup', 'file_writer', 'git_init'],
    'python': ['tool_python_project_setup', 'file_writer'],
    'excel': ['tool_excel_generator'],
    'word': ['tool_word_generator']
  }

  const detectedKeywords = Object.keys(keywords).filter(k =>
    userRequest.toLowerCase().includes(k)
  )

  const tools = detectedKeywords.flatMap(k => keywords[k])

  return {
    task_title: userRequest,
    task_type: 'create',
    subtasks: tools.map((tool, i) => ({
      step: i + 1,
      title: `执行 ${tool}`,
      tool,
      action: 'execute',
      params: { request: userRequest },
      dependencies: i > 0 ? [i] : []
    }))
  }
}
```

**实施难度**: 中
**风险**: 低

---

### 优化3: 智能任务计划缓存 ⚡⚡

**优先级**: 中
**预期提升**: 缓存命中率从 20% 提升到 60%

**优化方案**:
```javascript
class SmartTaskPlanCache {
  constructor({ maxSize = 100, ttl = 3600000 }) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.ttl = ttl // 1小时过期
  }

  // 使用语义相似度计算缓存键
  async getCacheKey(userRequest, projectContext) {
    // 1. 提取核心关键词
    const keywords = this.extractKeywords(userRequest)

    // 2. 规范化项目上下文
    const contextFingerprint = {
      type: projectContext.projectType,
      techCount: projectContext.technologies.length,
      fileCount: projectContext.existingFiles.length
    }

    // 3. 计算语义哈希
    const semanticHash = await this.computeSemanticHash(keywords)

    return `${semanticHash}_${JSON.stringify(contextFingerprint)}`
  }

  // 查找相似请求
  async findSimilar(userRequest, threshold = 0.8) {
    const requestEmbedding = await this.getEmbedding(userRequest)

    for (const [key, entry] of this.cache.entries()) {
      // 检查过期
      if (Date.now() - entry.timestamp > this.ttl) {
        this.cache.delete(key)
        continue
      }

      // 计算相似度
      const similarity = this.cosineSimilarity(
        requestEmbedding,
        entry.requestEmbedding
      )

      if (similarity >= threshold) {
        console.log(`缓存命中 (相似度: ${similarity.toFixed(2)})`)
        return entry.taskPlan
      }
    }

    return null
  }

  async set(userRequest, projectContext, taskPlan) {
    // LRU淘汰
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    const key = await this.getCacheKey(userRequest, projectContext)
    const requestEmbedding = await this.getEmbedding(userRequest)

    this.cache.set(key, {
      taskPlan,
      requestEmbedding,
      timestamp: Date.now()
    })
  }

  async getEmbedding(text) {
    // 调用embedding模型（如OpenAI text-embedding-ada-002）
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text
      })
    })

    const data = await response.json()
    return data.data[0].embedding
  }

  cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
    return dotProduct / (magA * magB)
  }
}

// 使用
const cache = new SmartTaskPlanCache({ maxSize: 100, ttl: 3600000 })

async decomposeTask(userRequest, projectContext) {
  // 1. 尝试精确匹配
  const cacheKey = await cache.getCacheKey(userRequest, projectContext)
  if (cache.cache.has(cacheKey)) {
    return cache.cache.get(cacheKey).taskPlan
  }

  // 2. 尝试相似匹配
  const similar = await cache.findSimilar(userRequest, 0.8)
  if (similar) {
    return similar
  }

  // 3. 生成新计划
  const taskPlan = await this.generateTaskPlan(userRequest, projectContext)

  // 4. 保存到缓存
  await cache.set(userRequest, projectContext, taskPlan)

  return taskPlan
}
```

**实施难度**: 中
**风险**: 低（降级为简单缓存）

---

### 优化4: LLM辅助多代理决策 ⚡⚡⚡

**优先级**: 高
**预期提升**: 多代理利用率从 70% 提升到 90%

**优化方案**:
```javascript
async shouldUseMultiAgent(task, context) {
  // 1. 基础规则快速判断（性能优化）
  const basicRules = this.checkBasicRules(task, context)
  if (basicRules.confidence > 0.9) {
    return basicRules.decision
  }

  // 2. LLM辅助决策（边界情况）
  const llmDecision = await this.llmAssistedDecision(task, context)

  // 3. 历史学习（强化学习）
  const historicalData = await this.getHistoricalPerformance(task)
  const adjustedDecision = this.adjustWithHistory(llmDecision, historicalData)

  return adjustedDecision
}

async llmAssistedDecision(task, context) {
  const prompt = `你是一个多代理系统决策专家。请判断以下任务是否应该使用多代理模式。

**任务信息**:
- 任务标题: ${task.task_title}
- 子任务数量: ${task.subtasks.length}
- 预计耗时: ${task.estimated_duration}
- 上下文长度: ${context.length} 字符

**子任务列表**:
${task.subtasks.map(st => `- ${st.title} (工具: ${st.tool})`).join('\n')}

**决策因素**:
1. 上下文污染: 上下文是否过长导致LLM性能下降？
2. 可并行化: 子任务之间是否独立，可以并行执行？
3. 专业化: 是否需要不同领域的专业知识？

请以JSON格式回复:
{
  "useMultiAgent": true/false,
  "strategy": "divide_context/parallel_execution/specialized_agents/null",
  "confidence": 0.0-1.0,
  "reason": "决策理由",
  "agentCount": 建议的代理数量
}

只输出JSON，不要有其他内容。`

  const response = await this.llmManager.query({
    prompt,
    temperature: 0.3,
    maxTokens: 200
  })

  return JSON.parse(response.text)
}

// 历史性能跟踪
async getHistoricalPerformance(task) {
  // 查询数据库中相似任务的执行记录
  const similar = await this.db.all(`
    SELECT
      use_multi_agent,
      AVG(execution_time) as avg_time,
      AVG(success_rate) as avg_success,
      COUNT(*) as count
    FROM task_execution_history
    WHERE task_type = ? AND subtask_count BETWEEN ? AND ?
    GROUP BY use_multi_agent
  `, [task.task_type, task.subtasks.length - 2, task.subtasks.length + 2])

  return similar
}

adjustWithHistory(llmDecision, historicalData) {
  if (!historicalData || historicalData.length === 0) {
    return llmDecision
  }

  // 比较多代理 vs 单代理的历史性能
  const multiAgent = historicalData.find(d => d.use_multi_agent === 1)
  const singleAgent = historicalData.find(d => d.use_multi_agent === 0)

  if (multiAgent && singleAgent) {
    // 多代理更快且成功率高
    if (multiAgent.avg_time < singleAgent.avg_time * 0.8 &&
        multiAgent.avg_success > singleAgent.avg_success * 0.95) {
      llmDecision.useMultiAgent = true
      llmDecision.reason += ` (历史数据: 多代理平均快${Math.round((1 - multiAgent.avg_time / singleAgent.avg_time) * 100)}%)`
    }
    // 单代理更稳定
    else if (singleAgent.avg_success > multiAgent.avg_success * 1.1) {
      llmDecision.useMultiAgent = false
      llmDecision.reason += ` (历史数据: 单代理成功率更高)`
    }
  }

  return llmDecision
}
```

**实施难度**: 高
**风险**: 中（需要积累历史数据）

---

### 优化5: 代理池复用 ⚡⚡

**优先级**: 中
**预期提升**: 减少 80% 代理创建开销（1秒 → 0.2秒）

**优化方案**:
```javascript
class AgentPool {
  constructor({ minSize = 3, maxSize = 10 }) {
    this.minSize = minSize
    this.maxSize = maxSize
    this.availableAgents = []
    this.busyAgents = new Map()

    // 预创建最小数量代理
    this.initialize()
  }

  async initialize() {
    for (let i = 0; i < this.minSize; i++) {
      const agent = await this.createAgent(`pooled_agent_${i}`)
      this.availableAgents.push(agent)
    }

    console.log(`[AgentPool] 代理池初始化完成，可用代理: ${this.minSize}`)
  }

  async acquireAgent(capabilities = {}) {
    // 1. 尝试从池中获取
    if (this.availableAgents.length > 0) {
      const agent = this.availableAgents.pop()

      // 重置代理状态
      agent.capabilities = capabilities.capabilities || []
      agent.role = capabilities.role || 'worker'
      agent.status = 'idle'
      agent.taskQueue = []
      agent.currentTask = null

      this.busyAgents.set(agent.id, agent)

      console.log(`[AgentPool] 从池中获取代理: ${agent.id}`)
      return agent
    }

    // 2. 池已空，检查是否可以扩容
    if (this.busyAgents.size < this.maxSize) {
      const agent = await this.createAgent(
        `pooled_agent_${Date.now()}`,
        capabilities
      )
      this.busyAgents.set(agent.id, agent)

      console.log(`[AgentPool] 创建新代理: ${agent.id}`)
      return agent
    }

    // 3. 池已满，等待可用代理
    console.warn('[AgentPool] 代理池已满，等待可用代理...')
    return await this.waitForAvailableAgent(capabilities)
  }

  releaseAgent(agentId) {
    const agent = this.busyAgents.get(agentId)
    if (!agent) return

    this.busyAgents.delete(agentId)

    // 如果池未满，放回池中
    if (this.availableAgents.length < this.maxSize) {
      this.availableAgents.push(agent)
      console.log(`[AgentPool] 代理归还: ${agentId}`)
    } else {
      // 池已满，销毁代理
      console.log(`[AgentPool] 代理销毁: ${agentId}`)
    }
  }

  async waitForAvailableAgent(capabilities, timeout = 30000) {
    const startTime = Date.now()

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.availableAgents.length > 0) {
          clearInterval(checkInterval)
          resolve(this.acquireAgent(capabilities))
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error('等待可用代理超时'))
        }
      }, 100)
    })
  }

  async createAgent(agentId, capabilities = {}) {
    return {
      id: agentId,
      capabilities: capabilities.capabilities || [],
      role: capabilities.role || 'worker',
      status: 'idle',
      createdAt: new Date().toISOString(),
      taskQueue: [],
      currentTask: null
    }
  }

  getStats() {
    return {
      available: this.availableAgents.length,
      busy: this.busyAgents.size,
      total: this.availableAgents.length + this.busyAgents.size
    }
  }
}

// 全局代理池
const agentPool = new AgentPool({ minSize: 3, maxSize: 10 })

// 使用代理池
class TeammateTool {
  async assignTask(teamId, taskData) {
    // 从池中获取代理，而不是创建新代理
    const agent = await agentPool.acquireAgent({
      capabilities: this.detectRequiredCapabilities(taskData),
      role: 'worker'
    })

    // 分配任务...
    agent.taskQueue.push(taskData)

    return { success: true, agentId: agent.id }
  }

  async releaseAgent(agentId) {
    // 任务完成后归还代理
    agentPool.releaseAgent(agentId)
  }
}
```

**实施难度**: 中
**风险**: 低

---

### 优化6: 动态并发控制 ⚡⚡⚡

**优先级**: 高
**预期提升**: CPU利用率从 50-60% 提升到 80-90%

**优化方案**:
```javascript
class DynamicConcurrencyController {
  constructor({ minConcurrency = 1, maxConcurrency = 10 }) {
    this.minConcurrency = minConcurrency
    this.maxConcurrency = maxConcurrency
    this.currentConcurrency = minConcurrency

    // 系统负载监控
    this.cpuUsage = 0
    this.memoryUsage = 0

    // 性能指标
    this.avgTaskTime = 1000 // 初始假设1秒
    this.taskThroughput = 0 // 任务/秒

    // 启动监控
    this.startMonitoring()
  }

  startMonitoring() {
    // 每5秒更新一次系统负载
    setInterval(() => {
      this.updateSystemLoad()
    }, 5000)
  }

  async updateSystemLoad() {
    const os = require('os')

    // CPU使用率
    const cpus = os.cpus()
    let totalIdle = 0
    let totalTick = 0

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type]
      }
      totalIdle += cpu.times.idle
    }

    this.cpuUsage = 1 - totalIdle / totalTick

    // 内存使用率
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    this.memoryUsage = 1 - freeMem / totalMem

    // 动态调整并发数
    this.adjustConcurrency()
  }

  adjustConcurrency() {
    const oldConcurrency = this.currentConcurrency

    // 规则1: CPU使用率低 (<50%) → 增加并发
    if (this.cpuUsage < 0.5 && this.currentConcurrency < this.maxConcurrency) {
      this.currentConcurrency = Math.min(
        this.currentConcurrency + 1,
        this.maxConcurrency
      )
    }

    // 规则2: CPU使用率高 (>90%) → 减少并发
    if (this.cpuUsage > 0.9 && this.currentConcurrency > this.minConcurrency) {
      this.currentConcurrency = Math.max(
        this.currentConcurrency - 1,
        this.minConcurrency
      )
    }

    // 规则3: 内存使用率高 (>85%) → 减少并发
    if (this.memoryUsage > 0.85 && this.currentConcurrency > this.minConcurrency) {
      this.currentConcurrency = Math.max(
        this.currentConcurrency - 2,
        this.minConcurrency
      )
    }

    // 规则4: 任务吞吐量下降 → 调整并发
    if (this.taskThroughput > 0) {
      const expectedThroughput = this.currentConcurrency / (this.avgTaskTime / 1000)

      if (this.taskThroughput < expectedThroughput * 0.7) {
        // 吞吐量不理想，可能是任务IO密集，增加并发
        this.currentConcurrency = Math.min(
          this.currentConcurrency + 2,
          this.maxConcurrency
        )
      }
    }

    if (oldConcurrency !== this.currentConcurrency) {
      console.log(
        `[DynamicConcurrency] 调整并发数: ${oldConcurrency} → ${this.currentConcurrency} ` +
        `(CPU: ${(this.cpuUsage * 100).toFixed(1)}%, Mem: ${(this.memoryUsage * 100).toFixed(1)}%)`
      )
    }
  }

  getConcurrency(taskType = 'default') {
    // 根据任务类型返回不同的并发数
    switch (taskType) {
      case 'io_bound': // IO密集型（文件读写）
        return Math.min(this.currentConcurrency * 2, this.maxConcurrency)

      case 'cpu_bound': // CPU密集型（LLM调用、数据处理）
        return this.currentConcurrency

      case 'network_bound': // 网络密集型（API调用）
        return Math.min(this.currentConcurrency * 1.5, this.maxConcurrency)

      default:
        return this.currentConcurrency
    }
  }

  recordTaskCompletion(taskType, duration) {
    // 更新平均任务时间
    this.avgTaskTime = this.avgTaskTime * 0.9 + duration * 0.1

    // 更新吞吐量（指数移动平均）
    const currentThroughput = 1000 / duration // 任务/秒
    this.taskThroughput = this.taskThroughput * 0.9 + currentThroughput * 0.1
  }
}

// 在TaskExecutor中使用
class TaskExecutor {
  constructor(options = {}) {
    this.concurrencyController = new DynamicConcurrencyController({
      minConcurrency: options.minConcurrency || 1,
      maxConcurrency: options.maxConcurrency || 10
    })

    // 其他初始化...
  }

  getReadyTasks() {
    const ready = []

    // 获取当前并发限制（动态）
    const maxConcurrency = this.concurrencyController.getConcurrency()

    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'pending') continue
      if (this.runningTasks.size >= maxConcurrency) break

      const deps = this.dependencyGraph.get(taskId) || []
      const allDepsCompleted = deps.every(depId =>
        this.completedTasks.has(depId)
      )

      if (allDepsCompleted) {
        ready.push({ taskId, task })
      }
    }

    return ready
  }

  async executeTask(taskId, task, executor) {
    const startTime = Date.now()

    try {
      // 执行任务...
      const result = await executor(task)

      // 记录任务完成
      const duration = Date.now() - startTime
      this.concurrencyController.recordTaskCompletion(task.type, duration)

      return result
    } catch (error) {
      // 错误处理...
      throw error
    }
  }
}
```

**实施难度**: 中
**风险**: 低

---

### 优化7: 智能重试策略 ⚡⚡

**优先级**: 中
**预期提升**: 任务成功率从 80% 提升到 95%

**优化方案**:
```javascript
class SmartRetryStrategy {
  constructor() {
    // 错误分类
    this.ERROR_TYPES = {
      TRANSIENT: 'transient', // 暂时性故障（网络超时、服务暂时不可用）
      PERMANENT: 'permanent', // 永久性故障（参数错误、工具不存在）
      RATE_LIMIT: 'rate_limit', // 速率限制
      RESOURCE: 'resource' // 资源不足（内存、磁盘空间）
    }

    // 重试配置
    this.RETRY_CONFIGS = {
      [this.ERROR_TYPES.TRANSIENT]: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true
      },
      [this.ERROR_TYPES.RATE_LIMIT]: {
        maxRetries: 5,
        baseDelay: 5000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitter: false
      },
      [this.ERROR_TYPES.RESOURCE]: {
        maxRetries: 2,
        baseDelay: 10000,
        maxDelay: 30000,
        backoffMultiplier: 1.5,
        jitter: true
      },
      [this.ERROR_TYPES.PERMANENT]: {
        maxRetries: 0 // 不重试
      }
    }
  }

  classifyError(error) {
    const message = error.message.toLowerCase()

    // 网络错误
    if (message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('network')) {
      return this.ERROR_TYPES.TRANSIENT
    }

    // 速率限制
    if (message.includes('rate limit') ||
        message.includes('too many requests') ||
        error.statusCode === 429) {
      return this.ERROR_TYPES.RATE_LIMIT
    }

    // 资源不足
    if (message.includes('out of memory') ||
        message.includes('enospc') ||
        message.includes('disk full')) {
      return this.ERROR_TYPES.RESOURCE
    }

    // 参数错误
    if (message.includes('invalid parameter') ||
        message.includes('not found') ||
        message.includes('does not exist') ||
        error.statusCode === 400 ||
        error.statusCode === 404) {
      return this.ERROR_TYPES.PERMANENT
    }

    // 默认为暂时性故障
    return this.ERROR_TYPES.TRANSIENT
  }

  calculateDelay(retryCount, errorType) {
    const config = this.RETRY_CONFIGS[errorType]
    if (!config) return 0

    // 指数退避
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, retryCount)

    // 限制最大延迟
    delay = Math.min(delay, config.maxDelay)

    // 添加抖动（避免雷鸣群效应）
    if (config.jitter) {
      delay += Math.random() * 1000
    }

    return delay
  }

  shouldRetry(error, retryCount) {
    const errorType = this.classifyError(error)
    const config = this.RETRY_CONFIGS[errorType]

    if (!config || retryCount >= config.maxRetries) {
      return {
        shouldRetry: false,
        reason: `已达最大重试次数 (${config?.maxRetries || 0})`
      }
    }

    return {
      shouldRetry: true,
      errorType,
      delay: this.calculateDelay(retryCount, errorType),
      retriesLeft: config.maxRetries - retryCount
    }
  }
}

// 在TaskExecutor中使用
class TaskExecutor {
  constructor(options = {}) {
    this.retryStrategy = new SmartRetryStrategy()
    // 其他初始化...
  }

  async executeTask(taskId, task, executor) {
    const taskData = this.tasks.get(taskId)
    taskData.status = 'running'
    taskData.startTime = Date.now()
    this.runningTasks.add(taskId)

    let retryCount = 0

    while (true) {
      try {
        const result = await Promise.race([
          executor(task),
          this._timeout(this.TASK_TIMEOUT)
        ])

        taskData.status = 'completed'
        taskData.endTime = Date.now()
        taskData.result = result

        this.completedTasks.add(taskId)
        this.runningTasks.delete(taskId)

        this.emit('task:complete', { taskId, task, result })

        return result

      } catch (error) {
        // 智能重试决策
        const retryDecision = this.retryStrategy.shouldRetry(error, retryCount)

        if (!retryDecision.shouldRetry) {
          // 不再重试，标记为失败
          taskData.status = 'failed'
          taskData.endTime = Date.now()
          taskData.error = error.message
          taskData.errorType = this.retryStrategy.classifyError(error)

          this.failedTasks.add(taskId)
          this.runningTasks.delete(taskId)

          this.emit('task:fail', {
            taskId,
            task,
            error,
            reason: retryDecision.reason
          })

          throw error
        }

        // 重试
        retryCount++

        this.emit('task:retry', {
          taskId,
          task,
          retryCount,
          errorType: retryDecision.errorType,
          delay: retryDecision.delay,
          retriesLeft: retryDecision.retriesLeft
        })

        console.log(
          `[TaskExecutor] 任务${taskId}重试 ${retryCount}/${retryDecision.retriesLeft + retryCount} ` +
          `(错误类型: ${retryDecision.errorType}, 延迟: ${retryDecision.delay}ms)`
        )

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, retryDecision.delay))
      }
    }
  }
}
```

**实施难度**: 中
**风险**: 低

---

### 优化8: 关键路径优化 ⚡⚡

**优先级**: 中
**预期提升**: 总执行时间减少 15-20%

**优化方案**:
```javascript
class CriticalPathOptimizer {
  constructor(tasks, dependencyGraph) {
    this.tasks = tasks
    this.dependencyGraph = dependencyGraph
    this.criticalPath = []
    this.taskPriorities = new Map()
  }

  // 计算关键路径
  computeCriticalPath() {
    // 1. 拓扑排序
    const sortedTasks = this.topologicalSort()

    // 2. 计算每个任务的最早开始时间（EST）
    const est = new Map()
    for (const taskId of sortedTasks) {
      const deps = this.dependencyGraph.get(taskId) || []
      const task = this.tasks.get(taskId)

      if (deps.length === 0) {
        est.set(taskId, 0)
      } else {
        const maxDepTime = Math.max(
          ...deps.map(depId =>
            est.get(depId) + (this.tasks.get(depId).task.estimatedDuration || 1000)
          )
        )
        est.set(taskId, maxDepTime)
      }
    }

    // 3. 计算每个任务的最晚开始时间（LST）
    const lst = new Map()
    const totalTime = Math.max(...est.values())

    for (let i = sortedTasks.length - 1; i >= 0; i--) {
      const taskId = sortedTasks[i]
      const task = this.tasks.get(taskId).task

      // 查找依赖此任务的任务
      const dependents = []
      for (const [otherId, deps] of this.dependencyGraph.entries()) {
        if (deps.includes(taskId)) {
          dependents.push(otherId)
        }
      }

      if (dependents.length === 0) {
        lst.set(taskId, totalTime - (task.estimatedDuration || 1000))
      } else {
        const minDependentTime = Math.min(
          ...dependents.map(depId => lst.get(depId))
        )
        lst.set(taskId, minDependentTime - (task.estimatedDuration || 1000))
      }
    }

    // 4. 计算浮动时间（Slack）
    const slack = new Map()
    for (const taskId of sortedTasks) {
      slack.set(taskId, lst.get(taskId) - est.get(taskId))
    }

    // 5. 关键路径 = 浮动时间为0的任务
    this.criticalPath = sortedTasks.filter(taskId => slack.get(taskId) === 0)

    // 6. 计算任务优先级（浮动时间越小，优先级越高）
    for (const [taskId, slackTime] of slack.entries()) {
      // 优先级 = 1000 - 浮动时间（确保关键路径任务优先级最高）
      this.taskPriorities.set(taskId, Math.max(0, 1000 - slackTime))
    }

    console.log(`[CriticalPath] 关键路径:`, this.criticalPath)
    console.log(`[CriticalPath] 预计总时间: ${totalTime}ms`)

    return {
      criticalPath: this.criticalPath,
      totalTime,
      taskPriorities: this.taskPriorities
    }
  }

  topologicalSort() {
    const sorted = []
    const visited = new Set()
    const temp = new Set()

    const visit = (taskId) => {
      if (visited.has(taskId)) return
      if (temp.has(taskId)) {
        throw new Error(`检测到循环依赖: ${taskId}`)
      }

      temp.add(taskId)

      const deps = this.dependencyGraph.get(taskId) || []
      for (const depId of deps) {
        visit(depId)
      }

      temp.delete(taskId)
      visited.add(taskId)
      sorted.push(taskId)
    }

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        visit(taskId)
      }
    }

    return sorted
  }

  getTaskPriority(taskId) {
    return this.taskPriorities.get(taskId) || 0
  }
}

// 在TaskExecutor中使用
class TaskExecutor {
  buildDependencyGraph() {
    // 构建依赖图...

    // 计算关键路径
    const optimizer = new CriticalPathOptimizer(this.tasks, this.dependencyGraph)
    const { criticalPath, totalTime, taskPriorities } = optimizer.computeCriticalPath()

    this.criticalPath = criticalPath
    this.taskPriorities = taskPriorities

    console.log(`[TaskExecutor] 预计总执行时间: ${(totalTime / 1000).toFixed(1)}秒`)
  }

  getReadyTasks() {
    const ready = []

    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'pending') continue
      if (this.runningTasks.size >= this.MAX_CONCURRENCY) break

      const deps = this.dependencyGraph.get(taskId) || []
      const allDepsCompleted = deps.every(depId =>
        this.completedTasks.has(depId)
      )

      if (allDepsCompleted) {
        ready.push({
          taskId,
          task,
          priority: this.taskPriorities.get(taskId) || 0
        })
      }
    }

    // 按优先级排序（关键路径任务优先）
    ready.sort((a, b) => b.priority - a.priority)

    return ready
  }
}
```

**实施难度**: 高
**风险**: 低

---

### 优化9: 工具调用结果缓存 ⚡⚡

**优先级**: 中
**预期提升**: 减少 10-15% 重复工具调用

**优化方案**:
```javascript
class ToolCallCache {
  constructor({ maxSize = 1000, ttl = 600000 }) {
    this.cache = new LRUCache({ max: maxSize, ttl }) // 使用lru-cache库
    this.cacheHits = 0
    this.cacheMisses = 0
  }

  getCacheKey(toolName, params) {
    // 排除不可缓存的参数（如timestamp）
    const cacheableParams = this.extractCacheableParams(params)

    // 生成稳定的哈希键
    return `${toolName}:${this.hash(cacheableParams)}`
  }

  extractCacheableParams(params) {
    // 移除不应影响缓存的参数
    const { timestamp, requestId, ...cacheable } = params
    return cacheable
  }

  hash(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort())
    return require('crypto').createHash('md5').update(str).digest('hex')
  }

  get(toolName, params) {
    const key = this.getCacheKey(toolName, params)
    const cached = this.cache.get(key)

    if (cached) {
      this.cacheHits++
      console.log(`[ToolCallCache] 缓存命中: ${toolName} (命中率: ${this.getHitRate().toFixed(2)}%)`)
      return cached
    }

    this.cacheMisses++
    return null
  }

  set(toolName, params, result) {
    const key = this.getCacheKey(toolName, params)
    this.cache.set(key, result)
  }

  getHitRate() {
    const total = this.cacheHits + this.cacheMisses
    return total > 0 ? (this.cacheHits / total) * 100 : 0
  }

  getStats() {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.getHitRate(),
      size: this.cache.size
    }
  }
}

class FunctionCaller {
  constructor() {
    this.tools = new Map()
    this.toolCache = new ToolCallCache({ maxSize: 1000, ttl: 600000 })

    // 定义可缓存的工具（纯函数）
    this.CACHEABLE_TOOLS = new Set([
      'file_reader',
      'project_analyzer',
      'data_analyzer',
      'image_analyzer',
      'tool_excel_formula_builder',
      'tool_markdown_generator'
      // 不包括: file_writer, git_commit等有副作用的工具
    ])
  }

  isCacheable(toolName) {
    return this.CACHEABLE_TOOLS.has(toolName)
  }

  async call(toolName, params, context = {}) {
    // 1. 检查缓存（仅对可缓存工具）
    if (this.isCacheable(toolName)) {
      const cached = this.toolCache.get(toolName, params)
      if (cached) {
        return cached
      }
    }

    // 2. 执行工具
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new Error(`工具不存在: ${toolName}`)
    }

    const result = await tool.function(params, context)

    // 3. 缓存结果（仅对可缓存工具）
    if (this.isCacheable(toolName)) {
      this.toolCache.set(toolName, params, result)
    }

    return result
  }

  getCacheStats() {
    return this.toolCache.getStats()
  }
}
```

**实施难度**: 低
**风险**: 低（注意不要缓存有副作用的工具）

---

### 优化10: 自动阶段转换 ⚡

**优先级**: 低
**预期提升**: 减少人为错误

**优化方案**:
```javascript
class AutoPhaseTransition {
  constructor(functionCaller, taskExecutor) {
    this.functionCaller = functionCaller
    this.taskExecutor = taskExecutor
    this.currentPhase = 'planning'

    // 监听任务执行事件
    this.taskExecutor.on('tasks:ready', () => this.maybeTransition('executing'))
    this.taskExecutor.on('tasks:all-complete', () => this.maybeTransition('validating'))
  }

  maybeTransition(targetPhase) {
    if (this.shouldTransition(targetPhase)) {
      console.log(`[AutoPhaseTransition] 自动切换阶段: ${this.currentPhase} → ${targetPhase}`)
      this.functionCaller.transitionToPhase(targetPhase)
      this.currentPhase = targetPhase
    }
  }

  shouldTransition(targetPhase) {
    const transitions = {
      planning: ['executing'],
      executing: ['validating', 'executing'],
      validating: ['executing', 'committing'],
      committing: ['planning']
    }

    const allowedTransitions = transitions[this.currentPhase] || []
    return allowedTransitions.includes(targetPhase)
  }
}

// 使用
const autoTransition = new AutoPhaseTransition(functionCaller, taskExecutor)
```

**实施难度**: 低
**风险**: 低

---

### 优化11: 质量门禁实时检查 ⚡⚡

**优先级**: 高
**预期提升**: 减少 50% 返工时间

**优化方案**:
```javascript
class RealtimeQualityMonitor {
  constructor({ projectPath, db }) {
    this.projectPath = projectPath
    this.db = db
    this.checks = []

    // 启动文件监控
    this.startFileWatcher()
  }

  startFileWatcher() {
    const chokidar = require('chokidar')

    const watcher = chokidar.watch(this.projectPath, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true
    })

    // 文件变更时触发检查
    watcher.on('change', async (path) => {
      console.log(`[RealtimeQuality] 文件变更: ${path}`)
      await this.checkFile(path)
    })
  }

  async checkFile(filePath) {
    // 只检查代码文件
    if (!/\.(js|jsx|ts|tsx|vue)$/.test(filePath)) return

    const checks = []

    // 1. 快速语法检查（使用eslint --fix）
    try {
      const { stdout } = await execPromise(
        `npx eslint "${filePath}" --format json`,
        { cwd: this.projectPath }
      )

      const result = JSON.parse(stdout)
      if (result[0] && result[0].errorCount > 0) {
        checks.push({
          type: 'lint',
          severity: 'error',
          count: result[0].errorCount,
          file: filePath
        })

        // 实时通知前端
        this.notify('quality-issue', {
          file: filePath,
          issues: result[0].messages.slice(0, 5) // 只显示前5个错误
        })
      }
    } catch (error) {
      console.error('[RealtimeQuality] Lint检查失败:', error)
    }

    // 2. 检查文件复杂度
    const complexity = await this.checkComplexity(filePath)
    if (complexity > 10) {
      this.notify('quality-warning', {
        file: filePath,
        message: `函数复杂度过高 (${complexity})，建议重构`
      })
    }

    return checks
  }

  async checkComplexity(filePath) {
    // 使用工具如eslint-plugin-complexity或自己实现
    // 这里简化为行数统计
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim()).length
    return Math.floor(lines / 10) // 简化的复杂度指标
  }

  notify(event, data) {
    // 通过IPC发送到前端
    const { BrowserWindow } = require('electron')
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      mainWindow.webContents.send(`realtime-quality:${event}`, data)
    }
  }
}

// 启动实时监控
const qualityMonitor = new RealtimeQualityMonitor({
  projectPath: project.path,
  db
})
```

**实施难度**: 中
**风险**: 低

---

### 优化12: 质量门禁并行检查 ⚡⚡

**优先级**: 中
**预期提升**: 质量检查时间减少 70%（10分钟 → 3分钟）

**优化方案**:
```javascript
async checkQualityGates(workflowId, stageId) {
  const stage = await this.loadStage(workflowId, stageId)

  // 并行执行所有质量门禁检查
  const results = await Promise.all(
    stage.qualityGates.map(gate =>
      this.checkQualityGate(workflowId, stageId, gate.id)
        .catch(error => ({
          passed: false,
          reason: `检查失败: ${error.message}`
        }))
    )
  )

  // 更新所有门禁状态
  for (let i = 0; i < stage.qualityGates.length; i++) {
    stage.qualityGates[i].status = results[i].passed ? 'passed' : 'failed'
    stage.qualityGates[i].result = results[i]
  }

  // 检查是否所有门禁都通过
  const allPassed = results.every(r => r.passed)

  if (!allPassed) {
    const failedGates = stage.qualityGates.filter(g => g.status === 'failed')
    notification.warning({
      message: '质量门禁未通过',
      description: `${failedGates.length}个门禁失败: ${failedGates.map(g => g.name).join(', ')}`
    })
  }

  return allPassed
}
```

**实施难度**: 低
**风险**: 低

---

### 优化13: 消息聚合推送 ⚡⚡

**优先级**: 中
**预期提升**: 前端渲染性能提升 50%

**优化方案**:
```javascript
class MessageAggregator {
  constructor({ window, batchInterval = 100 }) {
    this.window = window
    this.batchInterval = batchInterval
    this.messageQueue = []
    this.timer = null
  }

  push(event, data) {
    this.messageQueue.push({ event, data, timestamp: Date.now() })

    // 启动批量发送定时器
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush()
      }, this.batchInterval)
    }
  }

  flush() {
    if (this.messageQueue.length === 0) return

    // 按事件类型分组
    const grouped = {}
    for (const msg of this.messageQueue) {
      if (!grouped[msg.event]) {
        grouped[msg.event] = []
      }
      grouped[msg.event].push(msg.data)
    }

    // 发送批量消息
    for (const [event, dataList] of Object.entries(grouped)) {
      this.window.webContents.send(`batch:${event}`, dataList)
    }

    console.log(`[MessageAggregator] 发送${this.messageQueue.length}条消息 (${Object.keys(grouped).length}个事件类型)`)

    // 清空队列
    this.messageQueue = []
    this.timer = null
  }
}

// 使用
const messageAggregator = new MessageAggregator({
  window: mainWindow,
  batchInterval: 100 // 100ms批量发送一次
})

// 任务事件
taskExecutor.on('task:start', ({ taskId, task }) => {
  messageAggregator.push('task:start', { taskId, task })
})

taskExecutor.on('task:complete', ({ taskId, task, result }) => {
  messageAggregator.push('task:complete', { taskId, task, result })
})

// 前端接收
ipcRenderer.on('batch:task:start', (event, tasks) => {
  // 批量更新UI
  for (const { taskId, task } of tasks) {
    updateTaskStatus(taskId, 'running')
  }
})
```

**实施难度**: 低
**风险**: 低

---

### 优化14: 文件树懒加载 ⚡⚡

**优先级**: 中
**预期提升**: 大项目打开时间减少 80%（10秒 → 2秒）

**优化方案**:
```javascript
// 后端: 按需加载文件树
ipcMain.handle('file-tree:load-children', async (event, { projectPath, dirPath }) => {
  const fullPath = path.join(projectPath, dirPath)

  const files = await fs.readdir(fullPath, { withFileTypes: true })

  return files.map(file => ({
    name: file.name,
    path: path.join(dirPath, file.name),
    isDirectory: file.isDirectory(),
    // 延迟加载子节点
    children: file.isDirectory() ? null : undefined,
    size: file.isFile() ? (await fs.stat(path.join(fullPath, file.name))).size : 0
  }))
})

// 前端: 懒加载组件
```

```vue
<template>
  <a-tree
    :tree-data="treeData"
    :load-data="loadData"
    :expanded-keys="expandedKeys"
    @expand="handleExpand"
  >
    <template #title="{ title, isDirectory }">
      <folder-outlined v-if="isDirectory" />
      <file-outlined v-else />
      {{ title }}
    </template>
  </a-tree>
</template>

<script setup>
import { ref } from 'vue'
import { ipcRenderer } from 'electron'

const treeData = ref([
  {
    title: 'root',
    key: '/',
    isDirectory: true,
    children: [] // 初始为空
  }
])

const expandedKeys = ref([])

async function loadData(treeNode) {
  // 已加载过，直接返回
  if (treeNode.dataRef.children && treeNode.dataRef.children.length > 0) {
    return
  }

  // 加载子节点
  const children = await ipcRenderer.invoke('file-tree:load-children', {
    projectPath: project.value.path,
    dirPath: treeNode.dataRef.key
  })

  treeNode.dataRef.children = children.map(file => ({
    title: file.name,
    key: file.path,
    isLeaf: !file.isDirectory,
    isDirectory: file.isDirectory,
    children: file.isDirectory ? [] : undefined
  }))
}

function handleExpand(keys, { node, expanded }) {
  expandedKeys.value = keys
}
</script>
```

**实施难度**: 中
**风险**: 低

---

### 优化15: 智能检查点策略 ⚡

**优先级**: 低
**预期提升**: 减少 30% IO开销

**优化方案**:
```javascript
class SmartCheckpointStrategy {
  constructor({ minInterval = 60000, maxInterval = 600000 }) {
    this.minInterval = minInterval // 最小1分钟
    this.maxInterval = maxInterval // 最大10分钟
  }

  calculateInterval(taskMetadata) {
    const {
      estimatedDuration = 300000, // 默认5分钟
      currentProgress = 0,
      taskType = 'default',
      priority = 'normal'
    } = taskMetadata

    // 1. 基于预计耗时
    let interval
    if (estimatedDuration < 2 * 60 * 1000) {
      // 快速任务(<2分钟): 不保存检查点
      interval = Infinity
    } else if (estimatedDuration < 10 * 60 * 1000) {
      // 中等任务(2-10分钟): 每2分钟
      interval = 2 * 60 * 1000
    } else {
      // 慢速任务(>10分钟): 每5分钟
      interval = 5 * 60 * 1000
    }

    // 2. 基于任务类型调整
    if (taskType === 'data_processing') {
      // 数据处理任务: 更频繁
      interval *= 0.5
    } else if (taskType === 'llm_call') {
      // LLM调用: 较少（IO较小）
      interval *= 1.5
    }

    // 3. 基于优先级调整
    if (priority === 'urgent' || priority === 'high') {
      // 高优先级任务: 更频繁（确保不丢失进度）
      interval *= 0.8
    }

    // 4. 限制在合理范围
    interval = Math.max(this.minInterval, Math.min(interval, this.maxInterval))

    return interval
  }

  shouldSaveCheckpoint(lastCheckpointTime, taskMetadata) {
    const interval = this.calculateInterval(taskMetadata)

    if (interval === Infinity) {
      return false
    }

    const timeSinceLastCheckpoint = Date.now() - lastCheckpointTime
    return timeSinceLastCheckpoint >= interval
  }
}

// 在LongRunningTaskManager中使用
class LongRunningTaskManager {
  constructor({ db, functionCaller }) {
    this.db = db
    this.functionCaller = functionCaller
    this.checkpointStrategy = new SmartCheckpointStrategy({
      minInterval: 60000,
      maxInterval: 600000
    })
  }

  async executeNewTask(task, context) {
    const taskState = {
      taskId: task.id,
      startedAt: Date.now(),
      lastCheckpointTime: Date.now(),
      // ...其他状态
    }

    // 动态检查点定时器
    const checkCheckpoint = () => {
      if (this.checkpointStrategy.shouldSaveCheckpoint(
        taskState.lastCheckpointTime,
        {
          estimatedDuration: task.estimated_duration,
          currentProgress: taskState.completedSteps.length / taskState.totalSteps,
          taskType: task.task_type,
          priority: task.priority
        }
      )) {
        this.saveCheckpoint(task.id, taskState)
        taskState.lastCheckpointTime = Date.now()
      }

      // 继续检查
      setTimeout(checkCheckpoint, 10000) // 每10秒检查一次
    }

    checkCheckpoint()

    // ...执行任务
  }
}
```

**实施难度**: 中
**风险**: 低

---

## 3. 优化实施计划

### 阶段1: 快速优化（1-2周）

**目标**: 快速提升用户体验

**优化项**:
1. ✅ RAG检索并行化（优化1）
2. ✅ 消息聚合推送（优化13）
3. ✅ 文件树懒加载（优化14）
4. ✅ 工具调用结果缓存（优化9）

**预期效果**:
- 任务规划速度提升 60%
- 前端响应速度提升 50%
- 大项目打开速度提升 80%

---

### 阶段2: 核心优化（2-3周）

**目标**: 优化任务执行引擎

**优化项**:
5. ✅ LLM规划多层降级（优化2）
6. ✅ 动态并发控制（优化6）
7. ✅ 智能重试策略（优化7）
8. ✅ 质量门禁并行检查（优化12）

**预期效果**:
- 任务成功率提升 15%
- CPU利用率提升 30-40%
- 质量检查时间减少 70%

---

### 阶段3: 高级优化（3-4周）

**目标**: 智能化决策和优化

**优化项**:
9. ✅ 智能任务计划缓存（优化3）
10. ✅ LLM辅助多代理决策（优化4）
11. ✅ 代理池复用（优化5）
12. ✅ 关键路径优化（优化8）

**预期效果**:
- 缓存命中率提升 40%
- 多代理利用率提升 20%
- 总执行时间减少 15-20%

---

### 阶段4: 实时监控（2-3周）

**目标**: 提前发现质量问题

**优化项**:
13. ✅ 质量门禁实时检查（优化11）
14. ✅ 自动阶段转换（优化10）
15. ✅ 智能检查点策略（优化15）

**预期效果**:
- 返工时间减少 50%
- 人为错误减少
- IO开销减少 30%

---

## 4. 预期效果

### 4.1 性能提升总结

| 指标 | 当前 | 优化后 | 提升 |
|------|------|--------|------|
| **任务规划时间** | 2-3秒 | 1秒 | ↓ 60% |
| **任务成功率** | 80% | 95% | ↑ 15% |
| **CPU利用率** | 50-60% | 80-90% | ↑ 40% |
| **缓存命中率** | 20% | 60% | ↑ 40% |
| **多代理利用率** | 70% | 90% | ↑ 20% |
| **总执行时间** | 基准 | 基准 × 0.7 | ↓ 30% |
| **质量检查时间** | 10分钟 | 3分钟 | ↓ 70% |
| **前端渲染性能** | 基准 | 基准 × 1.5 | ↑ 50% |
| **大项目打开时间** | 10秒 | 2秒 | ↓ 80% |

### 4.2 用户体验提升

**等待时间减少**:
- 项目创建: 5分钟 → 3.5分钟（↓ 30%）
- 质量检查: 10分钟 → 3分钟（↓ 70%）
- 大项目打开: 10秒 → 2秒（↓ 80%）

**成功率提升**:
- 任务执行成功率: 80% → 95%（↑ 15%）
- LLM规划成功率: 85% → 95%（↑ 10%）

**交互流畅度**:
- 前端渲染卡顿: 1-2秒 → <0.2秒
- 消息推送延迟: 实时 → 批量（100ms）

### 4.3 资源利用率

**计算资源**:
- CPU利用率: 50-60% → 80-90%
- 内存使用: 稳定（代理池、缓存LRU）

**网络资源**:
- 重复LLM调用减少 10-15%（缓存）
- 前端消息流量减少 50%（聚合）

**存储资源**:
- 检查点IO减少 30%（智能策略）

---

## 5. 风险评估

### 低风险优化（可立即实施）

- ✅ RAG检索并行化
- ✅ 消息聚合推送
- ✅ 工具调用结果缓存
- ✅ 质量门禁并行检查
- ✅ 文件树懒加载
- ✅ 自动阶段转换

### 中风险优化（需要充分测试）

- ⚠️ LLM规划多层降级（可能增加成本）
- ⚠️ 智能任务计划缓存（需要embedding API）
- ⚠️ 动态并发控制（需要监控系统负载）
- ⚠️ 智能重试策略（需要错误分类准确）
- ⚠️ 代理池复用（需要确保状态隔离）

### 高风险优化（需要A/B测试）

- 🔴 LLM辅助多代理决策（增加LLM调用成本）
- 🔴 关键路径优化（算法复杂度高）

---

## 6. 实施建议

### 6.1 优先级排序

**P0（立即实施，1周内）**:
1. RAG检索并行化
2. 消息聚合推送
3. 工具调用结果缓存

**P1（重要，2-3周）**:
4. LLM规划多层降级
5. 动态并发控制
6. 智能重试策略
7. 质量门禁并行检查

**P2（有价值，4-6周）**:
8. 智能任务计划缓存
9. 代理池复用
10. 文件树懒加载
11. 质量门禁实时检查

**P3（锦上添花，6-8周）**:
12. LLM辅助多代理决策
13. 关键路径优化
14. 自动阶段转换
15. 智能检查点策略

### 6.2 A/B测试建议

对于高风险优化，建议进行A/B测试：

```javascript
// 特性开关配置
const FEATURES = {
  'llm-assisted-decision': {
    enabled: false,
    rollout: 0.1, // 10%用户
    description: 'LLM辅助多代理决策'
  },
  'critical-path-optimization': {
    enabled: false,
    rollout: 0.2, // 20%用户
    description: '关键路径优化'
  }
}

// 检查特性是否启用
function isFeatureEnabled(featureName) {
  const feature = FEATURES[featureName]
  if (!feature || !feature.enabled) return false

  // 基于用户ID的哈希，确保同一用户始终看到相同结果
  const userId = getCurrentUserId()
  const hash = murmurhash(userId + featureName)
  const bucket = hash % 100 / 100

  return bucket < feature.rollout
}

// 使用
if (isFeatureEnabled('llm-assisted-decision')) {
  // 使用LLM辅助决策
  decision = await llmAssistedDecision(task, context)
} else {
  // 使用基础规则
  decision = checkBasicRules(task, context)
}
```

### 6.3 监控指标

**关键指标（必须监控）**:
- 任务执行成功率
- 平均任务执行时间
- CPU/内存使用率
- LLM调用次数和成本
- 用户满意度（NPS）

**次要指标**:
- 缓存命中率
- 重试次数
- 质量门禁通过率
- 前端渲染FPS

---

## 总结

通过实施这15项优化建议，预计可以将整体性能提升 **30-50%**，用户体验显著改善。建议按照优先级分阶段实施，并持续监控关键指标，根据实际效果动态调整。

**核心优化重点**:
1. **并行化**: RAG检索、质量门禁检查、消息推送
2. **智能化**: 多层降级、智能重试、LLM辅助决策
3. **缓存化**: 任务计划、工具调用、代理池
4. **实时化**: 质量监控、动态并发、自动阶段转换

**投入产出比最高的优化**（优先实施）:
- ⭐⭐⭐ RAG检索并行化（低成本，高收益）
- ⭐⭐⭐ 消息聚合推送（低成本，高收益）
- ⭐⭐⭐ 工具调用结果缓存（低成本，高收益）
- ⭐⭐⭐ 动态并发控制（中成本，高收益）

---

**文档完成日期**: 2026-01-27
**文档版本**: v1.0.0