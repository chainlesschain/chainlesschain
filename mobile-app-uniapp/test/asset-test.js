/**
 * 资产管理系统测试套件
 * Asset Manager Test Suite
 *
 * 测试覆盖:
 * - 初始化
 * - 资产创建
 * - 资产管理（CRUD）
 * - 资产铸造
 * - 资产转账
 * - 资产销毁
 * - 余额查询
 * - 交易历史
 * - 统计信息
 * - 缓存功能
 * - 边界情况
 *
 * @version 1.0.0
 * @since 2024-01-02
 */

import {
  createAssetManager,
  AssetType,
  TransactionType,
  AssetStatus
} from '../src/services/trade/asset-manager.js'

// ============================================================
// 模拟数据库
// ============================================================

class MockDatabase {
  constructor() {
    this.tables = {
      assets: [],
      asset_holdings: [],
      asset_transfers: []
    }
  }

  async executeSql(sql, params = []) {
    // 模拟 CREATE TABLE
    if (sql.includes('CREATE TABLE')) {
      return []
    }

    // 模拟 CREATE INDEX
    if (sql.includes('CREATE INDEX')) {
      return []
    }

    // 模拟 INSERT INTO assets
    if (sql.includes('INSERT INTO assets')) {
      const record = {
        id: params[0],
        asset_type: params[1],
        name: params[2],
        symbol: params[3],
        description: params[4],
        metadata: params[5],
        creator_did: params[6],
        total_supply: params[7],
        decimals: params[8],
        status: params[9],
        created_at: params[10],
        updated_at: params[11],
        deleted: params[12]
      }
      this.tables.assets.push(record)
      return []
    }

    // 模拟 INSERT INTO asset_holdings
    if (sql.includes('INSERT INTO asset_holdings')) {
      const record = {
        id: params[0],
        asset_id: params[1],
        owner_did: params[2],
        amount: params[3],
        metadata: params[4],
        acquired_at: params[5],
        updated_at: params[6],
        deleted: params[7]
      }
      this.tables.asset_holdings.push(record)
      return []
    }

    // 模拟 INSERT INTO asset_transfers
    if (sql.includes('INSERT INTO asset_transfers')) {
      const record = {
        id: params[0],
        asset_id: params[1],
        from_did: params[2],
        to_did: params[3],
        amount: params[4],
        transaction_type: params[5],
        memo: params[6],
        created_at: params[7]
      }
      this.tables.asset_transfers.push(record)
      return []
    }

    // 模拟 SELECT FROM assets
    if (sql.includes('FROM assets')) {
      let records = [...this.tables.assets]

      // WHERE deleted = 0
      if (sql.includes('deleted = 0')) {
        records = records.filter(r => r.deleted === 0)
      }

      // WHERE id = ?
      if (sql.includes('WHERE id = ?')) {
        records = records.filter(r => r.id === params[0])
      }

      // WHERE asset_type = ?
      if (sql.includes('asset_type = ?')) {
        records = records.filter(r => r.asset_type === params[0])
      }

      // WHERE creator_did = ?
      if (sql.includes('creator_did = ?')) {
        const idx = params.findIndex((p, i) => sql.split('?')[i]?.includes('creator_did'))
        if (idx !== -1) {
          records = records.filter(r => r.creator_did === params[idx])
        }
      }

      // COUNT(*)
      if (sql.includes('COUNT(*)')) {
        return [{ count: records.length }]
      }

      // GROUP BY
      if (sql.includes('GROUP BY asset_type')) {
        const grouped = {}
        records.forEach(r => {
          if (!grouped[r.asset_type]) {
            grouped[r.asset_type] = { asset_type: r.asset_type, count: 0, total_supply: 0 }
          }
          grouped[r.asset_type].count++
          grouped[r.asset_type].total_supply += r.total_supply
        })
        return Object.values(grouped)
      }

      if (sql.includes('GROUP BY status')) {
        const grouped = {}
        records.forEach(r => {
          if (!grouped[r.status]) {
            grouped[r.status] = { status: r.status, count: 0 }
          }
          grouped[r.status].count++
        })
        return Object.values(grouped)
      }

      // ORDER BY created_at DESC
      if (sql.includes('ORDER BY created_at DESC')) {
        records.sort((a, b) => b.created_at - a.created_at)
      }

      // LIMIT
      const limitMatch = sql.match(/LIMIT\s+\?/)
      if (limitMatch) {
        const limitIndex = params.length - 1
        records = records.slice(0, params[limitIndex])
      }

      return records
    }

    // 模拟 SELECT FROM asset_holdings
    if (sql.includes('FROM asset_holdings')) {
      let records = [...this.tables.asset_holdings]

      if (sql.includes('deleted = 0')) {
        records = records.filter(r => r.deleted === 0)
      }

      if (sql.includes('owner_did = ?') && sql.includes('asset_id = ?')) {
        records = records.filter(r => r.owner_did === params[0] && r.asset_id === params[1])
      } else if (sql.includes('owner_did = ?')) {
        records = records.filter(r => r.owner_did === params[0])
      } else if (sql.includes('asset_id = ?')) {
        records = records.filter(r => r.asset_id === params[0])
      }

      if (sql.includes('amount > 0')) {
        records = records.filter(r => r.amount > 0)
      }

      if (sql.includes('ORDER BY updated_at DESC')) {
        records.sort((a, b) => b.updated_at - a.updated_at)
      }

      return records
    }

    // 模拟 SELECT FROM asset_transfers
    if (sql.includes('FROM asset_transfers')) {
      let records = [...this.tables.asset_transfers]

      if (sql.includes('asset_id = ?')) {
        records = records.filter(r => r.asset_id === params[0])
      }

      if (sql.includes('from_did = ? OR to_did = ?')) {
        const did = params[0]
        records = records.filter(r => r.from_did === did || r.to_did === did)
      }

      if (sql.includes('GROUP BY asset_id')) {
        const grouped = {}
        records.forEach(r => {
          if (!grouped[r.asset_id]) {
            grouped[r.asset_id] = { asset_id: r.asset_id, transfer_count: 0 }
          }
          grouped[r.asset_id].transfer_count++
        })
        return Object.values(grouped).sort((a, b) => b.transfer_count - a.transfer_count)
      }

      if (sql.includes('COUNT(*)')) {
        return [{ count: records.length }]
      }

      if (sql.includes('ORDER BY created_at DESC')) {
        records.sort((a, b) => b.created_at - a.created_at)
      }

      const limitMatch = sql.match(/LIMIT\s+\?/)
      if (limitMatch) {
        const limitIndex = params.length - 1
        records = records.slice(0, params[limitIndex])
      }

      return records
    }

    // 模拟 UPDATE assets
    if (sql.includes('UPDATE assets')) {
      const idIndex = params.length - 1
      const id = params[idIndex]

      const record = this.tables.assets.find(r => r.id === id)
      if (record) {
        if (sql.includes('total_supply = total_supply +')) {
          record.total_supply += params[0]
          record.updated_at = params[1]
        } else if (sql.includes('total_supply = total_supply -')) {
          record.total_supply -= params[0]
          record.updated_at = params[1]
        } else if (sql.includes('deleted = 1')) {
          record.deleted = 1
          record.updated_at = params[0]
        } else {
          // 普通更新
          if (sql.includes('name = ?')) {
            record.name = params[0]
          }
          if (sql.includes('description = ?')) {
            const idx = sql.indexOf('description = ?')
            const paramIdx = (sql.substring(0, idx).match(/\?/g) || []).length
            record.description = params[paramIdx]
          }
          record.updated_at = params[params.length - 2]
        }
      }

      return []
    }

    // 模拟 UPDATE asset_holdings
    if (sql.includes('UPDATE asset_holdings')) {
      if (sql.includes('amount = amount -')) {
        const amount = params[0]
        const timestamp = params[1]
        const assetId = params[2]
        const ownerDid = params[3]

        const record = this.tables.asset_holdings.find(
          r => r.asset_id === assetId && r.owner_did === ownerDid
        )

        if (record) {
          record.amount -= amount
          record.updated_at = timestamp
        }
      } else if (sql.includes('amount = ?')) {
        const newAmount = params[0]
        const timestamp = params[1]
        const assetId = params[2]
        const ownerDid = params[3]

        const record = this.tables.asset_holdings.find(
          r => r.asset_id === assetId && r.owner_did === ownerDid
        )

        if (record) {
          record.amount = newAmount
          record.updated_at = timestamp
        }
      }

      return []
    }

    return []
  }

  reset() {
    this.tables.assets = []
    this.tables.asset_holdings = []
    this.tables.asset_transfers = []
  }
}

// ============================================================
// 模拟DID管理器
// ============================================================

class MockDIDManager {
  constructor() {
    this.currentIdentity = {
      did: 'did:example:test_user',
      publicKey: 'test_public_key'
    }
  }

  getCurrentIdentity() {
    return this.currentIdentity
  }

  setCurrentIdentity(identity) {
    this.currentIdentity = identity
  }
}

// ============================================================
// 测试套件
// ============================================================

async function runTests() {
  console.log('='.repeat(60))
  console.log('资产管理系统测试套件')
  console.log('='.repeat(60))
  console.log()

  const db = new MockDatabase()
  const didManager = new MockDIDManager()
  const assetManager = createAssetManager(db, didManager)

  let passedTests = 0
  let failedTests = 0

  // 辅助测试函数
  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passedTests++
    } catch (error) {
      console.error(`✗ ${name}`)
      console.error(`  错误: ${error.message}`)
      failedTests++
    }
  }

  // ============================================================
  // 1. 初始化测试
  // ============================================================

  console.log('1. 初始化测试')
  console.log('-'.repeat(60))

  await test('应该成功创建管理器实例', async () => {
    if (!assetManager) throw new Error('管理器实例创建失败')
    if (assetManager.initialized) throw new Error('初始状态应为未初始化')
  })

  await test('应该成功初始化', async () => {
    await assetManager.initialize()
    if (!assetManager.initialized) throw new Error('初始化标志未设置')
  })

  await test('重复初始化应该跳过', async () => {
    await assetManager.initialize()
    if (!assetManager.initialized) throw new Error('状态异常')
  })

  console.log()

  // ============================================================
  // 2. 资产创建测试
  // ============================================================

  console.log('2. 资产创建测试')
  console.log('-'.repeat(60))

  let tokenAsset, nftAsset, knowledgeAsset

  await test('应该成功创建Token资产', async () => {
    tokenAsset = await assetManager.createAsset({
      type: AssetType.TOKEN,
      name: '测试积分',
      symbol: 'TKN',
      description: '用于测试的积分系统',
      totalSupply: 1000000,
      decimals: 2
    })

    if (!tokenAsset.id) throw new Error('未返回资产ID')
    if (tokenAsset.asset_type !== 'token') throw new Error('资产类型错误')
    if (tokenAsset.total_supply !== 1000000) throw new Error('总供应量错误')
  })

  await test('应该成功创建NFT资产', async () => {
    nftAsset = await assetManager.createAsset({
      type: AssetType.NFT,
      name: '数字证书NFT',
      symbol: 'CERT',
      description: '独一无二的数字证书',
      metadata: { edition: 1 }
    })

    if (!nftAsset.id) throw new Error('未返回资产ID')
    if (nftAsset.total_supply !== 1) throw new Error('NFT总供应量应该为1')
  })

  await test('应该成功创建知识产品资产', async () => {
    knowledgeAsset = await assetManager.createAsset({
      type: AssetType.KNOWLEDGE,
      name: 'JavaScript高级教程',
      description: '深入学习JavaScript',
      totalSupply: 100
    })

    if (!knowledgeAsset.id) throw new Error('未返回资产ID')
    if (knowledgeAsset.asset_type !== 'knowledge') throw new Error('资产类型错误')
  })

  await test('创建Token时必须提供symbol', async () => {
    try {
      await assetManager.createAsset({
        type: AssetType.TOKEN,
        name: 'Invalid Token'
        // 缺少 symbol
      })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('symbol')) throw error
    }
  })

  await test('资产名称不能为空', async () => {
    try {
      await assetManager.createAsset({
        type: AssetType.TOKEN,
        name: '',
        symbol: 'TKN'
      })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('名称不能为空')) throw error
    }
  })

  await test('资产类型必须有效', async () => {
    try {
      await assetManager.createAsset({
        type: 'invalid_type',
        name: 'Invalid Asset'
      })
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('无效的资产类型')) throw error
    }
  })

  console.log()

  // ============================================================
  // 3. 资产查询测试
  // ============================================================

  console.log('3. 资产查询测试')
  console.log('-'.repeat(60))

  await test('应该根据ID获取资产', async () => {
    const asset = await assetManager.getAsset(tokenAsset.id)
    if (!asset) throw new Error('未获取到资产')
    if (asset.id !== tokenAsset.id) throw new Error('资产ID不匹配')
  })

  await test('获取不存在的资产应该返回null', async () => {
    const asset = await assetManager.getAsset('non-existent-id')
    if (asset !== null) throw new Error('应该返回null')
  })

  await test('应该获取所有资产', async () => {
    const assets = await assetManager.getAllAssets()
    if (assets.length < 3) throw new Error('资产数量不正确')
  })

  await test('应该按类型过滤资产', async () => {
    const tokens = await assetManager.getAllAssets({ type: AssetType.TOKEN })
    const invalidType = tokens.find(a => a.asset_type !== 'token')
    if (invalidType) throw new Error('过滤结果包含其他类型')
  })

  await test('应该按创建者过滤资产', async () => {
    const myAssets = await assetManager.getAllAssets({
      creatorDid: 'did:example:test_user'
    })
    const notMine = myAssets.find(a => a.creator_did !== 'did:example:test_user')
    if (notMine) throw new Error('过滤结果包含其他创建者')
  })

  console.log()

  // ============================================================
  // 4. 资产转账测试
  // ============================================================

  console.log('4. 资产转账测试')
  console.log('-'.repeat(60))

  const recipientDid = 'did:example:recipient'

  await test('应该成功转账', async () => {
    const result = await assetManager.transferAsset(
      tokenAsset.id,
      recipientDid,
      10000,
      '测试转账'
    )

    if (!result.success) throw new Error('转账失败')
    if (!result.transferId) throw new Error('未返回交易ID')
  })

  await test('转账后余额应该正确', async () => {
    const senderBalance = await assetManager.getBalance(
      'did:example:test_user',
      tokenAsset.id
    )
    const recipientBalance = await assetManager.getBalance(
      recipientDid,
      tokenAsset.id
    )

    if (senderBalance !== 990000) throw new Error('发送者余额不正确')
    if (recipientBalance !== 10000) throw new Error('接收者余额不正确')
  })

  await test('余额不足时应该抛出错误', async () => {
    try {
      await assetManager.transferAsset(
        tokenAsset.id,
        recipientDid,
        2000000  // 超过余额
      )
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('余额不足')) throw error
    }
  })

  await test('不能转账给自己', async () => {
    try {
      await assetManager.transferAsset(
        tokenAsset.id,
        'did:example:test_user',
        100
      )
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('不能转账给自己')) throw error
    }
  })

  console.log()

  // ============================================================
  // 5. 资产销毁测试
  // ============================================================

  console.log('5. 资产销毁测试')
  console.log('-'.repeat(60))

  await test('应该成功销毁资产', async () => {
    const balanceBefore = await assetManager.getBalance(
      'did:example:test_user',
      tokenAsset.id
    )

    const result = await assetManager.burnAsset(tokenAsset.id, 5000)

    if (!result.success) throw new Error('销毁失败')

    const balanceAfter = await assetManager.getBalance(
      'did:example:test_user',
      tokenAsset.id
    )

    if (balanceAfter !== balanceBefore - 5000) throw new Error('余额未正确减少')
  })

  await test('销毁后总供应量应该减少', async () => {
    const asset = await assetManager.getAsset(tokenAsset.id)
    // 原始1000000 - 销毁5000 = 995000
    if (asset.total_supply !== 995000) throw new Error('总供应量未正确减少')
  })

  console.log()

  // ============================================================
  // 6. 资产铸造测试
  // ============================================================

  console.log('6. 资产铸造测试')
  console.log('-'.repeat(60))

  await test('创建者应该可以铸造资产', async () => {
    const result = await assetManager.mintAsset(
      tokenAsset.id,
      'did:example:test_user',
      10000
    )

    if (!result.success) throw new Error('铸造失败')
  })

  await test('铸造后余额应该增加', async () => {
    const balance = await assetManager.getBalance(
      'did:example:test_user',
      tokenAsset.id
    )
    // 990000 - 5000 + 10000 = 995000
    if (balance !== 995000) throw new Error('余额不正确')
  })

  await test('NFT不能铸造', async () => {
    try {
      await assetManager.mintAsset(nftAsset.id, 'did:example:test_user', 1)
      throw new Error('应该抛出错误')
    } catch (error) {
      if (!error.message.includes('NFT资产不能铸造')) throw error
    }
  })

  console.log()

  // ============================================================
  // 7. 交易历史测试
  // ============================================================

  console.log('7. 交易历史测试')
  console.log('-'.repeat(60))

  await test('应该获取资产历史', async () => {
    const history = await assetManager.getAssetHistory(tokenAsset.id)
    if (history.length === 0) throw new Error('未获取到历史记录')

    // 应该有: mint(创建时), transfer, burn, mint
    if (history.length < 4) throw new Error('历史记录数量不正确')
  })

  await test('应该获取用户历史', async () => {
    const history = await assetManager.getUserHistory('did:example:test_user')
    if (history.length === 0) throw new Error('未获取到历史记录')
  })

  console.log()

  // ============================================================
  // 8. 统计信息测试
  // ============================================================

  console.log('8. 统计信息测试')
  console.log('-'.repeat(60))

  await test('应该获取统计信息', async () => {
    const stats = await assetManager.getStatistics()

    if (typeof stats.total !== 'number') throw new Error('总数类型错误')
    if (!stats.byType) throw new Error('缺少按类型统计')
    if (!stats.byStatus) throw new Error('缺少按状态统计')
  })

  await test('统计应该正确计算各类型数量', async () => {
    const stats = await assetManager.getStatistics()

    if (typeof stats.token !== 'number') throw new Error('Token数量类型错误')
    if (typeof stats.nft !== 'number') throw new Error('NFT数量类型错误')
    if (typeof stats.knowledge !== 'number') throw new Error('知识产品数量类型错误')
  })

  await test('应该获取最近资产', async () => {
    const recent = await assetManager.getRecentAssets(5)
    if (!Array.isArray(recent)) throw new Error('应该返回数组')
    if (recent.length > 5) throw new Error('数量超过限制')

    // 检查是否按时间排序
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].created_at > recent[i - 1].created_at) {
        throw new Error('未按时间排序')
      }
    }
  })

  await test('应该获取最活跃资产', async () => {
    const active = await assetManager.getMostActiveAssets(5)
    if (!Array.isArray(active)) throw new Error('应该返回数组')
  })

  console.log()

  // ============================================================
  // 9. 缓存测试
  // ============================================================

  console.log('9. 缓存测试')
  console.log('-'.repeat(60))

  await test('第二次获取资产应该使用缓存', async () => {
    // 第一次获取
    await assetManager.getAsset(tokenAsset.id)

    // 第二次获取应该使用缓存
    const cached = assetManager.assetCache.get(tokenAsset.id)
    if (!cached) throw new Error('未缓存资产')
  })

  await test('第二次获取余额应该使用缓存', async () => {
    // 第一次获取
    await assetManager.getBalance('did:example:test_user', tokenAsset.id)

    // 检查缓存
    const cacheKey = `did:example:test_user:${tokenAsset.id}`
    const cached = assetManager.balanceCache.get(cacheKey)
    if (!cached) throw new Error('未缓存余额')
  })

  await test('统计信息应该被缓存', async () => {
    // 第一次获取
    await assetManager.getStatistics()

    // 检查缓存
    if (!assetManager.statsCache) throw new Error('统计信息未缓存')
  })

  console.log()

  // ============================================================
  // 10. 工具方法测试
  // ============================================================

  console.log('10. 工具方法测试')
  console.log('-'.repeat(60))

  await test('应该正确格式化资产数量', async () => {
    const { formatAmount } = await import('../src/services/trade/asset-manager.js')

    if (formatAmount(100, 0) !== '100') throw new Error('0小数位格式化错误')
    if (formatAmount(10050, 2) !== '100.50') throw new Error('2小数位格式化错误')
    if (formatAmount(123456789, 6) !== '123.456789') throw new Error('6小数位格式化错误')
  })

  await test('应该正确解析资产数量', async () => {
    const { parseAmount } = await import('../src/services/trade/asset-manager.js')

    if (parseAmount('100', 0) !== 100) throw new Error('0小数位解析错误')
    if (parseAmount('100.50', 2) !== 10050) throw new Error('2小数位解析错误')
    if (parseAmount('123.456789', 6) !== 123456789) throw new Error('6小数位解析错误')
  })

  console.log()

  // ============================================================
  // 测试总结
  // ============================================================

  console.log('='.repeat(60))
  console.log('测试总结')
  console.log('='.repeat(60))
  console.log(`总测试数: ${passedTests + failedTests}`)
  console.log(`✓ 通过: ${passedTests}`)
  console.log(`✗ 失败: ${failedTests}`)
  console.log(`通过率: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(2)}%`)
  console.log('='.repeat(60))

  if (failedTests === 0) {
    console.log('\n🎉 所有测试通过！')
  } else {
    console.log(`\n⚠️  有 ${failedTests} 个测试失败`)
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
