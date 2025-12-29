<template>
  <div class="asset-transfer">
    <a-modal
      :visible="visible"
      title="转账资产"
      width="600px"
      :confirm-loading="transferring"
      @ok="handleTransfer"
      @cancel="handleCancel"
    >
      <a-form layout="vertical">
        <!-- 资产信息 -->
        <a-alert v-if="asset" type="info" style="margin-bottom: 16px">
          <template #message>
            <a-space>
              <span>资产: <strong>{{ asset.name }}</strong></span>
              <a-tag v-if="asset.symbol" color="blue">{{ asset.symbol }}</a-tag>
            </a-space>
          </template>
          <template #description>
            当前余额: <strong class="balance-value">{{ formatAmount(asset.amount, asset.decimals) }}</strong>
          </template>
        </a-alert>

        <!-- 接收者 DID -->
        <a-form-item label="接收者 DID" required>
          <did-selector
            v-model:value="form.toDid"
            placeholder="选择接收者 DID"
            :exclude-dids="[currentUserDid]"
            show-quick-actions
            @create-did="handleCreateDid"
          />
          <template #extra>
            从您的身份列表或好友列表中选择接收者
          </template>
        </a-form-item>

        <!-- 转账数量 -->
        <a-form-item label="转账数量" required>
          <a-input-number
            v-model:value="form.amount"
            :min="getMinAmount()"
            :max="getMaxAmount()"
            :step="getStep()"
            :precision="asset?.decimals || 0"
            style="width: 100%"
            placeholder="输入转账数量"
          >
            <template #addonAfter>
              <a-button type="link" size="small" @click="setMaxAmount">
                全部
              </a-button>
            </template>
          </a-input-number>
          <template #extra>
            可用余额: {{ formatAmount(asset?.amount || 0, asset?.decimals || 0) }}
          </template>
        </a-form-item>

        <!-- 备注 -->
        <a-form-item label="备注（可选）">
          <a-textarea
            v-model:value="form.memo"
            placeholder="添加转账备注..."
            :rows="3"
            :maxlength="200"
            show-count
          />
        </a-form-item>

        <!-- 转账确认信息 -->
        <a-card v-if="form.toDid && form.amount > 0" size="small" title="转账确认">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="资产">
              {{ asset?.name }} {{ asset?.symbol ? `(${asset.symbol})` : '' }}
            </a-descriptions-item>
            <a-descriptions-item label="接收者">
              <a-typography-text copyable style="font-size: 12px">
                {{ shortenDid(form.toDid) }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="数量">
              <strong style="color: #1890ff; font-size: 16px">
                {{ formatAmount(form.amount * Math.pow(10, asset?.decimals || 0), asset?.decimals || 0) }}
              </strong>
            </a-descriptions-item>
            <a-descriptions-item v-if="form.memo" label="备注">
              {{ form.memo }}
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
  UserOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import DIDSelector from './common/DIDSelector.vue';

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  asset: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['transferred', 'cancel', 'update:visible']);

// Store
const tradeStore = useTradeStore();

// 状态
const transferring = computed(() => tradeStore.asset.loading);
const currentUserDid = ref('');

const form = reactive({
  toDid: '',
  amount: 0,
  memo: '',
});

// 工具函数
const formatAmount = (amount, decimals = 0) => {
  if (decimals === 0) {
    return amount.toString();
  }
  const divisor = Math.pow(10, decimals);
  return (amount / divisor).toFixed(decimals);
};

const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const getMinAmount = () => {
  return props.asset?.decimals > 0 ? 1 / Math.pow(10, props.asset.decimals) : 1;
};

const getMaxAmount = () => {
  if (!props.asset) return 0;
  return parseFloat(formatAmount(props.asset.amount, props.asset.decimals));
};

const getStep = () => {
  return getMinAmount();
};

const setMaxAmount = () => {
  form.amount = getMaxAmount();
};

// DID 事件处理
const handleCreateDid = () => {
  antMessage.info('请前往身份管理页面创建新的 DID');
};

// 表单验证
const validateForm = () => {
  if (!form.toDid || form.toDid.trim().length === 0) {
    antMessage.warning('请选择接收者 DID');
    return false;
  }

  if (form.toDid === currentUserDid.value) {
    antMessage.warning('不能转账给自己');
    return false;
  }

  if (form.amount <= 0) {
    antMessage.warning('转账数量必须大于 0');
    return false;
  }

  if (!props.asset) {
    antMessage.error('资产信息不存在');
    return false;
  }

  // 检查余额
  const maxAmount = getMaxAmount();
  if (form.amount > maxAmount) {
    antMessage.warning(`转账数量超过可用余额（最大: ${maxAmount}）`);
    return false;
  }

  return true;
};

// 转账
const handleTransfer = async () => {
  try {
    // 验证表单
    if (!validateForm()) {
      return;
    }

    // 转换数量（考虑小数位）
    const actualAmount = Math.floor(form.amount * Math.pow(10, props.asset.decimals));

    // 使用 store action 执行转账
    await tradeStore.transferAsset(
      props.asset.id || props.asset.asset_id,
      form.toDid.trim(),
      actualAmount,
      form.memo.trim()
    );

    antMessage.success(`成功转账 ${form.amount} ${props.asset.symbol || props.asset.name}！`);

    // 通知父组件
    emit('transferred');

    // 关闭对话框
    emit('update:visible', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('[AssetTransfer] 转账失败:', error);
    antMessage.error(error.message || '转账失败');
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
  form.toDid = '';
  form.amount = 0;
  form.memo = '';
};

// 获取当前用户 DID
const loadCurrentUserDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    console.error('[AssetTransfer] 获取当前用户 DID 失败:', error);
  }
};

// 监听对话框打开
watch(() => props.visible, async (newVal) => {
  if (newVal) {
    // 重置表单
    resetForm();

    // 加载当前用户 DID
    if (!currentUserDid.value) {
      await loadCurrentUserDid();
    }
  }
});

// 生命周期
onMounted(() => {
  loadCurrentUserDid();
});
</script>

<style scoped>
.asset-transfer {
  /* 样式 */
}

.balance-value {
  color: #1890ff;
  font-size: 16px;
}
</style>
