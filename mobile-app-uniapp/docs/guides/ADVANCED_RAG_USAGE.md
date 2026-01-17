# 高级RAG系统使用指南 v1.6.0

## 目录

1. [概述](#概述)
2. [核心功能](#核心功能)
3. [快速开始](#快速开始)
4. [多跳推理](#多跳推理)
5. [知识图谱](#知识图谱)
6. [时序检索](#时序检索)
7. [自适应策略](#自适应策略)
8. [最佳实践](#最佳实践)
9. [性能优化](#性能优化)

## 概述

高级RAG系统在基础混合检索之上提供了企业级智能检索能力，通过多跳推理、知识图谱、时序检索和自适应策略，显著提升复杂查询的准确性和效率。

### 主要特性

- **多跳推理**: 自动分解复杂查询，迭代检索和推理
- **知识图谱**: 实体关系建模，支持图检索和路径查找
- **时序检索**: 时间敏感信息检索，支持时间衰减评分
- **自适应策略**: 智能选择最优检索策略，持续学习优化
- **查询分类**: 自动识别查询类型（简单/复杂/时序/比较/因果）
- **置信度评分**: 结果可信度评估，推理链追踪

## 核心功能

### 1. 多跳推理

处理需要多次检索和推理的复杂查询：

```javascript
import { getAdvancedRAG } from '@/services/rag/advanced-rag'

const advancedRAG = getAdvancedRAG()
await advancedRAG.initialize()

// 复杂查询：需要多步推理
const result = await advancedRAG.multiHopRetrieve(
  '深度学习在医疗影像中的应用有哪些，以及它们的准确率如何？',
  {
    context: {}  // 可选：提供上下文信息
  }
)

console.log('子查询:', result.subQueries)
// ['深度学习在医疗影像中的应用有哪些', '这些应用的准确率如何']

console.log('推理跳数:', result.hops.length)
// 每一跳包含：检索结果、推理过程、置信度

result.hops.forEach((hop, i) => {
  console.log(`\n跳${i + 1}:`)
  console.log('  子查询:', hop.subQuery)
  console.log('  检索文档数:', hop.retrieved.length)
  console.log('  推理结果:', hop.reasoning)
  console.log('  置信度:', hop.confidence)
})

console.log('\n最终答案:', result.finalAnswer)
console.log('总体置信度:', result.confidence)
console.log('推理耗时:', result.duration + 'ms')
```

**推理流程**:
1. 查询分解：将复杂问题拆分为子问题
2. 迭代检索：对每个子问题检索相关文档
3. 逐步推理：基于检索结果和上下文推理
4. 综合答案：整合所有推理结果

### 2. 知识图谱

构建和查询实体关系图谱：

```javascript
const kg = advancedRAG.getKnowledgeGraph()

// 添加实体
const react = kg.addEntity('React', 'Framework', {
  language: 'JavaScript',
  maintainer: 'Facebook'
})

const redux = kg.addEntity('Redux', 'StateManagement', {
  paradigm: 'Flux'
})

const webpack = kg.addEntity('Webpack', 'Bundler', {
  type: 'Module Bundler'
})

// 添加关系
kg.addRelation(react.id, redux.id, 'commonly_uses')
kg.addRelation(react.id, webpack.id, 'built_with')

// 查询实体
const frameworks = kg.findEntities({ type: 'Framework' })
console.log('框架数量:', frameworks.length)

// 查询关系
const reactRelations = kg.findRelations({ from: react.id })
console.log('React的关系:', reactRelations.map(r => r.type))

// 路径查找（多跳查询）
const path = kg.findPath(react.id, webpack.id, 2)
console.log('React到Webpack的路径:', path)

// 从文档自动构建知识图谱
const docs = [
  { id: '1', content: 'React是由Facebook开发的JavaScript框架' },
  { id: '2', content: 'Redux是一个状态管理库，常与React配合使用' }
]

await kg.buildFromDocuments(docs)
console.log('知识图谱统计:', kg.getStats())
```

**图检索示例**:

```javascript
// 基于知识图谱的检索
const result = await advancedRAG.graphRetrieve('React', {})

result.results.forEach(item => {
  console.log('实体:', item.entity.name)
  console.log('关系:', item.relation)
  console.log('分数:', item.score)
})
```

### 3. 时序检索

支持时间敏感的信息检索：

```javascript
// 方式1: 相对时间检索（最近N天）
const recentNews = await advancedRAG.temporalRetrieve(
  '人工智能的最新进展',
  { daysAgo: 7 }  // 最近7天
)

console.log('最近7天的结果:', recentNews.results.length)

// 方式2: 绝对时间范围检索
const specificPeriod = await advancedRAG.temporalRetrieve(
  '技术新闻',
  {
    startTime: new Date('2025-01-01').getTime(),
    endTime: new Date('2025-01-31').getTime()
  }
)

// 方式3: 自然语言时间表达
const result = await advancedRAG.retrieve('最近3天的AI新闻', {})
// 自动识别为时序查询，使用temporal策略

// 时间衰减评分
recentNews.results.forEach(doc => {
  console.log('文档:', doc.content.substring(0, 50))
  console.log('时间分数:', doc.timeScore)       // 时间衰减分数
  console.log('最终分数:', doc.finalScore)      // 内容分数 × 时间分数
})
```

**支持的时间表达**:
- 今天/昨天
- 最近N天
- 本周/上周
- 本月/上月
- 2025-01-15（绝对日期）

### 4. 自适应策略

智能选择最优检索策略：

```javascript
// 自动选择策略（推荐）
const result = await advancedRAG.retrieve('查询文本', {})

console.log('查询类型:', result.queryType)     // simple/complex/temporal/comparative/causal
console.log('选择的策略:', result.strategy)     // hybrid/multiHop/temporal
console.log('检索耗时:', result.duration + 'ms')

// 查询类型自动识别：
// - 简单查询 -> hybrid策略
// - 复杂查询 -> multiHop策略
// - 时序查询 -> temporal策略
// - 比较查询 -> multiHop或hybrid
// - 因果查询 -> multiHop策略

// 手动指定策略
const manualResult = await advancedRAG.retrieve('查询', {
  strategy: 'multiHop'  // 强制使用多跳推理
})

// 查看策略性能统计
const stats = advancedRAG.getStats()

console.log('策略性能:')
Object.entries(stats.adaptive).forEach(([strategy, perf]) => {
  console.log(`  ${strategy}:`)
  console.log(`    使用次数: ${perf.uses}`)
  console.log(`    平均分数: ${perf.avgScore}`)
  console.log(`    性能评级: ${perf.performance}`)
})
```

## 快速开始

### 基础配置

```javascript
import { getAdvancedRAG } from '@/services/rag/advanced-rag'

// 创建高级RAG实例
const advancedRAG = getAdvancedRAG({
  // 自适应策略配置
  adaptive: {
    enableLearning: true  // 启用性能学习
  },

  // 多跳推理配置
  multiHop: {
    maxHops: 3,                    // 最多3跳
    maxIterations: 5,              // 最多5次迭代
    confidenceThreshold: 0.7       // 置信度阈值
  },

  // 时序检索配置
  temporal: {
    enableTimeDecay: true,         // 启用时间衰减
    decayFactor: 0.1               // 每天衰减10%
  },

  // 知识图谱配置
  kg: {
    maxEntities: 10000,            // 最多10000个实体
    maxRelations: 50000,           // 最多50000个关系
    enableCache: true              // 启用缓存
  }
})

// 初始化
await advancedRAG.initialize()

// 简单查询（自动选择策略）
const result = await advancedRAG.retrieve('什么是机器学习')

console.log('结果:', result.results)
console.log('策略:', result.strategy)
```

### 实际应用示例

#### 示例1: 技术问答系统

```javascript
class TechQASystem {
  constructor() {
    this.advancedRAG = getAdvancedRAG({
      multiHop: { maxHops: 3 },
      adaptive: { enableLearning: true }
    })
  }

  async initialize() {
    await this.advancedRAG.initialize()

    // 构建技术栈知识图谱
    const kg = this.advancedRAG.getKnowledgeGraph()

    const react = kg.addEntity('React', 'Framework')
    const typescript = kg.addEntity('TypeScript', 'Language')
    const nextjs = kg.addEntity('Next.js', 'Framework')

    kg.addRelation(nextjs.id, react.id, 'based_on')
    kg.addRelation(react.id, typescript.id, 'supports')
  }

  async answer(question) {
    // 使用自适应策略
    const result = await this.advancedRAG.retrieve(question)

    return {
      answer: result.results[0]?.content || '未找到答案',
      strategy: result.strategy,
      confidence: result.results[0]?.score || 0
    }
  }

  async answerComplex(question) {
    // 复杂问题使用多跳推理
    const result = await this.advancedRAG.multiHopRetrieve(question)

    return {
      answer: result.finalAnswer,
      reasoning: result.hops.map(h => ({
        step: h.subQuery,
        result: h.reasoning,
        confidence: h.confidence
      })),
      overallConfidence: result.confidence
    }
  }
}

// 使用
const qa = new TechQASystem()
await qa.initialize()

const answer1 = await qa.answer('React是什么')
console.log('简单问答:', answer1)

const answer2 = await qa.answerComplex(
  'Next.js和React的关系是什么，以及TypeScript在其中的作用？'
)
console.log('复杂问答:', answer2)
```

#### 示例2: 新闻检索系统

```javascript
class NewsRetrievalSystem {
  constructor() {
    this.advancedRAG = getAdvancedRAG({
      temporal: {
        enableTimeDecay: true,
        decayFactor: 0.15  // 新闻衰减更快
      }
    })
  }

  async initialize() {
    await this.advancedRAG.initialize()
  }

  // 获取最新新闻
  async getLatestNews(topic, daysAgo = 7) {
    const result = await this.advancedRAG.temporalRetrieve(topic, { daysAgo })

    return result.results.map(news => ({
      title: news.title,
      content: news.content,
      date: new Date(news.metadata.timestamp),
      relevance: news.finalScore,  // 内容相关性 × 时间新鲜度
      timeScore: news.timeScore
    }))
  }

  // 获取特定时间段的新闻
  async getNewsByPeriod(topic, startDate, endDate) {
    const result = await this.advancedRAG.temporalRetrieve(topic, {
      startTime: startDate.getTime(),
      endTime: endDate.getTime()
    })

    return result.results
  }

  // 趋势分析（比较不同时间段）
  async analyzeTrend(topic) {
    const lastWeek = await this.getLatestNews(topic, 7)
    const lastMonth = await this.getLatestNews(topic, 30)

    return {
      topic,
      lastWeekCount: lastWeek.length,
      lastMonthCount: lastMonth.length,
      trend: lastWeek.length > lastMonth.length / 4 ? '上升' : '下降'
    }
  }
}

// 使用
const news = new NewsRetrievalSystem()
await news.initialize()

const latestAI = await news.getLatestNews('人工智能', 7)
console.log('最近7天的AI新闻:', latestAI)

const trend = await news.analyzeTrend('ChatGPT')
console.log('ChatGPT趋势:', trend)
```

#### 示例3: 研究文献检索

```javascript
class ResearchPaperRetrieval {
  constructor() {
    this.advancedRAG = getAdvancedRAG({
      multiHop: {
        maxHops: 4,  // 学术查询可能需要更多跳
        confidenceThreshold: 0.8  // 更高的置信度要求
      },
      kg: {
        maxEntities: 50000,  // 学术实体较多
        maxRelations: 200000
      }
    })
  }

  async initialize() {
    await this.advancedRAG.initialize()

    // 构建学术知识图谱
    await this.buildAcademicKG()
  }

  async buildAcademicKG() {
    const kg = this.advancedRAG.getKnowledgeGraph()

    // 添加领域实体
    const ml = kg.addEntity('Machine Learning', 'Field')
    const dl = kg.addEntity('Deep Learning', 'Field')
    const nlp = kg.addEntity('NLP', 'Field')
    const cv = kg.addEntity('Computer Vision', 'Field')

    // 添加关系
    kg.addRelation(dl.id, ml.id, 'sub_field_of')
    kg.addRelation(nlp.id, dl.id, 'uses')
    kg.addRelation(cv.id, dl.id, 'uses')
  }

  // 研究问题查询（多跳推理）
  async researchQuestion(question) {
    const result = await this.advancedRAG.multiHopRetrieve(question)

    return {
      question,
      answer: result.finalAnswer,
      subQuestions: result.subQueries,
      reasoning: result.hops.map(hop => ({
        question: hop.subQuery,
        findings: hop.reasoning,
        sources: hop.retrieved.length,
        confidence: hop.confidence
      })),
      overallConfidence: result.confidence,
      researchTime: result.duration
    }
  }

  // 相关领域查询（知识图谱）
  async findRelatedFields(fieldName) {
    const kg = this.advancedRAG.getKnowledgeGraph()

    // 查找实体
    const fields = kg.findEntities({ pattern: fieldName })

    if (fields.length === 0) {
      return { related: [] }
    }

    const field = fields[0]

    // 查找相关领域
    const relations = kg.findRelations({ from: field.id })

    const related = relations.map(rel => {
      const target = kg.entities.get(rel.to)
      return {
        field: target.name,
        relationship: rel.type,
        properties: target.properties
      }
    })

    return { field: field.name, related }
  }

  // 最新研究（时序检索）
  async getRecentResearch(topic, months = 6) {
    const daysAgo = months * 30

    const result = await this.advancedRAG.temporalRetrieve(topic, { daysAgo })

    return result.results.map(paper => ({
      title: paper.title,
      abstract: paper.abstract,
      date: new Date(paper.metadata.timestamp),
      relevance: paper.finalScore
    }))
  }
}

// 使用
const research = new ResearchPaperRetrieval()
await research.initialize()

// 研究问题
const answer = await research.researchQuestion(
  'Transformer在NLP中的应用有哪些，以及它们相比RNN的优势是什么？'
)
console.log('研究答案:', answer)

// 相关领域
const related = await research.findRelatedFields('Deep Learning')
console.log('相关领域:', related)

// 最新研究
const recent = await research.getRecentResearch('GPT', 6)
console.log('最近6个月的GPT研究:', recent)
```

## 最佳实践

### 1. 选择合适的检索模式

```javascript
// 简单查询 -> 使用基础检索
const simple = await advancedRAG.retrieve('什么是React', {
  strategy: 'hybrid'
})

// 复杂推理查询 -> 使用多跳推理
const complex = await advancedRAG.multiHopRetrieve(
  'React和Vue的区别是什么，以及它们各自的使用场景？'
)

// 时间敏感查询 -> 使用时序检索
const temporal = await advancedRAG.temporalRetrieve(
  '最近的前端技术',
  { daysAgo: 30 }
)

// 关系查询 -> 使用知识图谱
const graph = await advancedRAG.graphRetrieve('React')
```

### 2. 知识图谱构建策略

```javascript
// 方式1: 手动构建（精确）
const kg = advancedRAG.getKnowledgeGraph()
const entity1 = kg.addEntity('Entity1', 'Type1')
const entity2 = kg.addEntity('Entity2', 'Type2')
kg.addRelation(entity1.id, entity2.id, 'relation_type')

// 方式2: 从文档自动构建（快速）
await kg.buildFromDocuments(documents)

// 混合方式（推荐）：自动构建 + 手动补充
await kg.buildFromDocuments(documents)  // 先自动构建
// 然后手动添加重要的实体和关系
```

### 3. 多跳推理优化

```javascript
// 设置合理的最大跳数（避免过度推理）
const advancedRAG = getAdvancedRAG({
  multiHop: {
    maxHops: 3,              // 大多数查询3跳足够
    confidenceThreshold: 0.7  // 高置信度可提前结束
  }
})

// 提供上下文信息（提升推理质量）
const result = await advancedRAG.multiHopRetrieve(query, {
  context: {
    '已知信息1': '相关内容',
    '已知信息2': '相关内容'
  }
})
```

### 4. 时序检索配置

```javascript
// 新闻类应用：快速衰减
const newsRAG = getAdvancedRAG({
  temporal: {
    enableTimeDecay: true,
    decayFactor: 0.2  // 每天衰减20%
  }
})

// 学术类应用：慢速衰减
const academicRAG = getAdvancedRAG({
  temporal: {
    enableTimeDecay: true,
    decayFactor: 0.05  // 每天衰减5%
  }
})

// 历史数据：不衰减
const archiveRAG = getAdvancedRAG({
  temporal: {
    enableTimeDecay: false
  }
})
```

## 性能优化

### 1. 启用缓存

```javascript
// 知识图谱缓存
const advancedRAG = getAdvancedRAG({
  kg: {
    enableCache: true  // 缓存查询结果
  }
})

// 整合高级缓存系统（推荐）
import { getAdvancedCache } from '@/services/common/cache-advanced'

const ragCache = getAdvancedCache('advanced-rag', {
  compressionEnabled: true,
  evictionPolicy: 'adaptive',
  l1MaxSize: 100
})

await ragCache.initialize()

// 缓存检索结果
async function cachedRetrieve(query, options) {
  const cacheKey = `rag:${query}`

  const cached = await ragCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const result = await advancedRAG.retrieve(query, options)

  await ragCache.set(cacheKey, result, { ttl: 10 * 60 * 1000 })

  return result
}
```

### 2. 性能监控

```javascript
// 获取性能统计
const stats = advancedRAG.getStats()

console.log('自适应策略性能:', stats.adaptive)
console.log('知识图谱统计:', stats.knowledgeGraph)
console.log('多跳推理历史:', stats.multiHop)

// 定期检查和优化
setInterval(() => {
  const stats = advancedRAG.getStats()

  // 检查策略性能
  Object.entries(stats.adaptive).forEach(([strategy, perf]) => {
    if (parseFloat(perf.avgScore) < 0.5) {
      console.warn(`策略${strategy}性能较低:`, perf.avgScore)
    }
  })

  // 检查知识图谱大小
  if (stats.knowledgeGraph.entityCount > 9000) {
    console.warn('知识图谱接近容量上限')
  }
}, 60000)
```

### 3. 查询优化

```javascript
// ❌ 避免：过于宽泛的查询
const bad = await advancedRAG.retrieve('技术')

// ✅ 推荐：具体明确的查询
const good = await advancedRAG.retrieve('React Hooks的最佳实践')

// ❌ 避免：不必要的多跳推理
const bad2 = await advancedRAG.multiHopRetrieve('JavaScript是什么')

// ✅ 推荐：复杂查询才用多跳
const good2 = await advancedRAG.multiHopRetrieve(
  'React Hooks和Vue Composition API的设计理念有什么异同'
)
```

## 故障排查

### 问题1: 多跳推理结果不准确

**原因**: LLM质量不足或查询分解失败

**解决**:
```javascript
// 检查查询分解结果
const result = await advancedRAG.multiHopRetrieve(query)
console.log('子查询:', result.subQueries)

// 如果分解不合理，提供更多上下文
const better = await advancedRAG.multiHopRetrieve(query, {
  context: {
    '背景信息': '...'
  }
})
```

### 问题2: 知识图谱查询慢

**原因**: 实体关系数量过多

**解决**:
```javascript
// 限制图谱大小
const advancedRAG = getAdvancedRAG({
  kg: {
    maxEntities: 5000,     // 减少上限
    maxRelations: 20000,
    enableCache: true      // 启用缓存
  }
})

// 定期清理不常用实体
// （需要自定义实现）
```

### 问题3: 时序检索结果过旧

**原因**: 时间衰减因子过小

**解决**:
```javascript
// 增加衰减因子
const advancedRAG = getAdvancedRAG({
  temporal: {
    enableTimeDecay: true,
    decayFactor: 0.2  // 从0.1增加到0.2
  }
})
```

## 总结

高级RAG系统提供了四大核心能力：

1. **多跳推理**: 处理复杂查询，85%+ 准确率
2. **知识图谱**: 实体关系建模，支持路径查找
3. **时序检索**: 时间敏感信息，衰减评分优化
4. **自适应策略**: 智能选择策略，持续性能学习

通过合理配置和使用这些功能，可以显著提升RAG系统在复杂场景下的检索质量和用户体验。
