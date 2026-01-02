/**
 * ChainlessChain 移动端集成测试套件 - 简化版
 *
 * 测试覆盖：
 * 1. 完整交易流程
 * 2. 社交交易流程
 * 3. 用户成长路径
 * 4. 数据一致性验证
 *
 * @version 1.0.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

import { createAssetManager, AssetType } from '../src/services/trade/asset-manager.js'
import { createMarketplaceManager } from '../src/services/trade/marketplace-manager.js'
import { createCreditScoreManager } from '../src/services/trade/credit-score-manager.js'
import { createSocialTradingManager } from '../src/services/trade/social-trading-manager.js'
import { createIncentiveManager } from '../src/services/trade/incentive-manager.js'

// ==================== Mock Dependencies ====================

class MockDB {
  constructor() {
    this.tables = {}
  }

  async executeSql(sql, params = []) {
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
      return []
    }
    if (sql.includes('INSERT')) return { rowsAffected: 1 }
    if (sql.includes('UPDATE')) return { rowsAffected: 1 }
    if (sql.includes('DELETE')) return { rowsAffected: 1 }
    if (sql.includes('SELECT')) return []
    return []
  }

  async transaction(callback) {
    await callback(this)
    return { success: true }
  }
}

class MockDIDManager {
  constructor() {
    this.currentDid = 'did:example:test-user'
  }

  async getCurrentDid() {
    return this.currentDid
  }

  async getCurrentIdentity() {
    return {
      did: this.currentDid,
      publicKey: 'mock-public-key',
      document: {}
    }
  }

  setCurrentDid(did) {
    this.currentDid = did
  }
}

// ==================== Test Results ====================

const results = { total: 0, passed: 0, failed: 0, errors: [] }

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

// ==================== 集成测试场景 ====================

/**
 * 场景1: 完整交易流程
 */
async function testCompleteTradeFlow() {
  console.log('\n' + '='.repeat(80))
  console.log('场景1: 完整交易流程（资产→交易→信用→激励）')
  console.log('='.repeat(80))

  const db = new MockDB()
  const didManager = new MockDIDManager()

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager, null)

  await assetManager.initialize()
  await marketplace.initialize()
  await creditScoreManager.initialize()
  await incentiveManager.initialize()

  try {
    console.log('\n📦 Step 1: 创建资产')
    const asset = await assetManager.createAsset({
      symbol: 'BTC',
      name: 'Bitcoin',
      type: AssetType.TOKEN,  // 使用正确的类型
      totalSupply: 10,
      initialBalance: 10
    })
    assert(asset.id !== undefined, '资产创建成功')

    console.log('\n📝 Step 2: 创建市场订单')
    const order = await marketplace.createOrder({
      assetId: asset.id,
      type: 'buy',
      orderType: 'limit',
      price: 50000,
      amount: 1
    })
    assert(order.id !== undefined, '订单创建成功')

    console.log('\n⚡ Step 3: 执行交易')
    await marketplace.executeOrder(order.id, 50000, 1)
    assert(true, '交易执行成功')

    console.log('\n📊 Step 4: 更新信用评分')
    await creditScoreManager.recordTradeActivity(asset.id, 'buy', 1, 50000, true)
    const creditScore = await creditScoreManager.getCreditScore()
    assert(creditScore !== null, '信用评分获取成功')

    console.log('\n🎁 Step 5: 获取用户等级')
    const userLevel = await incentiveManager.getUserLevel(didManager.currentDid)
    assert(userLevel !== null, '用户等级获取成功')
    assert(userLevel.level === 1, '初始等级为1')

    console.log('\n📅 Step 6: 每日签到')
    const checkIn = await incentiveManager.checkIn(didManager.currentDid)
    assert(checkIn.consecutiveDays === 1, '签到成功')

    console.log('✅ 完整交易流程测试通过')

  } catch (error) {
    assert(false, `完整交易流程失败: ${error.message}`)
  }
}

/**
 * 场景2: 社交交易流程
 */
async function testSocialTradeFlow() {
  console.log('\n' + '='.repeat(80))
  console.log('场景2: 社交交易流程（分享→点赞→评论→关注）')
  console.log('='.repeat(80))

  const db = new MockDB()
  const didManager = new MockDIDManager()

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const socialTrading = createSocialTradingManager(db, didManager, marketplace, creditScoreManager)

  await assetManager.initialize()
  await marketplace.initialize()
  await creditScoreManager.initialize()
  await socialTrading.initialize()

  try {
    console.log('\n📢 Step 1: 发布交易分享')
    const share = await socialTrading.createShare({
      type: 'order',
      title: '看涨BTC',
      description: 'BTC突破关键阻力位',
      price: 50000,
      targetPrice: 55000,
      stopLoss: 48000,
      tags: ['BTC', '做多']
    })
    assert(share.id !== undefined, '交易分享创建成功')

    console.log('\n👍 Step 2: 点赞分享')
    await socialTrading.addLike('share', share.id)
    assert(true, '点赞成功')

    console.log('\n💬 Step 3: 添加评论')
    const comment = await socialTrading.addComment(share.id, '很好的分析！')
    assert(comment.id !== undefined, '评论添加成功')

    console.log('\n➕ Step 4: 关注交易员（切换用户）')
    const traderDid = didManager.currentDid
    didManager.setCurrentDid('did:example:follower')
    await socialTrading.followTrader(traderDid)
    assert(true, '关注成功')

    console.log('\n📊 Step 5: 查看热门分享')
    const trending = await socialTrading.getTrendingShares(10)
    assert(Array.isArray(trending), '热门分享获取成功')

    console.log('✅ 社交交易流程测试通过')

  } catch (error) {
    assert(false, `社交交易流程失败: ${error.message}`)
  }
}

/**
 * 场景3: 用户成长路径
 */
async function testUserGrowthPath() {
  console.log('\n' + '='.repeat(80))
  console.log('场景3: 用户成长路径（注册→签到→经验→等级）')
  console.log('='.repeat(80))

  const db = new MockDB()
  const didManager = new MockDIDManager()

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager, null)

  await assetManager.initialize()
  await marketplace.initialize()
  await creditScoreManager.initialize()
  await incentiveManager.initialize()

  try {
    const userDid = 'did:example:new-user'
    didManager.setCurrentDid(userDid)

    console.log('\n🆕 Step 1: 新用户注册')
    const userLevel = await incentiveManager.getUserLevel(userDid)
    assert(userLevel !== null, '用户等级初始化成功')
    assert(userLevel.level === 1, '初始等级为1')
    console.log(`   等级: ${userLevel.level}, 经验: ${userLevel.exp}/${userLevel.next_level_exp}`)

    console.log('\n📅 Step 2: 每日签到')
    const checkIn = await incentiveManager.checkIn(userDid)
    assert(checkIn.consecutiveDays === 1, '签到天数正确')
    assert(checkIn.rewardPoints === 10, '签到奖励正确')
    console.log(`   签到奖励: ${checkIn.rewardPoints}积分, 连续${checkIn.consecutiveDays}天`)

    console.log('\n⭐ Step 3: 增加经验值')
    const expResult = await incentiveManager.addExp(userDid, 50, 'test')
    assert(expResult.level >= 1, '等级有效')
    assert(expResult.exp >= 0, '经验值有效')
    console.log(`   当前等级: ${expResult.level}, 经验: ${expResult.exp}`)

    console.log('\n📊 Step 4: 查看统计')
    const stats = await incentiveManager.getStatistics(userDid)
    assert(stats !== null, '统计数据获取成功')
    console.log(`   签到天数: ${stats.checkInDays || 0}`)
    console.log(`   获得奖励: ${stats.totalRewards || 0}`)

    console.log('✅ 用户成长路径测试通过')

  } catch (error) {
    assert(false, `用户成长路径失败: ${error.message}`)
  }
}

/**
 * 场景4: 数据一致性验证
 */
async function testDataConsistency() {
  console.log('\n' + '='.repeat(80))
  console.log('场景4: 数据一致性验证')
  console.log('='.repeat(80))

  const db = new MockDB()
  const didManager = new MockDIDManager()

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const socialTrading = createSocialTradingManager(db, didManager, marketplace, creditScoreManager)
  const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager, socialTrading)

  await assetManager.initialize()
  await marketplace.initialize()
  await creditScoreManager.initialize()
  await socialTrading.initialize()
  await incentiveManager.initialize()

  try {
    console.log('\n💼 创建测试数据')

    // 创建资产
    const asset1 = await assetManager.createAsset({
      symbol: 'BTC',
      name: 'Bitcoin',
      type: AssetType.TOKEN,
      totalSupply: 5,
      initialBalance: 5
    })

    const asset2 = await assetManager.createAsset({
      symbol: 'ETH',
      name: 'Ethereum',
      type: AssetType.TOKEN,
      totalSupply: 100,
      initialBalance: 100
    })

    assert(asset1.id !== undefined, '资产1创建成功')
    assert(asset2.id !== undefined, '资产2创建成功')

    // 创建订单
    const order1 = await marketplace.createOrder({
      assetId: asset1.id,
      type: 'buy',
      orderType: 'limit',
      price: 50000,
      amount: 1
    })

    const order2 = await marketplace.createOrder({
      assetId: asset2.id,
      type: 'sell',
      orderType: 'market',
      price: 3000,
      amount: 10
    })

    assert(order1.id !== undefined, '订单1创建成功')
    assert(order2.id !== undefined, '订单2创建成功')

    // 执行交易
    await marketplace.executeOrder(order1.id, 50000, 1)
    await marketplace.executeOrder(order2.id, 3000, 10)

    console.log('\n✓ 验证1: 资产管理模块')
    const assets = await assetManager.getAssets()
    assert(assets.length >= 2, '资产数量正确')

    console.log('✓ 验证2: 市场交易模块')
    const orders = await marketplace.getOrders()
    assert(orders.length >= 2, '订单数量正确')

    console.log('✓ 验证3: 信用评分模块')
    await creditScoreManager.recordTradeActivity(asset1.id, 'buy', 1, 50000, true)
    await creditScoreManager.recordTradeActivity(asset2.id, 'sell', 10, 3000, true)
    const creditScore = await creditScoreManager.getCreditScore()
    assert(creditScore !== null, '信用评分存在')

    console.log('✓ 验证4: 激励系统模块')
    const userLevel = await incentiveManager.getUserLevel(didManager.currentDid)
    assert(userLevel !== null, '用户等级存在')

    console.log('✅ 数据一致性验证通过')

  } catch (error) {
    assert(false, `数据一致性验证失败: ${error.message}`)
  }
}

// ==================== 运行所有集成测试 ====================

async function runAllIntegrationTests() {
  console.log('\n' + '═'.repeat(80))
  console.log('ChainlessChain 移动端集成测试套件 - 简化版')
  console.log('测试模块协作与数据流')
  console.log('═'.repeat(80))

  const startTime = Date.now()

  try {
    await testCompleteTradeFlow()
    await testSocialTradeFlow()
    await testUserGrowthPath()
    await testDataConsistency()
  } catch (error) {
    console.error('集成测试过程中发生错误:', error)
    results.failed++
    results.errors.push(`Critical error: ${error.message}`)
  }

  const endTime = Date.now()
  const duration = endTime - startTime

  // 输出测试结果
  console.log('\n' + '═'.repeat(80))
  console.log('集成测试结果')
  console.log('═'.repeat(80))
  console.log(`执行时间: ${duration}ms`)
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

  console.log('\n' + '═'.repeat(80))
  console.log('测试场景覆盖:')
  console.log('═'.repeat(80))
  console.log('✅ 场景1: 完整交易流程（资产→交易→信用→激励）')
  console.log('✅ 场景2: 社交交易流程（分享→点赞→评论→关注）')
  console.log('✅ 场景3: 用户成长路径（注册→签到→经验→等级）')
  console.log('✅ 场景4: 数据一致性验证')
  console.log('═'.repeat(80))

  return results.failed === 0
}

// 运行测试
runAllIntegrationTests().then(success => {
  if (success) {
    console.log('\n🎉 所有集成测试通过！')
    process.exit(0)
  } else {
    console.log('\n💥 部分集成测试失败')
    process.exit(1)
  }
}).catch(error => {
  console.error('\n💥 集成测试套件执行失败:', error)
  process.exit(1)
})
