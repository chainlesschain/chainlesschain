# Marketplace 组件优化指南

## 概述

Marketplace.vue 从 1150 行优化为约 400 行，通过拆分为以下子组件：

## 新增子组件

### 1. MarketplaceFilters.vue (~130 行)

位置: `common/MarketplaceFilters.vue`

**功能**:

- 基础筛选器（订单类型、搜索框）
- 高级筛选面板（价格范围、日期、排序）
- 搜索建议（基于历史记录）

**Props**:

```javascript
{
  modelValue: { orderType: '', keyword: '' },
  advancedFilters: { priceMin, priceMax, dateRange, sortBy, sortOrder },
  searchHistory: []
}
```

**Events**:

- `update:modelValue` - 筛选值变化
- `update:advancedFilters` - 高级筛选值变化
- `search` - 搜索触发
- `apply` - 应用高级筛选
- `reset` - 重置筛选

### 2. MyOrdersTab.vue (~170 行)

位置: `common/MyOrdersTab.vue`

**功能**:

- 我发布的订单列表
- 我购买的订单列表
- 订单状态显示
- 操作按钮（查看、编辑、取消）

**Props**:

```javascript
{
  loading: false,
  createdOrders: [],
  purchasedOrders: []
}
```

**Events**:

- `view` - 查看订单
- `edit` - 编辑订单
- `cancel` - 取消订单
- `create` - 创建新订单
- `confirmDelivery` - 确认收货
- `requestRefund` - 申请退款

### 3. PurchaseConfirmModal.vue (~100 行)

位置: `common/PurchaseConfirmModal.vue`

**功能**:

- 购买确认对话框
- 数量选择
- 总价计算
- 交易条款确认

**Props**:

```javascript
{
  open: false,
  order: null,
  loading: false
}
```

**Events**:

- `update:open` - 控制显示
- `confirm` - 确认购买

## 使用示例

### 优化后的 Marketplace.vue 模板

```vue
<template>
  <div class="marketplace-container">
    <a-card>
      <template #title>
        <a-space>
          <shop-outlined />
          <span>交易市场</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon><plus-outlined /></template>
            发布订单
          </a-button>
          <a-button @click="loadOrders">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <a-tabs v-model:active-key="activeTab" @change="handleTabChange">
        <!-- 市场订单 -->
        <a-tab-pane key="market" tab="市场订单">
          <!-- 使用筛选器组件 -->
          <marketplace-filters
            v-model="filterState"
            v-model:advanced-filters="advancedFilters"
            :search-history="searchHistory"
            @search="handleSearch"
            @apply="applyAdvancedFilters"
            @reset="resetAdvancedFilters"
          />

          <!-- 订单列表 -->
          <a-spin :spinning="loading">
            <a-row :gutter="[16, 16]">
              <a-col
                v-for="order in displayOrders"
                :key="order.id"
                :xs="24"
                :sm="12"
                :md="12"
                :lg="8"
                :xl="6"
              >
                <order-card
                  :order="order"
                  :current-user-did="currentDid"
                  @view="handleViewOrder"
                  @purchase="handlePurchase"
                  @cancel="handleCancelOrder"
                  @edit="handleEditOrder"
                  @share="handleShareOrder"
                />
              </a-col>
            </a-row>

            <a-empty
              v-if="!loading && displayOrders.length === 0"
              :description="emptyDescription"
            >
              <a-button
                v-if="showCreateButton"
                type="primary"
                @click="showCreateModal = true"
              >
                发布第一个订单
              </a-button>
            </a-empty>

            <!-- 分页 -->
            <marketplace-pagination
              v-if="pagination.total > 0"
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="pagination.total"
              @change="handlePageChange"
            />
          </a-spin>
        </a-tab-pane>

        <!-- 我的订单 - 使用子组件 -->
        <a-tab-pane key="myOrders" tab="我的订单">
          <my-orders-tab
            :loading="loadingMyOrders"
            :created-orders="myCreatedOrders"
            :purchased-orders="myPurchasedOrders"
            @view="handleViewOrder"
            @edit="handleEditOrder"
            @cancel="handleCancelOrder"
            @create="showCreateModal = true"
            @confirm-delivery="handleConfirmDelivery"
            @request-refund="handleRequestRefund"
          />
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 对话框 -->
    <order-create
      v-model:open="showCreateModal"
      @created="handleOrderCreated"
    />
    <order-detail v-model:open="showDetailModal" :order="selectedOrder" />
    <order-edit v-model:open="showEditModal" :order="selectedOrder" />
    <order-share-modal v-model:open="showShareModal" :order="selectedOrder" />

    <!-- 使用购买确认组件 -->
    <purchase-confirm-modal
      v-model:open="showPurchaseModal"
      :order="selectedOrder"
      :loading="purchaseLoading"
      @confirm="handleConfirmPurchase"
    />
  </div>
</template>

<script setup>
import MarketplaceFilters from "./common/MarketplaceFilters.vue";
import MyOrdersTab from "./common/MyOrdersTab.vue";
import PurchaseConfirmModal from "./common/PurchaseConfirmModal.vue";
// ... 其他导入

// 状态管理更简洁
const filterState = ref({ orderType: "", keyword: "" });
const advancedFilters = reactive({
  priceMin: null,
  priceMax: null,
  dateRange: null,
  sortBy: "created_at",
  sortOrder: "desc",
});

// ... 其余逻辑
</script>
```

## 迁移步骤

1. **创建子组件**（已完成）
   - [x] MarketplaceFilters.vue
   - [x] MyOrdersTab.vue
   - [x] PurchaseConfirmModal.vue

2. **更新 Marketplace.vue**
   - [ ] 导入新组件
   - [ ] 替换模板中的对应部分
   - [ ] 更新事件处理函数
   - [ ] 移除重复的工具函数

3. **测试验证**
   - [ ] 基础筛选功能
   - [ ] 高级筛选功能
   - [ ] 我的订单列表
   - [ ] 购买流程
   - [ ] 所有对话框

## 预期效果

| 指标                 | 优化前 | 优化后 |
| -------------------- | ------ | ------ |
| Marketplace.vue 行数 | 1150   | ~400   |
| 模板复杂度           | 高     | 低     |
| 可复用性             | 低     | 高     |
| 测试难度             | 高     | 低     |
| 维护成本             | 高     | 低     |

## 子组件复用

这些子组件可以在其他地方复用：

- **MarketplaceFilters**: 任何需要筛选功能的列表页
- **MyOrdersTab**: 其他订单相关页面
- **PurchaseConfirmModal**: 任何购买确认场景
