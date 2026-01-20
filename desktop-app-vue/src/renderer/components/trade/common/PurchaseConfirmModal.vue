<template>
  <a-modal
    :open="open"
    title="确认购买"
    :confirm-loading="loading"
    @ok="handleConfirm"
    @cancel="emit('update:open', false)"
  >
    <div v-if="order">
      <a-descriptions :column="1" bordered>
        <a-descriptions-item label="订单标题">
          {{ order.title }}
        </a-descriptions-item>
        <a-descriptions-item label="卖家">
          {{ shortenDid(order.creator_did) }}
        </a-descriptions-item>
        <a-descriptions-item label="数量">
          <a-input-number
            v-model:value="quantity"
            :min="1"
            :max="order.quantity"
            style="width: 100%"
          />
          <span class="available-hint">可购买: {{ order.quantity }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="单价">
          {{ order.price_amount }} {{ order.price_currency || "CNY" }}
        </a-descriptions-item>
        <a-descriptions-item label="总价">
          <strong class="total-price">
            {{ totalPrice.toFixed(2) }} {{ order.price_currency || "CNY" }}
          </strong>
        </a-descriptions-item>
      </a-descriptions>

      <a-alert
        v-if="order.description"
        type="info"
        style="margin-top: 16px"
        :message="order.description"
        show-icon
      />

      <a-divider />

      <a-checkbox v-model:checked="agreeTerms">
        我已阅读并同意
        <a @click.prevent="showTerms = true">交易条款</a>
      </a-checkbox>
    </div>

    <!-- 交易条款对话框 -->
    <a-modal
      v-model:open="showTerms"
      title="交易条款"
      :footer="null"
      width="600px"
    >
      <div class="terms-content">
        <h4>1. 交易规则</h4>
        <p>所有交易均通过托管系统进行，确保买卖双方权益。</p>

        <h4>2. 退款政策</h4>
        <p>在卖家确认发货前，买家可以申请全额退款。发货后需双方协商解决。</p>

        <h4>3. 争议处理</h4>
        <p>如发生争议，平台将介入调解，最终以证据为准。</p>

        <h4>4. 免责声明</h4>
        <p>平台仅提供交易撮合服务，不对商品质量负责。</p>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:open", "confirm"]);

const quantity = ref(1);
const agreeTerms = ref(false);
const showTerms = ref(false);

// 计算总价
const totalPrice = computed(() => {
  if (!props.order) {
    return 0;
  }
  return quantity.value * props.order.price_amount;
});

// 监听订单变化，重置数量
watch(
  () => props.order,
  (newOrder) => {
    if (newOrder) {
      quantity.value = 1;
      agreeTerms.value = false;
    }
  },
);

// 确认购买
const handleConfirm = () => {
  if (!agreeTerms.value) {
    return;
  }
  emit("confirm", {
    orderId: props.order.id,
    quantity: quantity.value,
    totalPrice: totalPrice.value,
  });
};

// 工具函数
const shortenDid = (did) => {
  if (!did) {
    return "";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};
</script>

<style scoped>
.total-price {
  color: #1890ff;
  font-size: 18px;
}

.available-hint {
  font-size: 12px;
  color: #999;
  margin-left: 8px;
}

.terms-content {
  max-height: 400px;
  overflow-y: auto;
}

.terms-content h4 {
  margin-top: 16px;
  margin-bottom: 8px;
}

.terms-content p {
  color: #666;
  line-height: 1.6;
}
</style>
