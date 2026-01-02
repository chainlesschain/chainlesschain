/**
 * 高级缓存功能测试
 *
 * 测试内容:
 * 1. 数据压缩功能
 * 2. LFU淘汰策略
 * 3. 自适应淘汰策略
 * 4. 缓存预热
 * 5. 批量操作
 * 6. 查询优化
 * 7. 性能分析
 * 8. 压缩性能
 * 9. 综合场景测试
 */

import { getAdvancedCache, LZString } from '../src/services/common/cache-advanced.js'

/**
 * 测试1: LZ-String压缩算法
 */
async function testCompression() {
  console.log('\n=== 测试1: LZ-String压缩算法 ===')

  const testData = {
    message: 'Hello World! '.repeat(100),
    numbers: Array.from({ length: 100 }, (_, i) => i),
    nested: {
      data: 'test data '.repeat(50),
      array: [1, 2, 3, 4, 5]
    }
  }

  const jsonStr = JSON.stringify(testData)
  const originalSize = jsonStr.length

  console.log('原始大小:', originalSize, 'bytes')

  // 压缩
  const startCompress = Date.now()
  const compressed = LZString.compressToBase64(jsonStr)
  const compressTime = Date.now() - startCompress

  const compressedSize = compressed.length
  const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2)

  console.log('压缩后大小:', compressedSize, 'bytes')
  console.log('压缩率:', ratio + '%')
  console.log('压缩耗时:', compressTime + 'ms')

  // 解压缩
  const startDecompress = Date.now()
  const decompressed = LZString.decompressFromBase64(compressed)
  const decompressTime = Date.now() - startDecompress

  console.log('解压耗时:', decompressTime + 'ms')

  // 验证
  const decompressedData = JSON.parse(decompressed)
  const passed = JSON.stringify(decompressedData) === jsonStr

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试2: 自动压缩功能
 */
async function testAutoCompression() {
  console.log('\n=== 测试2: 自动压缩功能 ===')

  const cache = getAdvancedCache('test-compression', {
    compressionEnabled: true,
    compressionThreshold: 1024, // 1KB
    l2Enabled: false
  })

  await cache.initialize()

  // 小数据（不压缩）
  const smallData = { message: 'Hello' }
  await cache.set('small-key', smallData)

  // 大数据（自动压缩）
  const largeData = {
    content: 'Large content '.repeat(200),
    array: Array.from({ length: 100 }, (_, i) => ({ id: i, data: 'test' }))
  }
  await cache.set('large-key', largeData)

  // 读取验证
  const small = await cache.get('small-key')
  const large = await cache.get('large-key')

  const passed = small.message === 'Hello' &&
                 large.content.startsWith('Large content') &&
                 large.array.length === 100

  const stats = cache.getStats()
  console.log('压缩节省:', stats.advanced.compressionSaved)
  console.log('压缩率:', stats.advanced.compressionRatio)

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试3: LFU淘汰策略
 */
async function testLFUEviction() {
  console.log('\n=== 测试3: LFU淘汰策略 ===')

  const cache = getAdvancedCache('test-lfu', {
    evictionPolicy: 'lfu',
    l1MaxSize: 5,
    l2Enabled: false
  })

  await cache.initialize()

  // 写入并访问不同频率
  await cache.set('key1', 'value1')
  await cache.set('key2', 'value2')
  await cache.set('key3', 'value3')

  // 访问key1多次（高频）
  for (let i = 0; i < 10; i++) {
    await cache.get('key1')
  }

  // 访问key2中等次数（中频）
  for (let i = 0; i < 5; i++) {
    await cache.get('key2')
  }

  // key3只访问一次（低频）
  await cache.get('key3')

  // 继续添加新键，触发淘汰
  await cache.set('key4', 'value4')
  await cache.set('key5', 'value5')
  await cache.set('key6', 'value6') // 应该淘汰key3

  const value1 = await cache.get('key1') // 高频，应存在
  const value2 = await cache.get('key2') // 中频，应存在
  const value3 = await cache.get('key3') // 低频，可能被淘汰

  console.log('key1（高频）:', value1)
  console.log('key2（中频）:', value2)
  console.log('key3（低频）:', value3)

  const passed = value1 === 'value1' && value2 === 'value2'

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试4: 自适应淘汰策略
 */
async function testAdaptiveEviction() {
  console.log('\n=== 测试4: 自适应淘汰策略 ===')

  const cache = getAdvancedCache('test-adaptive', {
    evictionPolicy: 'adaptive',
    adaptiveConfig: {
      lruWeight: 0.6,
      lfuWeight: 0.4
    },
    l1MaxSize: 5,
    l2Enabled: false
  })

  await cache.initialize()

  // 写入数据
  await cache.set('old-frequent', 'value1')
  await cache.set('old-rare', 'value2')
  await cache.set('new-frequent', 'value3')

  // 等待一会儿，让old-*变旧
  await new Promise(resolve => setTimeout(resolve, 100))

  // 访问old-frequent多次
  for (let i = 0; i < 10; i++) {
    await cache.get('old-frequent')
  }

  // 访问new-frequent多次
  for (let i = 0; i < 10; i++) {
    await cache.get('new-frequent')
  }

  // old-rare只访问一次
  await cache.get('old-rare')

  // 添加新数据触发淘汰
  await cache.set('key4', 'value4')
  await cache.set('key5', 'value5')
  await cache.set('key6', 'value6') // 应该淘汰old-rare

  const oldFrequent = await cache.get('old-frequent')
  const oldRare = await cache.get('old-rare')
  const newFrequent = await cache.get('new-frequent')

  console.log('旧的高频数据:', oldFrequent)
  console.log('旧的低频数据:', oldRare)
  console.log('新的高频数据:', newFrequent)

  const passed = oldFrequent !== null && newFrequent !== null

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试5: 缓存预热
 */
async function testCacheWarming() {
  console.log('\n=== 测试5: 缓存预热 ===')

  const cache = getAdvancedCache('test-warming', {
    l2Enabled: false
  })

  await cache.initialize()

  // 模拟数据加载器
  const dataLoader = async (key) => {
    return { key, data: `Data for ${key}`, timestamp: Date.now() }
  }

  // 预热常用数据
  const keys = ['user-1', 'user-2', 'user-3', 'config-1', 'config-2']
  const result = await cache.warming.warmCommonData(dataLoader, keys)

  console.log('预热结果:', result)

  // 验证数据已缓存
  const user1 = await cache.get('user-1')
  const config1 = await cache.get('config-1')

  console.log('预热的用户数据:', user1)
  console.log('预热的配置数据:', config1)

  const passed = result.success === 5 &&
                 user1 && user1.key === 'user-1' &&
                 config1 && config1.key === 'config-1'

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试6: 智能预热（基于访问模式）
 */
async function testSmartWarming() {
  console.log('\n=== 测试6: 智能预热 ===')

  const cache = getAdvancedCache('test-smart-warm', {
    l2Enabled: false
  })

  await cache.initialize()

  // 模拟访问日志
  const accessLog = [
    { key: 'hot-key-1', timestamp: Date.now() - 10000 },
    { key: 'hot-key-1', timestamp: Date.now() - 9000 },
    { key: 'hot-key-1', timestamp: Date.now() - 8000 },
    { key: 'hot-key-2', timestamp: Date.now() - 7000 },
    { key: 'hot-key-2', timestamp: Date.now() - 6000 },
    { key: 'cold-key', timestamp: Date.now() - 5000 },
    { key: 'hot-key-1', timestamp: Date.now() - 4000 },
    { key: 'hot-key-2', timestamp: Date.now() - 3000 },
    { key: 'hot-key-1', timestamp: Date.now() - 2000 },
    { key: 'hot-key-1', timestamp: Date.now() - 1000 }
  ]

  // 智能预热（阈值: 访问3次以上）
  const result = await cache.warming.smartWarm(accessLog, 3)

  console.log('热点键:', result.hotKeys)

  const passed = result.hotKeys.includes('hot-key-1') &&
                 result.hotKeys.includes('hot-key-2') &&
                 !result.hotKeys.includes('cold-key')

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试7: 批量操作
 */
async function testBatchOperations() {
  console.log('\n=== 测试7: 批量操作 ===')

  const cache = getAdvancedCache('test-batch', {
    l2Enabled: false
  })

  await cache.initialize()

  // 批量设置
  const entries = Array.from({ length: 100 }, (_, i) => ({
    key: `batch-key-${i}`,
    value: { index: i, data: 'test' },
    ttl: 10 * 60 * 1000
  }))

  const setStart = Date.now()
  const setResult = await cache.batch.batchSet(entries)
  const setTime = Date.now() - setStart

  console.log('批量设置结果:', setResult)
  console.log('批量设置耗时:', setTime + 'ms')

  // 批量获取
  const keys = entries.map(e => e.key)

  const getStart = Date.now()
  const getResult = await cache.batch.batchGet(keys)
  const getTime = Date.now() - getStart

  console.log('批量获取成功:', getResult.results.size)
  console.log('批量获取未命中:', getResult.missing.length)
  console.log('批量获取耗时:', getTime + 'ms')

  // 批量删除
  const deleteKeys = keys.slice(0, 50)
  const deleteResult = await cache.batch.batchDelete(deleteKeys)

  console.log('批量删除结果:', deleteResult)

  // 验证删除
  const afterDelete = await cache.batch.batchGet(deleteKeys)

  const passed = setResult.success === 100 &&
                 getResult.results.size === 100 &&
                 deleteResult.deleted === 50 &&
                 afterDelete.missing.length === 50

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试8: 查询优化缓存
 */
async function testQueryOptimization() {
  console.log('\n=== 测试8: 查询优化缓存 ===')

  const cache = getAdvancedCache('test-query', {
    l2Enabled: false
  })

  await cache.initialize()

  // 模拟查询函数
  let queryCount = 0
  const fetcher = async (query) => {
    queryCount++
    await new Promise(resolve => setTimeout(resolve, 10)) // 模拟延迟
    return { query, result: `Result for ${query}`, timestamp: Date.now() }
  }

  // 第一次查询（缓存未命中）
  const start1 = Date.now()
  const result1 = await cache.query.smartQuery('test query 1', fetcher)
  const time1 = Date.now() - start1

  console.log('第一次查询耗时:', time1 + 'ms')
  console.log('查询次数:', queryCount)

  // 第二次相同查询（缓存命中）
  const start2 = Date.now()
  const result2 = await cache.query.smartQuery('test query 1', fetcher)
  const time2 = Date.now() - start2

  console.log('第二次查询耗时:', time2 + 'ms')
  console.log('查询次数:', queryCount)

  // 分析查询模式
  const patterns = cache.query.analyzeQueryPatterns()
  console.log('查询模式分析:', patterns)

  const passed = queryCount === 1 && // 只执行了一次实际查询
                 time2 < time1 &&     // 第二次更快
                 result1.query === result2.query &&
                 patterns.length > 0

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试9: 性能分析
 */
async function testPerformanceAnalytics() {
  console.log('\n=== 测试9: 性能分析 ===')

  const cache = getAdvancedCache('test-analytics', {
    l2Enabled: false,
    enableMonitoring: false // 不启动自动监控
  })

  await cache.initialize()

  // 执行一系列操作
  for (let i = 0; i < 50; i++) {
    await cache.set(`key-${i}`, { index: i })
  }

  for (let i = 0; i < 100; i++) {
    await cache.get(`key-${i % 50}`)
  }

  // 生成性能报告
  const report = cache.performance.generateReport()

  console.log('性能报告:')
  console.log('- 运行时间:', report.uptime + 'ms')
  console.log('- 总操作数:', report.totalOperations)
  console.log('- 操作速率:', report.opsPerSecond + ' ops/s')
  console.log('- 平均延迟:', report.averageLatency)
  console.log('- 近期命中率:', report.recentHitRate)
  console.log('- 内存使用:', report.memoryUsage.l1)
  console.log('- 优化建议:', report.recommendations)

  const passed = report.totalOperations === 150 &&
                 parseFloat(report.opsPerSecond) > 0 &&
                 report.recommendations.length > 0

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试10: 压缩性能对比
 */
async function testCompressionPerformance() {
  console.log('\n=== 测试10: 压缩性能对比 ===')

  // 准备测试数据
  const testData = {
    content: 'Lorem ipsum dolor sit amet '.repeat(100),
    array: Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: 'Test description '.repeat(10)
    }))
  }

  // 不压缩
  const cache1 = getAdvancedCache('test-no-compress', {
    compressionEnabled: false,
    l2Enabled: false
  })
  await cache1.initialize()

  const start1 = Date.now()
  for (let i = 0; i < 100; i++) {
    await cache1.set(`key-${i}`, testData)
  }
  const writeTime1 = Date.now() - start1

  const start2 = Date.now()
  for (let i = 0; i < 100; i++) {
    await cache1.get(`key-${i}`)
  }
  const readTime1 = Date.now() - start2

  // 启用压缩
  const cache2 = getAdvancedCache('test-with-compress', {
    compressionEnabled: true,
    compressionThreshold: 100,
    l2Enabled: false
  })
  await cache2.initialize()

  const start3 = Date.now()
  for (let i = 0; i < 100; i++) {
    await cache2.set(`key-${i}`, testData)
  }
  const writeTime2 = Date.now() - start3

  const start4 = Date.now()
  for (let i = 0; i < 100; i++) {
    await cache2.get(`key-${i}`)
  }
  const readTime2 = Date.now() - start4

  console.log('不压缩:')
  console.log('- 写入耗时:', writeTime1 + 'ms')
  console.log('- 读取耗时:', readTime1 + 'ms')

  console.log('启用压缩:')
  console.log('- 写入耗时:', writeTime2 + 'ms')
  console.log('- 读取耗时:', readTime2 + 'ms')

  const stats = cache2.getStats()
  console.log('压缩统计:')
  console.log('- 节省空间:', stats.advanced.compressionSaved)
  console.log('- 压缩率:', stats.advanced.compressionRatio)

  const passed = readTime2 < readTime1 * 2 // 压缩后读取不应慢太多

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试11: 综合场景测试
 */
async function testComprehensiveScenario() {
  console.log('\n=== 测试11: 综合场景测试 ===')

  // 配置高级缓存
  const cache = getAdvancedCache('test-comprehensive', {
    compressionEnabled: true,
    compressionThreshold: 500,
    evictionPolicy: 'adaptive',
    l1MaxSize: 50,
    l1MaxMemory: 10 * 1024 * 1024,
    l2Enabled: false,
    enableMonitoring: false
  })

  await cache.initialize()

  console.log('场景1: 批量数据导入')
  const importData = Array.from({ length: 200 }, (_, i) => ({
    key: `user-${i}`,
    value: {
      id: i,
      name: `User ${i}`,
      profile: 'User profile data '.repeat(20)
    }
  }))

  const importResult = await cache.batch.batchSet(importData, { batchSize: 50 })
  console.log('导入结果:', importResult)

  console.log('\n场景2: 热点数据访问')
  // 模拟热点访问
  for (let i = 0; i < 20; i++) {
    await cache.get('user-1')
    await cache.get('user-2')
    await cache.get('user-3')
  }

  console.log('\n场景3: 查询优化')
  const queryFetcher = async (userId) => {
    return { userId, data: 'User data' }
  }

  for (let i = 1; i <= 10; i++) {
    await cache.query.smartQuery(`user-query-${i % 3}`, () => queryFetcher(i))
  }

  const patterns = cache.query.analyzeQueryPatterns()
  console.log('查询模式:', patterns.length, '个')

  console.log('\n场景4: 性能分析')
  const report = cache.performance.generateReport()
  console.log('总操作数:', report.totalOperations)
  console.log('操作速率:', report.opsPerSecond)
  console.log('近期命中率:', report.recentHitRate)

  console.log('\n场景5: 批量清理')
  const deleteResult = await cache.batch.batchDelete(
    importData.slice(0, 100).map(e => e.key)
  )
  console.log('清理结果:', deleteResult)

  const stats = cache.getStats()
  console.log('\n最终统计:')
  console.log('- L1缓存:', stats.l1.size, '/', stats.l1.maxSize)
  console.log('- 命中率:', stats.overall.hitRate)
  console.log('- 压缩节省:', stats.advanced.compressionSaved)

  const passed = importResult.success === 200 &&
                 patterns.length > 0 &&
                 deleteResult.deleted === 100 &&
                 parseInt(report.totalOperations) > 300

  console.log(passed ? '\n✅ 测试通过' : '\n❌ 测试失败')

  return passed
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('='.repeat(60))
  console.log('高级缓存功能测试开始')
  console.log('='.repeat(60))

  const tests = [
    { name: 'LZ-String压缩算法', fn: testCompression },
    { name: '自动压缩功能', fn: testAutoCompression },
    { name: 'LFU淘汰策略', fn: testLFUEviction },
    { name: '自适应淘汰策略', fn: testAdaptiveEviction },
    { name: '缓存预热', fn: testCacheWarming },
    { name: '智能预热', fn: testSmartWarming },
    { name: '批量操作', fn: testBatchOperations },
    { name: '查询优化', fn: testQueryOptimization },
    { name: '性能分析', fn: testPerformanceAnalytics },
    { name: '压缩性能对比', fn: testCompressionPerformance },
    { name: '综合场景测试', fn: testComprehensiveScenario }
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
  testCompression,
  testAutoCompression,
  testLFUEviction,
  testAdaptiveEviction,
  testCacheWarming,
  testSmartWarming,
  testBatchOperations,
  testQueryOptimization,
  testPerformanceAnalytics,
  testCompressionPerformance,
  testComprehensiveScenario,
  runAllTests
}

// 如果直接运行此文件
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests().catch(console.error)
}
