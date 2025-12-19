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
          <a-input
            v-model:value="form.toDid"
            placeholder="输入接收者的 DID"
          >
            <template #prefix><user-outlined /></template>
          </a-input>
          <template #extra>
            或从好友列表选择:
            <a-button type="link" size="small" @click="showFriendSelector = true">
              选择好友
            </a-button>
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

    <!-- 好友选择器 -->
    <a-modal
      v-model:visible="showFriendSelector"
      title="选择好友"
      width="500px"
      @ok="handleSelectFriend"
    >
      <a-list
        :data-source="friends"
        :loading="loadingFriends"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar :style="{ backgroundColor: getAvatarColor(item.friend_did) }">
                  <template #icon><user-outlined /></template>
                </a-avatar>
              </template>
              <template #title>
                {{ item.nickname || shortenDid(item.friend_did) }}
              </template>
              <template #description>
                <a-typography-text copyable style="font-size: 12px">
                  {{ item.friend_did }}
                </a-typography-text>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                type="link"
                size="small"
                @click="selectFriendDid(item.friend_did)"
              >
                选择
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  UserOutlined,
} from '@ant-design/icons-vue';

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

// 状态
const transferring = ref(false);
const showFriendSelector = ref(false);
const loadingFriends = ref(false);
const friends = ref([]);

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

const getAvatarColor = (did) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#1890ff'];
  const hash = did.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
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

// 加载好友列表
const loadFriends = async () => {
  try {
    loadingFriends.value = true;
    friends.value = await window.electronAPI.friend.getFriends();
  } catch (error) {
    console.error('加载好友列表失败:', error);
    antMessage.error('加载好友列表失败: ' + error.message);
  } finally {
    loadingFriends.value = false;
  }
};

// 选择好友
const selectFriendDid = (did) => {
  form.toDid = did;
  showFriendSelector.value = false;
};

const handleSelectFriend = () => {
  showFriendSelector.value = false;
};

// 转账
const handleTransfer = async () => {
  try {
    // 验证
    if (!form.toDid || form.toDid.trim().length === 0) {
      antMessage.warning('请输入接收者 DID');
      return;
    }

    if (form.amount <= 0) {
      antMessage.warning('转账数量必须大于 0');
      return;
    }

    if (!props.asset) {
      antMessage.error('资产信息不存在');
      return;
    }

    // 检查余额
    const maxAmount = getMaxAmount();
    if (form.amount > maxAmount) {
      antMessage.warning('转账数量超过可用余额');
      return;
    }

    transferring.value = true;

    // 转换数量（考虑小数位）
    const actualAmount = Math.floor(form.amount * Math.pow(10, props.asset.decimals));

    // 执行转账
    await window.electronAPI.asset.transfer(
      props.asset.asset_id,
      form.toDid.trim(),
      actualAmount,
      form.memo
    );

    antMessage.success('转账成功！');

    // 通知父组件
    emit('transferred');

    // 关闭对话框
    emit('update:visible', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('转账失败:', error);
    antMessage.error('转账失败: ' + error.message);
  } finally {
    transferring.value = false;
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

// 监听对话框打开
watch(() => props.visible, (newVal) => {
  if (newVal && props.asset) {
    // 重置表单
    resetForm();
  }
});

// 监听好友选择器打开
watch(() => showFriendSelector.value, (newVal) => {
  if (newVal && friends.value.length === 0) {
    loadFriends();
  }
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
