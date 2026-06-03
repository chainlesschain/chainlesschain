/**
 * 性能基准测试
 *
 * 用于测试应用的性能指标，包括：
 * - 页面加载时间
 * - 组件渲染性能
 * - API 响应时间
 * - 内存使用情况
 */

import { test, expect } from '@playwright/test'

// 性能基准阈值配置
const PERFORMANCE_THRESHOLDS = {
  // 页面加载时间 (ms)
  PAGE_LOAD: {
    EXCELLENT: 1000,
    GOOD: 2000,
    ACCEPTABLE: 3000
  },
  // 首次内容绘制 (ms)
  FCP: {
    EXCELLENT: 1000,
    GOOD: 2000,
    ACCEPTABLE: 3000
  },
  // 最大内容绘制 (ms)
  LCP: {
    EXCELLENT: 2500,
    GOOD: 4000,
    ACCEPTABLE: 5000
  },
  // 交互时间 (ms)
  TTI: {
    EXCELLENT: 3000,
    GOOD: 5000,
    ACCEPTABLE: 7000
  },
  // API 响应时间 (ms)
  API_RESPONSE: {
    EXCELLENT: 200,
    GOOD: 500,
    ACCEPTABLE: 1000
  }
}

/**
 * 测试页面性能指标
 */
async function measurePagePerformance(page) {
  const metrics = await page.evaluate(() => {
    const perfData = window.performance.timing
    const paintEntries = performance.getEntriesByType('paint')

    // 计算关键性能指标
    const domContentLoaded = perfData.domContentLoadedEventEnd - perfData.navigationStart
    const loadComplete = perfData.loadEventEnd - perfData.navigationStart

    // 首次内容绘制 (FCP)
    const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint')
    const fcp = fcpEntry ? fcpEntry.startTime : 0

    return {
      domContentLoaded,
      loadComplete,
      fcp,
      navigationStart: perfData.navigationStart,
      fetchStart: perfData.fetchStart,
      domainLookupStart: perfData.domainLookupStart,
      domainLookupEnd: perfData.domainLookupEnd,
      connectStart: perfData.connectStart,
      connectEnd: perfData.connectEnd,
      requestStart: perfData.requestStart,
      responseStart: perfData.responseStart,
      responseEnd: perfData.responseEnd,
      domInteractive: perfData.domInteractive - perfData.navigationStart,
      domComplete: perfData.domComplete - perfData.navigationStart
    }
  })

  return metrics
}

/**
 * 获取性能评分
 */
function getPerformanceScore(value, thresholds) {
  if (value <= thresholds.EXCELLENT) return 'EXCELLENT'
  if (value <= thresholds.GOOD) return 'GOOD'
  if (value <= thresholds.ACCEPTABLE) return 'ACCEPTABLE'
  return 'POOR'
}

/**
 * 格式化性能报告
 */
function formatPerformanceReport(testName, metrics, thresholds) {
  const score = getPerformanceScore(metrics.value, thresholds)
  const symbol = {
    EXCELLENT: '🟢',
    GOOD: '🟡',
    ACCEPTABLE: '🟠',
    POOR: '🔴'
  }[score]

  return `${symbol} ${testName}: ${metrics.value}ms (${score})`
}

test.describe('性能基准测试 - H5 平台', () => {
  test.beforeEach(async ({ page }) => {
    // 设置性能监控
    await page.coverage.startJSCoverage()
    await page.coverage.startCSSCoverage()
  })

  test.afterEach(async ({ page }, testInfo) => {
    // 收集覆盖率数据
    const [jsCoverage, cssCoverage] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage()
    ])

    // 计算代码覆盖率
    let totalBytes = 0
    let usedBytes = 0

    for (const entry of jsCoverage) {
      totalBytes += entry.text.length
      for (const range of entry.ranges) {
        usedBytes += range.end - range.start
      }
    }

    const coverage = totalBytes > 0 ? ((usedBytes / totalBytes) * 100).toFixed(2) : 0

    console.log(`\n📊 代码覆盖率: ${coverage}%`)
  })

  test('首页加载性能', async ({ page }) => {
    const startTime = Date.now()

    await page.goto('http://localhost:5173/')
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime
    const metrics = await measurePagePerformance(page)

    // 输出性能报告
    console.log('\n=== 首页性能报告 ===')
    console.log(formatPerformanceReport(
      '页面加载时间',
      { value: loadTime },
      PERFORMANCE_THRESHOLDS.PAGE_LOAD
    ))
    console.log(formatPerformanceReport(
      'DOM Content Loaded',
      { value: metrics.domContentLoaded },
      PERFORMANCE_THRESHOLDS.PAGE_LOAD
    ))
    console.log(formatPerformanceReport(
      'Load Complete',
      { value: metrics.loadComplete },
      PERFORMANCE_THRESHOLDS.PAGE_LOAD
    ))
    console.log(formatPerformanceReport(
      'First Contentful Paint',
      { value: metrics.fcp },
      PERFORMANCE_THRESHOLDS.FCP
    ))
    console.log(formatPerformanceReport(
      'DOM Interactive',
      { value: metrics.domInteractive },
      PERFORMANCE_THRESHOLDS.TTI
    ))

    // 性能断言
    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD.ACCEPTABLE)
    expect(metrics.domContentLoaded).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD.ACCEPTABLE)
    expect(metrics.fcp).toBeLessThan(PERFORMANCE_THRESHOLDS.FCP.ACCEPTABLE)
  })

  test('知识库列表页性能', async ({ page }) => {
    await page.goto('http://localhost:5173/')

    // 导航到知识库列表页
    const startTime = Date.now()
    await page.click('text=知识库')
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime
    const metrics = await measurePagePerformance(page)

    console.log('\n=== 知识库列表页性能报告 ===')
    console.log(formatPerformanceReport(
      '页面导航时间',
      { value: loadTime },
      PERFORMANCE_THRESHOLDS.PAGE_LOAD
    ))
    console.log(formatPerformanceReport(
      'DOM Interactive',
      { value: metrics.domInteractive },
      PERFORMANCE_THRESHOLDS.TTI
    ))

    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD.ACCEPTABLE)
  })

  test('AI 对话页性能', async ({ page }) => {
    await page.goto('http://localhost:5173/')

    // 导航到 AI 对话页
    const startTime = Date.now()
    await page.click('text=AI助手')
    await page.waitForLoadState('networkidle')

    const loadTime = Date.now() - startTime
    const metrics = await measurePagePerformance(page)

    console.log('\n=== AI 对话页性能报告 ===')
    console.log(formatPerformanceReport(
      '页面导航时间',
      { value: loadTime },
      PERFORMANCE_THRESHOLDS.PAGE_LOAD
    ))
    console.log(formatPerformanceReport(
      'DOM Interactive',
      { value: metrics.domInteractive },
      PERFORMANCE_THRESHOLDS.TTI
    ))

    expect(loadTime).toBeLessThan(PERFORMANCE_THRESHOLDS.PAGE_LOAD.ACCEPTABLE)
  })

  test('搜索性能测试', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await page.click('text=知识库')
    await page.waitForLoadState('networkidle')

    // 获取搜索输入框
    const searchInput = await page.locator('input[placeholder*="搜索"]').first()

    // 测试搜索响应时间
    const startTime = Date.now()
    await searchInput.fill('测试搜索')

    // 等待搜索结果
    await page.waitForTimeout(500) // debounce 延迟
    await page.waitForLoadState('networkidle')

    const searchTime = Date.now() - startTime

    console.log('\n=== 搜索性能报告 ===')
    console.log(formatPerformanceReport(
      '搜索响应时间',
      { value: searchTime },
      PERFORMANCE_THRESHOLDS.API_RESPONSE
    ))

    expect(searchTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE.ACCEPTABLE * 2)
  })

  test('图片上传性能测试', async ({ page }) => {
    await page.goto('http://localhost:5173/')

    // 导航到知识库编辑页
    await page.click('text=知识库')
    await page.waitForLoadState('networkidle')

    // 点击新建按钮
    await page.click('text=新建')
    await page.waitForLoadState('networkidle')

    // 模拟图片上传（注意：实际测试需要真实图片）
    const startTime = Date.now()

    // 这里只测试页面交互响应时间
    await page.click('text=标题')
    const interactionTime = Date.now() - startTime

    console.log('\n=== 编辑页交互性能报告 ===')
    console.log(formatPerformanceReport(
      '页面交互响应时间',
      { value: interactionTime },
      { EXCELLENT: 50, GOOD: 100, ACCEPTABLE: 200 }
    ))

    expect(interactionTime).toBeLessThan(200)
  })

  test('内存使用情况', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await page.waitForLoadState('networkidle')

    // 获取内存使用情况
    const memoryMetrics = await page.evaluate(() => {
      if (performance.memory) {
        return {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        }
      }
      return null
    })

    if (memoryMetrics) {
      const usedMB = (memoryMetrics.usedJSHeapSize / 1024 / 1024).toFixed(2)
      const totalMB = (memoryMetrics.totalJSHeapSize / 1024 / 1024).toFixed(2)
      const limitMB = (memoryMetrics.jsHeapSizeLimit / 1024 / 1024).toFixed(2)

      console.log('\n=== 内存使用情况 ===')
      console.log(`已使用: ${usedMB} MB`)
      console.log(`总分配: ${totalMB} MB`)
      console.log(`限制: ${limitMB} MB`)
      console.log(`使用率: ${((memoryMetrics.usedJSHeapSize / memoryMetrics.jsHeapSizeLimit) * 100).toFixed(2)}%`)

      // 内存使用不应超过限制的 80%
      expect(memoryMetrics.usedJSHeapSize).toBeLessThan(memoryMetrics.jsHeapSizeLimit * 0.8)
    } else {
      console.log('⚠️  此浏览器不支持 performance.memory API')
    }
  })

  test('资源加载性能', async ({ page }) => {
    const resourceTimings = []

    // 监听所有网络请求
    page.on('response', async (response) => {
      const request = response.request()
      const timing = response.request().timing()

      if (timing) {
        resourceTimings.push({
          url: request.url(),
          type: request.resourceType(),
          status: response.status(),
          size: (await response.body().catch(() => Buffer.from(''))).length,
          duration: timing.responseEnd - timing.requestStart
        })
      }
    })

    await page.goto('http://localhost:5173/')
    await page.waitForLoadState('networkidle')

    // 统计资源加载情况
    const stats = {
      totalResources: resourceTimings.length,
      totalSize: 0,
      totalDuration: 0,
      byType: {}
    }

    for (const timing of resourceTimings) {
      stats.totalSize += timing.size
      stats.totalDuration += timing.duration

      if (!stats.byType[timing.type]) {
        stats.byType[timing.type] = { count: 0, size: 0, duration: 0 }
      }

      stats.byType[timing.type].count++
      stats.byType[timing.type].size += timing.size
      stats.byType[timing.type].duration += timing.duration
    }

    console.log('\n=== 资源加载统计 ===')
    console.log(`总资源数: ${stats.totalResources}`)
    console.log(`总大小: ${(stats.totalSize / 1024).toFixed(2)} KB`)
    console.log(`总加载时间: ${stats.totalDuration.toFixed(2)} ms`)
    console.log('\n按类型分组:')

    Object.entries(stats.byType).forEach(([type, data]) => {
      console.log(`  ${type}: ${data.count}个, ${(data.size / 1024).toFixed(2)} KB, ${data.duration.toFixed(2)} ms`)
    })

    // 资源总数不应过多（避免过度加载）
    expect(stats.totalResources).toBeLessThan(100)
  })
})

test.describe('性能基准测试 - 长时间运行', () => {
  test('内存泄漏检测', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await page.waitForLoadState('networkidle')

    // 获取初始内存
    const getMemory = async () => {
      return await page.evaluate(() => {
        if (performance.memory) {
          return performance.memory.usedJSHeapSize
        }
        return 0
      })
    }

    const initialMemory = await getMemory()
    const memoryReadings = [initialMemory]

    console.log('\n=== 内存泄漏检测 ===')
    console.log(`初始内存: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`)

    // 模拟用户操作 10 次
    for (let i = 0; i < 10; i++) {
      // 导航到知识库列表
      await page.click('text=知识库')
      await page.waitForTimeout(500)

      // 导航到 AI 助手
      await page.click('text=AI助手')
      await page.waitForTimeout(500)

      // 导航回首页
      await page.click('text=首页')
      await page.waitForTimeout(500)

      // 记录内存
      const currentMemory = await getMemory()
      memoryReadings.push(currentMemory)

      console.log(`第 ${i + 1} 次迭代后内存: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`)
    }

    const finalMemory = await getMemory()
    const memoryGrowth = finalMemory - initialMemory
    const growthPercent = ((memoryGrowth / initialMemory) * 100).toFixed(2)

    console.log(`最终内存: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`)
    console.log(`内存增长: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB (${growthPercent}%)`)

    // 内存增长不应超过 50%
    expect(memoryGrowth).toBeLessThan(initialMemory * 0.5)
  })
})
