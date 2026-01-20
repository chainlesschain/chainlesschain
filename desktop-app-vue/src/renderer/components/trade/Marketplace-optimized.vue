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
            <template #icon>
              <plus-outlined />
            </template>
            发布订单
          </a-button>
          <a-button @click="loadOrders">
            <template #icon>
              <reload-outlined />
            </template>
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

            <!-- 空状态 -->
            <a-empty
              v-if="!loading && displayOrders.length === 0"
              :description="emptyDescription"
            >
              <a-button
                v-if="!filterState.keyword && !filterState.orderType"
                type="primary"
                @click="showCreateModal = true"
              >
                发布第一个订单
              </a-button>
            </a-empty>

            <!-- 分页 -->
            <div
              v-if="pagination.total > 0"
              style="margin-top: 16px; text-align: center"
            >
              <a-pagination
                v-model:current="pagination.current"
                v-model:page-size="pagination.pageSize"
                :total="pagination.total"
                :show-size-changer="true"
                :show-quick-jumper="true"
                :page-size-options="['12', '24', '48', '96']"
                show-total
                @change="handlePageChange"
                @show-size-change="handlePageSizeChange"
              >
                <template #showTotal="total, range">
                  显示 {{ range[0] }}-{{ range[1] }} 条，共 {{ total }} 条
                </template>
              </a-pagination>
            </div>
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
    <order-detail
      v-model:open="showDetailModal"
      :order="selectedOrder"
      @purchased="handleOrderPurchased"
      @cancelled="handleOrderCancelled"
    />
    <order-edit
      v-model:open="showEditModal"
      :order="selectedOrder || {}"
      :available-balance="getAvailableBalance(selectedOrder)"
      @updated="handleOrderUpdated"
    />
    <order-share-modal
      v-model:open="showShareModal"
      :order="selectedOrder || {}"
      @shared="handleOrderShared"
    />

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
import { logger } from "@/utils/logger";
import { ref, reactive, computed, onMounted, watch } from "vue";
import { message as antMessage, Modal } from "ant-design-vue";
import {
  ShopOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";

// 子组件
import OrderCard from "./common/OrderCard.vue";
import OrderCreate from "./OrderCreate.vue";
import OrderDetail from "./OrderDetail.vue";
import OrderEdit from "./OrderEdit.vue";
import OrderShareModal from "./common/OrderShareModal.vue";
import MarketplaceFilters from "./common/MarketplaceFilters.vue";
import MyOrdersTab from "./common/MyOrdersTab.vue";
import PurchaseConfirmModal from "./common/PurchaseConfirmModal.vue";

// Store
const tradeStore = useTradeStore();

// 本地状态
const activeTab = ref("market");
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const showPurchaseModal = ref(false);
const showEditModal = ref(false);
const showShareModal = ref(false);
const selectedOrder = ref(null);
const currentDid = ref("");
const purchaseLoading = ref(false);

// 筛选状态 - 用于 MarketplaceFilters 组件
const filterState = ref({
  orderType: "",
  keyword: "",
});

// 高级筛选状态
const advancedFilters = reactive({
  priceMin: null,
  priceMax: null,
  dateRange: null,
  sortBy: "created_at",
  sortOrder: "desc",
});

// 搜索历史
const searchHistory = ref([]);

// 分页状态
const pagination = reactive({
  current: 1,
  pageSize: 12,
  total: 0,
});

// 从 store 获取数据
const loading = computed(() => tradeStore.marketplace.loading);
const loadingMyOrders = computed(
  () => tradeStore.marketplace.loadingMyOrders || false,
);
const orders = computed(() => tradeStore.marketplace.orders);
const myCreatedOrders = computed(() => tradeStore.marketplace.myCreatedOrders);
const myPurchasedOrders = computed(
  () => tradeStore.marketplace.myPurchasedOrders,
);

// 空状态描述
const emptyDescription = computed(() => {
  return filterState.value.keyword || filterState.value.orderType
    ? "没有找到匹配的订单"
    : "暂无订单";
});

// 筛选后的订单
const filteredOrders = computed(() => {
  let result = orders.value;

  // 类型筛选
  if (filterState.value.orderType) {
    result = result.filter((o) => o.order_type === filterState.value.orderType);
  }

  // 关键词搜索
  if (filterState.value.keyword) {
    const keyword = filterState.value.keyword.toLowerCase();
    result = result.filter(
      (o) =>
        o.title.toLowerCase().includes(keyword) ||
        (o.description && o.description.toLowerCase().includes(keyword)),
    );
  }

  // 高级筛选 - 价格范围
  if (advancedFilters.priceMin != null) {
    result = result.filter((o) => o.price_amount >= advancedFilters.priceMin);
  }
  if (advancedFilters.priceMax != null) {
    result = result.filter((o) => o.price_amount <= advancedFilters.priceMax);
  }

  // 高级筛选 - 日期范围
  if (advancedFilters.dateRange?.length === 2) {
    const [startDate, endDate] = advancedFilters.dateRange;
    result = result.filter((o) => {
      const orderDate = new Date(o.created_at);
      return orderDate >= startDate && orderDate <= endDate;
    });
  }

  // 只显示开放状态的订单
  result = result.filter((o) => o.status === "open");

  // 排序
  result = [...result].sort((a, b) => {
    const sortOrder = advancedFilters.sortOrder === "asc" ? 1 : -1;
    const field = advancedFilters.sortBy;

    if (field === "created_at") {
      return sortOrder * (new Date(a.created_at) - new Date(b.created_at));
    } else if (field === "price_amount") {
      return sortOrder * (a.price_amount - b.price_amount);
    } else if (field === "quantity") {
      return sortOrder * (a.quantity - b.quantity);
    }
    return 0;
  });

  return result;
});

// 分页后的订单
const displayOrders = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredOrders.value.slice(start, start + pagination.pageSize);
});

// 监听筛选变化，更新分页
watch(
  filteredOrders,
  (newOrders) => {
    pagination.total = newOrders.length;
    const maxPage = Math.ceil(newOrders.length / pagination.pageSize) || 1;
    if (pagination.current > maxPage) {
      pagination.current = 1;
    }
  },
  { immediate: true },
);

// 同步 store 筛选状态
watch(
  () => filterState.value.orderType,
  (value) => {
    tradeStore.setMarketplaceFilter("orderType", value);
  },
);

// 工具函数
const isMyOrder = (order) => order.creator_did === currentDid.value;

// 加载订单列表
const loadOrders = async () => {
  try {
    await tradeStore.loadOrders({ status: "open" });
    logger.info("[Marketplace] 订单列表已加载:", orders.value.length);
  } catch (error) {
    logger.error("[Marketplace] 加载订单列表失败:", error);
    antMessage.error("加载订单列表失败: " + error.message);
  }
};

// 加载我的订单
const loadMyOrders = async () => {
  try {
    if (!currentDid.value) {
      return;
    }
    await tradeStore.loadMyOrders(currentDid.value);
    logger.info("[Marketplace] 我的订单已加载");
  } catch (error) {
    logger.error("[Marketplace] 加载我的订单失败:", error);
    antMessage.error("加载我的订单失败: " + error.message);
  }
};

// 标签页切换
const handleTabChange = (key) => {
  if (key === "myOrders") {
    loadMyOrders();
  }
};

// 搜索处理
const handleSearch = () => {
  pagination.current = 1;
  // 保存搜索历史
  const keyword = filterState.value.keyword;
  if (keyword && !searchHistory.value.includes(keyword)) {
    searchHistory.value = [keyword, ...searchHistory.value].slice(0, 10);
    try {
      localStorage.setItem(
        "marketplace-search-history",
        JSON.stringify(searchHistory.value),
      );
    } catch (e) {
      /* ignore */
    }
  }
};

// 应用高级筛选
const applyAdvancedFilters = () => {
  pagination.current = 1;
  antMessage.success("筛选条件已应用");
};

// 重置高级筛选
const resetAdvancedFilters = () => {
  advancedFilters.priceMin = null;
  advancedFilters.priceMax = null;
  advancedFilters.dateRange = null;
  advancedFilters.sortBy = "created_at";
  advancedFilters.sortOrder = "desc";
  pagination.current = 1;
  antMessage.info("筛选条件已重置");
};

// 分页处理
const handlePageChange = (page, pageSize) => {
  pagination.current = page;
  pagination.pageSize = pageSize;
};

const handlePageSizeChange = (current, size) => {
  pagination.current = 1;
  pagination.pageSize = size;
};

// 订单创建成功
const handleOrderCreated = () => {
  loadOrders();
  loadMyOrders();
};

// 查看订单详情
const handleViewOrder = (order) => {
  selectedOrder.value = order;
  showDetailModal.value = true;
};

// 购买订单
const handlePurchase = (order) => {
  if (isMyOrder(order)) {
    antMessage.warning("不能购买自己的订单");
    return;
  }
  selectedOrder.value = order;
  showPurchaseModal.value = true;
};

// 确认购买 - 接收来自 PurchaseConfirmModal 的数据
const handleConfirmPurchase = async ({ orderId, quantity, totalPrice }) => {
  try {
    purchaseLoading.value = true;
    await tradeStore.purchaseOrder(orderId, quantity);
    antMessage.success("购买成功！");
    showPurchaseModal.value = false;
    await loadOrders();
    await loadMyOrders();
  } catch (error) {
    logger.error("[Marketplace] 购买失败:", error);
    antMessage.error(error.message || "购买失败");
  } finally {
    purchaseLoading.value = false;
  }
};

// 取消订单
const handleCancelOrder = (order) => {
  Modal.confirm({
    title: "取消订单",
    content: "确定要取消这个订单吗？",
    okText: "确定",
    cancelText: "取消",
    async onOk() {
      try {
        await tradeStore.cancelOrder(order.id);
        antMessage.success("订单已取消");
        await loadOrders();
        await loadMyOrders();
      } catch (error) {
        logger.error("[Marketplace] 取消订单失败:", error);
        antMessage.error(error.message || "取消订单失败");
      }
    },
  });
};

// 订单购买/取消成功
const handleOrderPurchased = () => {
  loadOrders();
  loadMyOrders();
};

const handleOrderCancelled = () => {
  loadOrders();
  loadMyOrders();
};

// 编辑订单
const handleEditOrder = (order) => {
  if (!isMyOrder(order)) {
    antMessage.warning("只能编辑自己的订单");
    return;
  }
  if (order.status !== "open") {
    antMessage.warning("只能编辑开放状态的订单");
    return;
  }
  selectedOrder.value = order;
  showEditModal.value = true;
};

// 订单更新成功
const handleOrderUpdated = async (updatedOrder) => {
  antMessage.success("订单已更新");
  await loadOrders();
  await loadMyOrders();
  if (showDetailModal.value && selectedOrder.value?.id === updatedOrder.id) {
    selectedOrder.value = updatedOrder;
  }
};

// 分享订单
const handleShareOrder = (order) => {
  selectedOrder.value = order;
  showShareModal.value = true;
};

const handleOrderShared = (shareInfo) => {
  logger.info("[Marketplace] 订单已分享:", shareInfo);
};

// 获取可用余额
const getAvailableBalance = (order) => {
  if (!order || order.order_type !== "sell") {
    return 0;
  }
  const asset = tradeStore.myAssets.find((a) => a.id === order.asset_id);
  return asset ? asset.total_supply || 0 : 0;
};

// 确认收货
const handleConfirmDelivery = (transaction) => {
  Modal.confirm({
    title: "确认收货",
    content: "确定已收到商品/服务吗？确认后资金将释放给卖家。",
    okText: "确认收货",
    cancelText: "取消",
    async onOk() {
      try {
        await tradeStore.confirmDelivery(transaction.id);
        antMessage.success("已确认收货");
        await loadMyOrders();
      } catch (error) {
        logger.error("[Marketplace] 确认收货失败:", error);
        antMessage.error(error.message || "确认收货失败");
      }
    },
  });
};

// 申请退款
const handleRequestRefund = (transaction) => {
  Modal.confirm({
    title: "申请退款",
    content: "请输入退款原因:",
    okText: "申请退款",
    cancelText: "取消",
    async onOk() {
      try {
        await tradeStore.requestRefund(transaction.id, "买家申请退款");
        antMessage.success("已申请退款");
        await loadMyOrders();
      } catch (error) {
        logger.error("[Marketplace] 申请退款失败:", error);
        antMessage.error(error.message || "申请退款失败");
      }
    },
  });
};

// 加载搜索历史
const loadSearchHistory = () => {
  try {
    const history = localStorage.getItem("marketplace-search-history");
    if (history) {
      searchHistory.value = JSON.parse(history);
    }
  } catch (e) {
    /* ignore */
  }
};

// 生命周期
onMounted(async () => {
  loadSearchHistory();
  const identity = await window.electronAPI.did.getCurrentIdentity();
  if (identity) {
    currentDid.value = identity.did;
  }
  await loadOrders();
});
</script>

<style scoped>
.marketplace-container {
  padding: 20px;
}
</style>
