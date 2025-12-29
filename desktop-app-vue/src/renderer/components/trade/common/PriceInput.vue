<template>
  <div class="price-input">
    <a-input-group compact>
      <!-- 金额输入 -->
      <a-input-number
        v-model:value="amount"
        :min="min"
        :max="max"
        :step="step"
        :precision="precision"
        :disabled="disabled"
        :placeholder="placeholder"
        :style="{ width: assetSelectorWidth ? `calc(100% - ${assetSelectorWidth}px)` : '70%' }"
        @change="handleChange"
      >
        <template v-if="prefix" #prefix>
          <component :is="prefix" />
        </template>
      </a-input-number>

      <!-- 资产选择器 -->
      <a-select
        v-if="showAssetSelector"
        v-model:value="selectedAsset"
        :disabled="disabled"
        :style="{ width: assetSelectorWidth ? `${assetSelectorWidth}px` : '30%' }"
        @change="handleAssetChange"
      >
        <a-select-option
          v-for="asset in availableAssets"
          :key="asset.id"
          :value="asset.id"
        >
          <a-space size="small">
            <component
              :is="getAssetIcon(asset.asset_type)"
              :style="{ color: getAssetColor(asset.asset_type) }"
            />
            <span>{{ asset.symbol || asset.name }}</span>
          </a-space>
        </a-select-option>
      </a-select>

      <!-- 固定资产标签 -->
      <a-input
        v-else
        :value="assetLabel"
        disabled
        :style="{ width: assetSelectorWidth ? `${assetSelectorWidth}px` : '30%' }"
      >
        <template #prefix>
          <component
            v-if="fixedAssetType"
            :is="getAssetIcon(fixedAssetType)"
            :style="{ color: getAssetColor(fixedAssetType) }"
          />
        </template>
      </a-input>
    </a-input-group>

    <!-- 辅助信息 -->
    <div v-if="showHelper" class="price-helper">
      <a-space :size="4">
        <!-- 估值信息 -->
        <span v-if="estimatedValue" class="estimated-value">
          ≈ {{ formatAmount(estimatedValue) }} {{ estimatedCurrency }}
        </span>

        <!-- 余额信息 -->
        <span v-if="showBalance && balance !== null" class="balance-info">
          余额: {{ formatAmount(balance) }}
        </span>

        <!-- 快捷金额按钮 -->
        <a-button
          v-if="showQuickAmounts"
          v-for="(quickAmount, index) in quickAmounts"
          :key="index"
          type="link"
          size="small"
          @click="setQuickAmount(quickAmount)"
        >
          {{ quickAmount.label }}
        </a-button>
      </a-space>
    </div>

    <!-- 验证提示 -->
    <div v-if="validationMessage" class="validation-message" :class="validationType">
      <exclamation-circle-outlined v-if="validationType === 'error'" />
      <info-circle-outlined v-else />
      <span>{{ validationMessage }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  DollarOutlined,
  WalletOutlined,
  PictureOutlined,
  ReadOutlined,
  FileProtectOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  // v-model
  modelValue: {
    type: [Number, String],
    default: 0,
  },
  // 选中的资产 ID
  assetId: {
    type: String,
    default: '',
  },
  // 最小值
  min: {
    type: Number,
    default: 0,
  },
  // 最大值
  max: {
    type: Number,
    default: Infinity,
  },
  // 步长
  step: {
    type: Number,
    default: 1,
  },
  // 精度
  precision: {
    type: Number,
    default: 2,
  },
  // 占位符
  placeholder: {
    type: String,
    default: '请输入金额',
  },
  // 是否禁用
  disabled: {
    type: Boolean,
    default: false,
  },
  // 前缀图标
  prefix: {
    type: Object,
    default: () => DollarOutlined,
  },
  // 是否显示资产选择器
  showAssetSelector: {
    type: Boolean,
    default: true,
  },
  // 可选资产列表
  availableAssets: {
    type: Array,
    default: () => [],
  },
  // 固定资产标签（当 showAssetSelector=false 时）
  assetLabel: {
    type: String,
    default: 'CC',
  },
  // 固定资产类型
  fixedAssetType: {
    type: String,
    default: 'token',
  },
  // 资产选择器宽度
  assetSelectorWidth: {
    type: Number,
    default: 120,
  },
  // 是否显示辅助信息
  showHelper: {
    type: Boolean,
    default: true,
  },
  // 是否显示余额
  showBalance: {
    type: Boolean,
    default: false,
  },
  // 余额
  balance: {
    type: [Number, String],
    default: null,
  },
  // 估值
  estimatedValue: {
    type: [Number, String],
    default: null,
  },
  // 估值货币
  estimatedCurrency: {
    type: String,
    default: 'USD',
  },
  // 是否显示快捷金额
  showQuickAmounts: {
    type: Boolean,
    default: false,
  },
  // 快捷金额配置
  quickAmounts: {
    type: Array,
    default: () => [
      { label: '25%', value: 0.25 },
      { label: '50%', value: 0.5 },
      { label: '75%', value: 0.75 },
      { label: '全部', value: 1 },
    ],
  },
  // 验证消息
  validationMessage: {
    type: String,
    default: '',
  },
  // 验证类型
  validationType: {
    type: String,
    default: 'info', // 'info' | 'error' | 'warning'
  },
});

// Emits
const emit = defineEmits(['update:modelValue', 'update:assetId', 'change', 'asset-change']);

// 状态
const amount = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const selectedAsset = computed({
  get: () => props.assetId,
  set: (value) => emit('update:assetId', value),
});

// 资产类型图标
const getAssetIcon = (type) => {
  const iconMap = {
    token: WalletOutlined,
    nft: PictureOutlined,
    knowledge: ReadOutlined,
    service: FileProtectOutlined,
  };
  return iconMap[type] || WalletOutlined;
};

// 资产类型颜色
const getAssetColor = (type) => {
  const colorMap = {
    token: '#1890ff',
    nft: '#52c41a',
    knowledge: '#faad14',
    service: '#722ed1',
  };
  return colorMap[type] || '#999';
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';

  // 大数字使用科学计数法
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + 'B';
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M';
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K';
  }

  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

// 设置快捷金额
const setQuickAmount = (quickAmount) => {
  if (props.balance === null) return;

  const balance = parseFloat(props.balance);
  if (isNaN(balance)) return;

  const newAmount = balance * quickAmount.value;
  amount.value = parseFloat(newAmount.toFixed(props.precision));
};

// 事件处理
const handleChange = (value) => {
  emit('change', {
    amount: value,
    assetId: selectedAsset.value,
  });
};

const handleAssetChange = (value) => {
  const asset = props.availableAssets.find(a => a.id === value);
  emit('asset-change', asset);
};
</script>

<style scoped>
.price-input {
  width: 100%;
}

.price-helper {
  margin-top: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

.estimated-value {
  color: #1890ff;
  margin-right: 8px;
}

.balance-info {
  color: #52c41a;
}

.validation-message {
  margin-top: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.validation-message.info {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  color: #1890ff;
}

.validation-message.error {
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #ff4d4f;
}

.validation-message.warning {
  background: #fffbe6;
  border: 1px solid #ffe58f;
  color: #faad14;
}

:deep(.ant-input-number) {
  width: 100%;
}

:deep(.ant-input-group-compact > *:first-child) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

:deep(.ant-input-group-compact > *:last-child) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
