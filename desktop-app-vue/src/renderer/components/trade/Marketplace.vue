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
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
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

      <!-- 标签页 -->
      <a-tabs
        v-model:active-key="activeTab"
        @change="handleTabChange"
      >
        <a-tab-pane
          key="market"
          tab="市场订单"
        >
          <!-- 基础筛选器 -->
          <a-space
            style="margin-bottom: 16px"
            wrap
          >
            <span>订单类型:</span>
            <a-radio-group
              v-model:value="filterType"
              button-style="solid"
              @change="handleFilterChange"
            >
              <a-radio-button value="">
                全部
              </a-radio-button>
              <a-radio-button value="buy">
                求购
              </a-radio-button>
              <a-radio-button value="sell">
                出售
              </a-radio-button>
              <a-radio-button value="service">
                服务
              </a-radio-button>
              <a-radio-button value="barter">
                以物换物
              </a-radio-button>
            </a-radio-group>

            <a-auto-complete
              v-model:value="searchKeyword"
              :options="searchSuggestions"
              placeholder="搜索订单..."
              style="width: 200px"
              @search="handleSearchInput"
              @select="handleSuggestionSelect"
            >
              <template #option="{ value: optionValue }">
                <div>{{ optionValue }}</div>
              </template>
              <a-input-search
                placeholder="搜索订单..."
                @search="handleSearch"
              />
            </a-auto-complete>

            <a-button @click="showAdvancedFilter = !showAdvancedFilter">
              <template #icon>
                <filter-outlined />
              </template>
              高级筛选
            </a-button>
          </a-space>

          <!-- 高级筛选面板 -->
          <a-card
            v-if="showAdvancedFilter"
            size="small"
            style="margin-bottom: 16px"
          >
            <a-row :gutter="16">
              <a-col :span="6">
                <a-form-item label="价格范围">
                  <a-input-group compact>
                    <a-input-number
                      v-model:value="advancedFilters.priceMin"
                      placeholder="最低"
                      style="width: 50%"
                      :min="0"
                    />
                    <a-input-number
                      v-model:value="advancedFilters.priceMax"
                      placeholder="最高"
                      style="width: 50%"
                      :min="0"
                    />
                  </a-input-group>
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="创建时间">
                  <a-range-picker
                    v-model:value="advancedFilters.dateRange"
                    style="width: 100%"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="6">
                <a-form-item label="排序">
                  <a-select
                    v-model:value="advancedFilters.sortBy"
                    style="width: 100%"
                  >
                    <a-select-option value="created_at">
                      创建时间
                    </a-select-option>
                    <a-select-option value="price_amount">
                      价格
                    </a-select-option>
                    <a-select-option value="quantity">
                      数量
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
              <a-col :span="4">
                <a-form-item label="排序方向">
                  <a-radio-group v-model:value="advancedFilters.sortOrder">
                    <a-radio-button value="desc">
                      降序
                    </a-radio-button>
                    <a-radio-button value="asc">
                      升序
                    </a-radio-button>
                  </a-radio-group>
                </a-form-item>
              </a-col>
            </a-row>
            <a-space>
              <a-button
                type="primary"
                @click="applyAdvancedFilters"
              >
                应用筛选
              </a-button>
              <a-button @click="resetAdvancedFilters">
                重置
              </a-button>
            </a-space>
          </a-card>

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
              :description="
                searchKeyword || filterType ? '没有找到匹配的订单' : '暂无订单'
              "
            >
              <a-button
                v-if="!searchKeyword && !filterType"
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

        <a-tab-pane
          key="myOrders"
          tab="我的订单"
        >
          <a-spin :spinning="loadingMyOrders">
            <a-tabs>
              <a-tab-pane
                key="created"
                tab="我发布的"
              >
                <a-list
                  :data-source="myCreatedOrders"
                  :grid="{
                    gutter: 16,
                    xs: 1,
                    sm: 2,
                    md: 2,
                    lg: 3,
                    xl: 4,
                    xxl: 4,
                  }"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-card
                        hoverable
                        class="order-card"
                        @click="handleViewOrder(item)"
                      >
                        <template #actions>
                          <a-tooltip title="查看详情">
                            <eye-outlined @click.stop="handleViewOrder(item)" />
                          </a-tooltip>
                          <a-tooltip
                            v-if="item.status === 'open'"
                            title="取消订单"
                          >
                            <delete-outlined
                              @click.stop="handleCancelOrder(item)"
                            />
                          </a-tooltip>
                        </template>

                        <a-tag
                          :color="getOrderStatusColor(item.status)"
                          style="position: absolute; top: 8px; right: 8px"
                        >
                          {{ getOrderStatusName(item.status) }}
                        </a-tag>

                        <a-card-meta>
                          <template #title>
                            <div class="order-title">
                              {{ item.title }}
                            </div>
                          </template>
                          <template #description>
                            <div class="order-info">
                              <div class="order-price">
                                单价: {{ item.price_amount }}
                              </div>
                              <div class="order-quantity">
                                数量: {{ item.quantity }}
                              </div>
                              <div class="order-total">
                                总价:
                                <strong>{{
                                  (item.price_amount * item.quantity).toFixed(2)
                                }}</strong>
                              </div>
                              <div class="order-time">
                                {{ formatTime(item.created_at) }}
                              </div>
                            </div>
                          </template>
                        </a-card-meta>
                      </a-card>
                    </a-list-item>
                  </template>

                  <template #empty>
                    <a-empty description="还没有发布订单" />
                  </template>
                </a-list>
              </a-tab-pane>

              <a-tab-pane
                key="purchased"
                tab="我购买的"
              >
                <a-list
                  :data-source="myPurchasedOrders"
                  :grid="{
                    gutter: 16,
                    xs: 1,
                    sm: 1,
                    md: 1,
                    lg: 2,
                    xl: 2,
                    xxl: 2,
                  }"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-card
                        hoverable
                        class="transaction-card"
                      >
                        <a-tag
                          :color="getTransactionStatusColor(item.status)"
                          style="position: absolute; top: 8px; right: 8px"
                        >
                          {{ getTransactionStatusName(item.status) }}
                        </a-tag>

                        <a-descriptions
                          :column="1"
                          size="small"
                        >
                          <a-descriptions-item label="交易 ID">
                            <a-typography-text
                              copyable
                              style="font-size: 12px"
                            >
                              {{ shortenId(item.id) }}
                            </a-typography-text>
                          </a-descriptions-item>
                          <a-descriptions-item label="卖家">
                            {{ shortenDid(item.seller_did) }}
                          </a-descriptions-item>
                          <a-descriptions-item label="数量">
                            {{ item.quantity }}
                          </a-descriptions-item>
                          <a-descriptions-item label="金额">
                            <strong>{{
                              (item.payment_amount * item.quantity).toFixed(2)
                            }}</strong>
                          </a-descriptions-item>
                          <a-descriptions-item label="创建时间">
                            {{ formatTime(item.created_at) }}
                          </a-descriptions-item>
                        </a-descriptions>

                        <a-space style="margin-top: 16px">
                          <a-button
                            v-if="item.status === 'escrowed'"
                            type="primary"
                            size="small"
                            @click="handleConfirmDelivery(item)"
                          >
                            确认收货
                          </a-button>
                          <a-button
                            v-if="item.status === 'escrowed'"
                            danger
                            size="small"
                            @click="handleRequestRefund(item)"
                          >
                            申请退款
                          </a-button>
                        </a-space>
                      </a-card>
                    </a-list-item>
                  </template>

                  <template #empty>
                    <a-empty description="还没有购买记录" />
                  </template>
                </a-list>
              </a-tab-pane>
            </a-tabs>
          </a-spin>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 创建订单对话框 -->
    <order-create
      v-model:open="showCreateModal"
      @created="handleOrderCreated"
    />

    <!-- 订单详情对话框 -->
    <order-detail
      v-model:open="showDetailModal"
      :order="selectedOrder"
      @purchased="handleOrderPurchased"
      @cancelled="handleOrderCancelled"
    />

    <!-- 购买确认对话框 -->
    <a-modal
      v-model:open="showPurchaseModal"
      title="确认购买"
      @ok="handleConfirmPurchase"
    >
      <div v-if="selectedOrder">
        <a-descriptions
          :column="1"
          bordered
        >
          <a-descriptions-item label="订单标题">
            {{ selectedOrder.title }}
          </a-descriptions-item>
          <a-descriptions-item label="卖家">
            {{ shortenDid(selectedOrder.creator_did) }}
          </a-descriptions-item>
          <a-descriptions-item label="数量">
            <a-input-number
              v-model:value="purchaseQuantity"
              :min="1"
              :max="selectedOrder.quantity"
              style="width: 100%"
            />
          </a-descriptions-item>
          <a-descriptions-item label="单价">
            {{ selectedOrder.price_amount }}
          </a-descriptions-item>
          <a-descriptions-item label="总价">
            <strong style="color: #1890ff; font-size: 16px">
              {{ (purchaseQuantity * selectedOrder.price_amount).toFixed(2) }}
            </strong>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>

    <!-- 编辑订单对话框 -->
    <order-edit
      v-model:open="showEditModal"
      :order="selectedOrder || {}"
      :available-balance="getAvailableBalance(selectedOrder)"
      @updated="handleOrderUpdated"
    />

    <!-- 分享订单对话框 -->
    <order-share-modal
      v-model:open="showShareModal"
      :order="selectedOrder || {}"
      @shared="handleOrderShared"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from "vue";
import { message as antMessage, Modal } from "ant-design-vue";
import {
  ShopOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  FilterOutlined,
  EyeOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";
import OrderCard from "./common/OrderCard.vue";
import OrderCreate from "./OrderCreate.vue";
import OrderDetail from "./OrderDetail.vue";
import OrderEdit from "./OrderEdit.vue";
import OrderShareModal from "./common/OrderShareModal.vue";

// Store
const tradeStore = useTradeStore();

// 本地状态
const activeTab = ref("market");
const searchKeyword = ref("");
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const showPurchaseModal = ref(false);
const showEditModal = ref(false);
const showShareModal = ref(false);
const selectedOrder = ref(null);
const purchaseQuantity = ref(1);
const currentDid = ref("");

// 高级筛选状态
const showAdvancedFilter = ref(false);
const advancedFilters = reactive({
  priceMin: null,
  priceMax: null,
  dateRange: null,
  sortBy: "created_at",
  sortOrder: "desc",
});

// 搜索建议
const searchSuggestions = ref([]);
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
const filterType = computed({
  get: () => tradeStore.marketplace.filters.orderType,
  set: (value) => tradeStore.setMarketplaceFilter("orderType", value),
});

// 筛选后的订单
const filteredOrders = computed(() => {
  let result = orders.value;

  // 类型筛选
  if (filterType.value) {
    result = result.filter((o) => o.order_type === filterType.value);
  }

  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (o) =>
        o.title.toLowerCase().includes(keyword) ||
        (o.description && o.description.toLowerCase().includes(keyword)),
    );
  }

  // 高级筛选 - 价格范围
  if (
    advancedFilters.priceMin !== null &&
    advancedFilters.priceMin !== undefined
  ) {
    result = result.filter((o) => o.price_amount >= advancedFilters.priceMin);
  }
  if (
    advancedFilters.priceMax !== null &&
    advancedFilters.priceMax !== undefined
  ) {
    result = result.filter((o) => o.price_amount <= advancedFilters.priceMax);
  }

  // 高级筛选 - 日期范围
  if (advancedFilters.dateRange && advancedFilters.dateRange.length === 2) {
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
    const sortField = advancedFilters.sortBy;
    const sortOrder = advancedFilters.sortOrder === "asc" ? 1 : -1;

    if (sortField === "created_at") {
      return sortOrder * (new Date(a.created_at) - new Date(b.created_at));
    } else if (sortField === "price_amount") {
      return sortOrder * (a.price_amount - b.price_amount);
    } else if (sortField === "quantity") {
      return sortOrder * (a.quantity - b.quantity);
    }
    return 0;
  });

  return result;
});

// 分页后的订单（用于显示）
const displayOrders = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  const end = start + pagination.pageSize;
  return filteredOrders.value.slice(start, end);
});

// 监听筛选后的订单变化，更新分页总数
watch(
  filteredOrders,
  (newOrders) => {
    pagination.total = newOrders.length;
    // 如果当前页超出范围，重置到第一页
    const maxPage = Math.ceil(newOrders.length / pagination.pageSize) || 1;
    if (pagination.current > maxPage) {
      pagination.current = 1;
    }
  },
  { immediate: true },
);

// 工具函数
const getOrderTypeColor = (type) => {
  const colors = {
    buy: "blue",
    sell: "green",
    service: "purple",
    barter: "orange",
  };
  return colors[type] || "default";
};

const getOrderTypeName = (type) => {
  const names = {
    buy: "求购",
    sell: "出售",
    service: "服务",
    barter: "以物换物",
  };
  return names[type] || type;
};

const getOrderStatusColor = (status) => {
  const colors = {
    open: "green",
    matched: "blue",
    escrow: "orange",
    completed: "default",
    cancelled: "red",
    disputed: "volcano",
  };
  return colors[status] || "default";
};

const getOrderStatusName = (status) => {
  const names = {
    open: "开放",
    matched: "已匹配",
    escrow: "托管中",
    completed: "已完成",
    cancelled: "已取消",
    disputed: "有争议",
  };
  return names[status] || status;
};

const getTransactionStatusColor = (status) => {
  const colors = {
    pending: "blue",
    escrowed: "orange",
    delivered: "cyan",
    completed: "green",
    refunded: "default",
    disputed: "red",
  };
  return colors[status] || "default";
};

const getTransactionStatusName = (status) => {
  const names = {
    pending: "待处理",
    escrowed: "已托管",
    delivered: "已交付",
    completed: "已完成",
    refunded: "已退款",
    disputed: "有争议",
  };
  return names[status] || status;
};

const shortenDid = (did) => {
  if (!did) {return "";}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const shortenId = (id) => {
  if (!id) {return "";}
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

const isMyOrder = (order) => {
  return order.creator_did === currentDid.value;
};

// 加载订单列表
const loadOrders = async () => {
  try {
    await tradeStore.loadOrders({ status: "open" });
    console.log("[Marketplace] 订单列表已加载:", orders.value.length);
  } catch (error) {
    console.error("[Marketplace] 加载订单列表失败:", error);
    antMessage.error("加载订单列表失败: " + error.message);
  }
};

// 加载我的订单
const loadMyOrders = async () => {
  try {
    if (!currentDid.value) {return;}
    await tradeStore.loadMyOrders(currentDid.value);
    console.log("[Marketplace] 我的订单已加载");
  } catch (error) {
    console.error("[Marketplace] 加载我的订单失败:", error);
    antMessage.error("加载我的订单失败: " + error.message);
  }
};

// 标签页切换
const handleTabChange = (key) => {
  if (key === "myOrders") {
    loadMyOrders();
  }
};

// 筛选变化
const handleFilterChange = () => {
  // 重置分页到第一页
  pagination.current = 1;
};

// 搜索
const handleSearch = () => {
  // 重置分页到第一页
  pagination.current = 1;
  // 保存搜索历史
  if (
    searchKeyword.value &&
    !searchHistory.value.includes(searchKeyword.value)
  ) {
    searchHistory.value = [searchKeyword.value, ...searchHistory.value].slice(
      0,
      10,
    );
    try {
      localStorage.setItem(
        "marketplace-search-history",
        JSON.stringify(searchHistory.value),
      );
    } catch (e) {
      // ignore
    }
  }
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
  purchaseQuantity.value = Math.min(1, order.quantity);
  showPurchaseModal.value = true;
};

// 确认购买
const handleConfirmPurchase = async () => {
  try {
    if (!selectedOrder.value) {return;}

    await tradeStore.purchaseOrder(
      selectedOrder.value.id,
      purchaseQuantity.value,
    );

    antMessage.success("购买成功！");
    showPurchaseModal.value = false;
    await loadOrders();
    await loadMyOrders();
  } catch (error) {
    console.error("[Marketplace] 购买失败:", error);
    antMessage.error(error.message || "购买失败");
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
        console.error("[Marketplace] 取消订单失败:", error);
        antMessage.error(error.message || "取消订单失败");
      }
    },
  });
};

// 订单购买成功
const handleOrderPurchased = () => {
  loadOrders();
  loadMyOrders();
};

// 订单取消成功
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
  // 如果详情对话框打开，更新选中的订单
  if (showDetailModal.value && selectedOrder.value?.id === updatedOrder.id) {
    selectedOrder.value = updatedOrder;
  }
};

// 分享订单
const handleShareOrder = (order) => {
  selectedOrder.value = order;
  showShareModal.value = true;
};

// 订单分享成功
const handleOrderShared = (shareInfo) => {
  console.log("[Marketplace] 订单已分享:", shareInfo);
};

// 获取可用余额
const getAvailableBalance = (order) => {
  if (!order || order.order_type !== "sell") {return 0;}
  // 从 store 获取对应资产的余额
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
        console.error("[Marketplace] 确认收货失败:", error);
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
        console.error("[Marketplace] 申请退款失败:", error);
        antMessage.error(error.message || "申请退款失败");
      }
    },
  });
};

// 搜索输入处理 - 获取搜索建议
let searchDebounceTimer = null;
const handleSearchInput = async (value) => {
  // 防抖处理
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (!value || value.length < 2) {
    searchSuggestions.value = [];
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      // 尝试调用后端获取搜索建议
      if (window.electronAPI?.marketplace?.getSearchSuggestions) {
        const suggestions =
          await window.electronAPI.marketplace.getSearchSuggestions(value, 10);
        searchSuggestions.value = suggestions.map((s) => ({
          value: s.suggestion,
          label: s.suggestion,
        }));
      } else {
        // 降级到本地建议：从当前订单中匹配
        const localSuggestions = orders.value
          .filter((o) => o.title?.toLowerCase().includes(value.toLowerCase()))
          .slice(0, 8)
          .map((o) => ({
            value: o.title,
            label: o.title,
          }));
        searchSuggestions.value = localSuggestions;
      }
    } catch (error) {
      console.warn("[Marketplace] 获取搜索建议失败:", error);
      searchSuggestions.value = [];
    }
  }, 300);
};

// 选择搜索建议
const handleSuggestionSelect = (value) => {
  searchKeyword.value = value;
  // 添加到搜索历史
  if (!searchHistory.value.includes(value)) {
    searchHistory.value.unshift(value);
    searchHistory.value = searchHistory.value.slice(0, 10);
    try {
      localStorage.setItem(
        "marketplace-search-history",
        JSON.stringify(searchHistory.value),
      );
    } catch (e) {
      // ignore
    }
  }
};

// 应用高级筛选
const applyAdvancedFilters = () => {
  // 重置到第一页
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

// 分页变化
const handlePageChange = (page, pageSize) => {
  pagination.current = page;
  pagination.pageSize = pageSize;
};

// 每页数量变化
const handlePageSizeChange = (current, size) => {
  pagination.current = 1;
  pagination.pageSize = size;
};

// 加载搜索历史
const loadSearchHistory = () => {
  try {
    const history = localStorage.getItem("marketplace-search-history");
    if (history) {
      searchHistory.value = JSON.parse(history);
    }
  } catch (e) {
    // ignore
  }
};

// 生命周期
onMounted(async () => {
  // 加载搜索历史
  loadSearchHistory();

  // 获取当前用户 DID
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

.order-card {
  height: 100%;
  position: relative;
}

.order-title {
  font-size: 16px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.order-info {
  margin-top: 8px;
}

.order-price {
  font-size: 14px;
  margin-bottom: 4px;
}

.price-label {
  color: #666;
}

.price-value {
  color: #1890ff;
  font-weight: bold;
  margin-left: 4px;
}

.order-quantity {
  font-size: 14px;
  color: #666;
  margin-bottom: 4px;
}

.order-total {
  font-size: 14px;
  margin-bottom: 8px;
}

.total-label {
  color: #666;
}

.total-value {
  color: #ff4d4f;
  font-size: 16px;
  margin-left: 4px;
}

.order-description {
  font-size: 12px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-bottom: 8px;
}

.order-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #999;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.seller-did {
  color: #666;
}

.order-time {
  font-size: 11px;
}

.transaction-card {
  position: relative;
}
</style>
