<template>
  <a-modal
    v-model:open="visible"
    title="编辑订单"
    width="700px"
    :confirm-loading="updating"
    @ok="handleUpdate"
    @cancel="handleCancel"
  >
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
      <!-- 订单类型（不可编辑） -->
      <a-form-item label="订单类型">
        <a-tag
          :color="getOrderTypeColor(order.order_type)"
          style="font-size: 14px"
        >
          {{ getOrderTypeLabel(order.order_type) }}
        </a-tag>
        <span style="color: #8c8c8c; margin-left: 8px; font-size: 12px">
          （订单类型不可修改）
        </span>
      </a-form-item>

      <!-- 资产信息（不可编辑） -->
      <a-form-item label="资产">
        <a-space>
          <span style="font-weight: 500">{{ order.asset_name }}</span>
          <a-tag v-if="order.asset_symbol" color="blue">
            {{ order.asset_symbol }}
          </a-tag>
        </a-space>
        <div style="color: #8c8c8c; font-size: 12px; margin-top: 4px">
          （资产不可修改）
        </div>
      </a-form-item>

      <!-- 单价 -->
      <a-form-item label="单价" name="price_amount" required>
        <a-input-number
          v-model:value="form.price_amount"
          :min="0.00000001"
          :precision="8"
          style="width: 100%"
          placeholder="输入单价"
        >
          <template #addonAfter>
            {{ order.price_asset_symbol || "CC" }}
          </template>
        </a-input-number>
      </a-form-item>

      <!-- 数量 -->
      <a-form-item label="数量" name="quantity" required>
        <a-input-number
          v-model:value="form.quantity"
          :min="1"
          :max="maxQuantity"
          style="width: 100%"
          placeholder="输入数量"
        />
        <template #extra>
          <span v-if="order.order_type === 'sell'">
            原数量: {{ order.quantity }} | 可用余额: {{ availableBalance }}
          </span>
          <span v-else> 原数量: {{ order.quantity }} </span>
        </template>
      </a-form-item>

      <!-- 总价预览 -->
      <a-form-item label="总价">
        <a-statistic
          :value="totalPrice"
          :precision="2"
          :suffix="order.price_asset_symbol || 'CC'"
          style="display: inline-block"
        />
        <a-tag v-if="priceChanged" color="orange" style="margin-left: 12px">
          原价: {{ originalTotalPrice.toFixed(2) }}
          {{ order.price_asset_symbol || "CC" }}
        </a-tag>
      </a-form-item>

      <!-- 描述 -->
      <a-form-item label="订单描述" name="description">
        <a-textarea
          v-model:value="form.description"
          :rows="4"
          :maxlength="500"
          show-count
          placeholder="详细描述您的订单（可选）"
        />
      </a-form-item>

      <!-- 联系方式 -->
      <a-form-item label="联系方式" name="contact_info">
        <a-input
          v-model:value="form.contact_info"
          placeholder="您的联系方式（可选）"
          :maxlength="100"
        />
      </a-form-item>

      <!-- 位置信息 -->
      <a-form-item label="位置" name="location">
        <a-input
          v-model:value="form.location"
          placeholder="交易地点或发货地址（可选）"
          :maxlength="200"
        />
      </a-form-item>

      <!-- 有效期 -->
      <a-form-item label="有效期" name="valid_until">
        <a-date-picker
          v-model:value="form.valid_until"
          show-time
          format="YYYY-MM-DD HH:mm:ss"
          style="width: 100%"
          :disabled-date="disabledDate"
          placeholder="选择订单有效期（可选）"
        />
        <template #extra> 留空表示永久有效 </template>
      </a-form-item>

      <!-- 修改说明 -->
      <a-form-item label="修改说明">
        <a-textarea
          v-model:value="form.edit_reason"
          :rows="2"
          :maxlength="200"
          show-count
          placeholder="说明本次修改的原因（可选，但建议填写）"
        />
      </a-form-item>

      <!-- 修改提示 -->
      <a-alert
        v-if="hasChanges"
        message="订单将被更新"
        description="修改订单后，已关注此订单的用户将收到更新通知"
        type="warning"
        show-icon
        style="margin-top: 16px"
      />
    </a-form>
  </a-modal>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import dayjs from "dayjs";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Object,
    required: true,
  },
  availableBalance: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["update:open", "updated"]);

const formRef = ref(null);
const updating = ref(false);

const visible = computed({
  get: () => props.open,
  set: (val) => emit("update:open", val),
});

// 表单数据
const form = ref({
  price_amount: 0,
  quantity: 0,
  description: "",
  contact_info: "",
  location: "",
  valid_until: null,
  edit_reason: "",
});

// 表单验证规则
const rules = {
  price_amount: [
    { required: true, message: "请输入单价", trigger: "blur" },
    {
      type: "number",
      min: 0.00000001,
      message: "单价必须大于0",
      trigger: "blur",
    },
  ],
  quantity: [
    { required: true, message: "请输入数量", trigger: "blur" },
    { type: "number", min: 1, message: "数量必须大于0", trigger: "blur" },
  ],
};

// 计算属性
const maxQuantity = computed(() => {
  if (props.order.order_type === "sell") {
    // 对于出售订单，最大数量 = 原数量 + 可用余额
    return props.order.quantity + props.availableBalance;
  }
  return 999999999; // 其他类型订单没有限制
});

const totalPrice = computed(() => {
  return form.value.price_amount * form.value.quantity;
});

const originalTotalPrice = computed(() => {
  return props.order.price_amount * props.order.quantity;
});

const priceChanged = computed(() => {
  return Math.abs(totalPrice.value - originalTotalPrice.value) > 0.01;
});

const hasChanges = computed(() => {
  return (
    form.value.price_amount !== props.order.price_amount ||
    form.value.quantity !== props.order.quantity ||
    form.value.description !== (props.order.description || "") ||
    form.value.contact_info !== (props.order.contact_info || "") ||
    form.value.location !== (props.order.location || "")
  );
});

// 初始化表单
const initForm = () => {
  form.value = {
    price_amount: props.order.price_amount,
    quantity: props.order.quantity,
    description: props.order.description || "",
    contact_info: props.order.contact_info || "",
    location: props.order.location || "",
    valid_until: props.order.valid_until
      ? dayjs(props.order.valid_until)
      : null,
    edit_reason: "",
  };
};

// 禁用过去的日期
const disabledDate = (current) => {
  return current && current < dayjs().startOf("day");
};

// 处理更新
const handleUpdate = async () => {
  try {
    await formRef.value.validate();

    if (!hasChanges.value) {
      message.warning("没有任何修改");
      return;
    }

    updating.value = true;

    const updateData = {
      price_amount: form.value.price_amount,
      quantity: form.value.quantity,
      description: form.value.description,
      contact_info: form.value.contact_info,
      location: form.value.location,
      valid_until: form.value.valid_until
        ? form.value.valid_until.valueOf()
        : null,
    };

    // 使用统一的 electronAPI 调用
    const result = await window.electronAPI.marketplace.updateOrder(
      props.order.id,
      updateData,
    );

    message.success("订单已更新");
    emit("updated", result);
    visible.value = false;
  } catch (error) {
    if (error.errorFields) {
      message.error("请检查表单填写");
    } else {
      logger.error("更新订单失败:", error);
      message.error("更新订单失败");
    }
  } finally {
    updating.value = false;
  }
};

// 处理取消
const handleCancel = () => {
  visible.value = false;
};

// 工具函数
const getOrderTypeColor = (type) => {
  const colorMap = {
    sell: "green",
    buy: "blue",
    auction: "purple",
    exchange: "orange",
  };
  return colorMap[type] || "default";
};

const getOrderTypeLabel = (type) => {
  const labelMap = {
    sell: "出售",
    buy: "求购",
    auction: "拍卖",
    exchange: "交换",
  };
  return labelMap[type] || type;
};

// 监听 open 变化，初始化表单
watch(
  () => props.open,
  (val) => {
    if (val) {
      initForm();
    }
  },
);
</script>

<style scoped lang="scss">
// 样式继承自 OrderCreate.vue
</style>
