/**
 * 高级RAG系统
 *
 * 主要功能:
 * 1. 多跳推理 - 复杂查询分解和迭代检索
 * 2. 知识图谱 - 实体关系建模和图检索
 * 3. 时序检索 - 时间敏感信息检索
 * 4. 自适应策略 - 智能选择检索策略
 * 5. 查询分解 - 复杂问题拆解
 * 6. 推理链追踪 - 记录推理过程
 * 7. 置信度评分 - 结果可信度评估
 *
 * @version 1.6.0
 */

import { getHybridSearch } from './hybrid-search.js'
import { getLLMManager } from '../llm/llm-manager.js'
import { getAdvancedCache } from '../common/cache-advanced.js'

/**
 * 知识图谱管理器
 */
class KnowledgeGraphManager {
  constructor(config = {}) {
    this.config = {
      maxEntities: config.maxEntities || 10000,
      maxRelations: config.maxRelations || 50000,
      enableCache: config.enableCache !== false,
      ...config
    }

    // 实体存储 { id -> { name, type, properties } }
    this.entities = new Map()

    // 关系存储 { id -> { from, to, type, properties } }
    this.relations = new Map()

    // 索引
    this.entityIndex = new Map() // name -> entity ids
    this.typeIndex = new Map()   // type -> entity ids
    this.relationIndex = new Map() // from:to -> relation ids

    // 缓存
    if (this.config.enableCache) {
      this.cache = getAdvancedCache('knowledge-graph', {
        l1MaxSize: 100,
        compressionEnabled: true
      })
    }

    this.stats = {
      entityCount: 0,
      relationCount: 0,
      queriesProcessed: 0
    }
  }

  async initialize() {
    if (this.cache) {
      await this.cache.initialize()
    }
    return { success: true }
  }

  /**
   * 添加实体
   */
  addEntity(name, type, properties = {}) {
    const id = this.generateEntityId(name, type)

    const entity = {
      id,
      name,
      type,
      properties,
      createdAt: Date.now()
    }

    this.entities.set(id, entity)

    // 更新索引
    if (!this.entityIndex.has(name)) {
      this.entityIndex.set(name, new Set())
    }
    this.entityIndex.get(name).add(id)

    if (!this.typeIndex.has(type)) {
      this.typeIndex.set(type, new Set())
    }
    this.typeIndex.get(type).add(id)

    this.stats.entityCount++

    return entity
  }

  /**
   * 添加关系
   */
  addRelation(fromEntityId, toEntityId, relationType, properties = {}) {
    const id = this.generateRelationId(fromEntityId, toEntityId, relationType)

    const relation = {
      id,
      from: fromEntityId,
      to: toEntityId,
      type: relationType,
      properties,
      createdAt: Date.now()
    }

    this.relations.set(id, relation)

    // 更新索引
    const indexKey = `${fromEntityId}:${toEntityId}`
    if (!this.relationIndex.has(indexKey)) {
      this.relationIndex.set(indexKey, new Set())
    }
    this.relationIndex.get(indexKey).add(id)

    this.stats.relationCount++

    return relation
  }

  /**
   * 查找实体
   */
  findEntities(query) {
    const results = []

    // 按名称查找
    if (query.name) {
      const entityIds = this.entityIndex.get(query.name)
      if (entityIds) {
        entityIds.forEach(id => {
          const entity = this.entities.get(id)
          if (this.matchesQuery(entity, query)) {
            results.push(entity)
          }
        })
      }
    }

    // 按类型查找
    if (query.type) {
      const entityIds = this.typeIndex.get(query.type)
      if (entityIds) {
        entityIds.forEach(id => {
          const entity = this.entities.get(id)
          if (this.matchesQuery(entity, query)) {
            results.push(entity)
          }
        })
      }
    }

    // 全量查找（模糊匹配）
    if (!query.name && !query.type && query.pattern) {
      const pattern = new RegExp(query.pattern, 'i')
      this.entities.forEach(entity => {
        if (pattern.test(entity.name) && this.matchesQuery(entity, query)) {
          results.push(entity)
        }
      })
    }

    return results
  }

  /**
   * 查找关系
   */
  findRelations(query) {
    const results = []

    // 从特定实体出发
    if (query.from) {
      this.relations.forEach(relation => {
        if (relation.from === query.from && this.matchesQuery(relation, query)) {
          results.push(relation)
        }
      })
    }

    // 到特定实体
    if (query.to) {
      this.relations.forEach(relation => {
        if (relation.to === query.to && this.matchesQuery(relation, query)) {
          results.push(relation)
        }
      })
    }

    // 特定类型
    if (query.type && !query.from && !query.to) {
      this.relations.forEach(relation => {
        if (relation.type === query.type && this.matchesQuery(relation, query)) {
          results.push(relation)
        }
      })
    }

    return results
  }

  /**
   * 多跳查询（路径查找）
   */
  findPath(fromEntityId, toEntityId, maxHops = 3) {
    // BFS查找最短路径
    const queue = [{ entity: fromEntityId, path: [fromEntityId] }]
    const visited = new Set([fromEntityId])

    while (queue.length > 0) {
      const { entity, path } = queue.shift()

      // 找到目标
      if (entity === toEntityId) {
        return this.reconstructPath(path)
      }

      // 达到最大跳数
      if (path.length >= maxHops + 1) {
        continue
      }

      // 查找邻居
      const outgoingRelations = this.findRelations({ from: entity })

      for (const relation of outgoingRelations) {
        if (!visited.has(relation.to)) {
          visited.add(relation.to)
          queue.push({
            entity: relation.to,
            path: [...path, relation.to]
          })
        }
      }
    }

    return null // 未找到路径
  }

  /**
   * 重构路径（包含实体和关系）
   */
  reconstructPath(entityIds) {
    const path = []

    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i]
      const entity = this.entities.get(entityId)

      path.push({
        type: 'entity',
        data: entity
      })

      // 添加关系（除了最后一个实体）
      if (i < entityIds.length - 1) {
        const nextEntityId = entityIds[i + 1]
        const relations = this.findRelations({
          from: entityId,
          to: nextEntityId
        })

        if (relations.length > 0) {
          path.push({
            type: 'relation',
            data: relations[0]
          })
        }
      }
    }

    return path
  }

  /**
   * 匹配查询条件
   */
  matchesQuery(item, query) {
    // 检查所有查询条件
    for (const [key, value] of Object.entries(query)) {
      if (key === 'pattern') continue // 已在上层处理

      if (item[key] !== value) {
        return false
      }
    }

    return true
  }

  /**
   * 生成实体ID
   */
  generateEntityId(name, type) {
    return `entity:${type}:${name}:${Date.now()}`
  }

  /**
   * 生成关系ID
   */
  generateRelationId(from, to, type) {
    return `relation:${type}:${from}:${to}:${Date.now()}`
  }

  /**
   * 从文档构建知识图谱
   */
  async buildFromDocuments(documents) {
    const llm = getLLMManager()

    for (const doc of documents) {
      // 使用LLM提取实体和关系
      const prompt = `
从以下文本中提取实体和关系，以JSON格式返回：

文本：${doc.content}

返回格式：
{
  "entities": [
    { "name": "实体名", "type": "类型" }
  ],
  "relations": [
    { "from": "实体1", "to": "实体2", "type": "关系类型" }
  ]
}
`

      try {
        const response = await llm.chat([
          { role: 'user', content: prompt }
        ])

        const extracted = JSON.parse(response.content)

        // 添加实体
        const entityMap = new Map()
        for (const entity of extracted.entities || []) {
          const added = this.addEntity(entity.name, entity.type, {
            sourceDoc: doc.id
          })
          entityMap.set(entity.name, added.id)
        }

        // 添加关系
        for (const relation of extracted.relations || []) {
          const fromId = entityMap.get(relation.from)
          const toId = entityMap.get(relation.to)

          if (fromId && toId) {
            this.addRelation(fromId, toId, relation.type, {
              sourceDoc: doc.id
            })
          }
        }
      } catch (error) {
        console.error('[KG] 提取失败:', error.message)
      }
    }

    return {
      entities: this.stats.entityCount,
      relations: this.stats.relationCount
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      memoryUsage: {
        entities: this.entities.size,
        relations: this.relations.size
      }
    }
  }
}

/**
 * 多跳推理管理器
 */
class MultiHopReasoningManager {
  constructor(config = {}) {
    this.config = {
      maxHops: config.maxHops || 3,
      maxIterations: config.maxIterations || 5,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      ...config
    }

    this.hybridSearch = getHybridSearch()
    this.llm = getLLMManager()
    this.kg = new KnowledgeGraphManager()

    this.reasoningHistory = []
  }

  async initialize() {
    await this.kg.initialize()
    return { success: true }
  }

  /**
   * 执行多跳推理
   */
  async reason(query, context = {}) {
    const reasoning = {
      query,
      hops: [],
      finalAnswer: null,
      confidence: 0,
      startTime: Date.now()
    }

    // 步骤1: 分解查询
    const subQueries = await this.decomposeQuery(query)
    reasoning.subQueries = subQueries

    // 步骤2: 迭代检索和推理
    let currentContext = context
    let iteration = 0

    for (const subQuery of subQueries) {
      if (iteration >= this.config.maxIterations) {
        break
      }

      // 检索相关信息
      const retrievalResult = await this.hybridSearch.search(subQuery, {
        limit: 5,
        includeScores: true
      })

      const hop = {
        iteration: iteration + 1,
        subQuery,
        retrieved: retrievalResult.results.map(r => ({
          content: r.content,
          score: r.score
        })),
        reasoning: null,
        confidence: 0
      }

      // 基于检索结果推理
      const reasoningResult = await this.performReasoning(
        subQuery,
        retrievalResult.results,
        currentContext
      )

      hop.reasoning = reasoningResult.reasoning
      hop.confidence = reasoningResult.confidence

      // 更新上下文
      currentContext = {
        ...currentContext,
        [subQuery]: reasoningResult.reasoning
      }

      reasoning.hops.push(hop)
      iteration++

      // 如果置信度足够高，可以提前结束
      if (reasoningResult.confidence >= this.config.confidenceThreshold) {
        break
      }
    }

    // 步骤3: 综合最终答案
    reasoning.finalAnswer = await this.synthesizeFinalAnswer(
      query,
      reasoning.hops,
      currentContext
    )

    reasoning.confidence = this.calculateOverallConfidence(reasoning.hops)
    reasoning.endTime = Date.now()
    reasoning.duration = reasoning.endTime - reasoning.startTime

    this.reasoningHistory.push(reasoning)

    return reasoning
  }

  /**
   * 分解查询
   */
  async decomposeQuery(query) {
    const prompt = `
将以下复杂查询分解为多个子查询，按顺序执行这些子查询可以回答原始问题。

原始查询: ${query}

以JSON数组格式返回子查询列表，例如：
["子查询1", "子查询2", "子查询3"]

只返回JSON，不要其他解释。
`

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ])

      const subQueries = JSON.parse(response.content)

      if (Array.isArray(subQueries) && subQueries.length > 0) {
        return subQueries
      }
    } catch (error) {
      console.error('[MultiHop] 查询分解失败:', error.message)
    }

    // 降级：返回原始查询
    return [query]
  }

  /**
   * 执行推理
   */
  async performReasoning(subQuery, documents, context) {
    const contextStr = Object.entries(context)
      .map(([q, a]) => `Q: ${q}\nA: ${a}`)
      .join('\n\n')

    const documentsStr = documents
      .map((doc, i) => `[${i + 1}] ${doc.content}`)
      .join('\n\n')

    const prompt = `
基于以下信息回答问题：

已知信息：
${contextStr}

检索到的文档：
${documentsStr}

问题: ${subQuery}

请提供简洁的答案，并评估你的置信度（0-1）。

以JSON格式返回：
{
  "reasoning": "你的推理过程",
  "answer": "答案",
  "confidence": 0.85
}
`

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ])

      const result = JSON.parse(response.content)

      return {
        reasoning: result.answer || result.reasoning,
        confidence: result.confidence || 0.5
      }
    } catch (error) {
      console.error('[MultiHop] 推理失败:', error.message)

      return {
        reasoning: '无法推理',
        confidence: 0
      }
    }
  }

  /**
   * 综合最终答案
   */
  async synthesizeFinalAnswer(originalQuery, hops, context) {
    const hopsStr = hops
      .map((hop, i) => `
步骤${i + 1}: ${hop.subQuery}
推理: ${hop.reasoning}
置信度: ${hop.confidence}
`)
      .join('\n')

    const prompt = `
基于以下推理步骤，回答原始问题：

原始问题: ${originalQuery}

推理步骤：
${hopsStr}

请综合上述信息，给出最终答案。
`

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ])

      return response.content
    } catch (error) {
      console.error('[MultiHop] 综合答案失败:', error.message)

      // 降级：返回最后一跳的推理
      if (hops.length > 0) {
        return hops[hops.length - 1].reasoning
      }

      return '无法生成答案'
    }
  }

  /**
   * 计算总体置信度
   */
  calculateOverallConfidence(hops) {
    if (hops.length === 0) return 0

    // 取所有跳的置信度的调和平均数（更保守）
    const sum = hops.reduce((acc, hop) => acc + 1 / hop.confidence, 0)
    return hops.length / sum
  }

  /**
   * 获取推理历史
   */
  getHistory() {
    return this.reasoningHistory
  }
}

/**
 * 时序信息检索管理器
 */
class TemporalRetrievalManager {
  constructor(config = {}) {
    this.config = {
      enableTimeDecay: config.enableTimeDecay !== false,
      decayFactor: config.decayFactor || 0.1, // 每天衰减10%
      ...config
    }

    this.hybridSearch = getHybridSearch()
    this.timeIndex = new Map() // timestamp -> document ids
  }

  async initialize() {
    return { success: true }
  }

  /**
   * 索引文档时间信息
   */
  indexDocument(docId, timestamp) {
    const timeKey = this.getTimeKey(timestamp)

    if (!this.timeIndex.has(timeKey)) {
      this.timeIndex.set(timeKey, new Set())
    }

    this.timeIndex.get(timeKey).add(docId)
  }

  /**
   * 时间范围检索
   */
  async searchByTimeRange(query, startTime, endTime, options = {}) {
    // 基础检索
    const results = await this.hybridSearch.search(query, options)

    // 过滤时间范围
    const filtered = results.results.filter(doc => {
      const timestamp = doc.metadata?.timestamp || doc.createdAt || Date.now()
      return timestamp >= startTime && timestamp <= endTime
    })

    // 应用时间衰减
    if (this.config.enableTimeDecay) {
      const now = Date.now()

      filtered.forEach(doc => {
        const timestamp = doc.metadata?.timestamp || doc.createdAt || now
        const ageInDays = (now - timestamp) / (1000 * 60 * 60 * 24)
        const decayMultiplier = Math.exp(-this.config.decayFactor * ageInDays)

        doc.timeScore = decayMultiplier
        doc.finalScore = (doc.score || 1) * decayMultiplier
      })

      // 重新排序
      filtered.sort((a, b) => b.finalScore - a.finalScore)
    }

    return {
      results: filtered,
      totalResults: filtered.length,
      timeRange: { startTime, endTime }
    }
  }

  /**
   * 相对时间检索（例如：最近7天）
   */
  async searchRecent(query, daysAgo, options = {}) {
    const now = Date.now()
    const startTime = now - daysAgo * 24 * 60 * 60 * 1000
    const endTime = now

    return await this.searchByTimeRange(query, startTime, endTime, options)
  }

  /**
   * 时间点检索（查找特定时间附近的文档）
   */
  async searchNearTime(query, targetTime, windowDays = 7, options = {}) {
    const window = windowDays * 24 * 60 * 60 * 1000
    const startTime = targetTime - window
    const endTime = targetTime + window

    const results = await this.searchByTimeRange(query, startTime, endTime, options)

    // 按时间距离重新评分
    results.results.forEach(doc => {
      const timestamp = doc.metadata?.timestamp || doc.createdAt || Date.now()
      const timeDiff = Math.abs(timestamp - targetTime)
      const proximityScore = 1 - (timeDiff / window)

      doc.proximityScore = Math.max(0, proximityScore)
      doc.finalScore = (doc.score || 1) * doc.proximityScore
    })

    results.results.sort((a, b) => b.finalScore - a.finalScore)

    return results
  }

  /**
   * 时间键（按天）
   */
  getTimeKey(timestamp) {
    const date = new Date(timestamp)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  /**
   * 解析自然语言时间表达
   */
  parseTimeExpression(expression) {
    const now = Date.now()

    // 相对时间模式
    const relativePatterns = [
      { pattern: /今天|today/i, days: 0 },
      { pattern: /昨天|yesterday/i, days: 1 },
      { pattern: /最近(\d+)天|last (\d+) days?/i, days: null },
      { pattern: /本周|this week/i, days: 7 },
      { pattern: /上周|last week/i, days: 14 },
      { pattern: /本月|this month/i, days: 30 },
      { pattern: /上月|last month/i, days: 60 }
    ]

    for (const { pattern, days } of relativePatterns) {
      const match = expression.match(pattern)
      if (match) {
        const daysAgo = days !== null ? days : parseInt(match[1] || match[2])
        return {
          type: 'relative',
          daysAgo,
          startTime: now - daysAgo * 24 * 60 * 60 * 1000,
          endTime: now
        }
      }
    }

    // 绝对时间模式（简单实现）
    const dateMatch = expression.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (dateMatch) {
      const date = new Date(dateMatch[0])
      return {
        type: 'absolute',
        targetTime: date.getTime(),
        date: dateMatch[0]
      }
    }

    return null
  }
}

/**
 * 自适应检索策略管理器
 */
class AdaptiveRetrievalManager {
  constructor(config = {}) {
    this.config = {
      enableLearning: config.enableLearning !== false,
      ...config
    }

    this.hybridSearch = getHybridSearch()
    this.multiHop = new MultiHopReasoningManager()
    this.temporal = new TemporalRetrievalManager()

    // 策略性能历史
    this.strategyPerformance = new Map()

    // 查询类型分类器
    this.queryClassifier = {
      patterns: {
        simple: /^.{1,30}$/,                    // 简单短查询
        complex: /[?？].*[?？]|如何.*并且|需要.*同时/, // 复杂查询
        temporal: /最近|昨天|今天|上周|本月|(\d+)天前/, // 时间相关
        comparative: /比较|对比|差异|区别/,       // 比较类查询
        causal: /为什么|原因|导致|影响/            // 因果类查询
      }
    }
  }

  async initialize() {
    await this.multiHop.initialize()
    await this.temporal.initialize()

    // 初始化策略性能
    this.strategyPerformance.set('hybrid', { uses: 0, avgScore: 0.7 })
    this.strategyPerformance.set('multiHop', { uses: 0, avgScore: 0.65 })
    this.strategyPerformance.set('temporal', { uses: 0, avgScore: 0.6 })

    return { success: true }
  }

  /**
   * 自适应检索（智能选择策略）
   */
  async retrieve(query, options = {}) {
    const startTime = Date.now()

    // 分类查询
    const queryType = this.classifyQuery(query)

    // 选择策略
    const strategy = this.selectStrategy(queryType, options)

    console.log(`[AdaptiveRAG] 查询类型: ${queryType}, 策略: ${strategy}`)

    let result

    // 执行检索
    switch (strategy) {
      case 'multiHop':
        result = await this.multiHop.reason(query, options.context || {})
        result.results = [{ content: result.finalAnswer, score: result.confidence }]
        break

      case 'temporal':
        const timeInfo = this.temporal.parseTimeExpression(query)
        if (timeInfo && timeInfo.type === 'relative') {
          result = await this.temporal.searchRecent(query, timeInfo.daysAgo, options)
        } else if (timeInfo && timeInfo.type === 'absolute') {
          result = await this.temporal.searchNearTime(query, timeInfo.targetTime, 7, options)
        } else {
          result = await this.temporal.searchRecent(query, 30, options)
        }
        break

      case 'hybrid':
      default:
        result = await this.hybridSearch.search(query, options)
        break
    }

    const duration = Date.now() - startTime

    // 记录性能（用于学习）
    if (this.config.enableLearning) {
      this.recordPerformance(strategy, result, duration)
    }

    return {
      ...result,
      strategy,
      queryType,
      duration
    }
  }

  /**
   * 分类查询
   */
  classifyQuery(query) {
    const { patterns } = this.queryClassifier

    if (patterns.temporal.test(query)) {
      return 'temporal'
    }

    if (patterns.complex.test(query) || patterns.causal.test(query)) {
      return 'complex'
    }

    if (patterns.comparative.test(query)) {
      return 'comparative'
    }

    if (patterns.simple.test(query)) {
      return 'simple'
    }

    return 'general'
  }

  /**
   * 选择检索策略
   */
  selectStrategy(queryType, options) {
    // 用户指定策略
    if (options.strategy) {
      return options.strategy
    }

    // 基于查询类型选择
    switch (queryType) {
      case 'temporal':
        return 'temporal'

      case 'complex':
      case 'causal':
        return 'multiHop'

      case 'comparative':
        // 比较类查询可能需要多跳
        return Math.random() > 0.5 ? 'multiHop' : 'hybrid'

      case 'simple':
      case 'general':
      default:
        // 基于历史性能选择
        if (this.config.enableLearning) {
          return this.selectByPerformance()
        }

        return 'hybrid'
    }
  }

  /**
   * 基于性能选择策略
   */
  selectByPerformance() {
    let bestStrategy = 'hybrid'
    let bestScore = 0

    for (const [strategy, perf] of this.strategyPerformance.entries()) {
      if (perf.avgScore > bestScore) {
        bestScore = perf.avgScore
        bestStrategy = strategy
      }
    }

    return bestStrategy
  }

  /**
   * 记录性能
   */
  recordPerformance(strategy, result, duration) {
    const perf = this.strategyPerformance.get(strategy) || {
      uses: 0,
      avgScore: 0.5
    }

    // 计算分数（基于结果质量和速度）
    const qualityScore = this.calculateQualityScore(result)
    const speedScore = Math.max(0, 1 - duration / 10000) // 10秒为基准

    const score = qualityScore * 0.7 + speedScore * 0.3

    // 更新平均分（移动平均）
    perf.uses++
    perf.avgScore = (perf.avgScore * (perf.uses - 1) + score) / perf.uses

    this.strategyPerformance.set(strategy, perf)
  }

  /**
   * 计算结果质量分数
   */
  calculateQualityScore(result) {
    if (!result.results || result.results.length === 0) {
      return 0
    }

    // 基于结果数量和分数
    const avgScore = result.results.reduce((sum, r) => sum + (r.score || 0), 0) / result.results.length

    return avgScore
  }

  /**
   * 获取策略性能统计
   */
  getStrategyStats() {
    const stats = {}

    for (const [strategy, perf] of this.strategyPerformance.entries()) {
      stats[strategy] = {
        uses: perf.uses,
        avgScore: perf.avgScore.toFixed(3),
        performance: perf.avgScore > 0.7 ? '优秀' :
                    perf.avgScore > 0.5 ? '良好' : '一般'
      }
    }

    return stats
  }
}

/**
 * 高级RAG管理器（统一接口）
 */
export class AdvancedRAGManager {
  constructor(config = {}) {
    this.config = config

    // 核心组件
    this.adaptive = new AdaptiveRetrievalManager(config.adaptive)
    this.multiHop = new MultiHopReasoningManager(config.multiHop)
    this.temporal = new TemporalRetrievalManager(config.temporal)
    this.kg = new KnowledgeGraphManager(config.kg)
  }

  async initialize() {
    await Promise.all([
      this.adaptive.initialize(),
      this.kg.initialize()
    ])

    return { success: true }
  }

  /**
   * 智能检索（自动选择最优策略）
   */
  async retrieve(query, options = {}) {
    return await this.adaptive.retrieve(query, options)
  }

  /**
   * 多跳推理检索
   */
  async multiHopRetrieve(query, context = {}) {
    return await this.multiHop.reason(query, context)
  }

  /**
   * 时序检索
   */
  async temporalRetrieve(query, timeOptions = {}) {
    if (timeOptions.daysAgo) {
      return await this.temporal.searchRecent(query, timeOptions.daysAgo)
    } else if (timeOptions.startTime && timeOptions.endTime) {
      return await this.temporal.searchByTimeRange(
        query,
        timeOptions.startTime,
        timeOptions.endTime
      )
    } else {
      return await this.temporal.searchRecent(query, 30) // 默认30天
    }
  }

  /**
   * 知识图谱检索
   */
  async graphRetrieve(query, options = {}) {
    // 查找实体
    const entities = this.kg.findEntities({ pattern: query })

    if (entities.length === 0) {
      return { results: [], message: '未找到相关实体' }
    }

    // 扩展检索（通过关系）
    const expanded = []

    for (const entity of entities.slice(0, 5)) {
      const relations = this.kg.findRelations({ from: entity.id })

      for (const relation of relations.slice(0, 3)) {
        const targetEntity = this.kg.entities.get(relation.to)
        if (targetEntity) {
          expanded.push({
            entity: targetEntity,
            relation: relation.type,
            score: 0.8
          })
        }
      }
    }

    return {
      results: expanded,
      totalResults: expanded.length,
      method: 'knowledge-graph'
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      adaptive: this.adaptive.getStrategyStats(),
      knowledgeGraph: this.kg.getStats(),
      multiHop: {
        historySize: this.multiHop.reasoningHistory.length
      }
    }
  }

  /**
   * 获取知识图谱
   */
  getKnowledgeGraph() {
    return this.kg
  }
}

/**
 * 工厂函数
 */
let advancedRAGInstance = null

export function getAdvancedRAG(config = {}) {
  if (!advancedRAGInstance) {
    advancedRAGInstance = new AdvancedRAGManager(config)
  }
  return advancedRAGInstance
}

export default {
  AdvancedRAGManager,
  getAdvancedRAG,
  KnowledgeGraphManager,
  MultiHopReasoningManager,
  TemporalRetrievalManager,
  AdaptiveRetrievalManager
}
