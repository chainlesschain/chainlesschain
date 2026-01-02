# 资产管理系统 - 使用指南

> 移动端资产管理系统 v2.3.0
> 支持Token、NFT、知识产品、服务凭证的完整生命周期管理

---

## 快速开始

```javascript
import { createAssetManager } from '@/services/trade/asset-manager.js'

// 创建管理器实例
const db = uni.requireNativePlugin('SQLite')
const didManager = // ... DID管理器实例
const assetManager = createAssetManager(db, didManager)

// 初始化
await assetManager.initialize()

// 创建Token资产
const token = await assetManager.createAsset({
  type: 'token',
  name: '积分',
  symbol: 'POINTS',
  totalSupply: 1000000,
  decimals: 2
})

// 转账
await assetManager.transferAsset(token.id, recipientDid, 10000, '奖励积分')
```

---

## 资产类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **token** | 可替代通证 | 积分、代币、货币 |
| **nft** | 非同质化代币 | 证书、艺术品、收藏品 |
| **knowledge** | 知识产品 | 课程、文章、教程 |
| **service** | 服务凭证 | 会员、权益、订阅 |

---

## 核心功能

### 1. 创建资产

#### 创建Token

```javascript
const token = await assetManager.createAsset({
  type: 'token',
  name: '学习积分',
  symbol: 'LP',
  description: '奖励学习行为的积分系统',
  totalSupply: 1000000,
  decimals: 2,  // 支持小数点后2位
  metadata: {
    icon: 'https://example.com/icon.png',
    website: 'https://example.com'
  }
})

console.log('Token创建成功:', token.id)
```

#### 创建NFT

```javascript
const nft = await assetManager.createAsset({
  type: 'nft',
  name: '完成证书 #001',
  symbol: 'CERT',
  description: 'JavaScript高级课程完成证书',
  metadata: {
    image: 'https://example.com/cert001.png',
    edition: 1,
    issueDate: '2024-01-02'
  }
})

// NFT总供应量固定为1
console.log('NFT总供应量:', nft.total_supply) // 1
```

#### 创建知识产品

```javascript
const knowledge = await assetManager.createAsset({
  type: 'knowledge',
  name: 'Vue3实战教程',
  description: '从入门到精通的Vue3完整教程',
  totalSupply: 100,  // 限量100份
  metadata: {
    author: 'did:example:author',
    duration: '10小时',
    level: '中级'
  }
})
```

#### 创建服务凭证

```javascript
const service = await assetManager.createAsset({
  type: 'service',
  name: '高级会员',
  description: '一年期高级会员权益',
  totalSupply: 1000,
  metadata: {
    validityPeriod: '1年',
    benefits: ['无限访问', '优先支持', '专属内容']
  }
})
```

### 2. 资产转账

```javascript
const result = await assetManager.transferAsset(
  assetId,
  'did:example:recipient',
  10000,  // 数量（考虑decimals）
  '新年奖励'  // 备注（可选）
)

console.log('转账成功:', result.transferId)

// 转账后检查余额
const balance = await assetManager.getBalance(
  'did:example:recipient',
  assetId
)
console.log('接收者余额:', balance)
```

### 3. 资产铸造（增发）

```javascript
// 仅创建者可以铸造
const result = await assetManager.mintAsset(
  assetId,
  'did:example:recipient',
  5000
)

console.log('铸造成功:', result.transferId)

// 注意: NFT不能铸造
```

### 4. 资产销毁

```javascript
const result = await assetManager.burnAsset(assetId, 1000)

console.log('销毁成功:', result.transferId)

// 销毁后总供应量减少
const asset = await assetManager.getAsset(assetId)
console.log('当前总供应量:', asset.total_supply)
```

### 5. 查询资产

#### 获取单个资产

```javascript
const asset = await assetManager.getAsset(assetId)

console.log('资产名称:', asset.name)
console.log('资产类型:', asset.asset_type)
console.log('总供应量:', asset.total_supply)
console.log('创建者:', asset.creator_did)
```

#### 获取所有资产

```javascript
// 获取所有资产
const allAssets = await assetManager.getAllAssets()

// 按类型过滤
const tokens = await assetManager.getAllAssets({ type: 'token' })
const nfts = await assetManager.getAllAssets({ type: 'nft' })

// 按创建者过滤
const myAssets = await assetManager.getAllAssets({
  creatorDid: 'did:example:me'
})

// 按状态过滤
const activeAssets = await assetManager.getAllAssets({
  status: 'active'
})

// 限制数量
const recent = await assetManager.getAllAssets({ limit: 10 })
```

#### 获取用户资产

```javascript
// 获取用户持有的所有资产
const holdings = await assetManager.getAssetsByOwner('did:example:user')

holdings.forEach(holding => {
  console.log(`${holding.name}: ${holding.amount}`)
})
```

#### 获取余额

```javascript
const balance = await assetManager.getBalance(
  'did:example:user',
  assetId
)

console.log('余额:', balance)

// 格式化显示（考虑decimals）
const asset = await assetManager.getAsset(assetId)
const formatted = AssetManager.formatAmount(balance, asset.decimals)
console.log('格式化余额:', formatted)
```

### 6. 交易历史

#### 获取资产交易历史

```javascript
const history = await assetManager.getAssetHistory(assetId, 50)

history.forEach(tx => {
  console.log(`${tx.transaction_type}: ${tx.from_did} -> ${tx.to_did}`)
  console.log(`数量: ${tx.amount}`)
  console.log(`时间: ${new Date(tx.created_at).toLocaleString()}`)
  if (tx.memo) console.log(`备注: ${tx.memo}`)
})
```

#### 获取用户交易历史

```javascript
const history = await assetManager.getUserHistory('did:example:user', 50)

history.forEach(tx => {
  const isSender = tx.from_did === 'did:example:user'
  const direction = isSender ? '发送' : '接收'
  console.log(`${direction} ${tx.amount} (${tx.transaction_type})`)
})
```

### 7. 资产管理

#### 更新资产信息

```javascript
// 仅创建者可以更新
const updated = await assetManager.updateAsset(assetId, {
  name: '新名称',
  description: '新描述',
  metadata: { version: '2.0' },
  status: 'paused'  // 暂停资产
})
```

#### 删除资产

```javascript
// 软删除，仅创建者可以删除
await assetManager.deleteAsset(assetId)
```

---

## 统计信息

### 1. 总体统计

```javascript
const stats = await assetManager.getStatistics()

console.log('总资产数:', stats.total)
console.log('Token数:', stats.token)
console.log('NFT数:', stats.nft)
console.log('知识产品数:', stats.knowledge)
console.log('服务凭证数:', stats.service)
console.log('总交易数:', stats.totalTransfers)

// 按类型详细统计
console.log('Token总供应:', stats.byType.token?.totalSupply || 0)
console.log('NFT总供应:', stats.byType.nft?.totalSupply || 0)
```

### 2. 最近资产

```javascript
const recent = await assetManager.getRecentAssets(10)

recent.forEach(asset => {
  console.log(`${asset.name} (${asset.asset_type})`)
  console.log(`创建于: ${new Date(asset.created_at).toLocaleString()}`)
})
```

### 3. 最活跃资产

```javascript
const active = await assetManager.getMostActiveAssets(10)

active.forEach(asset => {
  console.log(`${asset.name}: ${asset.transfer_count} 笔交易`)
})
```

---

## 工具方法

### 格式化资产数量

```javascript
// 原始数量 -> 格式化数量
const formatted = AssetManager.formatAmount(10050, 2)
console.log(formatted) // "100.50"

const formatted2 = AssetManager.formatAmount(123456789, 6)
console.log(formatted2) // "123.456789"
```

### 解析资产数量

```javascript
// 格式化数量 -> 原始数量
const raw = AssetManager.parseAmount('100.50', 2)
console.log(raw) // 10050

const raw2 = AssetManager.parseAmount('123.456789', 6)
console.log(raw2) // 123456789
```

---

## 完整示例

### 示例1: 积分系统

```javascript
// 1. 创建积分
const points = await assetManager.createAsset({
  type: 'token',
  name: '学习积分',
  symbol: 'LP',
  description: '奖励学习行为',
  totalSupply: 1000000,
  decimals: 0
})

// 2. 用户完成任务，获得积分
await assetManager.transferAsset(
  points.id,
  'did:example:user',
  100,
  '完成每日任务'
)

// 3. 用户消费积分
const userDid = 'did:example:user'
const balance = await assetManager.getBalance(userDid, points.id)

if (balance >= 50) {
  await assetManager.burnAsset(points.id, 50)
  console.log('兑换成功')
}

// 4. 查看积分排行
const allHoldings = []
// 获取所有用户的持有情况（实际应用中需要遍历所有用户）
```

### 示例2: NFT证书系统

```javascript
// 1. 创建证书NFT
const cert = await assetManager.createAsset({
  type: 'nft',
  name: 'JavaScript专家证书',
  symbol: 'JSE',
  description: '完成JavaScript高级课程的证书',
  metadata: {
    image: 'https://cdn.example.com/cert.png',
    issuer: '教育平台',
    date: '2024-01-02'
  }
})

// 2. 发放证书给学员
await assetManager.transferAsset(
  cert.id,
  'did:example:student',
  1,
  '恭喜完成课程'
)

// 3. 验证证书持有
const balance = await assetManager.getBalance(
  'did:example:student',
  cert.id
)

if (balance > 0) {
  console.log('该用户拥有此证书')
}
```

### 示例3: 知识产品销售

```javascript
// 1. 创建知识产品
const course = await assetManager.createAsset({
  type: 'knowledge',
  name: 'Vue3完整教程',
  description: '10小时视频课程',
  totalSupply: 100,
  metadata: {
    price: 99,
    duration: '10小时',
    chapters: 20
  }
})

// 2. 用户购买
await assetManager.transferAsset(
  course.id,
  'did:example:buyer',
  1,
  '购买课程'
)

// 3. 检查剩余库存
const asset = await assetManager.getAsset(course.id)
const soldOut = await assetManager.getAssetsByOwner('did:example:platform')
const remaining = asset.total_supply - soldOut.reduce((sum, h) => sum - h.amount, asset.total_supply)

console.log(`剩余: ${remaining}份`)
```

---

## 常见问题

### Q1: 如何实现积分兑换？

```javascript
async function exchangePoints(userDid, pointsAssetId, amount, reward) {
  // 1. 检查余额
  const balance = await assetManager.getBalance(userDid, pointsAssetId)
  if (balance < amount) {
    throw new Error('积分不足')
  }

  // 2. 销毁积分
  await assetManager.burnAsset(pointsAssetId, amount)

  // 3. 发放奖励（这里简化处理）
  console.log(`兑换成功: ${reward}`)

  return { success: true }
}
```

### Q2: 如何实现资产交易？

```javascript
async function tradeAssets(buyer, seller, assetId, price) {
  // 1. 检查买家积分
  const buyerBalance = await assetManager.getBalance(buyer, priceAssetId)
  if (buyerBalance < price) {
    throw new Error('余额不足')
  }

  // 2. 检查卖家资产
  const sellerBalance = await assetManager.getBalance(seller, assetId)
  if (sellerBalance < 1) {
    throw new Error('卖家资产不足')
  }

  // 3. 转移资产
  await assetManager.transferAsset(assetId, buyer, 1, '购买')

  // 4. 支付价格
  await assetManager.transferAsset(priceAssetId, seller, price, '销售收入')

  return { success: true }
}
```

### Q3: 如何查看我的所有资产？

```javascript
const myAssets = await assetManager.getAssetsByOwner('did:example:me')

// 按类型分组
const byType = {}
myAssets.forEach(asset => {
  if (!byType[asset.asset_type]) {
    byType[asset.asset_type] = []
  }
  byType[asset.asset_type].push(asset)
})

console.log('我的Token:', byType.token)
console.log('我的NFT:', byType.nft)
```

### Q4: 如何备份资产数据？

```javascript
// 导出所有资产定义
const allAssets = await assetManager.getAllAssets()

// 导出我的持有记录
const myHoldings = await assetManager.getAssetsByOwner('did:example:me')

// 导出交易历史
const myHistory = await assetManager.getUserHistory('did:example:me', 1000)

const backup = {
  exportDate: Date.now(),
  assets: allAssets,
  holdings: myHoldings,
  history: myHistory
}

// 保存到文件
const fs = uni.getFileSystemManager()
fs.writeFileSync(
  '/storage/backup.json',
  JSON.stringify(backup, null, 2),
  'utf8'
)
```

---

更多信息请参考完整报告: `MOBILE_ASSET_COMPLETE_REPORT.md`
