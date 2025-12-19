<template>
  <div class="order-create">
    <a-modal
      :visible="visible"
      title="创建订单"
      width="700px"
      :confirm-loading="creating"
      @ok="handleCreate"
      @cancel="handleCancel"
    >
      <a-form layout="vertical">
        <!-- 订单类型 -->
        <a-form-item label="订单类型" required>
          <a-radio-group v-model:value="form.type" button-style="solid">
            <a-radio-button value="buy">
              <shopping-outlined /> 求购
            </a-radio-button>
            <a-radio-button value="sell">
              <dollar-outlined /> 出售
            </a-radio-button>
            <a-radio-button value="service">
              <tool-outlined /> 服务
            </a-radio-button>
            <a-radio-button value="barter">
              <swap-outlined /> 以物换物
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- 订单标题 -->
        <a-form-item label="订单标题" required>
          <a-input
            v-model:value="form.title"
            placeholder="简明扼要地描述您的订单"
            :maxlength="100"
            show-count
          />
        </a-form-item>

        <!-- 资产选择（出售订单需要） -->
        <a-form-item v-if="form.type === 'sell'" label="出售资产" required>
          <a-select
            v-model:value="form.assetId"
            placeholder="选择要出售的资产"
            show-search
            :filter-option="filterAssetOption"
            @change="handleAssetChange"
          >
            <a-select-option
              v-for="asset in myAssets"
              :key="asset.asset_id"
              :value="asset.asset_id"
              :label="asset.name"
            >
              <a-space>
                <span>{{ asset.name }}</span>
                <a-tag v-if="asset.symbol" color="blue">{{ asset.symbol }}</a-tag>
                <span style="color: #999; font-size: 12px">余额: {{ formatAmount(asset.amount, asset.decimals) }}</span>
              </a-space>
            </a-select-option>
          </a-select>
        </a-form-item>

        <!-- 数量 -->
        <a-form-item label="数量" required>
          <a-input-number
            v-model:value="form.quantity"
            :min="1"
            :max="getMaxQuantity()"
            style="width: 100%"
            placeholder="订单数量"
          />
          <template v-if="form.type === 'sell' && selectedAsset" #extra>
            可用余额: {{ formatAmount(selectedAsset.amount, selectedAsset.decimals) }}
          </template>
        </a-form-item>

        <!-- 价格资产 -->
        <a-form-item label="价格资产">
          <a-select
            v-model:value="form.priceAssetId"
            placeholder="选择支付资产（默认为主币）"
            allow-clear
          >
            <a-select-option
              v-for="asset in paymentAssets"
              :key="asset.asset_id"
              :value="asset.asset_id"
            >
              <a-space>
                <span>{{ asset.name }}</span>
                <a-tag v-if="asset.symbol" color="blue">{{ asset.symbol }}</a-tag>
              </a-space>
            </a-select-option>
          </a-select>
        </a-form-item>

        <!-- 单价 -->
        <a-form-item label="单价" required>
          <a-input-number
            v-model:value="form.priceAmount"
            :min="0"
            :step="0.01"
            :precision="2"
            style="width: 100%"
            placeholder="每个单位的价格"
          >
            <template #addonAfter>
              {{ selectedPriceAsset?.symbol || '单位' }}
            </template>
          </a-input-number>
        </a-form-item>

        <!-- 总价显示 -->
        <a-alert
          v-if="form.quantity > 0 && form.priceAmount > 0"
          type="info"
          style="margin-bottom: 16px"
        >
          <template #message>
            <strong>总价: {{ (form.quantity * form.priceAmount).toFixed(2) }} {{ selectedPriceAsset?.symbol || '单位' }}</strong>
          </template>
        </a-alert>

        <!-- 描述 -->
        <a-form-item label="订单描述">
          <a-textarea
            v-model:value="form.description"
            placeholder="详细描述您的订单内容、交易条件等..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 高级选项 -->
        <a-collapse ghost>
          <a-collapse-panel key="metadata" header="高级设置（可选）">
            <a-form-item label="交易地点">
              <a-input v-model:value="form.metadata.location" placeholder="线下交易地点" />
            </a-form-item>

            <a-form-item label="联系方式">
              <a-input v-model:value="form.metadata.contact" placeholder="联系电话/邮箱等" />
            </a-form-item>

            <a-form-item label="有效期（天）">
              <a-input-number
                v-model:value="form.metadata.validDays"
                :min="1"
                :max="365"
                style="width: 100%"
                placeholder="订单有效天数"
              />
            </a-form-item>
          </a-collapse-panel>
        </a-collapse>

        <!-- 订单预览 -->
        <a-card v-if="isFormValid" size="small" title="订单预览" style="margin-top: 16px">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="类型">
              <a-tag :color="getOrderTypeColor(form.type)">
                {{ getOrderTypeName(form.type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="标题">
              {{ form.title }}
            </a-descriptions-item>
            <a-descriptions-item v-if="form.type === 'sell' && selectedAsset" label="资产">
              {{ selectedAsset.name }} {{ selectedAsset.symbol ? `(${selectedAsset.symbol})` : '' }}
            </a-descriptions-item>
            <a-descriptions-item label="数量">
              {{ form.quantity }}
            </a-descriptions-item>
            <a-descriptions-item label="单价">
              {{ form.priceAmount }} {{ selectedPriceAsset?.symbol || '单位' }}
            </a-descriptions-item>
            <a-descriptions-item label="总价">
              <strong style="color: #1890ff; font-size: 16px">
                {{ (form.quantity * form.priceAmount).toFixed(2) }} {{ selectedPriceAsset?.symbol || '单位' }}
              </strong>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  ShoppingOutlined,
  DollarOutlined,
  ToolOutlined,
  SwapOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(['created', 'cancel', 'update:visible']);

// 状态
const creating = ref(false);
const myAssets = ref([]);
const paymentAssets = ref([]);
const currentDid = ref('');

const form = reactive({
  type: 'sell',
  title: '',
  assetId: null,
  quantity: 1,
  priceAssetId: null,
  priceAmount: 0,
  description: '',
  metadata: {
    location: '',
    contact: '',
    validDays: 30,
  },
});

// 计算属性
const selectedAsset = computed(() => {
  return myAssets.value.find(a => a.asset_id === form.assetId);
});

const selectedPriceAsset = computed(() => {
  if (!form.priceAssetId) return null;
  return paymentAssets.value.find(a => a.asset_id === form.priceAssetId);
});

const isFormValid = computed(() => {
  return form.title && form.quantity > 0 && form.priceAmount > 0;
});

// 工具函数
const formatAmount = (amount, decimals = 0) => {
  if (decimals === 0) {
    return amount.toString();
  }
  const divisor = Math.pow(10, decimals);
  return (amount / divisor).toFixed(decimals);
};

const getMaxQuantity = () => {
  if (form.type === 'sell' && selectedAsset.value) {
    return parseFloat(formatAmount(selectedAsset.value.amount, selectedAsset.value.decimals));
  }
  return 1000000; // 求购订单没有数量限制
};

const getOrderTypeColor = (type) => {
  const colors = {
    buy: 'blue',
    sell: 'green',
    service: 'purple',
    barter: 'orange',
  };
  return colors[type] || 'default';
};

const getOrderTypeName = (type) => {
  const names = {
    buy: '求购',
    sell: '出售',
    service: '服务',
    barter: '以物换物',
  };
  return names[type] || type;
};

const filterAssetOption = (input, option) => {
  return option.label.toLowerCase().includes(input.toLowerCase());
};

// 加载我的资产
const loadMyAssets = async () => {
  try {
    if (!currentDid.value) {
      const identity = await window.electronAPI.did.getCurrentIdentity();
      if (identity) {
        currentDid.value = identity.did;
      }
    }

    if (!currentDid.value) {
      return;
    }

    myAssets.value = await window.electronAPI.asset.getByOwner(currentDid.value);

    // 筛选出 token 类型资产作为支付选项
    paymentAssets.value = myAssets.value.filter(a => a.asset_type === 'token');
  } catch (error) {
    console.error('加载资产列表失败:', error);
    antMessage.error('加载资产列表失败: ' + error.message);
  }
};

// 处理资产选择变化
const handleAssetChange = (assetId) => {
  const asset = myAssets.value.find(a => a.asset_id === assetId);
  if (asset) {
    // 自动设置数量上限
    const maxQty = getMaxQuantity();
    if (form.quantity > maxQty) {
      form.quantity = maxQty;
    }
  }
};

// 创建订单
const handleCreate = async () => {
  try {
    // 验证
    if (!form.title || form.title.trim().length === 0) {
      antMessage.warning('请输入订单标题');
      return;
    }

    if (form.type === 'sell' && !form.assetId) {
      antMessage.warning('请选择要出售的资产');
      return;
    }

    if (form.quantity <= 0) {
      antMessage.warning('订单数量必须大于 0');
      return;
    }

    if (form.priceAmount <= 0) {
      antMessage.warning('单价必须大于 0');
      return;
    }

    // 检查余额
    if (form.type === 'sell' && selectedAsset.value) {
      const maxQty = getMaxQuantity();
      if (form.quantity > maxQty) {
        antMessage.warning('订单数量超过可用余额');
        return;
      }
    }

    creating.value = true;

    const options = {
      type: form.type,
      assetId: form.assetId,
      title: form.title.trim(),
      description: form.description,
      priceAssetId: form.priceAssetId,
      priceAmount: form.priceAmount,
      quantity: form.quantity,
      metadata: {
        ...form.metadata,
        createdAt: Date.now(),
      },
    };

    const order = await window.electronAPI.marketplace.createOrder(options);

    antMessage.success('订单创建成功！');

    // 通知父组件
    emit('created', order);

    // 关闭对话框
    emit('update:visible', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('创建订单失败:', error);
    antMessage.error('创建订单失败: ' + error.message);
  } finally {
    creating.value = false;
  }
};

// 取消
const handleCancel = () => {
  emit('cancel');
  emit('update:visible', false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.type = 'sell';
  form.title = '';
  form.assetId = null;
  form.quantity = 1;
  form.priceAssetId = null;
  form.priceAmount = 0;
  form.description = '';
  form.metadata = {
    location: '',
    contact: '',
    validDays: 30,
  };
};

// 监听对话框打开
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadMyAssets();
    resetForm();
  }
});

// 生命周期
onMounted(async () => {
  await loadMyAssets();
});
</script>

<style scoped>
.order-create {
  /* 样式 */
}
</style>
