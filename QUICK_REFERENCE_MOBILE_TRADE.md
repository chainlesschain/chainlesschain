# ChainlessChain 移动端交易系统快速参考

**版本**: v1.0.0
**最后更新**: 2026-01-02

---

## 🚀 快速开始

### 运行集成测试

```bash
cd mobile-app-uniapp
node test/integration-test-real.js
```

**预期结果**:
```
✅ 通过: 39
❌ 失败: 0
通过率: 100.00%
执行时间: ~42ms
```

### 安装依赖

```bash
cd mobile-app-uniapp
npm install
```

---

## 📦 核心模块

### 1. AssetManager - 资产管理

**位置**: `src/services/trade/asset-manager.js` (1,147行)

**创建实例**:
```javascript
import { createAssetManager } from './asset-manager.js'

const assetManager = createAssetManager(db, didManager)
await assetManager.initialize()
```

**主要API**:
```javascript
// 创建资产
const asset = await assetManager.createAsset({
  symbol: 'BTC',
  name: 'Bitcoin',
  type: 'token',
  totalSupply: 21000000,
  decimals: 8
})

// 转账
await assetManager.transferAsset(assetId, toDid, amount, 'memo')

// 查询余额
const balance = await assetManager.getBalance(ownerDid, assetId)

// 获取所有资产
const assets = await assetManager.getAllAssets()
```

---

### 2. MarketplaceManager - 市场交易

**位置**: `src/services/trade/marketplace-manager.js` (1,117行)

**创建实例**:
```javascript
import { createMarketplaceManager } from './marketplace-manager.js'

const marketplace = createMarketplaceManager(db, didManager, assetManager)
await marketplace.initialize()
```

**主要API**:
```javascript
// 创建订单
const order = await marketplace.createOrder({
  type: 'buy',              // 'buy' 或 'sell'
  title: 'BTC限价买单',
  assetId: 'asset_xxx',
  priceAmount: 50000,       // 注意: priceAmount 不是 price
  quantity: 1               // 注意: quantity 不是 amount
})

// 匹配订单（购买）
const transaction = await marketplace.matchOrder(orderId, quantity)

// 取消订单
await marketplace.cancelOrder(orderId)

// 查询订单
const orders = await marketplace.getOrders({ status: 'open' })
```

---

### 3. ContractEngine - 智能合约

**位置**: `src/services/trade/contract-engine.js` (1,140行)

**创建实例**:
```javascript
import { createContractEngine } from './contract-engine.js'

const contractEngine = createContractEngine(db, didManager, assetManager)
await contractEngine.initialize()
```

**主要API**:
```javascript
// 创建合约
const contract = await contractEngine.createContract({
  title: 'BTC/USDT交易合约',
  type: 'simple_trade',     // simple_trade, subscription, bounty, skill_exchange, custom
  escrowType: 'simple',     // simple, multisig, timelock, conditional
  parties: ['did:example:a', 'did:example:b'],
  terms: {
    assetA: 'asset_btc',
    assetB: 'asset_usdt',
    amountA: 1,
    amountB: 50000
  },
  description: '交易描述'
})

// 签署合约
await contractEngine.signContract(contractId, 'signature-data')

// 激活合约（签名满足后自动激活，也可手动）
await contractEngine.activateContract(contractId)

// 执行合约
await contractEngine.executeContract(contractId)

// 查询合约
const contract = await contractEngine.getContract(contractId)
```

**重要**:
- ⚠️ 必须所有参与方签署后才能激活
- ⚠️ 当最后一方签署时，合约会**自动激活**

---

### 4. CreditScoreManager - 信用评分

**位置**: `src/services/trade/credit-score-manager.js` (810行)

**创建实例**:
```javascript
import { createCreditScoreManager } from './credit-score-manager.js'

const creditScoreManager = createCreditScoreManager(
  db, didManager, assetManager, marketplace
)
await creditScoreManager.initialize()
```

**主要API**:
```javascript
// 交易完成事件（自动更新信用分）
await creditScoreManager.onTransactionCompleted(
  userDid,
  transactionId,
  amount
)

// 获取用户信用
const credit = await creditScoreManager.getUserCredit(userDid)
console.log(credit.score)  // 信用分数

// 获取信用报告
const report = await creditScoreManager.getCreditReport(userDid)

// 获取排行榜
const leaderboard = await creditScoreManager.getLeaderboard(50)
```

---

### 5. SocialTradingManager - 社交交易

**位置**: `src/services/trade/social-trading-manager.js` (950行)

**创建实例**:
```javascript
import { createSocialTradingManager } from './social-trading-manager.js'

const socialTrading = createSocialTradingManager(
  db, didManager, marketplace, creditScoreManager
)
await socialTrading.initialize()
```

**主要API**:
```javascript
// 发布交易分享
const share = await socialTrading.createShare({
  type: 'order',           // 'order', 'trade', 'analysis', 'tip'
  title: '看涨BTC',
  description: '突破关键阻力位',
  price: 50000,
  targetPrice: 55000,
  stopLoss: 48000,
  tags: ['BTC', '做多']
})

// 点赞
await socialTrading.addLike('share', shareId)

// 评论
const comment = await socialTrading.addComment(shareId, '很好的分析！')

// 关注交易员
await socialTrading.followTrader(traderDid)

// 获取热门分享
const trending = await socialTrading.getTrendingShares(10)
```

---

### 6. IncentiveManager - 激励系统

**位置**: `src/services/trade/incentive-manager.js` (1,070行)

**创建实例**:
```javascript
import { createIncentiveManager } from './incentive-manager.js'

const incentiveManager = createIncentiveManager(
  db, didManager, marketplace, creditScoreManager
)
await incentiveManager.initialize()
```

**主要API**:
```javascript
// 获取用户等级
const userLevel = await incentiveManager.getUserLevel(userDid)
console.log(userLevel.level)  // 等级
console.log(userLevel.exp)    // 当前经验
console.log(userLevel.next_level_exp)  // 升级所需

// 每日签到
const checkIn = await incentiveManager.checkIn(userDid)
console.log(checkIn.consecutiveDays)  // 连续签到天数
console.log(checkIn.rewardPoints)     // 奖励积分

// 增加经验
await incentiveManager.addExp(userDid, 50, 'trade')

// 查看任务
const tasks = await incentiveManager.getTasks(userDid)

// 完成任务
await incentiveManager.completeTask(userDid, taskId)

// 查看里程碑
const milestones = await incentiveManager.getMilestones(userDid)
```

---

## 🔧 常见模式

### 完整交易流程

```javascript
// 1. 初始化所有模块
const assetManager = createAssetManager(db, didManager)
const marketplace = createMarketplaceManager(db, didManager, assetManager)
const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace)
const incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager)

await assetManager.initialize()
await marketplace.initialize()
await creditScoreManager.initialize()
await incentiveManager.initialize()

// 2. 卖家创建资产
const sellerDid = 'did:example:seller'
didManager.setCurrentDid(sellerDid)

const asset = await assetManager.createAsset({
  symbol: 'BTC',
  name: 'Bitcoin',
  type: 'token',
  totalSupply: 10,
  initialBalance: 10
})

// 3. 卖家创建卖单
const order = await marketplace.createOrder({
  type: 'sell',
  title: 'BTC出售',
  assetId: asset.id,
  priceAmount: 50000,
  quantity: 1
})

// 4. 买家匹配订单
const buyerDid = 'did:example:buyer'
didManager.setCurrentDid(buyerDid)

const transaction = await marketplace.matchOrder(order.id, 1)

// 5. 更新买家信用分
await creditScoreManager.onTransactionCompleted(
  buyerDid,
  transaction.id,
  transaction.payment_amount
)

// 6. 买家签到获取奖励
const checkIn = await incentiveManager.checkIn(buyerDid)
console.log(`获得 ${checkIn.rewardPoints} 积分`)
```

### 智能合约流程

```javascript
// 1. 初始化
const contractEngine = createContractEngine(db, didManager, assetManager)
await contractEngine.initialize()

const partyA = 'did:example:party-a'
const partyB = 'did:example:party-b'

// 2. 甲方创建合约
didManager.setCurrentDid(partyA)

const contract = await contractEngine.createContract({
  title: 'BTC/USDT交换合约',
  type: 'simple_trade',
  escrowType: 'simple',
  parties: [partyA, partyB],
  terms: {
    assetA: 'asset_btc',
    assetB: 'asset_usdt',
    amountA: 1,
    amountB: 50000
  }
})

// 3. 甲方签署
await contractEngine.signContract(contract.id, 'signature-a')

// 4. 乙方签署（将自动激活合约）
didManager.setCurrentDid(partyB)
await contractEngine.signContract(contract.id, 'signature-b')

// 5. 执行合约
didManager.setCurrentDid(partyA)
await contractEngine.executeContract(contract.id)

console.log('合约执行成功！')
```

---

## 🧪 测试

### 运行所有测试

```bash
# 集成测试（推荐）
node test/integration-test-real.js

# 单元测试
node test/asset-test.js
node test/contract-test.js
node test/credit-score-test.js
node test/social-trading-test.js
```

### 测试场景

集成测试覆盖6个场景:
1. ✅ 完整交易流程
2. ✅ 社交交易流程
3. ✅ 智能合约流程
4. ✅ 用户成长路径
5. ✅ 数据一致性验证
6. ✅ 并发操作测试

---

## ⚠️ 常见错误

### 1. 订单参数错误

❌ **错误**:
```javascript
createOrder({
  price: 50000,      // 错误!
  amount: 1          // 错误!
})
```

✅ **正确**:
```javascript
createOrder({
  priceAmount: 50000,  // 正确
  quantity: 1,         // 正确
  title: '订单标题'     // 必须
})
```

### 2. 合约参数错误

❌ **错误**:
```javascript
// 使用位置参数
createContract(title, type, parties, terms)
```

✅ **正确**:
```javascript
// 使用options对象
createContract({
  title: '...',
  type: 'simple_trade',
  escrowType: 'simple',  // 必须
  parties: [...],
  terms: {...}
})
```

### 3. 不能购买自己的订单

❌ **错误**:
```javascript
didManager.setCurrentDid('did:seller')
const order = await marketplace.createOrder({ type: 'sell', ... })
await marketplace.matchOrder(order.id, 1)  // 错误：同一用户
```

✅ **正确**:
```javascript
didManager.setCurrentDid('did:seller')
const order = await marketplace.createOrder({ type: 'sell', ... })

didManager.setCurrentDid('did:buyer')  // 切换用户
await marketplace.matchOrder(order.id, 1)  // 正确
```

### 4. API方法名错误

| ❌ 错误 | ✅ 正确 |
|--------|--------|
| `executeOrder()` | `matchOrder()` |
| `deployContract()` | `activateContract()` |
| `getAssets()` | `getAllAssets()` |
| `getCreditScore()` | `getUserCredit(userDid)` |
| `recordTradeActivity()` | `onTransactionCompleted()` |

---

## 📚 完整文档

### 实现报告
- `MOBILE_ASSET_COMPLETE_REPORT.md`
- `MOBILE_MARKETPLACE_COMPLETE_REPORT.md`
- `MOBILE_CONTRACT_COMPLETE_REPORT.md`
- `MOBILE_CREDIT_SCORE_COMPLETE_REPORT.md`
- `MOBILE_SOCIAL_TRADING_COMPLETE_REPORT.md`
- `MOBILE_INCENTIVE_COMPLETE_REPORT.md`

### 使用指南
- `docs/ASSET_USAGE.md`
- `docs/CONTRACT_USAGE.md`
- `docs/CREDIT_SCORE_USAGE.md`

### 测试报告
- `REAL_INTEGRATION_TEST_REPORT.md` ⭐ (详细)
- `INTEGRATION_TEST_REPORT.md`

### 项目状态
- `PROJECT_STATUS_2026-01-02.md`
- `WORK_SUMMARY_2026-01-02.md`

---

## 💡 提示

### 性能优化
- 所有Manager都使用**单例模式**
- 内置**LRU缓存** (TTL: 5分钟)
- 使用**SQLite WAL模式**支持并发

### 最佳实践
1. 始终先调用 `initialize()`
2. 使用工厂函数创建实例
3. 跨用户操作记得切换DID
4. 合约需要全部签署才能激活
5. 留意异步方法的返回值

### 调试技巧
```javascript
// 所有模块都有日志输出
[AssetManager] ✓ 资产已创建: asset_xxx (Bitcoin)
[MarketplaceManager] ✓ 订单已创建: market_xxx (BTC限价买单)
[ContractEngine] 创建合约: contract_xxx
```

---

## 🔗 快捷链接

- **GitHub**: (项目仓库)
- **集成测试**: `mobile-app-uniapp/test/integration-test-real.js`
- **源代码**: `mobile-app-uniapp/src/services/trade/`
- **文档**: `mobile-app-uniapp/docs/`

---

## 📞 获取帮助

遇到问题？

1. 查看 `REAL_INTEGRATION_TEST_REPORT.md` 了解测试详情
2. 查看 `WORK_SUMMARY_2026-01-02.md` 了解Bug修复
3. 查看具体模块的使用指南
4. 运行集成测试查看示例

---

**快速参考版本**: v1.0.0
**最后更新**: 2026-01-02
**状态**: ✅ 生产就绪
