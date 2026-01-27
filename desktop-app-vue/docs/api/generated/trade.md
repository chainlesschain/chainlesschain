# trade

**Source**: `src\renderer\stores\trade.js`

**Generated**: 2026-01-27T06:44:03.889Z

---

## export const useTradeStore = defineStore('trade',

```javascript
export const useTradeStore = defineStore('trade',
```

* 交易模块主Store
 *
 * 管理8个子模块的状态:
 * 1. 资产管理 (asset)
 * 2. 交易市场 (marketplace)
 * 3. 托管管理 (escrow)
 * 4. 智能合约 (contract)
 * 5. 信用评分 (credit)
 * 6. 评价管理 (review)
 * 7. 知识付费 (knowledge)
 * 8. UI状态 (ui)

---

## getAssetById: (state) => (assetId) =>

```javascript
getAssetById: (state) => (assetId) =>
```

* 根据ID获取资产

---

## myTokenAssets: (state) =>

```javascript
myTokenAssets: (state) =>
```

* 我的通证资产

---

## myNFTAssets: (state) =>

```javascript
myNFTAssets: (state) =>
```

* 我的NFT资产

---

## myKnowledgeAssets: (state) =>

```javascript
myKnowledgeAssets: (state) =>
```

* 我的知识产品

---

## myServiceAssets: (state) =>

```javascript
myServiceAssets: (state) =>
```

* 我的服务凭证

---

## filteredOrders: (state) =>

```javascript
filteredOrders: (state) =>
```

* 过滤后的订单列表

---

## openOrders: (state) =>

```javascript
openOrders: (state) =>
```

* 开放的订单（可购买）

---

## filteredContracts: (state) =>

```javascript
filteredContracts: (state) =>
```

* 过滤后的合约列表

---

## activeContracts: (state) =>

```javascript
activeContracts: (state) =>
```

* 活跃的合约

---

## pendingSignContracts: (state) =>

```javascript
pendingSignContracts: (state) =>
```

* 待签名的合约

---

## creditLevel: (state) =>

```javascript
creditLevel: (state) =>
```

* 信用等级

---

## creditScore: (state) =>

```javascript
creditScore: (state) =>
```

* 信用评分

---

## creditLevelColor: (state) =>

```javascript
creditLevelColor: (state) =>
```

* 信用等级颜色

---

## async loadMyAssets(ownerDid)

```javascript
async loadMyAssets(ownerDid)
```

* 加载我的资产

---

## async loadAllAssets(filters =

```javascript
async loadAllAssets(filters =
```

* 加载所有资产

---

## async createAsset(options)

```javascript
async createAsset(options)
```

* 创建资产

---

## async transferAsset(assetId, toDid, amount, memo)

```javascript
async transferAsset(assetId, toDid, amount, memo)
```

* 转账资产

---

## async mintAsset(assetId, toDid, amount)

```javascript
async mintAsset(assetId, toDid, amount)
```

* 铸造资产

---

## async burnAsset(assetId, amount)

```javascript
async burnAsset(assetId, amount)
```

* 销毁资产

---

## async loadAssetHistory(assetId, limit = 50)

```javascript
async loadAssetHistory(assetId, limit = 50)
```

* 加载资产历史

---

## setCurrentAsset(asset)

```javascript
setCurrentAsset(asset)
```

* 设置当前资产

---

## async loadOrders(filters =

```javascript
async loadOrders(filters =
```

* 加载订单列表

---

## async loadMyOrders(userDid)

```javascript
async loadMyOrders(userDid)
```

* 加载我的订单

---

## async createOrder(options)

```javascript
async createOrder(options)
```

* 创建订单

---

## async purchaseOrder(orderId, quantity)

```javascript
async purchaseOrder(orderId, quantity)
```

* 购买订单（匹配订单）

---

## async cancelOrder(orderId)

```javascript
async cancelOrder(orderId)
```

* 取消订单

---

## async loadTransactions(filters =

```javascript
async loadTransactions(filters =
```

* 加载交易记录

---

## async confirmDelivery(transactionId)

```javascript
async confirmDelivery(transactionId)
```

* 确认交付

---

## async requestRefund(transactionId, reason)

```javascript
async requestRefund(transactionId, reason)
```

* 申请退款

---

## setMarketplaceFilter(key, value)

```javascript
setMarketplaceFilter(key, value)
```

* 设置市场筛选条件

---

## setCurrentOrder(order)

```javascript
setCurrentOrder(order)
```

* 设置当前订单

---

## async loadEscrows(filters =

```javascript
async loadEscrows(filters =
```

* 加载托管列表

---

## async loadEscrowDetail(escrowId)

```javascript
async loadEscrowDetail(escrowId)
```

* 加载托管详情

---

## async loadEscrowHistory(escrowId)

```javascript
async loadEscrowHistory(escrowId)
```

* 加载托管历史

---

## async disputeEscrow(escrowId, reason)

```javascript
async disputeEscrow(escrowId, reason)
```

* 发起托管争议

---

## async loadEscrowStatistics()

```javascript
async loadEscrowStatistics()
```

* 加载托管统计

---

## async loadContracts(filters =

```javascript
async loadContracts(filters =
```

* 加载合约列表

---

## async loadContractTemplates()

```javascript
async loadContractTemplates()
```

* 加载合约模板

---

## async createContract(options)

```javascript
async createContract(options)
```

* 创建合约

---

## async createContractFromTemplate(templateId, params)

```javascript
async createContractFromTemplate(templateId, params)
```

* 从模板创建合约

---

## async activateContract(contractId)

```javascript
async activateContract(contractId)
```

* 激活合约

---

## async signContract(contractId, signature)

```javascript
async signContract(contractId, signature)
```

* 签名合约

---

## async executeContract(contractId)

```javascript
async executeContract(contractId)
```

* 执行合约

---

## async cancelContract(contractId, reason)

```javascript
async cancelContract(contractId, reason)
```

* 取消合约

---

## async checkContractConditions(contractId)

```javascript
async checkContractConditions(contractId)
```

* 检查合约条件

---

## async loadContractConditions(contractId)

```javascript
async loadContractConditions(contractId)
```

* 加载合约条件

---

## async loadContractEvents(contractId)

```javascript
async loadContractEvents(contractId)
```

* 加载合约事件

---

## async initiateArbitration(contractId, reason, evidence)

```javascript
async initiateArbitration(contractId, reason, evidence)
```

* 发起仲裁

---

## async resolveArbitration(arbitrationId, resolution)

```javascript
async resolveArbitration(arbitrationId, resolution)
```

* 解决仲裁

---

## setContractFilter(key, value)

```javascript
setContractFilter(key, value)
```

* 设置合约筛选条件

---

## setCurrentContract(contract)

```javascript
setCurrentContract(contract)
```

* 设置当前合约

---

## async loadUserCredit(userDid)

```javascript
async loadUserCredit(userDid)
```

* 加载用户信用信息

---

## async updateCreditScore(userDid)

```javascript
async updateCreditScore(userDid)
```

* 更新信用评分

---

## async loadScoreHistory(userDid, limit = 50)

```javascript
async loadScoreHistory(userDid, limit = 50)
```

* 加载评分历史

---

## async loadLeaderboard(limit = 50)

```javascript
async loadLeaderboard(limit = 50)
```

* 加载信用排行榜

---

## async loadCreditStatistics()

```javascript
async loadCreditStatistics()
```

* 加载信用统计

---

## async loadReviews(targetId, targetType, filters =

```javascript
async loadReviews(targetId, targetType, filters =
```

* 加载评价列表

---

## async loadMyReviews(userDid)

```javascript
async loadMyReviews(userDid)
```

* 加载我的评价

---

## async createReview(options)

```javascript
async createReview(options)
```

* 创建评价

---

## async updateReview(reviewId, updates)

```javascript
async updateReview(reviewId, updates)
```

* 更新评价

---

## async replyToReview(reviewId, content)

```javascript
async replyToReview(reviewId, content)
```

* 回复评价

---

## async markReviewHelpful(reviewId, helpful)

```javascript
async markReviewHelpful(reviewId, helpful)
```

* 标记评价为有帮助/无帮助

---

## async reportReview(reviewId, reason, description)

```javascript
async reportReview(reviewId, reason, description)
```

* 举报评价

---

## async loadReviewStatistics(targetId, targetType)

```javascript
async loadReviewStatistics(targetId, targetType)
```

* 加载评价统计

---

## async loadKnowledgeContents(filters =

```javascript
async loadKnowledgeContents(filters =
```

* 加载知识内容列表

---

## async loadMyContents(creatorDid)

```javascript
async loadMyContents(creatorDid)
```

* 加载我的创作内容

---

## async createKnowledgeContent(options)

```javascript
async createKnowledgeContent(options)
```

* 创建知识内容

---

## async updateKnowledgeContent(contentId, updates)

```javascript
async updateKnowledgeContent(contentId, updates)
```

* 更新知识内容

---

## async purchaseContent(contentId, paymentAssetId)

```javascript
async purchaseContent(contentId, paymentAssetId)
```

* 购买内容

---

## async subscribeToCreator(planId, paymentAssetId)

```javascript
async subscribeToCreator(planId, paymentAssetId)
```

* 订阅创作者

---

## async unsubscribe(planId)

```javascript
async unsubscribe(planId)
```

* 取消订阅

---

## async loadMyPurchases(userDid)

```javascript
async loadMyPurchases(userDid)
```

* 加载我的购买记录

---

## async loadMySubscriptions(userDid)

```javascript
async loadMySubscriptions(userDid)
```

* 加载我的订阅

---

## async accessContent(contentId)

```javascript
async accessContent(contentId)
```

* 访问内容（解密）

---

## async checkContentAccess(contentId, userDid)

```javascript
async checkContentAccess(contentId, userDid)
```

* 检查内容访问权限

---

## async loadKnowledgeStatistics(creatorDid)

```javascript
async loadKnowledgeStatistics(creatorDid)
```

* 加载知识统计（创作者）

---

## setActiveTab(tab)

```javascript
setActiveTab(tab)
```

* 设置活跃Tab

---

## setSelectedDid(did)

```javascript
setSelectedDid(did)
```

* 设置选中的DID

---

## initUI()

```javascript
initUI()
```

* 初始化UI状态

---

