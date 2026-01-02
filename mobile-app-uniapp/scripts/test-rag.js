/**
 * RAG系统测试脚本
 *
 * 测试移动端RAG功能的各个模块
 *
 * 运行方式：
 * node scripts/test-rag.js
 */

const fs = require('fs')
const path = require('path')

// 模拟uni-app环境
global.uni = {
  request: async (options) => {
    console.log(`[Mock] uni.request: ${options.url}`)
    // 模拟API失败，强制使用TF-IDF模式
    throw new Error('Mock API not available')
  }
}

// 模拟数据库
class MockDatabase {
  constructor() {
    this.tables = {
      notes: [
        {
          id: '1',
          title: 'Python机器学习基础',
          content: 'Python是一种广泛使用的编程语言，特别适合机器学习和数据科学。常用的库包括NumPy、Pandas、Scikit-learn等。',
          type: 'note',
          tags: 'Python,机器学习',
          created_at: Date.now() - 86400000,
          updated_at: Date.now() - 86400000
        },
        {
          id: '2',
          title: 'JavaScript异步编程',
          content: 'JavaScript中的异步编程主要通过Promise和async/await实现。异步编程可以提高程序性能，避免阻塞。',
          type: 'note',
          tags: 'JavaScript,异步编程',
          created_at: Date.now() - 172800000,
          updated_at: Date.now() - 172800000
        },
        {
          id: '3',
          title: '深度学习入门',
          content: '深度学习是机器学习的一个分支，使用神经网络模型。常用的框架有TensorFlow、PyTorch等。深度学习在图像识别、自然语言处理等领域有广泛应用。',
          type: 'note',
          tags: '深度学习,神经网络',
          created_at: Date.now() - 259200000,
          updated_at: Date.now() - 259200000
        },
        {
          id: '4',
          title: 'Vue3响应式原理',
          content: 'Vue3使用Proxy实现响应式系统，相比Vue2的Object.defineProperty更强大。Vue3的Composition API提供了更好的代码组织方式。',
          type: 'note',
          tags: 'Vue3,前端框架',
          created_at: Date.now() - 345600000,
          updated_at: Date.now() - 345600000
        },
        {
          id: '5',
          title: 'Docker容器化部署',
          content: 'Docker是一个开源的容器化平台，可以将应用程序及其依赖打包成容器。Docker Compose可以管理多容器应用。',
          type: 'note',
          tags: 'Docker,DevOps',
          created_at: Date.now() - 432000000,
          updated_at: Date.now() - 432000000
        }
      ],
      vector_embeddings: []
    }
  }

  async exec(sql, params = []) {
    // 简单的SQL解析
    if (sql.includes('CREATE TABLE')) {
      return []
    }

    if (sql.includes('CREATE INDEX')) {
      return []
    }

    if (sql.includes('SELECT') && sql.includes('FROM notes')) {
      return this.tables.notes.filter(note => !note.deleted)
    }

    if (sql.includes('SELECT') && sql.includes('FROM vector_embeddings')) {
      return this.tables.vector_embeddings
    }

    if (sql.includes('INSERT OR REPLACE INTO vector_embeddings')) {
      const [id, embedding, metadata, created_at, updated_at] = params
      const existing = this.tables.vector_embeddings.findIndex(v => v.id === id)
      const record = { id, embedding, metadata, created_at, updated_at }

      if (existing >= 0) {
        this.tables.vector_embeddings[existing] = record
      } else {
        this.tables.vector_embeddings.push(record)
      }
      return []
    }

    if (sql.includes('DELETE FROM vector_embeddings')) {
      if (params.length > 0) {
        this.tables.vector_embeddings = this.tables.vector_embeddings.filter(v => v.id !== params[0])
      } else {
        this.tables.vector_embeddings = []
      }
      return []
    }

    if (sql.includes('WHERE id = ?')) {
      const id = params[0]
      return this.tables.notes.filter(note => note.id === id)
    }

    return []
  }
}

// 模拟database模块
const mockDb = new MockDatabase()
const databaseModule = { db: mockDb }

// 加载RAG模块（需要修改路径以适配Node.js）
function loadRAGModule(modulePath) {
  const fullPath = path.join(__dirname, '..', modulePath)
  const code = fs.readFileSync(fullPath, 'utf-8')

  // 替换导入语句
  const modifiedCode = code
    .replace(/import\s+{[^}]+}\s+from\s+['"]\.\.\/database\.js['"]/g, 'const { db: database } = databaseModule')
    .replace(/import\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g, 'const $1 = loadRAGModule("src/services/rag/$2")')
    .replace(/export default/g, 'module.exports =')

  // 使用eval执行（仅用于测试）
  const moduleExports = {}
  const moduleWrapper = new Function('module', 'exports', 'databaseModule', 'loadRAGModule', modifiedCode)
  moduleWrapper(moduleExports, moduleExports, databaseModule, loadRAGModule)

  return moduleExports
}

// 测试工具函数
class TestRunner {
  constructor() {
    this.tests = []
    this.passed = 0
    this.failed = 0
  }

  test(name, fn) {
    this.tests.push({ name, fn })
  }

  async run() {
    console.log('\n' + '='.repeat(80))
    console.log('RAG系统测试开始')
    console.log('='.repeat(80) + '\n')

    for (const { name, fn } of this.tests) {
      try {
        console.log(`\n📝 ${name}`)
        await fn()
        this.passed++
        console.log(`✅ 通过`)
      } catch (error) {
        this.failed++
        console.log(`❌ 失败: ${error.message}`)
        console.error(error)
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('测试结果')
    console.log('='.repeat(80))
    console.log(`✅ 通过: ${this.passed}`)
    console.log(`❌ 失败: ${this.failed}`)
    console.log(`📊 总计: ${this.tests.length}`)
    console.log(`🎯 成功率: ${((this.passed / this.tests.length) * 100).toFixed(2)}%`)
    console.log('='.repeat(80) + '\n')

    return this.failed === 0
  }
}

// 主测试函数
async function runTests() {
  const runner = new TestRunner()

  // 加载模块
  let EmbeddingsService, VectorStore, Reranker, RAGManager

  try {
    EmbeddingsService = loadRAGModule('src/services/rag/embeddings-service.js')
    VectorStore = loadRAGModule('src/services/rag/vector-store.js')
    Reranker = loadRAGModule('src/services/rag/reranker.js')
    RAGManager = loadRAGModule('src/services/rag/rag-manager.js')
  } catch (error) {
    console.error('❌ 模块加载失败:', error.message)
    console.log('\n💡 提示: 此测试脚本需要在RAG模块实现完成后运行')
    console.log('   确保以下文件存在:')
    console.log('   - mobile-app-uniapp/src/services/rag/embeddings-service.js')
    console.log('   - mobile-app-uniapp/src/services/rag/vector-store.js')
    console.log('   - mobile-app-uniapp/src/services/rag/reranker.js')
    console.log('   - mobile-app-uniapp/src/services/rag/rag-manager.js')
    process.exit(1)
  }

  // ==================== Embeddings Service 测试 ====================

  runner.test('EmbeddingsService: 初始化和模式检测', async () => {
    const service = new EmbeddingsService({ mode: 'auto' })
    await service.initialize()

    console.log(`   当前模式: ${service.currentMode}`)

    if (!['transformers', 'api', 'tfidf'].includes(service.currentMode)) {
      throw new Error(`无效的模式: ${service.currentMode}`)
    }
  })

  runner.test('EmbeddingsService: TF-IDF向量生成', async () => {
    const service = new EmbeddingsService({ mode: 'tfidf' })
    await service.initialize()

    const text = 'Python机器学习和深度学习'
    const embedding = await service.generateEmbedding(text)

    console.log(`   文本: "${text}"`)
    console.log(`   向量维度: ${embedding.length}`)
    console.log(`   向量前5维: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`)

    if (embedding.length !== 384) {
      throw new Error(`向量维度错误: 期望384，实际${embedding.length}`)
    }
  })

  runner.test('EmbeddingsService: 批量生成', async () => {
    const service = new EmbeddingsService({ mode: 'tfidf' })
    await service.initialize()

    const texts = [
      'Python编程',
      'JavaScript开发',
      '机器学习算法'
    ]

    const embeddings = await service.generateEmbeddingsBatch(texts)

    console.log(`   批量生成数量: ${embeddings.length}`)

    if (embeddings.length !== texts.length) {
      throw new Error('批量生成数量不匹配')
    }

    embeddings.forEach((emb, i) => {
      if (emb.length !== 384) {
        throw new Error(`第${i}个向量维度错误`)
      }
    })
  })

  runner.test('EmbeddingsService: 余弦相似度计算', async () => {
    const service = new EmbeddingsService({ mode: 'tfidf' })
    await service.initialize()

    const text1 = 'Python机器学习'
    const text2 = 'Python深度学习'
    const text3 = 'JavaScript前端开发'

    const emb1 = await service.generateEmbedding(text1)
    const emb2 = await service.generateEmbedding(text2)
    const emb3 = await service.generateEmbedding(text3)

    const sim12 = service.cosineSimilarity(emb1, emb2)
    const sim13 = service.cosineSimilarity(emb1, emb3)

    console.log(`   "${text1}" vs "${text2}": ${sim12.toFixed(4)}`)
    console.log(`   "${text1}" vs "${text3}": ${sim13.toFixed(4)}`)

    if (sim12 <= sim13) {
      console.log(`   ⚠️  警告: 相关文本的相似度应该更高`)
    }
  })

  runner.test('EmbeddingsService: 缓存机制', async () => {
    const service = new EmbeddingsService({
      mode: 'tfidf',
      enableCache: true
    })
    await service.initialize()

    const text = 'Python机器学习'

    // 第一次生成
    await service.generateEmbedding(text)

    // 第二次应该命中缓存
    const stats1 = service.getStats()
    await service.generateEmbedding(text)
    const stats2 = service.getStats()

    console.log(`   缓存统计: ${JSON.stringify(stats2.cache)}`)

    if (stats2.cache.hits <= stats1.cache.hits) {
      throw new Error('缓存未生效')
    }
  })

  // ==================== Vector Store 测试 ====================

  runner.test('VectorStore: 初始化', async () => {
    const store = new VectorStore()
    const result = await store.initialize()

    console.log(`   初始化结果: ${result}`)
    console.log(`   向量数量: ${store.vectors.size}`)

    if (!result) {
      throw new Error('初始化失败')
    }
  })

  runner.test('VectorStore: 添加向量', async () => {
    const store = new VectorStore()
    await store.initialize()

    const embedding = new Array(384).fill(0).map(() => Math.random())
    const metadata = { title: '测试文档', content: '测试内容' }

    await store.addVector('test-1', embedding, metadata)

    console.log(`   向量数量: ${store.vectors.size}`)
    console.log(`   统计: ${JSON.stringify(store.getStats())}`)

    if (!store.hasVector('test-1')) {
      throw new Error('向量添加失败')
    }
  })

  runner.test('VectorStore: 批量添加向量', async () => {
    const store = new VectorStore()
    await store.initialize()

    const items = [
      { id: 'batch-1', title: '文档1', content: '内容1' },
      { id: 'batch-2', title: '文档2', content: '内容2' },
      { id: 'batch-3', title: '文档3', content: '内容3' }
    ]

    const embeddings = items.map(() =>
      new Array(384).fill(0).map(() => Math.random())
    )

    await store.addVectorsBatch(items, embeddings)

    console.log(`   批量添加数量: ${items.length}`)
    console.log(`   向量总数: ${store.vectors.size}`)

    if (store.vectors.size !== items.length) {
      throw new Error('批量添加数量不匹配')
    }
  })

  runner.test('VectorStore: 相似度搜索', async () => {
    const store = new VectorStore()
    await store.initialize()

    const embService = new EmbeddingsService({ mode: 'tfidf' })
    await embService.initialize()

    // 添加测试向量
    const docs = [
      { id: '1', title: 'Python机器学习', content: 'Python用于机器学习' },
      { id: '2', title: 'JavaScript开发', content: 'JavaScript前端开发' },
      { id: '3', title: '深度学习入门', content: '深度学习和神经网络' }
    ]

    const embeddings = await embService.generateEmbeddingsBatch(
      docs.map(d => `${d.title}\n${d.content}`)
    )

    await store.addVectorsBatch(docs, embeddings)

    // 搜索
    const query = '机器学习教程'
    const queryEmb = await embService.generateEmbedding(query)
    const results = await store.search(queryEmb, {
      topK: 2,
      similarityThreshold: 0.0
    })

    console.log(`   查询: "${query}"`)
    console.log(`   结果数量: ${results.length}`)
    results.forEach((r, i) => {
      console.log(`   [${i + 1}] ${r.metadata.title} (相似度: ${r.similarity.toFixed(4)})`)
    })

    if (results.length === 0) {
      throw new Error('搜索无结果')
    }
  })

  runner.test('VectorStore: 删除向量', async () => {
    const store = new VectorStore()
    await store.initialize()

    const embedding = new Array(384).fill(0).map(() => Math.random())
    await store.addVector('delete-test', embedding, {})

    const beforeCount = store.vectors.size
    await store.deleteVector('delete-test')
    const afterCount = store.vectors.size

    console.log(`   删除前: ${beforeCount}`)
    console.log(`   删除后: ${afterCount}`)

    if (store.hasVector('delete-test')) {
      throw new Error('删除失败')
    }
  })

  // ==================== Reranker 测试 ====================

  runner.test('Reranker: 关键词重排序', async () => {
    const reranker = new Reranker({ method: 'keyword' })

    const query = 'Python机器学习'
    const documents = [
      {
        id: '1',
        similarity: 0.8,
        metadata: {
          title: 'JavaScript开发指南',
          content: 'JavaScript是一门前端语言'
        }
      },
      {
        id: '2',
        similarity: 0.7,
        metadata: {
          title: 'Python机器学习入门',
          content: 'Python非常适合机器学习和数据科学'
        }
      },
      {
        id: '3',
        similarity: 0.75,
        metadata: {
          title: '深度学习基础',
          content: '深度学习是机器学习的一个分支'
        }
      }
    ]

    const reranked = await reranker.rerank(query, documents)

    console.log(`   查询: "${query}"`)
    console.log(`   重排序结果:`)
    reranked.forEach((doc, i) => {
      console.log(`   [${i + 1}] ${doc.metadata.title} (重排分数: ${doc.rerank_score.toFixed(4)}, 原始: ${doc.similarity})`)
    })

    // 验证第一个结果是否包含关键词
    if (!reranked[0].metadata.title.includes('Python') && !reranked[0].metadata.title.includes('机器学习')) {
      console.log('   ⚠️  警告: 最相关的文档应该包含查询关键词')
    }
  })

  runner.test('Reranker: 混合重排序', async () => {
    const reranker = new Reranker({
      method: 'hybrid',
      vectorWeight: 0.6,
      keywordWeight: 0.4
    })

    const query = 'Python编程'
    const documents = [
      {
        id: '1',
        similarity: 0.9,
        metadata: {
          title: 'Python高级编程',
          content: 'Python编程的高级技巧'
        }
      },
      {
        id: '2',
        similarity: 0.5,
        metadata: {
          title: 'Java开发',
          content: 'Java企业级开发'
        }
      }
    ]

    const reranked = await reranker.rerank(query, documents)

    console.log(`   查询: "${query}"`)
    console.log(`   混合重排序结果:`)
    reranked.forEach((doc, i) => {
      console.log(`   [${i + 1}] ${doc.metadata.title}`)
      console.log(`       向量分数: ${doc.vector_score?.toFixed(4) || 'N/A'}`)
      console.log(`       关键词分数: ${doc.keyword_score?.toFixed(4) || 'N/A'}`)
      console.log(`       混合分数: ${doc.rerank_score.toFixed(4)}`)
    })
  })

  // ==================== RAG Manager 测试 ====================

  runner.test('RAGManager: 初始化', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      enableReranking: true,
      embeddingsMode: 'tfidf'
    })

    const result = await manager.initialize()

    console.log(`   初始化结果: ${JSON.stringify(result)}`)
    console.log(`   向量模式: ${result.mode}`)
    console.log(`   向量数量: ${result.vectorCount}`)

    if (!result.success) {
      throw new Error('RAG Manager初始化失败')
    }
  })

  runner.test('RAGManager: 构建向量索引', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      embeddingsMode: 'tfidf'
    })

    await manager.initialize()

    const stats = manager.getIndexStats()

    console.log(`   索引统计: ${JSON.stringify(stats, null, 2)}`)

    if (stats.vectorStore.totalVectors === 0) {
      throw new Error('向量索引为空')
    }
  })

  runner.test('RAGManager: 检索相关文档', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      enableReranking: true,
      rerankMethod: 'hybrid',
      embeddingsMode: 'tfidf',
      topK: 10,
      rerankTopK: 3
    })

    await manager.initialize()

    const query = '如何学习机器学习'
    const results = await manager.retrieve(query, {
      topK: 5,
      similarityThreshold: 0.0
    })

    console.log(`   查询: "${query}"`)
    console.log(`   检索结果数量: ${results.length}`)
    results.forEach((doc, i) => {
      console.log(`   [${i + 1}] ${doc.title}`)
      console.log(`       相似度: ${doc.similarity?.toFixed(4) || 'N/A'}`)
      console.log(`       重排分数: ${doc.rerank_score?.toFixed(4) || 'N/A'}`)
      console.log(`       内容预览: ${doc.content?.substring(0, 50)}...`)
    })

    if (results.length === 0) {
      throw new Error('检索无结果')
    }
  })

  runner.test('RAGManager: 增强查询', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      enableReranking: true,
      embeddingsMode: 'tfidf',
      maxContextLength: 500
    })

    await manager.initialize()

    const query = 'Python编程最佳实践'
    const enhanced = await manager.enhanceQuery(query, {
      topK: 3
    })

    console.log(`   原始查询: "${enhanced.query}"`)
    console.log(`   上下文长度: ${enhanced.context.length}字符`)
    console.log(`   检索到的文档数量: ${enhanced.retrievedDocs.length}`)
    console.log(`   上下文预览:`)
    console.log(`   ${enhanced.context.substring(0, 200)}...`)

    if (!enhanced.context) {
      console.log('   ⚠️  未生成上下文（可能是没有相关文档）')
    }
  })

  runner.test('RAGManager: 添加和删除文档', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      embeddingsMode: 'tfidf'
    })

    await manager.initialize()

    const newDoc = {
      id: 'test-new-doc',
      title: '测试文档',
      content: '这是一个测试文档，用于验证添加功能',
      type: 'note',
      tags: '测试',
      created_at: Date.now()
    }

    // 添加
    await manager.addDocument(newDoc)
    console.log(`   ✅ 已添加文档: ${newDoc.id}`)

    const statsAfterAdd = manager.getIndexStats()
    console.log(`   添加后向量数量: ${statsAfterAdd.vectorStore.totalVectors}`)

    // 删除
    await manager.removeDocument(newDoc.id)
    console.log(`   ✅ 已删除文档: ${newDoc.id}`)

    const statsAfterDelete = manager.getIndexStats()
    console.log(`   删除后向量数量: ${statsAfterDelete.vectorStore.totalVectors}`)
  })

  runner.test('RAGManager: 性能统计', async () => {
    const manager = new RAGManager({
      enableRAG: true,
      enableReranking: true,
      embeddingsMode: 'tfidf'
    })

    await manager.initialize()

    // 执行几次查询
    const queries = ['Python编程', '机器学习', '前端开发']

    for (const query of queries) {
      await manager.retrieve(query)
    }

    const stats = manager.getIndexStats()

    console.log(`   索引统计:`)
    console.log(`   - 已启用: ${stats.enabled}`)
    console.log(`   - 已初始化: ${stats.initialized}`)
    console.log(`   - 总查询数: ${stats.queries.total}`)
    console.log(`   - 平均耗时: ${stats.queries.avgTime}ms`)
    console.log(`   - 向量数量: ${stats.vectorStore.totalVectors}`)
    console.log(`   - 缓存命中率: ${stats.embeddings.cache.hits}/${stats.embeddings.cache.hits + stats.embeddings.cache.misses}`)
  })

  // 运行所有测试
  const success = await runner.run()

  if (success) {
    console.log('🎉 所有测试通过！RAG系统运行正常。\n')
    process.exit(0)
  } else {
    console.log('❌ 部分测试失败，请检查错误信息。\n')
    process.exit(1)
  }
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('\n❌ 未处理的Promise拒绝:', error)
  process.exit(1)
})

// 运行测试
runTests().catch(error => {
  console.error('\n❌ 测试运行失败:', error)
  process.exit(1)
})
