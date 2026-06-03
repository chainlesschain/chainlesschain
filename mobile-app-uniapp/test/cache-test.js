/**
 * 缓存管理器测试
 *
 * 测试内容:
 * 1. 基本读写
 * 2. L1缓存功能
 * 3. L2缓存功能
 * 4. LRU淘汰
 * 5. TTL过期
 * 6. 多级缓存
 * 7. 命名空间隔离
 * 8. 性能测试
 */

import { getCacheManager } from '../src/services/common/cache-manager.js'

/**
 * 测试1: 基本初始化
 */
async function testInitialization() {
  console.log('\n=== 测试1: 基本初始化 ===')

  const cache = getCacheManager('test-init')

  const result = await cache.initialize()

  console.log('初始化结果:', result)
  console.log('统计信息:', cache.getStats())

  return result.success
}

/**
 * 测试2: L1缓存读写
 */
async function testL1Cache() {
  console.log('\n=== 测试2: L1缓存读写 ===')

  const cache = getCacheManager('test-l1', {
    l1MaxSize: 10,
    l2Enabled: false // 只测试L1
  })

  await cache.initialize()

  // 写入
  await cache.set('key1', 'value1')
  await cache.set('key2', { name: 'test', value: 123 })
  await cache.set('key3', [1, 2, 3, 4, 5])

  // 读取
  const value1 = await cache.get('key1')
  const value2 = await cache.get('key2')
  const value3 = await cache.get('key3')

  console.log('key1:', value1)
  console.log('key2:', value2)
  console.log('key3:', value3)

  const passed = value1 === 'value1' &&
                 value2.name === 'test' &&
                 value3.length === 5

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试3: L2缓存读写
 */
async function testL2Cache() {
  console.log('\n=== 测试3: L2缓存读写 ===')

  const cache = getCacheManager('test-l2', {
    l1Enabled: false, // 只测试L2
    l2Enabled: true
  })

  await cache.initialize()

  // 写入
  await cache.set('key1', 'value1', { persist: true })
  await cache.set('key2', { data: 'test' }, { persist: true })

  // 等待写入完成
  await new Promise(resolve => setTimeout(resolve, 100))

  // 读取
  const value1 = await cache.get('key1')
  const value2 = await cache.get('key2')

  console.log('key1:', value1)
  console.log('key2:', value2)

  const passed = value1 === 'value1' && value2.data === 'test'

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  // 清理
  await cache.clear()

  return passed
}

/**
 * 测试4: LRU淘汰机制
 */
async function testLRU() {
  console.log('\n=== 测试4: LRU淘汰机制 ===')

  const cache = getCacheManager('test-lru', {
    l1MaxSize: 5, // 最多5个项
    l2Enabled: false
  })

  await cache.initialize()

  // 写入6个项（超过最大值）
  for (let i = 1; i <= 6; i++) {
    await cache.set(`key${i}`, `value${i}`)
  }

  // key1应该被淘汰了
  const value1 = await cache.get('key1')
  const value6 = await cache.get('key6')

  console.log('key1（应被淘汰）:', value1)
  console.log('key6（应存在）:', value6)

  const stats = cache.getStats()
  console.log('淘汰次数:', stats.overall.evictions)

  const passed = value1 === null && value6 === 'value6' && stats.overall.evictions > 0

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试5: TTL过期机制
 */
async function testTTL() {
  console.log('\n=== 测试5: TTL过期机制 ===')

  const cache = getCacheManager('test-ttl', {
    l2Enabled: false
  })

  await cache.initialize()

  // 写入短TTL数据
  await cache.set('temp-key', 'temp-value', { ttl: 1000 }) // 1秒过期

  // 立即读取（应存在）
  const value1 = await cache.get('temp-key')
  console.log('立即读取:', value1)

  // 等待2秒
  await new Promise(resolve => setTimeout(resolve, 2000))

  // 再次读取（应过期）
  const value2 = await cache.get('temp-key')
  console.log('2秒后读取:', value2)

  const passed = value1 === 'temp-value' && value2 === null

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试6: 多级缓存
 */
async function testMultiLayer() {
  console.log('\n=== 测试6: 多级缓存 ===')

  const cache = getCacheManager('test-multi', {
    l1MaxSize: 5,
    l1Enabled: true,
    l2Enabled: true
  })

  await cache.initialize()

  // 写入数据（应同时写入L1和L2）
  await cache.set('key1', 'value1')

  // 从L1读取
  const value1 = await cache.get('key1')
  console.log('从L1读取:', value1)

  const stats1 = cache.getStats()
  console.log('L1命中:', stats1.l1.hits)

  // 清空L1
  await cache.clear({ l2Only: false, l1Only: true })

  // 从L2读取（应自动提升到L1）
  const value2 = await cache.get('key1')
  console.log('从L2读取:', value2)

  const stats2 = cache.getStats()
  console.log('L2命中:', stats2.l2.hits)

  const passed = value1 === 'value1' &&
                 value2 === 'value1' &&
                 stats1.l1.hits > 0 &&
                 stats2.l2.hits > 0

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  // 清理
  await cache.clear()

  return passed
}

/**
 * 测试7: 命名空间隔离
 */
async function testNamespace() {
  console.log('\n=== 测试7: 命名空间隔离 ===')

  const cache1 = getCacheManager('namespace1', { l2Enabled: false })
  const cache2 = getCacheManager('namespace2', { l2Enabled: false })

  await cache1.initialize()
  await cache2.initialize()

  // 在不同命名空间写入相同的键
  await cache1.set('same-key', 'value-from-ns1')
  await cache2.set('same-key', 'value-from-ns2')

  // 读取
  const value1 = await cache1.get('same-key')
  const value2 = await cache2.get('same-key')

  console.log('namespace1:', value1)
  console.log('namespace2:', value2)

  const passed = value1 === 'value-from-ns1' && value2 === 'value-from-ns2'

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试8: 缓存删除
 */
async function testDelete() {
  console.log('\n=== 测试8: 缓存删除 ===')

  const cache = getCacheManager('test-delete', { l2Enabled: false })

  await cache.initialize()

  // 写入
  await cache.set('key1', 'value1')
  await cache.set('key2', 'value2')

  // 删除key1
  await cache.delete('key1')

  // 读取
  const value1 = await cache.get('key1')
  const value2 = await cache.get('key2')

  console.log('key1（已删除）:', value1)
  console.log('key2（未删除）:', value2)

  const passed = value1 === null && value2 === 'value2'

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试9: 性能测试
 */
async function testPerformance() {
  console.log('\n=== 测试9: 性能测试 ===')

  const cache = getCacheManager('test-perf', {
    l1MaxSize: 1000,
    l2Enabled: false
  })

  await cache.initialize()

  // 写入性能
  console.log('测试写入性能...')
  const writeStart = Date.now()
  for (let i = 0; i < 1000; i++) {
    await cache.set(`key${i}`, { index: i, data: 'test data' })
  }
  const writeTime = Date.now() - writeStart
  console.log(`写入1000个项: ${writeTime}ms (${(1000 / writeTime * 1000).toFixed(0)} ops/s)`)

  // 读取性能
  console.log('测试读取性能...')
  const readStart = Date.now()
  for (let i = 0; i < 1000; i++) {
    await cache.get(`key${i}`)
  }
  const readTime = Date.now() - readStart
  console.log(`读取1000个项: ${readTime}ms (${(1000 / readTime * 1000).toFixed(0)} ops/s)`)

  // 缓存命中率
  const stats = cache.getStats()
  console.log('缓存命中率:', stats.l1.hitRate)

  const passed = readTime < 1000 // 读取1000个项应该在1秒内完成

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 测试10: 内存管理
 */
async function testMemoryManagement() {
  console.log('\n=== 测试10: 内存管理 ===')

  const cache = getCacheManager('test-memory', {
    l1MaxSize: 100,
    l1MaxMemory: 1024 * 1024, // 1MB
    l2Enabled: false
  })

  await cache.initialize()

  // 写入大数据
  const largeData = new Array(1000).fill('x').join('')

  for (let i = 0; i < 100; i++) {
    await cache.set(`key${i}`, largeData)
  }

  const stats = cache.getStats()
  console.log('L1内存占用:', stats.l1.memory, '/', stats.l1.maxMemory)
  console.log('L1项数:', stats.l1.size, '/', stats.l1.maxSize)
  console.log('淘汰次数:', stats.overall.evictions)

  const passed = stats.l1.memory <= stats.l1.maxMemory

  console.log(passed ? '✅ 测试通过' : '❌ 测试失败')

  return passed
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('='.repeat(60))
  console.log('缓存管理器测试开始')
  console.log('='.repeat(60))

  const tests = [
    { name: '初始化', fn: testInitialization },
    { name: 'L1缓存读写', fn: testL1Cache },
    { name: 'L2缓存读写', fn: testL2Cache },
    { name: 'LRU淘汰机制', fn: testLRU },
    { name: 'TTL过期机制', fn: testTTL },
    { name: '多级缓存', fn: testMultiLayer },
    { name: '命名空间隔离', fn: testNamespace },
    { name: '缓存删除', fn: testDelete },
    { name: '性能测试', fn: testPerformance },
    { name: '内存管理', fn: testMemoryManagement }
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
  testL1Cache,
  testL2Cache,
  testLRU,
  testTTL,
  testMultiLayer,
  testNamespace,
  testDelete,
  testPerformance,
  testMemoryManagement,
  runAllTests
}

// 如果直接运行此文件
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests().catch(console.error)
}
