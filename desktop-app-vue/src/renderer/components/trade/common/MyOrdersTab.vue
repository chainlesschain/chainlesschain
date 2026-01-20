<template>
  <a-spin :spinning="loading">
    <a-tabs v-model:active-key="activeKey">
      <!-- 我发布的订单 -->
      <a-tab-pane key="created" tab="我发布的">
        <a-list
          :data-source="createdOrders"
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
              <a-card hoverable class="order-card" @click="emit('view', item)">
                <template #actions>
                  <a-tooltip title="查看详情">
                    <eye-outlined @click.stop="emit('view', item)" />
                  </a-tooltip>
                  <a-tooltip v-if="item.status === 'open'" title="编辑订单">
                    <edit-outlined @click.stop="emit('edit', item)" />
                  </a-tooltip>
                  <a-tooltip v-if="item.status === 'open'" title="取消订单">
                    <delete-outlined @click.stop="emit('cancel', item)" />
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
                          (
                            (item.price_amount ?? 0) * (item.quantity ?? 0)
                          ).toFixed(2)
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
            <a-empty description="还没有发布订单">
              <a-button type="primary" @click="emit('create')">
                发布第一个订单
              </a-button>
            </a-empty>
          </template>
        </a-list>
      </a-tab-pane>

      <!-- 我购买的订单 -->
      <a-tab-pane key="purchased" tab="我购买的">
        <a-list
          :data-source="purchasedOrders"
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
              <a-card hoverable class="transaction-card">
                <a-tag
                  :color="getTransactionStatusColor(item.status)"
                  style="position: absolute; top: 8px; right: 8px"
                >
                  {{ getTransactionStatusName(item.status) }}
                </a-tag>

                <a-descriptions :column="1" size="small">
                  <a-descriptions-item label="交易 ID">
                    <a-typography-text copyable style="font-size: 12px">
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
                      (
                        (item.payment_amount ?? 0) * (item.quantity ?? 0)
                      ).toFixed(2)
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
                    @click="emit('confirmDelivery', item)"
                  >
                    确认收货
                  </a-button>
                  <a-button
                    v-if="item.status === 'escrowed'"
                    danger
                    size="small"
                    @click="emit('requestRefund', item)"
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
</template>

<script setup>
import { ref } from "vue";
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  createdOrders: {
    type: Array,
    default: () => [],
  },
  purchasedOrders: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "view",
  "edit",
  "cancel",
  "create",
  "confirmDelivery",
  "requestRefund",
]);

const activeKey = ref("created");

// 工具函数
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
</script>

<style scoped>
.order-card {
  position: relative;
}

.order-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-info {
  font-size: 13px;
  color: #666;
}

.order-info > div {
  margin-bottom: 4px;
}

.order-total strong {
  color: #1890ff;
}

.transaction-card {
  position: relative;
}
</style>
