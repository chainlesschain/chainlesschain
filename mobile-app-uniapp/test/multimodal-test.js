/**
 * 多模态管理器测试
 *
 * 测试内容:
 * 1. 图像问答
 * 2. 图像描述
 * 3. 图像OCR
 * 4. 多图像理解
 * 5. 缓存功能
 */

import { getMultimodalManager } from '../src/services/llm/multimodal-manager.js'

/**
 * 测试配置
 */
const TEST_CONFIG = {
  // API密钥（从环境变量或配置文件读取）
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',

  // 测试图像
  testImages: {
    // 本地图像
    local: '/static/images/test-image.jpg',

    // URL图像
    url: 'https://example.com/image.jpg',

    // base64图像（示例）
    base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...'
  }
}

/**
 * 测试1: 基本初始化
 */
async function testInitialization() {
  console.log('\n=== 测试1: 基本初始化 ===')

  const multimodal = getMultimodalManager({
    openaiApiKey: TEST_CONFIG.openaiApiKey,
    anthropicApiKey: TEST_CONFIG.anthropicApiKey,
    dashscopeApiKey: TEST_CONFIG.dashscopeApiKey
  })

  const result = await multimodal.initialize()

  console.log('初始化结果:', result)
  console.log('支持的模型:', multimodal.getSupportedModels())

  return result.success
}

/**
 * 测试2: 图像问答（GPT-4V）
 */
async function testImageQA() {
  console.log('\n=== 测试2: 图像问答（GPT-4V） ===')

  const multimodal = getMultimodalManager()

  const result = await multimodal.askAboutImage(
    TEST_CONFIG.testImages.local,
    '这张图片中有什么？',
    {
      model: 'gpt-4-vision-preview',
      maxTokens: 500
    }
  )

  console.log('问答结果:', result)

  if (result.success) {
    console.log('✅ 图像问答成功')
    console.log('回答:', result.content)
  } else {
    console.log('❌ 图像问答失败:', result.error)
  }

  return result.success
}

/**
 * 测试3: 图像描述（Claude 3）
 */
async function testImageDescription() {
  console.log('\n=== 测试3: 图像描述（Claude 3） ===')

  const multimodal = getMultimodalManager()

  const result = await multimodal.describeImage(
    TEST_CONFIG.testImages.local,
    {
      model: 'claude-3-sonnet',
      maxTokens: 500
    }
  )

  console.log('描述结果:', result)

  if (result.success) {
    console.log('✅ 图像描述成功')
    console.log('描述:', result.content)
  } else {
    console.log('❌ 图像描述失败:', result.error)
  }

  return result.success
}

/**
 * 测试4: 图像OCR
 */
async function testImageOCR() {
  console.log('\n=== 测试4: 图像OCR ===')

  const multimodal = getMultimodalManager()

  const result = await multimodal.extractTextFromImage(
    TEST_CONFIG.testImages.local,
    {
      model: 'gpt-4-vision-preview'
    }
  )

  console.log('OCR结果:', result)

  if (result.success) {
    console.log('✅ OCR成功')
    console.log('提取的文字:', result.content)
  } else {
    console.log('❌ OCR失败:', result.error)
  }

  return result.success
}

/**
 * 测试5: 多图像理解
 */
async function testMultipleImages() {
  console.log('\n=== 测试5: 多图像理解 ===')

  const multimodal = getMultimodalManager()

  const images = [
    TEST_CONFIG.testImages.local,
    TEST_CONFIG.testImages.url
  ]

  const result = await multimodal.askAboutImage(
    images,
    '比较这两张图片的异同',
    {
      model: 'gpt-4-vision-preview',
      maxTokens: 800
    }
  )

  console.log('多图像理解结果:', result)

  if (result.success) {
    console.log('✅ 多图像理解成功')
    console.log('分析:', result.content)
  } else {
    console.log('❌ 多图像理解失败:', result.error)
  }

  return result.success
}

/**
 * 测试6: 图像分析
 */
async function testImageAnalysis() {
  console.log('\n=== 测试6: 图像分析 ===')

  const multimodal = getMultimodalManager()

  const aspects = ['情感', '物体', '场景', '颜色']

  for (const aspect of aspects) {
    console.log(`\n分析${aspect}...`)

    const result = await multimodal.analyzeImage(
      TEST_CONFIG.testImages.local,
      aspect,
      {
        model: 'gpt-4-vision-preview',
        maxTokens: 300
      }
    )

    if (result.success) {
      console.log(`✅ ${aspect}分析成功:`, result.content.substring(0, 100) + '...')
    } else {
      console.log(`❌ ${aspect}分析失败:`, result.error)
    }
  }

  return true
}

/**
 * 测试7: 缓存功能
 */
async function testCache() {
  console.log('\n=== 测试7: 缓存功能 ===')

  const multimodal = getMultimodalManager({
    enableCache: true,
    cacheSize: 10
  })

  // 第一次调用（缓存未命中）
  console.log('第一次调用（缓存未命中）...')
  const start1 = Date.now()
  await multimodal.askAboutImage(
    TEST_CONFIG.testImages.local,
    '这是什么？'
  )
  const time1 = Date.now() - start1

  // 第二次调用（缓存命中）
  console.log('第二次调用（缓存命中）...')
  const start2 = Date.now()
  await multimodal.askAboutImage(
    TEST_CONFIG.testImages.local,
    '这是什么？'
  )
  const time2 = Date.now() - start2

  console.log(`第一次耗时: ${time1}ms`)
  console.log(`第二次耗时: ${time2}ms`)
  console.log(`缓存提速: ${((time1 - time2) / time1 * 100).toFixed(2)}%`)

  const stats = multimodal.getStats()
  console.log('缓存统计:', {
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    cacheHitRate: stats.cacheHitRate
  })

  return stats.cacheHits > 0
}

/**
 * 测试8: 对话式多模态交互
 */
async function testConversationalVision() {
  console.log('\n=== 测试8: 对话式多模态交互 ===')

  const multimodal = getMultimodalManager()

  const messages = [
    {
      role: 'user',
      content: '请看这张图片',
      images: [TEST_CONFIG.testImages.local]
    },
    {
      role: 'assistant',
      content: '我看到了这张图片。'
    },
    {
      role: 'user',
      content: '图片中有几个人？'
    }
  ]

  const result = await multimodal.chat(messages, {
    model: 'gpt-4-vision-preview'
  })

  console.log('对话结果:', result)

  if (result.success) {
    console.log('✅ 对话式交互成功')
    console.log('AI回复:', result.content)
  } else {
    console.log('❌ 对话式交互失败:', result.error)
  }

  return result.success
}

/**
 * 测试9: 错误处理
 */
async function testErrorHandling() {
  console.log('\n=== 测试9: 错误处理 ===')

  const multimodal = getMultimodalManager()

  // 测试不存在的图像
  const result1 = await multimodal.askAboutImage(
    '/path/to/nonexistent/image.jpg',
    '这是什么？'
  )

  console.log('不存在的图像:', result1.success ? '❌ 应该失败但成功了' : '✅ 正确失败')

  // 测试不支持的模型
  const result2 = await multimodal.chat(
    [{ role: 'user', content: 'Hello' }],
    { model: 'nonexistent-model' }
  )

  console.log('不支持的模型:', result2.success ? '❌ 应该失败但成功了' : '✅ 正确失败')

  return !result1.success && !result2.success
}

/**
 * 测试10: 性能统计
 */
async function testStatistics() {
  console.log('\n=== 测试10: 性能统计 ===')

  const multimodal = getMultimodalManager()

  // 执行几次调用
  await multimodal.askAboutImage(TEST_CONFIG.testImages.local, '测试1')
  await multimodal.askAboutImage(TEST_CONFIG.testImages.local, '测试2')
  await multimodal.askAboutImage(TEST_CONFIG.testImages.local, '测试3')

  const stats = multimodal.getStats()

  console.log('性能统计:')
  console.log('- 总请求数:', stats.totalRequests)
  console.log('- 成功请求:', stats.successfulRequests)
  console.log('- 失败请求:', stats.failedRequests)
  console.log('- 成功率:', stats.successRate)
  console.log('- 已处理图像:', stats.imagesProcessed)
  console.log('- 缓存命中:', stats.cacheHits)
  console.log('- 缓存未命中:', stats.cacheMisses)
  console.log('- 缓存命中率:', stats.cacheHitRate)
  console.log('- 缓存大小:', stats.cacheSize)

  return true
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('='.repeat(60))
  console.log('多模态管理器测试开始')
  console.log('='.repeat(60))

  const tests = [
    { name: '初始化', fn: testInitialization },
    { name: '图像问答', fn: testImageQA },
    { name: '图像描述', fn: testImageDescription },
    { name: '图像OCR', fn: testImageOCR },
    { name: '多图像理解', fn: testMultipleImages },
    { name: '图像分析', fn: testImageAnalysis },
    { name: '缓存功能', fn: testCache },
    { name: '对话式交互', fn: testConversationalVision },
    { name: '错误处理', fn: testErrorHandling },
    { name: '性能统计', fn: testStatistics }
  ]

  const results = []

  for (const test of tests) {
    try {
      const passed = await test.fn()
      results.push({ name: test.name, passed })
      console.log(`\n${test.name}: ${passed ? '✅ 通过' : '❌ 失败'}`)
    } catch (error) {
      console.error(`\n${test.name}: ❌ 异常 -`, error.message)
      results.push({ name: test.name, passed: false, error })
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('测试总结')
  console.log('='.repeat(60))

  const passed = results.filter(r => r.passed).length
  const total = results.length

  console.log(`通过: ${passed}/${total}`)
  console.log(`成功率: ${((passed / total) * 100).toFixed(2)}%`)

  console.log('\n详细结果:')
  results.forEach(r => {
    const status = r.passed ? '✅' : '❌'
    console.log(`${status} ${r.name}`)
  })

  console.log('\n' + '='.repeat(60))
}

// 导出测试函数
export {
  testInitialization,
  testImageQA,
  testImageDescription,
  testImageOCR,
  testMultipleImages,
  testImageAnalysis,
  testCache,
  testConversationalVision,
  testErrorHandling,
  testStatistics,
  runAllTests
}

// 如果直接运行此文件
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests().catch(console.error)
}
