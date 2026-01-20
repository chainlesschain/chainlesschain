<template>
  <div class="order-detail">
    <a-modal
      :open="open"
      title="订单详情"
      width="800px"
      :footer="null"
      @cancel="handleCancel"
    >
      <div v-if="order">
        <!-- 订单基本信息 -->
        <a-card title="基本信息" size="small" style="margin-bottom: 16px">
          <a-descriptions :column="2" bordered>
            <a-descriptions-item label="订单 ID" :span="2">
              <a-typography-text copyable>
                {{ order.id }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="订单类型">
              <a-tag :color="getOrderTypeColor(order.order_type)">
                {{ getOrderTypeName(order.order_type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="订单状态">
              <status-badge :status="order.status" type="order" show-icon />
            </a-descriptions-item>
            <a-descriptions-item label="订单标题" :span="2">
              <strong>{{ order.title }}</strong>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="order.description"
              label="订单描述"
              :span="2"
            >
              {{ order.description }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 交易信息 -->
        <a-card title="交易信息" size="small" style="margin-bottom: 16px">
          <a-descriptions :column="2" bordered>
            <a-descriptions-item label="创建者">
              <a-space>
                <user-outlined />
                <a-typography-text copyable style="font-size: 12px">
                  {{ order.creator_did }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="创建时间">
              {{ formatTime(order.created_at) }}
            </a-descriptions-item>
            <a-descriptions-item label="数量">
              <strong style="font-size: 16px; color: #1890ff">{{
                order.quantity
              }}</strong>
            </a-descriptions-item>
            <a-descriptions-item label="单价">
              <strong style="font-size: 16px; color: #52c41a">{{
                order.price_amount
              }}</strong>
            </a-descriptions-item>
            <a-descriptions-item label="总价" :span="2">
              <strong style="font-size: 20px; color: #ff4d4f">
                {{
                  ((order.price_amount ?? 0) * (order.quantity ?? 0)).toFixed(2)
                }}
              </strong>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="order.asset_id"
              label="资产 ID"
              :span="2"
            >
              <a-typography-text copyable style="font-size: 12px">
                {{ order.asset_id }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="order.price_asset_id"
              label="支付资产 ID"
              :span="2"
            >
              <a-typography-text copyable style="font-size: 12px">
                {{ order.price_asset_id }}
              </a-typography-text>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 扩展信息 -->
        <a-card
          v-if="hasMetadata"
          title="扩展信息"
          size="small"
          style="margin-bottom: 16px"
        >
          <a-descriptions :column="2" bordered>
            <a-descriptions-item
              v-if="order.metadata?.location"
              label="交易地点"
              :span="2"
            >
              <environment-outlined /> {{ order.metadata.location }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="order.metadata?.contact"
              label="联系方式"
              :span="2"
            >
              <phone-outlined /> {{ order.metadata.contact }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="order.metadata?.validDays"
              label="有效期"
            >
              {{ order.metadata.validDays }} 天
            </a-descriptions-item>
            <a-descriptions-item v-if="order.updated_at" label="更新时间">
              {{ formatTime(order.updated_at) }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 相关交易 -->
        <a-card
          v-if="transactions.length > 0"
          title="相关交易"
          size="small"
          style="margin-bottom: 16px"
        >
          <a-list :data-source="transactions" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>
                    <a-space>
                      <span>交易 ID: {{ shortenId(item.id) }}</span>
                      <status-badge
                        :status="item.status"
                        type="transaction"
                        show-icon
                      />
                    </a-space>
                  </template>
                  <template #description>
                    <div>
                      <div>买家: {{ shortenDid(item.buyer_did) }}</div>
                      <div>
                        数量: {{ item.quantity }} | 金额:
                        {{
                          (
                            (item.payment_amount ?? 0) * (item.quantity ?? 0)
                          ).toFixed(2)
                        }}
                      </div>
                      <div>创建时间: {{ formatTime(item.created_at) }}</div>
                    </div>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <a-space>
            <a-button
              v-if="!isMyOrder && order.status === 'open'"
              type="primary"
              @click="handlePurchase"
            >
              <shopping-cart-outlined /> 立即购买
            </a-button>
            <a-button
              v-if="isMyOrder && order.status === 'open'"
              danger
              @click="handleCancel"
            >
              <delete-outlined /> 取消订单
            </a-button>
            <a-button @click="handleClose"> 关闭 </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>

    <!-- 购买确认对话框 -->
    <a-modal
      v-model:open="showPurchaseModal"
      title="确认购买"
      @ok="handleConfirmPurchase"
    >
      <div v-if="order">
        <a-form layout="vertical">
          <a-form-item label="购买数量" required>
            <a-input-number
              v-model:value="purchaseQuantity"
              :min="1"
              :max="order.quantity"
              style="width: 100%"
            />
          </a-form-item>

          <a-alert type="info" style="margin-bottom: 16px">
            <template #message>
              <div>
                <div>单价: {{ order.price_amount }}</div>
                <div>数量: {{ purchaseQuantity }}</div>
                <div>
                  <strong
                    >总价:
                    {{
                      (
                        (purchaseQuantity ?? 0) * (order.price_amount ?? 0)
                      ).toFixed(2)
                    }}</strong
                  >
                </div>
              </div>
            </template>
          </a-alert>

          <a-alert
            type="warning"
            message="购买后资金将被托管，确认收货后才会释放给卖家"
          />
        </a-form>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, watch } from "vue";
import { message as antMessage, Modal } from "ant-design-vue";
import {
  UserOutlined,
  ShoppingCartOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  PhoneOutlined,
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";
import StatusBadge from "./common/StatusBadge.vue";

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(["purchased", "cancelled", "update:open"]);

// 状态
const showPurchaseModal = ref(false);
const purchaseQuantity = ref(1);
const currentDid = ref("");

// 从 store 获取数据
const transactions = computed(() =>
  tradeStore.marketplace.transactions.filter(
    (t) => t.order_id === props.order?.id,
  ),
);

// 计算属性
const isMyOrder = computed(() => {
  return props.order && props.order.seller_did === currentDid.value;
});

const hasMetadata = computed(() => {
  if (!props.order || !props.order.metadata) {
    return false;
  }
  const meta = props.order.metadata;
  return (
    meta.location || meta.contact || meta.validDays || props.order.updated_at
  );
});

// 工具函数
const getOrderTypeColor = (type) => {
  const colors = {
    sell: "green",
    buy: "blue",
    auction: "purple",
    exchange: "orange",
  };
  return colors[type] || "default";
};

const getOrderTypeName = (type) => {
  const names = {
    sell: "出售",
    buy: "求购",
    auction: "拍卖",
    exchange: "交换",
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
  if (!did) {
    return "";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const shortenId = (id) => {
  if (!id) {
    return "";
  }
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

// 加载相关交易
const loadTransactions = async () => {
  if (!props.order) {
    return;
  }

  try {
    // 使用 store 加载交易记录
    await tradeStore.loadTransactions({ orderId: props.order.id });
    logger.info("[OrderDetail] 交易记录已加载:", transactions.value.length);
  } catch (error) {
    logger.error("[OrderDetail] 加载交易列表失败:", error);
  }
};

// 购买订单
const handlePurchase = () => {
  if (isMyOrder.value) {
    antMessage.warning("不能购买自己的订单");
    return;
  }

  if (props.order.status !== "open") {
    antMessage.warning("订单状态不可购买");
    return;
  }

  purchaseQuantity.value = Math.min(1, props.order.quantity);
  showPurchaseModal.value = true;
};

// 确认购买
const handleConfirmPurchase = async () => {
  try {
    if (!props.order) {
      return;
    }

    // 使用 store 购买订单
    await tradeStore.purchaseOrder(props.order.id, purchaseQuantity.value);

    logger.info("[OrderDetail] 订单购买成功:", props.order.id);
    antMessage.success("购买成功！");
    showPurchaseModal.value = false;
    emit("purchased");
    emit("update:open", false);
  } catch (error) {
    logger.error("[OrderDetail] 购买失败:", error);
    antMessage.error(error.message || "购买失败");
  }
};

// 取消订单
const handleCancel = () => {
  Modal.confirm({
    title: "取消订单",
    content: "确定要取消这个订单吗？",
    okText: "确定",
    cancelText: "取消",
    async onOk() {
      try {
        // 使用 store 取消订单
        await tradeStore.cancelOrder(props.order.id);

        logger.info("[OrderDetail] 订单已取消:", props.order.id);
        antMessage.success("订单已取消");
        emit("cancelled");
        emit("update:open", false);
      } catch (error) {
        logger.error("[OrderDetail] 取消订单失败:", error);
        antMessage.error(error.message || "取消订单失败");
      }
    },
  });
};

// 关闭对话框
const handleClose = () => {
  emit("update:open", false);
};

// 监听订单变化
watch(
  () => props.order,
  (newOrder) => {
    if (newOrder) {
      loadTransactions();
    }
  },
  { immediate: true },
);

// 监听对话框打开
watch(
  () => props.open,
  async (newVal) => {
    if (newVal) {
      // 获取当前用户 DID
      const identity = await window.electronAPI.did.getCurrentIdentity();
      if (identity) {
        currentDid.value = identity.did;
      }

      await loadTransactions();
    }
  },
);
</script>

<style scoped>
.order-detail {
  /* 样式 */
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
