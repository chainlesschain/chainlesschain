# 信用评分系统 - 使用指南

> 移动端信用评分系统 v2.6.0
> 支持5级信用体系、6维度评分、自动计算、历史趋势追踪

---

## 快速开始

```javascript
import { createCreditScoreManager } from '@/services/trade/credit-score-manager.js'

// 创建管理器实例
const db = uni.requireNativePlugin('SQLite')
const didManager = // ... DID管理器实例
const creditManager = createCreditScoreManager(db, didManager)

// 初始化
await creditManager.initialize()

// 获取用户信用
const credit = await creditManager.getUserCredit('did:example:user')
console.log(`信用评分: ${credit.creditScore}`)
console.log(`信用等级: ${credit.creditLevel}`)

// 处理交易完成事件
await creditManager.onTransactionCompleted('did:example:user', 'tx_001', 100)

// 获取信用报告
const report = await creditManager.getCreditReport('did:example:user')
```

---

## 信用等级系统

| 等级 | 分数范围 | 颜色 | 权益 |
|------|----------|------|------|
| **新手** | 0-100 | 灰色 | 无 |
| **青铜** | 101-300 | 青铜色 | 降低 5% 手续费 |
| **白银** | 301-600 | 银色 | 降低 10% 手续费 + 优先展示 |
| **黄金** | 601-900 | 金色 | 降低 15% 手续费 + 优先展示 + 更高托管比例 |
| **钻石** | 901-1000 | 钻石色 | 降低 20% 手续费 + 优先展示 + 免保证金 + VIP 支持 |

---

## 评分权重系统

| 维度 | 权重 | 说明 | 最高分值 |
|------|------|------|----------|
| **交易完成率** | 30% | 完成交易数 / 总交易数 | 300分 |
| **交易金额** | 20% | 累计交易金额（对数增长） | 200分 |
| **好评率** | 25% | 好评数 / 总评价数 | 250分 |
| **响应速度** | 10% | 平均响应时间（越短越好） | 100分 |
| **纠纷率** | 10% | 纠纷数 / 总交易数（扣分项） | 100分 |
| **退款率** | 5% | 退款数 / 总交易数（扣分项） | 50分 |

**总分**: 0-1000分

---

## 核心功能

### 1. 获取用户信用

```javascript
const credit = await creditManager.getUserCredit('did:example:user')

console.log('用户DID:', credit.userDid)
console.log('信用评分:', credit.creditScore)
console.log('信用等级:', credit.creditLevel)
console.log('总交易数:', credit.totalTransactions)
console.log('完成交易数:', credit.completedTransactions)
console.log('累计交易额:', credit.totalVolume)
console.log('好评数:', credit.positiveReviews)
console.log('差评数:', credit.negativeReviews)
console.log('纠纷数:', credit.disputes)
console.log('退款数:', credit.refunds)
console.log('平均响应时间:', credit.avgResponseTime, 'ms')
```

### 2. 交易事件处理

#### 交易完成（+10分）

```javascript
// 用户完成一笔交易
await creditManager.onTransactionCompleted(
  'did:example:user',
  'tx_001',      // 交易ID
  100            // 交易金额
)

// 自动：
// - 增加总交易数
// - 增加完成交易数
// - 累加交易金额
// - 加 10 分
// - 重新计算信用评分
```

#### 交易取消（-5分）

```javascript
// 用户取消交易
await creditManager.onTransactionCancelled(
  'did:example:user',
  'tx_002'
)

// 自动：
// - 增加总交易数
// - 扣 5 分
// - 重新计算信用评分
```

### 3. 评价事件处理

#### 收到好评（+5/+10/+15分）

```javascript
// 5星好评 +15分
await creditManager.onPositiveReview('did:example:user', 'review_001', 5)

// 4星好评 +10分
await creditManager.onPositiveReview('did:example:user', 'review_002', 4)

// 3星好评 +5分
await creditManager.onPositiveReview('did:example:user', 'review_003', 3)
```

#### 收到差评（-10/-20/-30分）

```javascript
// 1星差评 -30分
await creditManager.onNegativeReview('did:example:user', 'review_004', 1)

// 2星差评 -20分
await creditManager.onNegativeReview('did:example:user', 'review_005', 2)

// 3星以下差评 -10分
await creditManager.onNegativeReview('did:example:user', 'review_006', 3)
```

### 4. 纠纷事件处理

#### 发起纠纷（-20分）

```javascript
await creditManager.onDisputeInitiated('did:example:user', 'dispute_001')

// 扣 20 分，纠纷数 +1
```

#### 纠纷解决

```javascript
// 用户胜诉（+10分）
await creditManager.onDisputeResolved(
  'did:example:user',
  'dispute_001',
  'favor_user'
)

// 用户败诉（-10分）
await creditManager.onDisputeResolved(
  'did:example:user',
  'dispute_002',
  'favor_opponent'
)

// 和解（+5分）
await creditManager.onDisputeResolved(
  'did:example:user',
  'dispute_003',
  'settlement'
)
```

### 5. 退款事件（-8分）

```javascript
await creditManager.onRefund('did:example:user', 'refund_001')

// 扣 8 分，退款数 +1
```

### 6. 响应时间更新

```javascript
// 记录用户响应时间（毫秒）
await creditManager.updateResponseTime(
  'did:example:user',
  1800000  // 30分钟
)

// 自动计算平均响应时间
// 1小时内响应满分，越慢分数越低
```

### 7. 手动计算信用评分

```javascript
const result = await creditManager.calculateCreditScore('did:example:user')

console.log('信用评分:', result.creditScore)
console.log('信用等级:', result.creditLevel)
console.log('等级颜色:', result.levelColor)
console.log('权益:', result.benefits)

// 示例输出:
// 信用评分: 650
// 信用等级: 黄金
// 等级颜色: gold
// 权益: ['降低 15% 手续费', '优先展示', '更高托管比例']
```

### 8. 获取信用报告

```javascript
const report = await creditManager.getCreditReport('did:example:user')

console.log('信用评分:', report.creditScore)
console.log('信用等级:', report.creditLevel)
console.log('等级权益:', report.benefits)

// 详细统计
const stats = report.statistics
console.log('完成率:', stats.completionRate + '%')
console.log('好评率:', stats.positiveRate + '%')
console.log('纠纷率:', stats.disputeRate + '%')
console.log('退款率:', stats.refundRate + '%')

// 最近记录
report.recentRecords.forEach(record => {
  console.log(`[${record.eventType}] ${record.reason} (${record.scoreChange > 0 ? '+' : ''}${record.scoreChange}分)`)
})
```

### 9. 验证信用等级

```javascript
// 检查用户是否达到指定等级
const isGold = await creditManager.verifyCreditLevel('did:example:user', '黄金')

if (isGold) {
  console.log('用户已达到黄金等级，享受高级权益')
} else {
  console.log('用户未达到黄金等级')
}

// 实际应用
if (await creditManager.verifyCreditLevel(buyerDid, '白银')) {
  // 白银及以上用户可以享受免保证金
  enableNoDeposit()
}
```

### 10. 获取排行榜

```javascript
const leaderboard = await creditManager.getLeaderboard(50)

leaderboard.forEach(entry => {
  console.log(`第 ${entry.rank} 名: ${entry.userDid}`)
  console.log(`  信用评分: ${entry.creditScore}`)
  console.log(`  信用等级: ${entry.creditLevel}`)
  console.log(`  总交易数: ${entry.totalTransactions}`)
  console.log(`  累计交易额: ${entry.totalVolume}`)
})
```

### 11. 信用快照和趋势

#### 创建快照

```javascript
// 定期创建快照（如每天）
await creditManager.createSnapshot('did:example:user')
```

#### 查看趋势

```javascript
// 获取30天信用趋势
const trend = await creditManager.getCreditTrend('did:example:user', 30)

trend.forEach(snapshot => {
  console.log('日期:', new Date(snapshot.date).toLocaleDateString())
  console.log('信用评分:', snapshot.creditScore)
  console.log('信用等级:', snapshot.creditLevel)
})

// 可视化趋势图
// 显示信用评分的上升/下降趋势
```

### 12. 批量计算（定时任务）

```javascript
// 每天凌晨批量计算所有用户的信用评分
async function dailyCreditUpdate() {
  await creditManager.recalculateAllScores()
  console.log('所有用户信用评分已更新')
}

// 设置定时任务
setInterval(dailyCreditUpdate, 24 * 60 * 60 * 1000)
```

### 13. 获取统计信息

```javascript
const stats = await creditManager.getStatistics()

console.log('总用户数:', stats.totalUsers)
console.log('平均信用分:', stats.avgScore)
console.log('总交易数:', stats.totalTransactions)

console.log('\n按等级分布:')
Object.entries(stats.byLevel).forEach(([level, count]) => {
  console.log(`  ${level}: ${count} 人`)
})
```

---

## 完整示例

### 示例1: 电商交易流程

```javascript
// 1. 买家下单
const buyerDid = 'did:example:buyer'
const sellerDid = 'did:example:seller'

// 2. 验证买家信用等级
const hasSufficientCredit = await creditManager.verifyCreditLevel(buyerDid, '青铜')

if (!hasSufficientCredit) {
  console.log('您的信用等级不足，无法购买此商品')
  return
}

// 3. 交易完成
await creditManager.onTransactionCompleted(sellerDid, 'tx_001', 199)
await creditManager.onTransactionCompleted(buyerDid, 'tx_001', 199)

// 4. 买家给好评
await creditManager.onPositiveReview(sellerDid, 'review_001', 5)

// 5. 卖家给好评
await creditManager.onPositiveReview(buyerDid, 'review_002', 5)

// 6. 查看更新后的信用
const sellerCredit = await creditManager.getUserCredit(sellerDid)
console.log(`卖家新评分: ${sellerCredit.creditScore}`)
```

### 示例2: 信用等级系统集成

```javascript
// 根据信用等级提供不同权益
async function applyFeeDiscount(userDid, baseAmount) {
  const credit = await creditManager.getUserCredit(userDid)
  const level = creditManager.getCreditLevel(credit.creditScore)

  let discount = 0

  switch (level.name) {
    case '青铜':
      discount = 0.05  // 5%
      break
    case '白银':
      discount = 0.10  // 10%
      break
    case '黄金':
      discount = 0.15  // 15%
      break
    case '钻石':
      discount = 0.20  // 20%
      break
    default:
      discount = 0
  }

  const finalAmount = baseAmount * (1 - discount)
  console.log(`原价: ${baseAmount}, 折扣: ${discount * 100}%, 实付: ${finalAmount}`)

  return finalAmount
}

// 使用
const amount = await applyFeeDiscount('did:example:user', 100)
```

### 示例3: 纠纷处理流程

```javascript
// 1. 买家提出纠纷
await creditManager.onDisputeInitiated(sellerDid, 'dispute_001')
console.log('卖家信用分被扣 20 分')

// 2. 平台介入调查
// ...

// 3a. 如果买家胜诉
await creditManager.onDisputeResolved(sellerDid, 'dispute_001', 'favor_opponent')
await creditManager.onDisputeResolved(buyerDid, 'dispute_001', 'favor_user')
console.log('卖家额外扣 10 分，买家恢复 10 分')

// 3b. 如果卖家胜诉
await creditManager.onDisputeResolved(sellerDid, 'dispute_001', 'favor_user')
await creditManager.onDisputeResolved(buyerDid, 'dispute_001', 'favor_opponent')
console.log('卖家恢复 10 分，买家额外扣 10 分')

// 3c. 如果和解
await creditManager.onDisputeResolved(sellerDid, 'dispute_001', 'settlement')
await creditManager.onDisputeResolved(buyerDid, 'dispute_001', 'settlement')
console.log('双方各恢复 5 分')
```

### 示例4: 信用趋势分析

```javascript
// 分析用户信用趋势
async function analyzeCreditTrend(userDid) {
  const trend = await creditManager.getCreditTrend(userDid, 90) // 90天

  if (trend.length < 2) {
    return '数据不足'
  }

  const latest = trend[trend.length - 1].creditScore
  const earliest = trend[0].creditScore
  const change = latest - earliest

  console.log(`90天信用变化: ${change > 0 ? '+' : ''}${change} 分`)

  if (change > 100) {
    return '信用快速上升，用户表现优秀'
  } else if (change > 0) {
    return '信用稳步上升，用户表现良好'
  } else if (change === 0) {
    return '信用保持稳定'
  } else if (change > -100) {
    return '信用小幅下降，建议改善'
  } else {
    return '信用大幅下降，存在风险'
  }
}

const analysis = await analyzeCreditTrend('did:example:user')
console.log(analysis)
```

---

## 信用评分算法详解

```javascript
// 伪代码展示评分计算逻辑

function calculateScore(credit) {
  let score = 0

  // 1. 交易完成率 (30%) - 最高 300 分
  const completionRate = credit.completedTransactions / credit.totalTransactions
  score += completionRate * 300

  // 2. 交易金额 (20%) - 最高 200 分（对数增长）
  const volumeScore = Math.min(200, Math.log10(credit.totalVolume + 1) * 50)
  score += volumeScore

  // 3. 好评率 (25%) - 最高 250 分
  const positiveRate = credit.positiveReviews / (credit.positiveReviews + credit.negativeReviews)
  score += positiveRate * 250

  // 4. 响应速度 (10%) - 最高 100 分
  // 1小时内响应满分，越慢分数越低
  const responseScore = Math.max(0, 100 - (credit.avgResponseTime / 3600000))
  score += responseScore

  // 5. 纠纷率 (10%) - 最高 100 分（扣分项）
  const disputeRate = credit.disputes / credit.totalTransactions
  score += (1 - disputeRate) * 100

  // 6. 退款率 (5%) - 最高 50 分（扣分项）
  const refundRate = credit.refunds / credit.totalTransactions
  score += (1 - refundRate) * 50

  // 限制在 0-1000 范围
  return Math.max(0, Math.min(1000, Math.round(score)))
}
```

---

## 常见问题

### Q1: 如何快速提升信用评分？

1. **完成更多交易**: 每笔完成的交易 +10 分
2. **获得好评**: 5星好评 +15 分
3. **快速响应**: 保持1小时内响应
4. **避免纠纷**: 每次纠纷 -20 分
5. **避免退款**: 每次退款 -8 分

### Q2: 信用评分多久更新一次？

- **实时更新**: 每次事件发生后立即重新计算
- **快照**: 建议每天创建一次快照

### Q3: 如何恢复下降的信用评分？

- 持续完成交易
- 获得更多好评
- 缩短响应时间
- 避免新的纠纷和退款

### Q4: 新用户的初始评分是多少？

- 初始评分: 0 分
- 初始等级: 新手
- 完成第一笔交易后开始累积评分

### Q5: 信用评分会过期吗？

- 评分不会过期
- 但建议定期创建快照追踪趋势

---

更多信息请参考完整报告: `MOBILE_CREDIT_SCORE_COMPLETE_REPORT.md`
