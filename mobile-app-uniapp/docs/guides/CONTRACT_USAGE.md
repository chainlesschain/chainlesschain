# 智能合约引擎 - 使用指南

> 移动端智能合约引擎 v2.5.0
> 支持多种合约类型、条件执行、多方签名、自动执行、仲裁系统

---

## 快速开始

```javascript
import { createContractEngine } from '@/services/trade/contract-engine.js'
import { createAssetManager } from '@/services/trade/asset-manager.js'

// 创建管理器实例
const db = uni.requireNativePlugin('SQLite')
const didManager = // ... DID管理器实例
const assetManager = createAssetManager(db, didManager)
const contractEngine = createContractEngine(db, didManager, assetManager)

// 初始化
await contractEngine.initialize()

// 创建合约
const contract = await contractEngine.createContract({
  type: 'simple_trade',
  escrowType: 'simple',
  title: '购买课程',
  parties: ['did:example:buyer', 'did:example:seller'],
  terms: {
    assetId: 'asset_course',
    price: 99,
    priceAssetId: 'asset_points'
  }
})

// 签署合约
await contractEngine.signContract(contract.id, 'signature_data')

// 合约会自动激活并执行
```

---

## 合约类型

| 类型 | 说明 | 用途 |
|------|------|------|
| **simple_trade** | 简单交易 | 一次性买卖交易 |
| **subscription** | 订阅服务 | 周期性服务订阅 |
| **bounty** | 赏金任务 | 任务悬赏和奖励 |
| **skill_exchange** | 技能交换 | 点对点技能交换 |
| **custom** | 自定义 | 灵活的自定义合约 |

---

## 托管类型

| 类型 | 说明 | 特点 |
|------|------|------|
| **simple** | 简单托管 | 直接执行，无额外验证 |
| **multisig** | 多签托管 | 需要多方签名批准 |
| **timelock** | 时间锁 | 指定时间后才能执行 |
| **conditional** | 条件托管 | 满足条件才能执行 |

---

## 合约状态

| 状态 | 说明 | 下一步操作 |
|------|------|------------|
| **draft** | 草稿 | 签名或取消 |
| **active** | 激活 | 满足条件、执行 |
| **executing** | 执行中 | 等待完成 |
| **completed** | 已完成 | 结束 |
| **cancelled** | 已取消 | 结束 |
| **disputed** | 有争议 | 仲裁 |
| **arbitrated** | 已仲裁 | 结束 |

---

## 核心功能

### 1. 创建合约

#### 简单交易合约

```javascript
const contract = await contractEngine.createContract({
  type: 'simple_trade',
  escrowType: 'simple',
  title: '购买Vue3课程',
  description: '10小时完整视频教程',
  parties: ['did:example:buyer', 'did:example:seller'],
  terms: {
    assetId: 'asset_course_123',
    quantity: 1,
    priceAssetId: 'asset_points',
    priceAmount: 99
  },
  assetTransfers: [
    {
      assetId: 'asset_course_123',
      toDid: 'did:example:buyer',
      amount: 1
    }
  ],
  requiredSignatures: 2  // 需要买卖双方签名
})

console.log('合约创建成功:', contract.id)
```

#### 订阅服务合约

```javascript
const contract = await contractEngine.createContract({
  type: 'subscription',
  escrowType: 'timelock',
  title: '年度会员订阅',
  description: '一年期高级会员权益',
  parties: ['did:example:user', 'did:example:platform'],
  terms: {
    duration: 365 * 24 * 60 * 60 * 1000, // 1年
    price: 999,
    priceAssetId: 'asset_points',
    benefits: [
      '无限访问所有课程',
      '优先技术支持',
      '专属社区权限'
    ],
    autoRenew: true
  },
  expiresIn: 7 * 24 * 60 * 60 * 1000  // 7天后过期
})
```

#### 赏金任务合约

```javascript
const contract = await contractEngine.createContract({
  type: 'bounty',
  escrowType: 'conditional',
  title: '开发P2P消息功能',
  description: '在移动端实现完整的P2P消息系统',
  parties: ['did:example:issuer', 'did:example:developer'],
  terms: {
    requirements: [
      '实现端到端加密',
      '支持离线消息',
      '通过所有测试',
      '提供完整文档'
    ],
    reward: 5000,
    rewardAssetId: 'asset_points',
    deadline: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30天
  }
})

// 添加条件
await contractEngine.addCondition(contract.id, {
  type: 'delivery_confirmed',
  data: {
    deliverables: ['源代码', '测试报告', '技术文档']
  },
  required: true
})

await contractEngine.addCondition(contract.id, {
  type: 'approval_count',
  data: {
    required: 1,  // 需要发布者确认
    approvers: ['did:example:issuer']
  },
  required: true
})
```

#### 技能交换合约

```javascript
const contract = await contractEngine.createContract({
  type: 'skill_exchange',
  escrowType: 'multisig',
  title: '技能互换协议',
  description: 'Vue教学 换 Python教学',
  parties: ['did:example:alice', 'did:example:bob'],
  terms: {
    aliceProvides: {
      skill: 'Vue3开发',
      hours: 10,
      topics: ['组件开发', '状态管理', '路由']
    },
    bobProvides: {
      skill: 'Python开发',
      hours: 10,
      topics: ['FastAPI', '数据分析', '爬虫']
    },
    schedule: '每周2次，每次1小时'
  },
  requiredSignatures: 2
})
```

#### 自定义合约

```javascript
const contract = await contractEngine.createContract({
  type: 'custom',
  escrowType: 'conditional',
  title: '知识产权转让',
  description: '开源项目知识产权转让协议',
  parties: [
    'did:example:original_author',
    'did:example:new_owner'
  ],
  terms: {
    project: 'awesome-project',
    transferItems: [
      '源代码所有权',
      '商标权',
      '专利权'
    ],
    compensation: 50000,
    compensationAssetId: 'asset_points',
    restrictions: [
      '原作者保留署名权',
      '新所有者需开源维护1年'
    ]
  },
  requiredSignatures: 2
})
```

### 2. 添加条件

合约可以添加多个条件，只有满足所有必需条件后才能执行。

#### 付款条件

```javascript
await contractEngine.addCondition(contractId, {
  type: 'payment_received',
  data: {
    amount: 99,
    assetId: 'asset_points',
    recipient: 'did:example:seller'
  },
  required: true  // 必需条件
})
```

#### 交付确认条件

```javascript
await contractEngine.addCondition(contractId, {
  type: 'delivery_confirmed',
  data: {
    deliveryProof: 'ipfs://Qm...',
    deliveryHash: 'sha256:abc123...'
  },
  required: true
})
```

#### 时间条件

```javascript
await contractEngine.addCondition(contractId, {
  type: 'time_elapsed',
  data: {
    startTime: Date.now(),
    duration: 24 * 60 * 60 * 1000,  // 24小时后
    description: '冷静期结束'
  },
  required: false  // 可选条件
})
```

#### 批准数量条件

```javascript
await contractEngine.addCondition(contractId, {
  type: 'approval_count',
  data: {
    required: 3,
    current: 0,
    approvers: [
      'did:example:party1',
      'did:example:party2',
      'did:example:party3'
    ]
  },
  required: true
})
```

#### 自定义逻辑条件

```javascript
await contractEngine.addCondition(contractId, {
  type: 'custom_logic',
  data: {
    logic: 'reputation_check',
    params: {
      minRating: 4.5,
      minTransactions: 10
    }
  },
  required: false
})
```

### 3. 签署合约

参与方需要签署合约才能激活。

```javascript
// 获取当前DID
const currentDid = await didManager.getCurrentDid()

// 生成签名（实际应用中需要使用私钥签名）
const signature = await signData({
  contractId: contract.id,
  terms: contract.terms,
  timestamp: Date.now()
})

// 签署合约
await contractEngine.signContract(contract.id, signature)

console.log('签署成功')

// 查看签名状态
const signatures = await contractEngine.getSignatures(contract.id)
console.log(`当前签名: ${signatures.length}/${contract.required_signatures}`)
```

### 4. 激活合约

当所有必需签名收集完成后，合约会自动激活。也可以手动激活：

```javascript
try {
  await contractEngine.activateContract(contractId)
  console.log('合约已激活')
} catch (error) {
  console.error('激活失败:', error.message)
}
```

### 5. 满足条件

参与方确认条件已满足时，调用此方法：

```javascript
// 获取合约条件
const conditions = await contractEngine.getConditions(contractId)

// 找到需要满足的条件
const paymentCondition = conditions.find(c =>
  c.condition_type === 'payment_received'
)

// 满足条件（提供证明）
await contractEngine.meetCondition(contractId, paymentCondition.id, {
  transactionId: 'tx_123456',
  transactionHash: 'hash_abc...',
  timestamp: Date.now()
})

console.log('条件已满足')

// 检查是否所有条件都已满足
const updatedConditions = await contractEngine.getConditions(contractId)
const allMet = updatedConditions
  .filter(c => c.is_required)
  .every(c => c.is_met)

if (allMet) {
  console.log('所有必需条件已满足，合约将自动执行')
}
```

### 6. 执行合约

当所有必需条件满足后，合约可以执行：

```javascript
try {
  await contractEngine.executeContract(contractId)
  console.log('合约执行成功')

  // 如果有资产转移，会自动执行
  // 合约状态变为 'executing'
} catch (error) {
  console.error('执行失败:', error.message)
}
```

### 7. 完成合约

合约执行后，确认交付完成：

```javascript
await contractEngine.completeContract(contractId)
console.log('合约已完成')

// 查看完成时间
const contract = await contractEngine.getContract(contractId)
console.log('完成时间:', new Date(contract.completed_at).toLocaleString())
```

### 8. 取消合约

在激活前或激活后（未执行时）可以取消合约：

```javascript
await contractEngine.cancelContract(contractId, '不再需要此服务')
console.log('合约已取消')
```

### 9. 提出争议

如果对合约执行有异议，可以提出争议：

```javascript
await contractEngine.disputeContract(contractId, '商品与描述不符')
console.log('已提出争议')

// 合约状态变为 'disputed'
// 需要通过仲裁解决
```

### 10. 请求仲裁

对有争议的合约请求仲裁：

```javascript
const arbitration = await contractEngine.requestArbitration(
  contractId,
  '商品质量问题',
  {
    // 提供证据
    photos: ['photo1.jpg', 'photo2.jpg'],
    description: '收到的商品与描述严重不符',
    expectedCondition: '全新',
    actualCondition: '二手，有明显划痕'
  },
  'did:example:arbitrator'  // 指定仲裁员（可选）
)

console.log('仲裁请求已提交:', arbitration.id)
```

### 11. 解决仲裁

仲裁员解决争议：

```javascript
// 仲裁员身份
const arbitratorDid = await didManager.getCurrentDid()

// 解决仲裁
await contractEngine.resolveArbitration(arbitrationId, {
  decision: 'refund',
  reason: '经核实，商品确实与描述不符',
  actions: [
    {
      type: 'refund',
      assetId: 'asset_points',
      amount: 99,
      from: 'did:example:seller',
      to: 'did:example:buyer'
    },
    {
      type: 'penalty',
      assetId: 'asset_credit',
      amount: -10,
      to: 'did:example:seller'
    }
  ],
  finalStatus: 'cancelled'
})

console.log('仲裁已解决')
```

### 12. 查询合约

#### 获取单个合约

```javascript
const contract = await contractEngine.getContract(contractId)

console.log('合约标题:', contract.title)
console.log('合约类型:', contract.contract_type)
console.log('合约状态:', contract.status)
console.log('参与方:', contract.parties)
console.log('条款:', contract.terms)
```

#### 获取所有合约

```javascript
// 获取所有合约
const allContracts = await contractEngine.getAllContracts()

// 按类型查询
const tradeContracts = await contractEngine.getAllContracts({
  type: 'simple_trade'
})

// 按状态查询
const activeContracts = await contractEngine.getAllContracts({
  status: 'active'
})

// 按参与方查询
const myContracts = await contractEngine.getAllContracts({
  partyDid: 'did:example:me'
})

// 限制数量
const recent = await contractEngine.getAllContracts({ limit: 10 })
```

#### 获取我的合约

```javascript
// 我参与的所有合约
const myContracts = await contractEngine.getMyContracts()

// 我的激活合约
const myActiveContracts = await contractEngine.getMyContracts('active')

// 我的已完成合约
const myCompletedContracts = await contractEngine.getMyContracts('completed')
```

#### 搜索合约

```javascript
const results = await contractEngine.searchContracts('Vue3')

results.forEach(contract => {
  console.log(`${contract.title} - ${contract.status}`)
})
```

### 13. 获取合约详情

#### 获取条件

```javascript
const conditions = await contractEngine.getConditions(contractId)

conditions.forEach(condition => {
  console.log('条件类型:', condition.condition_type)
  console.log('是否必需:', condition.is_required ? '是' : '否')
  console.log('是否满足:', condition.is_met ? '是' : '否')
  if (condition.is_met) {
    console.log('满足时间:', new Date(condition.met_at).toLocaleString())
    console.log('满足者:', condition.met_by)
  }
})
```

#### 获取签名

```javascript
const signatures = await contractEngine.getSignatures(contractId)

signatures.forEach(sig => {
  console.log('签名者:', sig.signer_did)
  console.log('签名时间:', new Date(sig.signed_at).toLocaleString())
})
```

#### 获取事件日志

```javascript
const events = await contractEngine.getEvents(contractId)

events.forEach(event => {
  console.log(`[${event.event_type}]`, event.actor_did)
  console.log('时间:', new Date(event.created_at).toLocaleString())
  if (event.event_data) {
    console.log('数据:', event.event_data)
  }
})
```

#### 获取仲裁信息

```javascript
const arbitration = await contractEngine.getArbitration(contractId)

if (arbitration) {
  console.log('仲裁状态:', arbitration.status)
  console.log('发起人:', arbitration.initiator_did)
  console.log('仲裁员:', arbitration.arbitrator_did)
  console.log('理由:', arbitration.reason)

  if (arbitration.resolution) {
    console.log('解决方案:', arbitration.resolution)
  }
}
```

### 14. 统计信息

```javascript
const stats = await contractEngine.getStatistics()

console.log('总合约数:', stats.total)
console.log('我的合约数:', stats.myContracts)

console.log('\n按状态统计:')
Object.entries(stats.byStatus).forEach(([status, count]) => {
  console.log(`  ${status}: ${count}`)
})

console.log('\n按类型统计:')
Object.entries(stats.byType).forEach(([type, count]) => {
  console.log(`  ${type}: ${count}`)
})
```

---

## 完整示例

### 示例1: 商品交易流程

```javascript
// 1. 卖家创建销售合约
const sellerId = 'did:example:seller'
const buyerId = 'did:example:buyer'

const contract = await contractEngine.createContract({
  type: 'simple_trade',
  escrowType: 'conditional',
  title: 'iPhone 13 Pro 出售',
  description: '九成新，无划痕，配件齐全',
  parties: [sellerId, buyerId],
  terms: {
    product: 'iPhone 13 Pro 256GB',
    condition: '9成新',
    price: 5000,
    priceAssetId: 'asset_points'
  },
  assetTransfers: [
    {
      assetId: 'asset_iphone',
      toDid: buyerId,
      amount: 1
    }
  ],
  requiredSignatures: 2
})

// 2. 添加条件
await contractEngine.addCondition(contract.id, {
  type: 'payment_received',
  data: { amount: 5000, assetId: 'asset_points' },
  required: true
})

await contractEngine.addCondition(contract.id, {
  type: 'delivery_confirmed',
  data: { trackingNumber: 'SF1234567890' },
  required: true
})

// 3. 双方签署
// 卖家签署
await contractEngine.signContract(contract.id, 'seller_signature')

// 买家签署（自动激活）
await contractEngine.signContract(contract.id, 'buyer_signature')

// 4. 买家付款（满足付款条件）
const conditions = await contractEngine.getConditions(contract.id)
const paymentCondition = conditions.find(c => c.condition_type === 'payment_received')
await contractEngine.meetCondition(contract.id, paymentCondition.id, {
  transactionId: 'pay_123'
})

// 5. 卖家发货并更新物流
// ...

// 6. 买家确认收货（满足交付条件）
const deliveryCondition = conditions.find(c => c.condition_type === 'delivery_confirmed')
await contractEngine.meetCondition(contract.id, deliveryCondition.id, {
  receivedAt: Date.now(),
  satisfied: true
})

// 7. 合约自动执行（转移资产）
// 8. 完成合约
await contractEngine.completeContract(contract.id)

console.log('交易完成！')
```

### 示例2: 订阅服务

```javascript
// 1. 创建订阅合约
const subscription = await contractEngine.createContract({
  type: 'subscription',
  escrowType: 'timelock',
  title: '年度VIP会员',
  parties: ['did:example:user', 'did:example:platform'],
  terms: {
    duration: 365 * 24 * 60 * 60 * 1000,
    price: 999,
    priceAssetId: 'asset_points',
    benefits: ['无限访问', '优先支持', '专属权益'],
    autoRenew: true
  },
  requiredSignatures: 1
})

// 2. 用户签署并支付
await contractEngine.signContract(subscription.id, 'user_signature')

// 3. 添加付款条件
await contractEngine.addCondition(subscription.id, {
  type: 'payment_received',
  data: { amount: 999 },
  required: true
})

// 4. 满足条件后自动激活服务
// ...

// 5. 到期前提醒续费
if (subscription.terms.autoRenew) {
  // 自动续费逻辑
}
```

### 示例3: 赏金任务

```javascript
// 1. 发布赏金
const bounty = await contractEngine.createContract({
  type: 'bounty',
  escrowType: 'conditional',
  title: '开发移动端聊天功能',
  description: '实现端到端加密的P2P聊天',
  parties: ['did:example:issuer', 'did:example:developer'],
  terms: {
    requirements: [
      '实现E2E加密',
      '支持离线消息',
      '通过所有测试'
    ],
    reward: 5000,
    deadline: Date.now() + 30 * 24 * 60 * 60 * 1000
  }
})

// 2. 添加交付条件
await contractEngine.addCondition(bounty.id, {
  type: 'delivery_confirmed',
  data: {
    deliverables: ['源代码', '测试报告', '文档']
  },
  required: true
})

await contractEngine.addCondition(bounty.id, {
  type: 'approval_count',
  data: {
    required: 1,
    approvers: ['did:example:issuer']
  },
  required: true
})

// 3. 开发者接受并签署
await contractEngine.signContract(bounty.id, 'dev_signature')

// 4. 开发者提交成果
await contractEngine.meetCondition(bounty.id, deliveryConditionId, {
  githubRepo: 'https://github.com/dev/chat-feature',
  testReport: 'ipfs://Qm...',
  docs: 'ipfs://Qm...'
})

// 5. 发布者审核并批准
await contractEngine.meetCondition(bounty.id, approvalConditionId, {
  approved: true,
  reviewComment: '完成质量很高，符合所有要求'
})

// 6. 自动执行奖励发放
// 7. 完成合约
await contractEngine.completeContract(bounty.id)
```

---

## 自动执行

合约引擎会自动执行以下操作：

1. **签名检查**: 当签名数量达到要求时，自动激活合约
2. **条件检查**: 定期检查所有激活合约的条件
3. **自动执行**: 条件满足后自动执行合约
4. **过期处理**: 自动取消已过期的合约

```javascript
// 自动执行已在初始化时启动
// 默认每60秒检查一次

// 如需调整检查间隔
contractEngine.autoExecuteInterval = 30 * 1000  // 30秒

// 停止自动执行
contractEngine.stopAutoExecute()

// 重新启动
contractEngine._startAutoExecute()
```

---

## 常见问题

### Q1: 如何确保合约安全？

1. **多方签名**: 使用multisig托管类型
2. **条件验证**: 添加必需条件，严格验证
3. **仲裁机制**: 预设仲裁员处理争议
4. **时间锁**: 使用timelock增加冷静期

### Q2: 合约可以修改吗？

不可以。合约一旦创建就不能修改条款。如需修改，应取消原合约并创建新合约。

### Q3: 如何处理合约争议？

1. 参与方提出争议: `disputeContract()`
2. 请求仲裁: `requestArbitration()`
3. 仲裁员调查并解决: `resolveArbitration()`

### Q4: 自动执行会出错吗？

合约引擎会进行多重验证：
- 状态检查
- 条件验证
- 资产余额验证
- 权限验证

出错时会记录日志，不会执行操作。

### Q5: 如何查看合约历史？

```javascript
// 查看事件日志
const events = await contractEngine.getEvents(contractId)

// 查看条件变化
const conditions = await contractEngine.getConditions(contractId)

// 查看签名历史
const signatures = await contractEngine.getSignatures(contractId)
```

---

更多信息请参考完整报告: `MOBILE_CONTRACT_COMPLETE_REPORT.md`
