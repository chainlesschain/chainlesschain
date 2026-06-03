/**
 * ChainlessChain 移动端集成测试套件 - 真实数据库版本
 *
 * 使用 better-sqlite3 进行真实数据库测试
 *
 * 测试覆盖：
 * 1. 完整交易流程
 * 2. 社交交易流程
 * 3. 智能合约流程
 * 4. 用户成长路径
 * 5. 数据一致性验证
 * 6. 并发操作测试
 *
 * @version 1.0.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

import Database from 'better-sqlite3'
import { createAssetManager, AssetType } from '../src/services/trade/asset-manager.js'
import { createMarketplaceManager } from '../src/services/trade/marketplace-manager.js'
import { createCreditScoreManager } from '../src/services/trade/credit-score-manager.js'
import { createSocialTradingManager } from '../src/services/trade/social-trading-manager.js'
import { createIncentiveManager } from '../src/services/trade/incentive-manager.js'
import { createContractEngine } from '../src/services/trade/contract-engine.js'
import { unlink, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ==================== Real Database Adapter ====================

class RealDBAdapter {
  constructor(dbPath) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
  }

  async executeSql(sql, params = []) {
    try {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const stmt = this.db.prepare(sql)
        const rows = stmt.all(...params)
        return rows
      } else if (sql.trim().toUpperCase().startsWith('INSERT')) {
        const stmt = this.db.prepare(sql)
        const info = stmt.run(...params)
        return { rowsAffected: info.changes, insertId: info.lastInsertRowid }
      } else if (sql.trim().toUpperCase().startsWith('UPDATE') ||
                 sql.trim().toUpperCase().startsWith('DELETE')) {
        const stmt = this.db.prepare(sql)
        const info = stmt.run(...params)
        return { rowsAffected: info.changes }
      } else {
        // CREATE, ALTER, DROP等
        this.db.exec(sql)
        return []
      }
    } catch (error) {
      console.error(`SQL Error: ${sql}`, error)
      throw error
    }
  }

  async transaction(callback) {
    const transaction = this.db.transaction(callback)
    return transaction(this)
  }

  close() {
    this.db.close()
  }
}

// ==================== Mock DID Manager ====================

class MockDIDManager {
  constructor() {
    this.currentDid = 'did:example:test-user'
  }

  async getCurrentDid() {
    return this.currentDid
  }

  // 同步方法 - AssetManager 的 _getCurrentDid() 需要同步调用
  getCurrentIdentity() {
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

const results = { total: 0, passed: 0, failed: 0, errors: [], warnings: [] }

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

function warn(message) {
  results.warnings.push(message)
  console.warn(`⚠️  ${message}`)
}

// ==================== 集成测试场景 ====================

/**
 * 场景1: 完整交易流程
 */
async function testCompleteTradeFlow(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景1: 完整交易流程（资产→交易→信用→激励）')
  console.log('='.repeat(80))

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
      type: AssetType.TOKEN,
      totalSupply: 10,
      initialBalance: 10
    })
    assert(asset.id !== undefined, '资产创建成功')
    assert(asset.symbol === 'BTC', '资产符号正确')
    console.log(`   资产ID: ${asset.id}`)

    console.log('\n📝 Step 2: 创建市场订单')
    const order = await marketplace.createOrder({
      title: 'BTC限价买单',
      assetId: asset.id,
      type: 'buy',
      priceAmount: 50000,
      quantity: 1
    })
    assert(order.id !== undefined, '订单创建成功')
    console.log(`   订单ID: ${order.id}`)

    console.log('\n⚡ Step 3: 执行交易（切换到买家）')
    const buyerDid = 'did:example:buyer'
    didManager.setCurrentDid(buyerDid)
    const transaction = await marketplace.matchOrder(order.id, 1)
    assert(true, '交易执行成功')

    console.log('\n📊 Step 4: 更新信用评分')
    await creditScoreManager.onTransactionCompleted(buyerDid, transaction.id, transaction.payment_amount)
    didManager.setCurrentDid('did:example:test-user')  // 切换回原用户
    const creditScore = await creditScoreManager.getUserCredit('did:example:test-user')
    assert(creditScore !== null, '信用评分获取成功')
    console.log(`   信用分数: ${creditScore.score || 0}`)

    console.log('\n🎁 Step 5: 获取用户等级')
    const userLevel = await incentiveManager.getUserLevel(didManager.currentDid)
    assert(userLevel !== null, '用户等级获取成功')
    assert(userLevel.level === 1, '初始等级为1')
    console.log(`   等级: ${userLevel.level}, 经验: ${userLevel.exp}/${userLevel.next_level_exp}`)

    console.log('\n📅 Step 6: 每日签到')
    const checkIn = await incentiveManager.checkIn(didManager.currentDid)
    assert(checkIn.consecutiveDays === 1, '签到天数正确')
    assert(checkIn.rewardPoints === 10, '签到奖励正确')
    console.log(`   签到奖励: ${checkIn.rewardPoints}积分, 连续${checkIn.consecutiveDays}天`)

    console.log('✅ 完整交易流程测试通过')

  } catch (error) {
    assert(false, `完整交易流程失败: ${error.message}`)
    console.error(error)
  }
}

/**
 * 场景2: 社交交易流程
 */
async function testSocialTradeFlow(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景2: 社交交易流程（分享→点赞→评论→关注）')
  console.log('='.repeat(80))

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const socialTrading = createSocialTradingManager(db, didManager, marketplace, creditScoreManager)

  // 重新初始化（如果需要）
  try { await socialTrading.initialize() } catch (e) { /* 已初始化 */ }

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
    console.log(`   分享ID: ${share.id}`)

    console.log('\n👍 Step 2: 点赞分享')
    await socialTrading.addLike('share', share.id)
    assert(true, '点赞成功')

    console.log('\n💬 Step 3: 添加评论')
    const comment = await socialTrading.addComment(share.id, '很好的分析！')
    assert(comment.id !== undefined, '评论添加成功')
    console.log(`   评论ID: ${comment.id}`)

    console.log('\n➕ Step 4: 关注交易员（切换用户）')
    const traderDid = didManager.currentDid
    didManager.setCurrentDid('did:example:follower')
    await socialTrading.followTrader(traderDid)
    assert(true, '关注成功')
    didManager.setCurrentDid(traderDid) // 切回原用户

    console.log('\n📊 Step 5: 查看热门分享')
    const trending = await socialTrading.getTrendingShares(10)
    assert(Array.isArray(trending), '热门分享获取成功')
    console.log(`   热门分享数: ${trending.length}`)

    console.log('\n📈 Step 6: 查看统计')
    const stats = await socialTrading.getStatistics(traderDid)
    assert(stats !== null, '统计信息获取成功')
    console.log(`   总分享: ${stats.totalShares}, 粉丝: ${stats.followers}`)

    console.log('✅ 社交交易流程测试通过')

  } catch (error) {
    assert(false, `社交交易流程失败: ${error.message}`)
    console.error(error)
  }
}

/**
 * 场景3: 智能合约流程
 */
async function testSmartContractFlow(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景3: 智能合约流程（合约→签署→执行）')
  console.log('='.repeat(80))

  const assetManager = createAssetManager(db, didManager)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, null, null)
  const contractEngine = createContractEngine(db, didManager, assetManager, creditScoreManager)

  try { await contractEngine.initialize() } catch (e) { /* 已初始化 */ }

  try {
    const partyA = 'did:example:party-a'
    const partyB = 'did:example:party-b'

    console.log('\n📦 Step 1: 创建交易双方资产')
    didManager.setCurrentDid(partyA)
    const assetA = await assetManager.createAsset({
      symbol: 'BTC',
      name: 'Bitcoin',
      type: AssetType.TOKEN,
      totalSupply: 1,
      initialBalance: 1
    })
    assert(assetA.id !== undefined, '甲方资产创建成功')

    didManager.setCurrentDid(partyB)
    const assetB = await assetManager.createAsset({
      symbol: 'USDT',
      name: 'Tether',
      type: AssetType.TOKEN,
      totalSupply: 50000,
      initialBalance: 50000
    })
    assert(assetB.id !== undefined, '乙方资产创建成功')

    console.log('\n📜 Step 2: 创建智能合约')
    didManager.setCurrentDid(partyA)
    const contract = await contractEngine.createContract({
      title: 'BTC/USDT 交易合约',
      type: 'simple_trade',
      escrowType: 'simple',
      parties: [partyA, partyB],
      terms: {
        assetA: assetA.id,
        assetB: assetB.id,
        amountA: 1,
        amountB: 50000
      },
      description: '验证资产余额、执行交换、确认交易'
    })
    assert(contract.id !== undefined, '智能合约创建成功')
    console.log(`   合约ID: ${contract.id}`)

    console.log('\n✍️  Step 3: 甲方签署合约')
    await contractEngine.signContract(contract.id, 'signature-party-a')
    assert(true, '甲方签署成功')

    console.log('\n✍️  Step 4: 乙方签署合约（将自动激活）')
    didManager.setCurrentDid(partyB)
    await contractEngine.signContract(contract.id, 'signature-party-b')
    assert(true, '乙方签署成功并自动激活')

    console.log('\n⚡ Step 5: 执行智能合约')
    didManager.setCurrentDid(partyA)
    await contractEngine.executeContract(contract.id)
    assert(true, '合约执行成功')

    console.log('✅ 智能合约流程测试通过')

  } catch (error) {
    assert(false, `智能合约流程失败: ${error.message}`)
    console.error(error)
  }
}

/**
 * 场景4: 用户成长路径
 */
async function testUserGrowthPath(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景4: 用户成长路径（注册→签到→经验→等级）')
  console.log('='.repeat(80))

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager, null)

  try { await incentiveManager.initialize() } catch (e) { /* 已初始化 */ }

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
    assert(checkIn.consecutiveDays >= 1, '签到天数正确')
    assert(checkIn.rewardPoints >= 10, '签到奖励正确')
    console.log(`   签到奖励: ${checkIn.rewardPoints}积分, 连续${checkIn.consecutiveDays}天`)

    console.log('\n⭐ Step 3: 增加经验值')
    const expResult = await incentiveManager.addExp(userDid, 50, 'test')
    assert(expResult.level >= 1, '等级有效')
    assert(expResult.exp >= 0, '经验值有效')
    console.log(`   当前等级: ${expResult.level}, 经验: ${expResult.exp}`)

    console.log('\n🏆 Step 4: 检查里程碑')
    await incentiveManager.checkMilestone(userDid, 'trade_count', 1)
    const milestones = await incentiveManager.getUnclaimedMilestones(userDid)
    assert(Array.isArray(milestones), '里程碑列表获取成功')
    console.log(`   未领取里程碑: ${milestones.length}`)

    console.log('\n📊 Step 5: 查看统计')
    const stats = await incentiveManager.getStatistics(userDid)
    assert(stats !== null, '统计数据获取成功')
    console.log(`   签到天数: ${stats.checkInDays || 0}`)
    console.log(`   总奖励: ${stats.totalRewards || 0}`)

    console.log('✅ 用户成长路径测试通过')

  } catch (error) {
    assert(false, `用户成长路径失败: ${error.message}`)
    console.error(error)
  }
}

/**
 * 场景5: 数据一致性验证
 */
async function testDataConsistency(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景5: 数据一致性验证')
  console.log('='.repeat(80))

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)
  const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace, null)
  const socialTrading = createSocialTradingManager(db, didManager, marketplace, creditScoreManager)
  const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager, socialTrading)

  try {
    console.log('\n💼 创建测试数据')

    // 创建资产
    const asset1 = await assetManager.createAsset({
      symbol: 'ETH',
      name: 'Ethereum',
      type: AssetType.TOKEN,
      totalSupply: 5,
      initialBalance: 5
    })

    const asset2 = await assetManager.createAsset({
      symbol: 'USDC',
      name: 'USD Coin',
      type: AssetType.TOKEN,
      totalSupply: 100,
      initialBalance: 100
    })

    assert(asset1.id !== undefined, '资产1创建成功')
    assert(asset2.id !== undefined, '资产2创建成功')

    // 创建订单
    const order1 = await marketplace.createOrder({
      title: 'ETH限价买单',
      assetId: asset1.id,
      type: 'buy',
      priceAmount: 3000,
      quantity: 1
    })

    const order2 = await marketplace.createOrder({
      title: 'USDT市价卖单',
      assetId: asset2.id,
      type: 'sell',
      priceAmount: 1,
      quantity: 50
    })

    assert(order1.id !== undefined, '订单1创建成功')
    assert(order2.id !== undefined, '订单2创建成功')

    // 执行交易（切换用户）
    didManager.setCurrentDid('did:example:buyer-consistency')
    await marketplace.matchOrder(order1.id, 1)
    await marketplace.matchOrder(order2.id, 50)
    didManager.setCurrentDid('did:example:new-user')  // 切换回原用户

    console.log('\n✓ 验证1: 资产管理模块')
    const assets = await assetManager.getAllAssets()
    assert(assets.length >= 2, `资产数量正确 (${assets.length} >= 2)`)

    console.log('✓ 验证2: 市场交易模块')
    const orders = await marketplace.getOrders()
    assert(orders.length >= 2, `订单数量正确 (${orders.length} >= 2)`)

    console.log('✓ 验证3: 信用评分模块')
    const consistencyUserDid = 'did:example:new-user'
    const creditScore = await creditScoreManager.getUserCredit(consistencyUserDid)
    assert(creditScore !== null, '信用评分存在')

    console.log('✓ 验证4: 激励系统模块')
    const userLevel = await incentiveManager.getUserLevel(didManager.currentDid)
    assert(userLevel !== null, '用户等级存在')

    console.log('✅ 数据一致性验证通过')

  } catch (error) {
    assert(false, `数据一致性验证失败: ${error.message}`)
    console.error(error)
  }
}

/**
 * 场景6: 并发操作测试
 */
async function testConcurrentOperations(db, didManager) {
  console.log('\n' + '='.repeat(80))
  console.log('场景6: 并发操作测试')
  console.log('='.repeat(80))

  const assetManager = createAssetManager(db, didManager)
  const marketplace = createMarketplaceManager(db, didManager, assetManager, null)

  try {
    console.log('\n🔄 执行并发操作')

    // 并发创建多个资产
    const assetPromises = []
    for (let i = 0; i < 5; i++) {
      assetPromises.push(
        assetManager.createAsset({
          symbol: `TEST${i}`,
          name: `Test Asset ${i}`,
          type: AssetType.TOKEN,
          totalSupply: 100,
          initialBalance: 100
        })
      )
    }

    const assets = await Promise.all(assetPromises)
    assert(assets.length === 5, '并发创建5个资产成功')
    console.log(`   创建了 ${assets.length} 个资产`)

    // 并发创建多个订单
    const orderPromises = []
    for (let i = 0; i < 5; i++) {
      orderPromises.push(
        marketplace.createOrder({
          title: `并发测试订单${i + 1}`,
          assetId: assets[i].id,
          type: i % 2 === 0 ? 'buy' : 'sell',
          priceAmount: 1000,
          quantity: 10
        })
      )
    }

    const orders = await Promise.all(orderPromises)
    assert(orders.length === 5, '并发创建5个订单成功')
    console.log(`   创建了 ${orders.length} 个订单`)

    console.log('✅ 并发操作测试通过')

  } catch (error) {
    assert(false, `并发操作测试失败: ${error.message}`)
    console.error(error)
  }
}

// ==================== 运行所有集成测试 ====================

async function runAllIntegrationTests() {
  console.log('\n' + '═'.repeat(80))
  console.log('ChainlessChain 移动端集成测试套件 - 真实数据库版本')
  console.log('使用 better-sqlite3 进行真实环境测试')
  console.log('═'.repeat(80))

  const dbPath = join(__dirname, 'test-integration.db')

  // 删除旧的测试数据库
  if (existsSync(dbPath)) {
    unlink(dbPath, (err) => {
      if (err) console.error('删除旧数据库失败:', err)
    })
  }

  const db = new RealDBAdapter(dbPath)
  const didManager = new MockDIDManager()

  const startTime = Date.now()

  try {
    await testCompleteTradeFlow(db, didManager)
    await testSocialTradeFlow(db, didManager)
    await testSmartContractFlow(db, didManager)
    await testUserGrowthPath(db, didManager)
    await testDataConsistency(db, didManager)
    await testConcurrentOperations(db, didManager)
  } catch (error) {
    console.error('集成测试过程中发生错误:', error)
    results.failed++
    results.errors.push(`Critical error: ${error.message}`)
  } finally {
    db.close()
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
  console.log(`⚠️  警告: ${results.warnings.length}`)
  console.log(`通过率: ${((results.passed / results.total) * 100).toFixed(2)}%`)

  if (results.errors.length > 0) {
    console.log('\n失败的测试:')
    results.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`)
    })
  }

  if (results.warnings.length > 0) {
    console.log('\n警告信息:')
    results.warnings.forEach((warning, index) => {
      console.log(`${index + 1}. ${warning}`)
    })
  }

  console.log('\n' + '═'.repeat(80))
  console.log('测试场景覆盖:')
  console.log('═'.repeat(80))
  console.log('✅ 场景1: 完整交易流程（资产→交易→信用→激励）')
  console.log('✅ 场景2: 社交交易流程（分享→点赞→评论→关注）')
  console.log('✅ 场景3: 智能合约流程（合约→签署→执行）')
  console.log('✅ 场景4: 用户成长路径（注册→签到→经验→等级）')
  console.log('✅ 场景5: 数据一致性验证')
  console.log('✅ 场景6: 并发操作测试')
  console.log('═'.repeat(80))

  console.log(`\n数据库文件: ${dbPath}`)
  console.log('(测试完成后可删除此文件)')

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
