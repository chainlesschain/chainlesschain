<template>
  <div class="order-purchase">
    <a-modal
      :open="open"
      title="购买订单"
      width="600px"
      :confirm-loading="purchasing"
      @ok="handlePurchase"
      @cancel="handleCancel"
    >
      <div v-if="order">
        <!-- 订单信息 -->
        <a-card
          size="small"
          style="margin-bottom: 16px"
        >
          <template #title>
            <a-space>
              <shopping-cart-outlined />
              <span>订单信息</span>
            </a-space>
          </template>

          <a-descriptions
            :column="1"
            bordered
            size="small"
          >
            <a-descriptions-item label="订单标题">
              <strong>{{ order.asset_name || order.title }}</strong>
            </a-descriptions-item>

            <a-descriptions-item label="订单类型">
              <a-tag :color="getOrderTypeColor(order.order_type)">
                {{ getOrderTypeName(order.order_type) }}
              </a-tag>
            </a-descriptions-item>

            <a-descriptions-item label="订单状态">
              <status-badge
                :status="order.status"
                type="order"
                show-icon
              />
            </a-descriptions-item>

            <a-descriptions-item label="卖家">
              <a-space>
                <user-outlined />
                <a-typography-text
                  copyable
                  :ellipsis="{ tooltip: order.seller_did }"
                >
                  {{ formatDid(order.seller_did) }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>

            <a-descriptions-item label="可购数量">
              <a-tag color="blue">
                {{ order.quantity }}
              </a-tag>
            </a-descriptions-item>

            <a-descriptions-item label="单价">
              <span style="font-size: 16px; font-weight: 600; color: #52c41a">
                {{ formatAmount(order.price_amount) }}
                <span style="font-size: 12px; color: #8c8c8c; margin-left: 4px">
                  {{ order.price_asset_symbol || 'CC' }}
                </span>
              </span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 购买表单 -->
        <a-card
          size="small"
          style="margin-bottom: 16px"
        >
          <template #title>
            <a-space>
              <calculator-outlined />
              <span>购买信息</span>
            </a-space>
          </template>

          <a-form layout="vertical">
            <!-- 购买数量 -->
            <a-form-item
              label="购买数量"
              required
            >
              <a-input-number
                v-model:value="form.quantity"
                :min="1"
                :max="order.quantity"
                :step="1"
                style="width: 100%"
                placeholder="请输入购买数量"
                @change="handleQuantityChange"
              >
                <template #addonAfter>
                  <a-button
                    type="link"
                    size="small"
                    @click="form.quantity = order.quantity"
                  >
                    全部
                  </a-button>
                </template>
              </a-input-number>
              <template #extra>
                <span style="color: #8c8c8c">可购数量: {{ order.quantity }}</span>
              </template>
            </a-form-item>

            <!-- 总价显示 -->
            <a-form-item label="支付金额">
              <div class="total-price-display">
                <div class="price-breakdown">
                  <div class="breakdown-item">
                    <span class="label">单价:</span>
                    <span class="value">
                      {{ formatAmount(order.price_amount) }} {{ order.price_asset_symbol || 'CC' }}
                    </span>
                  </div>
                  <div class="breakdown-item">
                    <span class="label">数量:</span>
                    <span class="value">x {{ form.quantity }}</span>
                  </div>
                  <a-divider style="margin: 8px 0" />
                  <div class="breakdown-item total">
                    <span class="label">总计:</span>
                    <span class="value">
                      {{ formatAmount(totalAmount) }}
                      <span class="symbol">{{ order.price_asset_symbol || 'CC' }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </a-form-item>

            <!-- 备注 -->
            <a-form-item label="备注（可选）">
              <a-textarea
                v-model:value="form.memo"
                placeholder="可以添加备注信息..."
                :rows="3"
                :maxlength="200"
                show-count
              />
            </a-form-item>
          </a-form>
        </a-card>

        <!-- 托管说明 -->
        <a-alert
          type="info"
          style="margin-bottom: 16px"
        >
          <template #icon>
            <safety-certificate-outlined />
          </template>
          <template #message>
            <strong>交易安全保障</strong>
          </template>
          <template #description>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>您的支付金额将由系统托管，确保交易安全</li>
              <li>卖家发货后，您需要确认收货才会释放资金</li>
              <li>如有问题，可以申请退款或发起争议</li>
              <li>托管期间资金完全由智能合约保护</li>
            </ul>
          </template>
        </a-alert>

        <!-- 订单描述 -->
        <a-card
          v-if="order.description"
          size="small"
          title="订单描述"
        >
          <p style="margin: 0; color: #595959; line-height: 1.6">
            {{ order.description }}
          </p>
        </a-card>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, watch } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  ShoppingCartOutlined,
  UserOutlined,
  CalculatorOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';

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
const emit = defineEmits(['purchased', 'cancel', 'update:open']);

// 表单状态
const form = reactive({
  quantity: 1,
  memo: '',
});

// 从 store 获取状态
const purchasing = computed(() => tradeStore.marketplace.purchasing);

// 计算属性
const totalAmount = computed(() => {
  if (!props.order) {return 0;}
  return props.order.price_amount * form.quantity;
});

// 工具函数
const getOrderTypeColor = (type) => {
  const colors = {
    sell: 'green',
    buy: 'blue',
    auction: 'purple',
    exchange: 'orange',
  };
  return colors[type] || 'default';
};

const getOrderTypeName = (type) => {
  const names = {
    sell: '出售',
    buy: '求购',
    auction: '拍卖',
    exchange: '交换',
  };
  return names[type] || type;
};

const formatAmount = (amount) => {
  if (!amount && amount !== 0) {return '0';}
  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

const formatDid = (did) => {
  if (!did) {return '-';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 事件处理

// 数量变化
const handleQuantityChange = (value) => {
  if (value < 1) {
    form.quantity = 1;
  } else if (props.order && value > props.order.quantity) {
    form.quantity = props.order.quantity;
  }
};

// 购买订单
const handlePurchase = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    // 使用 store 购买订单
    await tradeStore.purchaseOrder(props.order.id, form.quantity);

    logger.info('[OrderPurchase] 订单购买成功:', props.order.id);
    antMessage.success('购买成功！订单已进入托管');

    // 通知父组件
    emit('purchased', {
      orderId: props.order.id,
      quantity: form.quantity,
      totalAmount: totalAmount.value,
    });

    // 关闭对话框
    emit('update:open', false);

    // 重置表单
    resetForm();
  } catch (error) {
    logger.error('[OrderPurchase] 购买失败:', error);
    antMessage.error(error.message || '购买失败');
  }
};

// 验证表单
const validateForm = () => {
  if (!props.order) {
    antMessage.warning('订单信息无效');
    return false;
  }

  if (props.order.status !== 'open') {
    antMessage.warning('订单状态不可购买');
    return false;
  }

  if (form.quantity <= 0) {
    antMessage.warning('购买数量必须大于 0');
    return false;
  }

  if (form.quantity > props.order.quantity) {
    antMessage.warning('购买数量超过可购数量');
    return false;
  }

  return true;
};

// 取消
const handleCancel = () => {
  emit('cancel');
  emit('update:open', false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.quantity = 1;
  form.memo = '';
};

// 监听对话框打开
watch(() => props.open, (newVal) => {
  if (newVal && props.order) {
    // 重置表单
    resetForm();

    // 设置默认数量为最小值（1）或可购数量
    form.quantity = Math.min(1, props.order.quantity);
  }
});
</script>

<style scoped>
.order-purchase {
  /* 样式 */
}

.total-price-display {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px;
  color: white;
}

.price-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.breakdown-item.total {
  margin-top: 4px;
}

.breakdown-item .label {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.breakdown-item .value {
  font-size: 16px;
  font-weight: 600;
  color: white;
}

.breakdown-item.total .value {
  font-size: 24px;
  font-weight: 700;
}

.breakdown-item .symbol {
  font-size: 14px;
  font-weight: 400;
  margin-left: 4px;
  opacity: 0.9;
}

:deep(.ant-divider) {
  background-color: rgba(255, 255, 255, 0.3);
  margin: 8px 0;
}

:deep(.ant-input-number-group-addon) {
  padding: 0;
}

:deep(.ant-alert-info) {
  border-radius: 8px;
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
  color: #595959;
}
</style>
