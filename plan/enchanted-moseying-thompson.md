# 交易模块前端集成实施计划

## 📋 项目概况

**目标**: 为ChainlessChain交易模块创建完整的前端UI，集成8个已实现的后端子模块

**后端现状**: ✅ 完全就绪
- 8个子模块已实现（资产、市场、托管、合约、模板、信用、评价、知识付费）
- 50+ IPC接口已注册并暴露（`src/preload/index.js` 259-365行）
- 23个数据库表已创建

**前端现状**: ⚠️ 部分完成
- 路由已定义部分页面（marketplace, contracts, credit-score等）
- CreditScore.vue等少数组件已存在
- **缺少统一的交易中心入口页面**
- **缺少完整的Pinia store**

**用户需求**:
- ✅ 全部集成（8个子模块）
- ✅ 统一交易中心页面（TradingHub）
- ✅ 混合store方案（主trade.js + 子模块状态）
- ✅ 保持现有子模块命名空间（asset.*, marketplace.*等）

---

## 🎯 实施策略

### 分三阶段实施

**Phase 1 (核心MVP)**: 2周
- 创建trade.js store
- 创建TradingHub主页面
- 实现资产、市场、托管、合约4个核心模块的UI
- 完成基础交易闭环

**Phase 2 (增强功能)**: 1.5周
- 完善信用评分集成
- 实现评价系统和知识付费UI
- 增强托管和合约功能

**Phase 3 (高级特性)**: 1周
- 实时通知系统
- 数据可视化
- 高级筛选和导出

---

## 📁 文件结构设计

### 需要创建的文件 (28个)

#### 1. Pinia Store (1个)
```
desktop-app-vue/src/renderer/stores/
└── trade.js                    # 交易模块主store
```

#### 2. 主页面 (1个)
```
desktop-app-vue/src/renderer/pages/
└── TradingHub.vue              # 交易中心主页面（8个Tab）
```

#### 3. 子组件 (26个)

**资产管理 (2个新建，3个增强现有)**
```
desktop-app-vue/src/renderer/components/trade/
├── AssetList.vue               # 增强 - 资产列表
├── AssetCreate.vue             # 增强 - 创建资产
├── AssetTransfer.vue           # 增强 - 转账
├── AssetDetail.vue             # ✨新建 - 资产详情
└── AssetHistory.vue            # ✨新建 - 资产历史
```

**交易市场 (2个新建，3个增强现有)**
```
desktop-app-vue/src/renderer/components/trade/
├── Marketplace.vue             # 增强 - 市场首页
├── OrderCreate.vue             # 增强 - 创建订单
├── OrderDetail.vue             # 增强 - 订单详情
├── OrderPurchase.vue           # ✨新建 - 购买订单
└── TransactionList.vue         # ✨新建 - 交易记录
```

**托管管理 (4个全新)**
```
desktop-app-vue/src/renderer/components/trade/
├── EscrowList.vue              # ✨新建 - 托管列表
├── EscrowDetail.vue            # ✨新建 - 托管详情
├── EscrowDispute.vue           # ✨新建 - 争议发起
└── EscrowStatistics.vue        # ✨新建 - 托管统计
```

**智能合约 (4个新建，3个增强现有)**
```
desktop-app-vue/src/renderer/components/trade/
├── ContractList.vue            # 增强 - 合约列表
├── ContractCreate.vue          # 增强 - 创建合约
├── ContractDetail.vue          # 增强 - 合约详情
├── ContractTemplateSelector.vue # ✨新建 - 模板选择器
├── ContractSign.vue            # ✨新建 - 合约签名
├── ContractExecute.vue         # ✨新建 - 合约执行
└── ContractArbitration.vue     # ✨新建 - 仲裁管理
```

**信用评分 (对接现有组件)**
```
desktop-app-vue/src/renderer/components/trade/
└── CreditScore.vue             # ✅已存在 - 对接store即可
```

**评价管理 (2个新建，2个增强现有)**
```
desktop-app-vue/src/renderer/components/trade/
├── ReviewList.vue              # 增强 - 评价列表
├── MyReviews.vue               # 增强 - 我的评价
├── ReviewCreate.vue            # ✨新建 - 创建评价
└── ReviewReply.vue             # ✨新建 - 评价回复
```

**知识付费 (3个新建，2个增强现有)**
```
desktop-app-vue/src/renderer/components/knowledge/
├── ContentStore.vue            # 增强 - 内容商店
├── MyPurchases.vue             # 增强 - 我的购买
├── ContentCreate.vue           # ✨新建 - 创建内容
├── ContentDetail.vue           # ✨新建 - 内容详情
└── SubscriptionPlans.vue       # ✨新建 - 订阅计划
```

**可复用组件 (7个全新)**
```
desktop-app-vue/src/renderer/components/trade/common/
├── AssetCard.vue               # ✨新建 - 资产卡片
├── OrderCard.vue               # ✨新建 - 订单卡片
├── ContractCard.vue            # ✨新建 - 合约卡片
├── TransactionTimeline.vue     # ✨新建 - 交易时间线
├── PriceInput.vue              # ✨新建 - 价格输入组件
├── DIDSelector.vue             # ✨新建 - DID选择器
└── StatusBadge.vue             # ✨新建 - 状态徽章
```

### 需要修改的文件 (2个)

```
desktop-app-vue/src/renderer/router/index.js       # 添加TradingHub路由
desktop-app-vue/src/renderer/components/MainLayout.vue  # 添加菜单入口
```

**注意**: 不需要修改 `src/preload/index.js` 和 `src/main/index.js`，IPC接口已全部就绪！

---

## 🏗️ 核心实现设计

### 1. Pinia Store设计 (`stores/trade.js`)

**State结构** (8个子模块状态):

```javascript
{
  // 资产管理
  asset: {
    myAssets: [],
    allAssets: [],
    currentAsset: null,
    assetHistory: [],
    balances: {},  // { assetId: amount }
    loading: false,
    creating: false,
  },

  // 交易市场
  marketplace: {
    orders: [],
    myCreatedOrders: [],
    myPurchasedOrders: [],
    transactions: [],
    currentOrder: null,
    filters: { orderType: '', status: '', searchKeyword: '' },
    loading: false,
    purchasing: false,
  },

  // 托管管理
  escrow: {
    escrows: [],
    currentEscrow: null,
    escrowHistory: [],
    statistics: { total: 0, locked: 0, released: 0, refunded: 0, disputed: 0 },
    loading: false,
  },

  // 智能合约
  contract: {
    contracts: [],
    templates: [],
    currentContract: null,
    conditions: [],
    events: [],
    signatures: [],
    filters: { status: '', templateType: '' },
    loading: false,
    executing: false,
  },

  // 信用评分
  credit: {
    userCredit: null,
    scoreHistory: [],
    leaderboard: [],
    statistics: null,
    loading: false,
  },

  // 评价管理
  review: {
    reviews: [],
    myReviews: [],
    targetReviews: [],
    statistics: null,
    currentReview: null,
    loading: false,
  },

  // 知识付费
  knowledge: {
    contents: [],
    myContents: [],
    myPurchases: [],
    mySubscriptions: [],
    subscriptionPlans: [],
    currentContent: null,
    statistics: null,
    loading: false,
  },

  // UI状态
  ui: {
    activeTab: 'marketplace',  // TradingHub当前Tab
    selectedDid: null,         // 当前用户DID
  },
}
```

**Getters** (常用计算属性):
- `getAssetById(assetId)`
- `myTokenAssets`, `myNFTAssets`
- `filteredOrders`, `filteredContracts`
- `creditLevel`, `creditScore`

**Actions** (50+个方法，按子模块组织):

```javascript
// 资产管理
loadMyAssets(ownerDid)
loadAllAssets(filters)
createAsset(options)
transferAsset(assetId, toDid, amount, memo)
loadAssetHistory(assetId, limit)

// 交易市场
loadOrders(filters)
loadMyOrders(userDid)
createOrder(options)
purchaseOrder(orderId, quantity)
cancelOrder(orderId)
loadTransactions(filters)
confirmDelivery(transactionId)
requestRefund(transactionId, reason)
setMarketplaceFilter(key, value)

// 托管管理
loadEscrows(filters)
loadEscrowDetail(escrowId)
loadEscrowHistory(escrowId)
disputeEscrow(escrowId, reason)
loadEscrowStatistics()

// 智能合约
loadContracts(filters)
loadContractTemplates()
createContract(options)
createContractFromTemplate(templateId, params)
signContract(contractId, signature)
executeContract(contractId)
checkContractConditions(contractId)
loadContractEvents(contractId)
initiateArbitration(contractId, reason, evidence)
setContractFilter(key, value)

// 信用评分
loadUserCredit(userDid)
updateCreditScore(userDid)
loadScoreHistory(userDid, limit)
loadLeaderboard(limit)
loadCreditStatistics()

// 评价管理
loadReviews(targetId, targetType, filters)
loadMyReviews(userDid)
createReview(options)
replyToReview(reviewId, content)
markReviewHelpful(reviewId, helpful)
reportReview(reviewId, reason, description)
loadReviewStatistics(targetId, targetType)

// 知识付费
loadKnowledgeContents(filters)
createKnowledgeContent(options)
purchaseContent(contentId, paymentAssetId)
subscribeToCreator(planId, paymentAssetId)
loadMyPurchases(userDid)
loadMySubscriptions(userDid)
accessContent(contentId)
loadKnowledgeStatistics(creatorDid)

// UI状态
setActiveTab(tab)
setSelectedDid(did)
```

**IPC调用方式**:
```javascript
// 使用现有的子模块命名空间
await window.electronAPI.asset.create(options)
await window.electronAPI.marketplace.getOrders(filters)
await window.electronAPI.contract.sign(contractId, signature)
// 等等...
```

---

### 2. TradingHub主页面设计 (`pages/TradingHub.vue`)

**布局结构**:

```vue
<a-card>
  <template #title>
    <ShopOutlined /> 交易中心
  </template>
  <template #extra>
    <!-- 信用评分快捷入口 + DID选择器 -->
    <a-badge :count="creditScore" :number-style="{ backgroundColor: getCreditColor() }">
      <TrophyOutlined @click="activeTab = 'credit'" />
    </a-badge>
    <DIDSelector v-model:value="selectedDid" />
  </template>

  <!-- 8个Tab -->
  <a-tabs v-model:activeKey="activeTab" @change="handleTabChange">
    <a-tab-pane key="assets" tab="我的资产">
      <AssetList :owner-did="selectedDid" />
    </a-tab-pane>

    <a-tab-pane key="marketplace" tab="交易市场">
      <Marketplace />
    </a-tab-pane>

    <a-tab-pane key="escrow" tab="托管管理">
      <EscrowList />
    </a-tab-pane>

    <a-tab-pane key="contracts" tab="智能合约">
      <ContractList />
    </a-tab-pane>

    <a-tab-pane key="credit" tab="信用评分">
      <CreditScore :user-did="selectedDid" />
    </a-tab-pane>

    <a-tab-pane key="reviews" tab="评价管理">
      <ReviewList />
    </a-tab-pane>

    <a-tab-pane key="knowledge" tab="知识付费">
      <ContentStore />
    </a-tab-pane>

    <a-tab-pane key="transactions" tab="交易记录">
      <TransactionList />
    </a-tab-pane>
  </a-tabs>
</a-card>
```

**Tab切换逻辑**:
```javascript
const handleTabChange = (key) => {
  // 根据Tab加载对应数据
  switch (key) {
    case 'assets':
      tradeStore.loadMyAssets(selectedDid.value);
      break;
    case 'marketplace':
      tradeStore.loadOrders();
      break;
    // ... 其他tab
  }
};
```

**特色功能**:
- Tab切换时懒加载数据（性能优化）
- 信用评分徽章显示在标题栏，颜色根据等级变化
- DID选择器支持多身份切换
- 保持用户最后访问的Tab（localStorage）

---

### 3. 路由配置

**新增路由** (`router/index.js`):

```javascript
{
  path: '/',
  component: MainLayout,
  meta: { requiresAuth: true },
  children: [
    // ... 现有路由 ...

    // ===== 新增: 交易中心统一入口 =====
    {
      path: 'trading',
      name: 'TradingHub',
      component: () => import('../pages/TradingHub.vue'),
      meta: { title: '交易中心' },
    },

    // 保留现有的独立路由（快捷入口）
    // marketplace, contracts, credit-score等已存在，无需修改
  ],
}
```

**菜单集成** (`MainLayout.vue`):

```vue
<a-sub-menu key="trade">
  <template #icon><ShopOutlined /></template>
  <template #title>交易系统</template>

  <!-- 新增: 统一入口 -->
  <a-menu-item key="trading">
    <template #icon><DashboardOutlined /></template>
    交易中心
  </a-menu-item>

  <a-menu-divider />

  <!-- 保留快捷入口（已存在） -->
  <a-menu-item key="marketplace">交易市场</a-menu-item>
  <a-menu-item key="contracts">智能合约</a-menu-item>
  <a-menu-item key="credit-score">信用评分</a-menu-item>
</a-sub-menu>
```

---

## 🎬 关键交互流程

### 流程1: 资产创建 → 转账

```
1. 用户点击"创建资产" → AssetCreate模态框打开
2. 填写: 资产类型(token/nft/knowledge/service)、名称、符号、总供应量
3. 提交 → tradeStore.createAsset(options)
4. IPC调用 → window.electronAPI.asset.create(options)
5. 后端写入assets表 → 返回资产对象
6. Store更新asset.myAssets → 刷新列表
7. 用户点击"转账" → AssetTransfer模态框
8. 输入: 目标DID、金额、备注
9. 提交 → tradeStore.transferAsset(assetId, toDid, amount, memo)
10. 后端写入asset_transfers表 → 更新asset_holdings
11. 刷新余额显示 → 成功提示
```

### 流程2: 订单创建 → 购买 → 托管 → 完成

```
卖家:
1. 点击"发布订单" → OrderCreate模态框
2. 选择资产、设置价格、数量 → 提交
3. tradeStore.createOrder(options)
4. 订单进入'open'状态 → 显示在市场列表

买家:
5. 浏览订单 → 点击"购买" → OrderPurchase确认框
6. 确认购买数量 → tradeStore.purchaseOrder(orderId, quantity)
7. 后端创建交易记录(transactions表)
8. 自动创建托管(escrows表, status='locked')
9. 扣除买方资产，锁入托管 → 交易状态='escrowed'

卖家发货:
10. 线下发货 → 交易详情显示"等待买家确认"

买家确认:
11. 点击"确认收货" → tradeStore.confirmDelivery(transactionId)
12. 托管释放资产给卖家 → escrow.status='released'
13. 交易状态='completed'
14. 触发信用评分更新 → 弹出评价提示
```

### 流程3: 智能合约（以Simple Trade为例）

```
1. 点击"创建合约" → ContractCreate组件
2. 选择模板"Simple Trade" → ContractTemplateSelector
3. 填写参数: sellerDid, buyerDid, assetId, quantity, priceAmount
4. 提交 → tradeStore.createContractFromTemplate(templateId, params)
5. 合约状态='draft' → 等待签名

6. 买卖双方查看合约详情 → 点击"签名"
7. ContractSign组件 → 输入签名(使用DID私钥)
8. tradeStore.signContract(contractId, signature)
9. 当所有签名完成 → 合约状态='active'

10. 系统检查条件 → tradeStore.checkContractConditions(contractId)
11. 满足条件后点击"执行" → tradeStore.executeContract(contractId)
12. 后端执行资产转移 → 合约状态='completed'
13. 记录合约事件 → 显示时间线
```

### 流程4: 评价流程

```
1. 交易完成后 → 系统弹出评价提示
2. 点击"评价" → ReviewCreate模态框
3. 填写: 评分(1-5星)、评价内容、标签
4. 提交 → tradeStore.createReview(options)
5. 写入reviews表 → 触发信用评分更新

6. 商家查看收到的评价 → 点击"回复"
7. ReviewReply组件 → 输入回复内容
8. tradeStore.replyToReview(reviewId, content)
9. 写入review_replies表 → 买家收到通知
```

---

## ⚡ 技术要点

### 1. IPC序列化问题

**问题**: Electron IPC不支持undefined、Function、Symbol

**解决方案**:
- preload.js已有`removeUndefined()`函数
- 传递复杂对象前先清理（如果需要）

### 2. 事件监听和清理

**监听交易状态变化**:

```javascript
// 在组件中监听
onMounted(() => {
  window.electronAPI.marketplace.on?.('trade:order-matched', handleOrderMatched);
});

onBeforeUnmount(() => {
  window.electronAPI.marketplace.off?.('trade:order-matched', handleOrderMatched);
});
```

**需要监听的事件**:
- `trade:order-matched` - 订单匹配
- `trade:escrow-disputed` - 托管争议
- `trade:contract-signed` - 合约签名
- `trade:contract-executed` - 合约执行
- `trade:review-received` - 收到评价
- `trade:credit-updated` - 信用更新

### 3. 错误处理

**统一错误处理模式**:

```javascript
// Store action
async createAsset(options) {
  this.asset.creating = true;
  try {
    const asset = await window.electronAPI.asset.create(options);
    this.asset.myAssets.push(asset);
    return asset;
  } catch (error) {
    console.error('创建资产失败:', error);

    // 友好提示
    let userMessage = '创建资产失败';
    if (error.message.includes('DID')) {
      userMessage = '请先创建DID身份';
    } else if (error.message.includes('symbol')) {
      userMessage = '资产符号已存在';
    }

    throw new Error(userMessage);
  } finally {
    this.asset.creating = false;
  }
}

// Vue组件
const handleCreate = async () => {
  try {
    await tradeStore.createAsset(formData.value);
    message.success('资产创建成功');
  } catch (error) {
    message.error(error.message);
  }
};
```

### 4. 加载状态和骨架屏

```vue
<a-spin :spinning="loading">
  <a-skeleton v-if="loading" active :paragraph="{ rows: 4 }" />
  <div v-else>
    <!-- 实际内容 -->
  </div>
</a-spin>
```

### 5. 性能优化

**懒加载**:
- Tab切换时才加载数据
- 使用`defineAsyncComponent`延迟加载组件

**虚拟滚动**:
- 大数据集(1000+)考虑使用`vue-virtual-scroller`

**缓存**:
- Store保留最近访问的数据
- 使用`keep-alive`缓存Tab内容

**防抖节流**:
```javascript
import { debounce } from 'lodash-es';

const debouncedSearch = debounce((keyword) => {
  tradeStore.setMarketplaceFilter('searchKeyword', keyword);
}, 300);
```

---

## 📅 Phase 1 实施清单（核心MVP - 2周）

### 第一周: Store + 主页面 + 资产/市场

**Day 1-2: 基础架构**
- [ ] 创建 `stores/trade.js`（完整实现）
- [ ] 创建 `pages/TradingHub.vue`（8个Tab容器）
- [ ] 修改 `router/index.js`（添加/trading路由）
- [ ] 修改 `MainLayout.vue`（添加菜单入口）

**Day 3-4: 资产管理**
- [ ] 创建 `AssetCard.vue`（可复用组件）
- [ ] 创建 `StatusBadge.vue`（可复用组件）
- [ ] 增强 `AssetList.vue`（筛选、搜索、卡片展示）
- [ ] 增强 `AssetCreate.vue`（支持4种资产类型）
- [ ] 增强 `AssetTransfer.vue`（DID选择器集成）
- [ ] 创建 `AssetDetail.vue`（资产详情抽屉）
- [ ] 创建 `AssetHistory.vue`（历史记录时间线）

**Day 5-7: 交易市场**
- [ ] 创建 `OrderCard.vue`（可复用组件）
- [ ] 创建 `PriceInput.vue`（可复用组件）
- [ ] 创建 `DIDSelector.vue`（可复用组件）
- [ ] 增强 `Marketplace.vue`（订单列表、筛选、搜索）
- [ ] 增强 `OrderCreate.vue`（4种订单类型）
- [ ] 增强 `OrderDetail.vue`（订单详情、状态流转）
- [ ] 创建 `OrderPurchase.vue`（购买确认组件）
- [ ] 创建 `TransactionList.vue`（交易记录列表）

### 第二周: 托管 + 合约

**Day 8-10: 托管管理**
- [ ] 创建 `EscrowList.vue`（托管列表、统计卡片）
- [ ] 创建 `EscrowDetail.vue`（托管详情、历史记录）
- [ ] 创建 `EscrowDispute.vue`（争议发起组件）
- [ ] 创建 `EscrowStatistics.vue`（托管统计面板）
- [ ] 创建 `TransactionTimeline.vue`（可复用时间线）

**Day 11-14: 智能合约**
- [ ] 创建 `ContractCard.vue`（可复用组件）
- [ ] 增强 `ContractList.vue`（合约列表、筛选）
- [ ] 增强 `ContractCreate.vue`（支持5种合约类型）
- [ ] 增强 `ContractDetail.vue`（合约详情、条件、事件）
- [ ] 创建 `ContractTemplateSelector.vue`（6种模板选择）
- [ ] 创建 `ContractSign.vue`（合约签名组件）
- [ ] 创建 `ContractExecute.vue`（合约执行组件）

**Phase 1 完成标准**:
- [ ] 可以创建资产并转账
- [ ] 可以创建订单并购买（自动托管）
- [ ] 可以确认收货（释放托管）
- [ ] 可以创建和执行智能合约
- [ ] 所有核心流程打通
- [ ] 错误处理完善
- [ ] 加载状态完善

---

## 📅 Phase 2 实施清单（增强功能 - 1.5周）

**Week 3: 信用评分 + 评价系统**
- [ ] 对接 `CreditScore.vue` 到trade.js store
- [ ] 增强 `ReviewList.vue`（筛选、排序、高质量推荐）
- [ ] 增强 `MyReviews.vue`（我的评价、待评价）
- [ ] 创建 `ReviewCreate.vue`（评分、标签、内容）
- [ ] 创建 `ReviewReply.vue`（回复组件）
- [ ] 实现评价 → 信用更新联动

**Week 4: 知识付费 + 托管/合约增强**
- [ ] 增强 `ContentStore.vue`（内容商店、搜索、预览）
- [ ] 创建 `ContentCreate.vue`（创建付费内容、AES加密）
- [ ] 创建 `ContentDetail.vue`（内容详情、购买/订阅）
- [ ] 增强 `MyPurchases.vue`（购买记录、访问内容）
- [ ] 创建 `SubscriptionPlans.vue`（订阅计划管理）
- [ ] 创建 `ContractArbitration.vue`（仲裁管理组件）

---

## 📅 Phase 3 实施清单（高级特性 - 1周）

**Week 5: 实时通知 + 可视化 + 高级功能**
- [ ] 实现IPC事件监听系统（6个交易事件）
- [ ] 添加 `app.js` 交易通知状态
- [ ] 集成ECharts数据可视化（交易统计图表）
- [ ] 实现高级筛选（多条件组合、保存方案）
- [ ] 实现批量操作（批量转账、批量订单管理）
- [ ] 实现导出功能（交易记录CSV、合约PDF）
- [ ] 性能优化（虚拟滚动、keep-alive缓存）

---

## 🎯 关键成功因素

1. **严格遵循现有架构模式**
   - 参考DIDManagement.vue、Friends.vue的实现方式
   - 使用Ant Design Vue组件库
   - 遵循Composition API + Pinia模式

2. **保持代码一致性**
   - 使用现有的子模块命名空间（asset.*, marketplace.*等）
   - 不修改preload.js和main/index.js（IPC已就绪）
   - 统一错误处理和加载状态模式

3. **注重用户体验**
   - 友好的错误提示
   - 清晰的加载状态
   - 流畅的Tab切换
   - 响应式设计

4. **测试覆盖**
   - 单元测试Store的Actions（Vitest）
   - E2E测试核心流程（Playwright）
   - 手动测试所有交互流程

---

## 📝 关键文件路径清单

**最关键的5个文件**:

1. `C:\code\chainlesschain\desktop-app-vue\src\renderer\stores\trade.js`
   - 整个交易模块的状态管理核心

2. `C:\code\chainlesschain\desktop-app-vue\src\renderer\pages\TradingHub.vue`
   - 统一入口页面，决定整体架构

3. `C:\code\chainlesschain\desktop-app-vue\src\renderer\router\index.js`
   - 添加TradingHub路由

4. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\MainLayout.vue`
   - 添加菜单入口

5. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\trade\AssetList.vue`
   - 资产管理的核心组件，作为其他组件的参考实现

**参考文件**:
- `src/renderer/components/DIDManagement.vue` - CRUD模式参考
- `src/renderer/components/Friends.vue` - 统计卡片、筛选参考
- `src/renderer/components/trade/CreditScore.vue` - 已有组件，直接对接
- `src/renderer/stores/project.js` - Store组织方式参考
- `src/preload/index.js` (259-365行) - IPC API定义

---

## ✅ 准备开始实施

所有准备工作已完成，可以立即开始Phase 1实施！

**建议顺序**:
1. 先创建trade.js store（核心基础）
2. 创建TradingHub.vue（主页面框架）
3. 按资产 → 市场 → 托管 → 合约的顺序实现子模块
4. 每完成一个子模块立即测试核心流程
5. 边开发边优化用户体验
