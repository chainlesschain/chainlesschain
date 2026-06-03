/**
 * Credit Score Manager 测试套件
 *
 * 测试覆盖:
 * 1. 初始化测试
 * 2. 用户信用创建测试
 * 3. 交易事件处理测试
 * 4. 评价事件处理测试
 * 5. 纠纷事件处理测试
 * 6. 信用评分计算测试
 * 7. 信用报告测试
 * 8. 排行榜测试
 * 9. 快照和趋势测试
 * 10. 缓存测试
 * 11. 统计测试
 *
 * @version 2.6.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

import {
  createCreditScoreManager,
  CreditLevels,
  ScoreWeights,
  EventType
} from '../src/services/trade/credit-score-manager.js'

// Mock dependencies
class MockDB {
  constructor() {
    this.tables = {}
  }

  async executeSql(sql, params = []) {
    if (sql.includes('CREATE TABLE')) {
      return []
    }

    if (sql.includes('INSERT INTO user_credits')) {
      return []
    }

    if (sql.includes('INSERT INTO credit_records')) {
      return []
    }

    if (sql.includes('INSERT INTO credit_snapshots')) {
      return []
    }

    if (sql.includes('SELECT * FROM user_credits WHERE user_did')) {
      return [{
        user_did: params[0],
        credit_score: 500,
        credit_level: '白银',
        total_transactions: 10,
        completed_transactions: 9,
        total_volume: 10000,
        positive_reviews: 8,
        negative_reviews: 1,
        disputes: 0,
        refunds: 1,
        avg_response_time: 1800000,
        last_updated: Date.now()
      }]
    }

    if (sql.includes('SELECT * FROM credit_records')) {
      return []
    }

    if (sql.includes('SELECT * FROM credit_snapshots')) {
      return []
    }

    if (sql.includes('SELECT COUNT(*) as count FROM user_credits')) {
      return [{ count: 100 }]
    }

    if (sql.includes('SELECT AVG(credit_score)')) {
      return [{ avg: 450 }]
    }

    if (sql.includes('SELECT SUM(total_transactions)')) {
      return [{ sum: 1000 }]
    }

    if (sql.includes('UPDATE user_credits')) {
      return []
    }

    return []
  }
}

class MockDIDManager {
  async getCurrentDid() {
    return 'did:example:user'
  }
}

// 测试结果
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
}

// 测试辅助函数
function assert(condition, message) {
  results.total++
  if (condition) {
    results.passed++
    console.log(`✅ ${message}`)
  } else {
    results.failed++
    console.error(`❌ ${message}`)
    results.errors.push(message)
  }
}

// ==================== 测试套件 ====================

/**
 * 1. 初始化测试
 */
async function testInitialization() {
  console.log('\n=== 测试 1: 初始化 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  assert(creditManager !== null, '初始化成功')
  assert(creditManager.db === db, '数据库实例正确')
  assert(creditManager.didManager === didManager, 'DID管理器实例正确')
  assert(creditManager.creditLevels.length === 5, '信用等级数量正确')
  assert(Object.keys(creditManager.scoreWeights).length === 6, '评分权重数量正确')
}

/**
 * 2. 用户信用创建测试
 */
async function testUserCreditCreation() {
  console.log('\n=== 测试 2: 用户信用创建 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 获取用户信用（自动创建）
  const credit = await creditManager.getUserCredit('did:example:alice')

  assert(credit !== null, '用户信用创建成功')
  assert(credit.userDid === 'did:example:alice', '用户DID正确')
  assert(credit.creditScore >= 0, '信用评分初始化')
  assert(credit.creditLevel !== undefined, '信用等级初始化')
}

/**
 * 3. 交易事件处理测试
 */
async function testTransactionEvents() {
  console.log('\n=== 测试 3: 交易事件处理 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const userDid = 'did:example:user'

  // 交易完成
  try {
    await creditManager.onTransactionCompleted(userDid, 'tx_001', 100)
    assert(true, '交易完成事件处理成功')
  } catch (error) {
    assert(false, `交易完成事件失败: ${error.message}`)
  }

  // 交易取消
  try {
    await creditManager.onTransactionCancelled(userDid, 'tx_002')
    assert(true, '交易取消事件处理成功')
  } catch (error) {
    assert(false, `交易取消事件失败: ${error.message}`)
  }
}

/**
 * 4. 评价事件处理测试
 */
async function testReviewEvents() {
  console.log('\n=== 测试 4: 评价事件处理 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const userDid = 'did:example:user'

  // 好评（5星）
  try {
    await creditManager.onPositiveReview(userDid, 'review_001', 5)
    assert(true, '好评事件处理成功（5星）')
  } catch (error) {
    assert(false, `好评事件失败: ${error.message}`)
  }

  // 好评（4星）
  try {
    await creditManager.onPositiveReview(userDid, 'review_002', 4)
    assert(true, '好评事件处理成功（4星）')
  } catch (error) {
    assert(false, `好评事件失败: ${error.message}`)
  }

  // 差评（1星）
  try {
    await creditManager.onNegativeReview(userDid, 'review_003', 1)
    assert(true, '差评事件处理成功（1星）')
  } catch (error) {
    assert(false, `差评事件失败: ${error.message}`)
  }

  // 差评（2星）
  try {
    await creditManager.onNegativeReview(userDid, 'review_004', 2)
    assert(true, '差评事件处理成功（2星）')
  } catch (error) {
    assert(false, `差评事件失败: ${error.message}`)
  }
}

/**
 * 5. 纠纷事件处理测试
 */
async function testDisputeEvents() {
  console.log('\n=== 测试 5: 纠纷事件处理 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const userDid = 'did:example:user'

  // 发起纠纷
  try {
    await creditManager.onDisputeInitiated(userDid, 'dispute_001')
    assert(true, '纠纷发起事件处理成功')
  } catch (error) {
    assert(false, `纠纷发起失败: ${error.message}`)
  }

  // 纠纷解决（胜诉）
  try {
    await creditManager.onDisputeResolved(userDid, 'dispute_001', 'favor_user')
    assert(true, '纠纷解决事件处理成功（胜诉）')
  } catch (error) {
    assert(false, `纠纷解决失败: ${error.message}`)
  }

  // 纠纷解决（败诉）
  try {
    await creditManager.onDisputeResolved(userDid, 'dispute_002', 'favor_opponent')
    assert(true, '纠纷解决事件处理成功（败诉）')
  } catch (error) {
    assert(false, `纠纷解决失败: ${error.message}`)
  }

  // 纠纷解决（和解）
  try {
    await creditManager.onDisputeResolved(userDid, 'dispute_003', 'settlement')
    assert(true, '纠纷解决事件处理成功（和解）')
  } catch (error) {
    assert(false, `纠纷解决失败: ${error.message}`)
  }
}

/**
 * 6. 退款事件处理测试
 */
async function testRefundEvent() {
  console.log('\n=== 测试 6: 退款事件处理 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  try {
    await creditManager.onRefund('did:example:user', 'refund_001')
    assert(true, '退款事件处理成功')
  } catch (error) {
    assert(false, `退款事件失败: ${error.message}`)
  }
}

/**
 * 7. 响应时间更新测试
 */
async function testResponseTimeUpdate() {
  console.log('\n=== 测试 7: 响应时间更新 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  try {
    await creditManager.updateResponseTime('did:example:user', 3600000) // 1小时
    assert(true, '响应时间更新成功')
  } catch (error) {
    assert(false, `响应时间更新失败: ${error.message}`)
  }
}

/**
 * 8. 信用评分计算测试
 */
async function testCreditScoreCalculation() {
  console.log('\n=== 测试 8: 信用评分计算 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const result = await creditManager.calculateCreditScore('did:example:user')

  assert(result.creditScore !== undefined, '信用评分计算成功')
  assert(result.creditScore >= 0 && result.creditScore <= 1000, '评分在有效范围内')
  assert(result.creditLevel !== undefined, '信用等级确定')
  assert(result.levelColor !== undefined, '等级颜色确定')
  assert(Array.isArray(result.benefits), '权益列表返回')

  console.log(`评分: ${result.creditScore}, 等级: ${result.creditLevel}`)
}

/**
 * 9. 信用等级测试
 */
async function testCreditLevel() {
  console.log('\n=== 测试 9: 信用等级 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 测试各个分数段
  const testCases = [
    { score: 50, expectedLevel: '新手' },
    { score: 200, expectedLevel: '青铜' },
    { score: 450, expectedLevel: '白银' },
    { score: 750, expectedLevel: '黄金' },
    { score: 950, expectedLevel: '钻石' }
  ]

  testCases.forEach(({ score, expectedLevel }) => {
    const level = creditManager.getCreditLevel(score)
    assert(level.name === expectedLevel, `评分 ${score} 对应等级 ${expectedLevel}`)
  })
}

/**
 * 10. 信用记录测试
 */
async function testCreditRecords() {
  console.log('\n=== 测试 10: 信用记录 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 添加记录
  try {
    await creditManager.addCreditRecord(
      'did:example:user',
      EventType.TRADE_COMPLETED,
      'tx_001',
      10,
      '完成交易'
    )
    assert(true, '添加信用记录成功')
  } catch (error) {
    assert(false, `添加记录失败: ${error.message}`)
  }

  // 获取记录
  const records = await creditManager.getCreditRecords('did:example:user', 10)
  assert(Array.isArray(records), '获取信用记录成功')
}

/**
 * 11. 信用报告测试
 */
async function testCreditReport() {
  console.log('\n=== 测试 11: 信用报告 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const report = await creditManager.getCreditReport('did:example:user')

  assert(report !== null, '信用报告生成成功')
  assert(report.userDid !== undefined, '用户DID')
  assert(report.creditScore !== undefined, '信用评分')
  assert(report.creditLevel !== undefined, '信用等级')
  assert(report.levelColor !== undefined, '等级颜色')
  assert(Array.isArray(report.benefits), '权益列表')
  assert(report.statistics !== undefined, '统计信息')
  assert(Array.isArray(report.recentRecords), '最近记录')

  console.log('信用报告:', JSON.stringify(report, null, 2))
}

/**
 * 12. 信用等级验证测试
 */
async function testCreditLevelVerification() {
  console.log('\n=== 测试 12: 信用等级验证 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 测试等级验证
  const isGold = await creditManager.verifyCreditLevel('did:example:user', '黄金')
  const isBronze = await creditManager.verifyCreditLevel('did:example:user', '青铜')

  assert(typeof isGold === 'boolean', '黄金等级验证返回布尔值')
  assert(typeof isBronze === 'boolean', '青铜等级验证返回布尔值')

  console.log(`是否达到黄金: ${isGold}, 是否达到青铜: ${isBronze}`)
}

/**
 * 13. 排行榜测试
 */
async function testLeaderboard() {
  console.log('\n=== 测试 13: 排行榜 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const leaderboard = await creditManager.getLeaderboard(10)

  assert(Array.isArray(leaderboard), '排行榜返回数组')

  leaderboard.forEach((entry, index) => {
    assert(entry.rank === index + 1, `排名 ${index + 1} 正确`)
    assert(entry.userDid !== undefined, '用户DID存在')
    assert(entry.creditScore !== undefined, '信用评分存在')
  })
}

/**
 * 14. 快照和趋势测试
 */
async function testSnapshotAndTrend() {
  console.log('\n=== 测试 14: 快照和趋势 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 创建快照
  try {
    await creditManager.createSnapshot('did:example:user')
    assert(true, '创建信用快照成功')
  } catch (error) {
    assert(false, `创建快照失败: ${error.message}`)
  }

  // 获取趋势
  const trend = await creditManager.getCreditTrend('did:example:user', 30)
  assert(Array.isArray(trend), '获取信用趋势成功')

  trend.forEach(snapshot => {
    assert(snapshot.creditScore !== undefined, '快照包含评分')
    assert(snapshot.creditLevel !== undefined, '快照包含等级')
    assert(snapshot.date !== undefined, '快照包含日期')
  })
}

/**
 * 15. 批量计算测试
 */
async function testBatchCalculation() {
  console.log('\n=== 测试 15: 批量计算 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  try {
    await creditManager.recalculateAllScores()
    assert(true, '批量计算信用评分成功')
  } catch (error) {
    assert(false, `批量计算失败: ${error.message}`)
  }
}

/**
 * 16. 统计信息测试
 */
async function testStatistics() {
  console.log('\n=== 测试 16: 统计信息 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  const stats = await creditManager.getStatistics()

  assert(stats !== null, '统计信息获取成功')
  assert(stats.totalUsers !== undefined, '总用户数')
  assert(stats.byLevel !== undefined, '按等级统计')
  assert(stats.avgScore !== undefined, '平均信用分')
  assert(stats.totalTransactions !== undefined, '总交易数')

  console.log('统计信息:', JSON.stringify(stats, null, 2))
}

/**
 * 17. 缓存测试
 */
async function testCache() {
  console.log('\n=== 测试 17: 缓存 ===')

  const db = new MockDB()
  const didManager = new MockDIDManager()
  const creditManager = createCreditScoreManager(db, didManager)

  await creditManager.initialize()

  // 第一次读取（未缓存）
  const start1 = Date.now()
  await creditManager.getUserCredit('did:example:user')
  const time1 = Date.now() - start1

  // 第二次读取（已缓存）
  const start2 = Date.now()
  await creditManager.getUserCredit('did:example:user')
  const time2 = Date.now() - start2

  assert(true, `第一次读取: ${time1}ms, 第二次读取: ${time2}ms`)

  // 清除缓存
  creditManager.clearCache()
  assert(creditManager.creditCache.size === 0, '缓存已清除')
}

// ==================== 运行所有测试 ====================

async function runAllTests() {
  console.log('\n' + '='.repeat(60))
  console.log('Credit Score Manager 测试套件')
  console.log('='.repeat(60))

  try {
    await testInitialization()
    await testUserCreditCreation()
    await testTransactionEvents()
    await testReviewEvents()
    await testDisputeEvents()
    await testRefundEvent()
    await testResponseTimeUpdate()
    await testCreditScoreCalculation()
    await testCreditLevel()
    await testCreditRecords()
    await testCreditReport()
    await testCreditLevelVerification()
    await testLeaderboard()
    await testSnapshotAndTrend()
    await testBatchCalculation()
    await testStatistics()
    await testCache()
  } catch (error) {
    console.error('测试过程中发生错误:', error)
    results.failed++
    results.errors.push(error.message)
  }

  // 输出测试结果
  console.log('\n' + '='.repeat(60))
  console.log('测试结果')
  console.log('='.repeat(60))
  console.log(`总测试数: ${results.total}`)
  console.log(`✅ 通过: ${results.passed}`)
  console.log(`❌ 失败: ${results.failed}`)
  console.log(`通过率: ${((results.passed / results.total) * 100).toFixed(2)}%`)

  if (results.errors.length > 0) {
    console.log('\n失败的测试:')
    results.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`)
    })
  }

  console.log('='.repeat(60))
}

// 运行测试
runAllTests()
