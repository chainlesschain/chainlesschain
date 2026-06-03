/**
 * LLM功能测试脚本 (移动端)
 *
 * 测试项:
 * 1. LLM管理器初始化
 * 2. 对话管理
 * 3. 模型缓存
 * 4. 知识库集成
 * 5. AI问答
 * 6. 内容总结
 */

// 模拟uni-app环境
global.uni = {
  request: async (options) => {
    console.log('[Mock uni.request]', options.url)
    return {
      statusCode: 200,
      data: {
        content: '这是一个模拟的LLM响应',
        model: 'mock-model',
        usage: { total_tokens: 100 }
      }
    }
  },

  showToast: (options) => {
    console.log('[Toast]', options.title)
  },

  showLoading: (options) => {
    console.log('[Loading]', options.title)
  },

  hideLoading: () => {
    console.log('[Loading] Hidden')
  }
}

// 导入模块
const LLMManager = require('../src/services/llm/llm-manager.js').default
const ConversationManager = require('../src/services/llm/conversation-manager.js').default
const ModelCacheManager = require('../src/services/llm/model-cache-manager.js').default
const KnowledgeLLMIntegration = require('../src/services/llm/knowledge-llm-integration.js').default

// 测试配置
const config = {
  llm: {
    mode: 'api',
    apiEndpoint: 'http://localhost:8000/api/chat',
    maxTokens: 2000,
    temperature: 0.7
  },
  conversation: {
    maxContextWindow: 10,
    defaultTitle: '测试对话'
  }
}

/**
 * 测试1: LLM管理器初始化
 */
async function testLLMManager() {
  console.log('\n========== 测试1: LLM管理器初始化 ==========')

  try {
    const llmManager = new LLMManager(config.llm)

    // 初始化
    console.log('[Test] 初始化LLM管理器...')
    const initResult = await llmManager.initialize()
    console.log('[Test] 初始化结果:', initResult)

    if (!initResult.success) {
      throw new Error('LLM管理器初始化失败')
    }

    // 测试聊天
    console.log('[Test] 测试聊天...')
    const messages = [
      { role: 'user', content: '你好，请介绍一下自己' }
    ]

    const chatResult = await llmManager.chat(messages)
    console.log('[Test] 聊天结果:', chatResult)

    // 获取统计
    const stats = llmManager.getStats()
    console.log('[Test] 统计信息:', stats)

    // 获取可用模型
    const models = await llmManager.getModels()
    console.log('[Test] 可用模型:', models)

    console.log('✅ LLM管理器测试通过')

    return llmManager
  } catch (error) {
    console.error('❌ LLM管理器测试失败:', error)
    throw error
  }
}

/**
 * 测试2: 对话管理
 */
async function testConversationManager() {
  console.log('\n========== 测试2: 对话管理 ==========')

  try {
    const conversationManager = new ConversationManager(config)

    // 初始化
    console.log('[Test] 初始化对话管理器...')
    const initResult = await conversationManager.initialize()
    console.log('[Test] 初始化结果:', initResult)

    // 创建对话
    console.log('[Test] 创建对话...')
    const conv = await conversationManager.createConversation({
      title: '测试对话',
      context_type: 'test',
      system_message: '你是一个测试助手'
    })
    console.log('[Test] 对话创建成功:', conv)

    const conversationId = conv.id

    // 发送消息
    console.log('[Test] 发送用户消息...')
    const response = await conversationManager.sendMessage(
      conversationId,
      '你好，这是一条测试消息'
    )
    console.log('[Test] AI回复:', response)

    // 获取消息列表
    console.log('[Test] 获取消息列表...')
    const messages = await conversationManager.getMessages(conversationId)
    console.log('[Test] 消息数量:', messages.length)
    messages.forEach(msg => {
      console.log(`  [${msg.role}]: ${msg.content.substring(0, 50)}...`)
    })

    // 更新对话标题
    console.log('[Test] 更新对话标题...')
    await conversationManager.updateConversation(conversationId, {
      title: '更新后的标题'
    })

    // 获取对话详情
    const conversation = await conversationManager.getConversation(conversationId)
    console.log('[Test] 对话详情:', conversation.title)

    // 获取对话列表
    const conversations = await conversationManager.getConversations()
    console.log('[Test] 对话列表数量:', conversations.length)

    // 获取统计
    const stats = conversationManager.getStats()
    console.log('[Test] 统计信息:', stats)

    // 清空消息
    console.log('[Test] 清空对话消息...')
    await conversationManager.clearMessages(conversationId)

    // 删除对话
    console.log('[Test] 删除对话...')
    await conversationManager.deleteConversation(conversationId)

    console.log('✅ 对话管理测试通过')

    return conversationManager
  } catch (error) {
    console.error('❌ 对话管理测试失败:', error)
    throw error
  }
}

/**
 * 测试3: 模型缓存管理
 */
async function testModelCacheManager() {
  console.log('\n========== 测试3: 模型缓存管理 ==========')

  try {
    const modelCacheManager = new ModelCacheManager()

    // 初始化
    console.log('[Test] 初始化模型缓存管理器...')
    const initResult = await modelCacheManager.initialize()
    console.log('[Test] 初始化结果:', initResult)

    // 获取可用模型列表
    console.log('[Test] 获取可用模型...')
    const models = modelCacheManager.getAvailableModels()
    console.log('[Test] 可用模型数量:', models.length)
    models.forEach(model => {
      console.log(`  - ${model.name} (${modelCacheManager.formatSize(model.size)})`)
    })

    // 获取已缓存模型
    console.log('[Test] 获取已缓存模型...')
    const cachedModels = modelCacheManager.getCachedModels()
    console.log('[Test] 已缓存模型数量:', cachedModels.length)

    // 检查模型是否已缓存
    const modelId = 'Llama-3-8B-Instruct-q4f32_1'
    console.log(`[Test] 检查模型 ${modelId} 是否已缓存...`)
    const isCached = await modelCacheManager.isModelCached(modelId)
    console.log('[Test] 是否已缓存:', isCached)

    // 获取存储信息
    console.log('[Test] 获取存储信息...')
    const storageInfo = await modelCacheManager.getStorageInfo()
    console.log('[Test] 存储信息:', storageInfo)

    // 获取统计
    const stats = modelCacheManager.getStats()
    console.log('[Test] 统计信息:', stats)

    console.log('✅ 模型缓存管理测试通过')

    return modelCacheManager
  } catch (error) {
    console.error('❌ 模型缓存管理测试失败:', error)
    throw error
  }
}

/**
 * 测试4: 知识库LLM集成
 */
async function testKnowledgeLLMIntegration() {
  console.log('\n========== 测试4: 知识库LLM集成 ==========')

  try {
    const knowledgeLLM = new KnowledgeLLMIntegration({
      ...config,
      enableRAG: false // 暂时禁用RAG以简化测试
    })

    // 初始化
    console.log('[Test] 初始化知识库LLM集成...')
    const initResult = await knowledgeLLM.initialize()
    console.log('[Test] 初始化结果:', initResult)

    // 创建AI助手对话
    console.log('[Test] 创建AI助手对话...')
    const chat = await knowledgeLLM.createAssistantChat({
      title: '测试AI助手'
    })
    console.log('[Test] 对话创建成功:', chat.id)

    // 与AI助手聊天
    console.log('[Test] 与AI助手聊天...')
    const response = await knowledgeLLM.chatWithAssistant(
      chat.id,
      '你好，请介绍一下你能做什么'
    )
    console.log('[Test] AI回复:', response.assistantMessage.substring(0, 100) + '...')

    console.log('✅ 知识库LLM集成测试通过')

    return knowledgeLLM
  } catch (error) {
    console.error('❌ 知识库LLM集成测试失败:', error)
    throw error
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('========================================')
  console.log('       移动端LLM功能测试套件')
  console.log('========================================')

  const results = {
    total: 0,
    passed: 0,
    failed: 0
  }

  const tests = [
    { name: 'LLM管理器', fn: testLLMManager },
    { name: '对话管理', fn: testConversationManager },
    { name: '模型缓存管理', fn: testModelCacheManager },
    { name: '知识库LLM集成', fn: testKnowledgeLLMIntegration }
  ]

  for (const test of tests) {
    results.total++
    try {
      await test.fn()
      results.passed++
    } catch (error) {
      results.failed++
      console.error(`\n测试 "${test.name}" 失败:`, error.message)
    }
  }

  console.log('\n========================================')
  console.log('           测试结果汇总')
  console.log('========================================')
  console.log(`总计: ${results.total}`)
  console.log(`通过: ${results.passed} ✅`)
  console.log(`失败: ${results.failed} ❌`)
  console.log(`成功率: ${((results.passed / results.total) * 100).toFixed(2)}%`)
  console.log('========================================')

  if (results.failed > 0) {
    process.exit(1)
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
