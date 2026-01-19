<template>
  <div class="wallet-selector">
    <a-select
      v-model:value="selectedValue"
      :placeholder="placeholder"
      :loading="loading"
      :allow-clear="allowClear"
      :disabled="disabled"
      :size="size"
      :style="{ width: width }"
      @change="handleChange"
    >
      <template #suffixIcon>
        <wallet-outlined />
      </template>

      <!-- 内置钱包选项 -->
      <a-select-opt-group label="内置钱包">
        <a-select-option
          v-for="wallet in internalWallets"
          :key="wallet.id"
          :value="wallet.id"
        >
          <div class="wallet-option">
            <div class="wallet-avatar">
              <a-avatar
                :size="avatarSize"
                :style="{ backgroundColor: getAvatarColor(wallet.address) }"
              >
                <wallet-outlined />
              </a-avatar>
            </div>
            <div class="wallet-info">
              <div class="wallet-name">
                {{ formatAddress(wallet.address) }}
                <a-tag
                  v-if="wallet.is_default"
                  color="blue"
                  size="small"
                >
                  默认
                </a-tag>
              </div>
              <div
                v-if="showBalance"
                class="wallet-balance"
              >
                <span class="balance-label">余额:</span>
                <span class="balance-value">{{ getWalletBalance(wallet) }}</span>
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>

      <!-- 外部钱包选项 -->
      <a-select-opt-group
        v-if="showExternalOptions"
        label="外部钱包"
      >
        <a-select-option
          v-if="!externalWalletConnected"
          value="__metamask__"
        >
          <div class="wallet-option">
            <div class="wallet-avatar">
              <a-avatar
                :size="avatarSize"
                style="background-color: #f6851b"
              >
                🦊
              </a-avatar>
            </div>
            <div class="wallet-info">
              <div class="wallet-name">
                连接 MetaMask
              </div>
            </div>
          </div>
        </a-select-option>

        <a-select-option
          v-if="!externalWalletConnected"
          value="__walletconnect__"
        >
          <div class="wallet-option">
            <div class="wallet-avatar">
              <a-avatar
                :size="avatarSize"
                style="background-color: #3b99fc"
              >
                🔗
              </a-avatar>
            </div>
            <div class="wallet-info">
              <div class="wallet-name">
                连接 WalletConnect
              </div>
            </div>
          </div>
        </a-select-option>

        <!-- 已连接的外部钱包 -->
        <a-select-option
          v-if="externalWalletConnected"
          value="__external_connected__"
        >
          <div class="wallet-option">
            <div class="wallet-avatar">
              <a-avatar
                :size="avatarSize"
                style="background-color: #52c41a"
              >
                ✓
              </a-avatar>
            </div>
            <div class="wallet-info">
              <div class="wallet-name">
                {{ externalWalletProvider === 'metamask' ? 'MetaMask' : 'WalletConnect' }}
                <a-tag
                  color="green"
                  size="small"
                >
                  已连接
                </a-tag>
              </div>
              <div class="wallet-balance">
                {{ formatAddress(externalWalletAddress) }}
              </div>
            </div>
          </div>
        </a-select-option>
      </a-select-opt-group>

      <!-- 空状态 -->
      <template #notFoundContent>
        <a-empty
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
          description="暂无钱包"
        >
          <a-button
            type="link"
            size="small"
            @click="handleCreateWallet"
          >
            <plus-outlined /> 创建钱包
          </a-button>
        </a-empty>
      </template>
    </a-select>

    <!-- 快捷操作 -->
    <div
      v-if="showQuickActions"
      class="quick-actions"
    >
      <a-button
        type="link"
        size="small"
        @click="handleCreateWallet"
      >
        <plus-outlined /> 新建
      </a-button>
      <a-button
        type="link"
        size="small"
        @click="handleManageWallets"
      >
        <setting-outlined /> 管理
      </a-button>
      <a-button
        v-if="currentAddress"
        type="link"
        size="small"
        @click="handleCopyAddress"
      >
        <copy-outlined /> 复制地址
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { message, Empty } from 'ant-design-vue';
import {
  WalletOutlined,
  CopyOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { useRouter } from 'vue-router';
import { useBlockchainStore } from '@/stores/blockchain';

const props = defineProps({
  // v-model绑定值 (钱包ID或特殊值)
  modelValue: {
    type: String,
    default: '',
  },
  // 占位符
  placeholder: {
    type: String,
    default: '选择钱包',
  },
  // 是否允许清空
  allowClear: {
    type: Boolean,
    default: true,
  },
  // 是否禁用
  disabled: {
    type: Boolean,
    default: false,
  },
  // 尺寸
  size: {
    type: String,
    default: 'middle', // 'small' | 'middle' | 'large'
  },
  // 宽度
  width: {
    type: String,
    default: '100%',
  },
  // 头像大小
  avatarSize: {
    type: Number,
    default: 32,
  },
  // 是否显示余额
  showBalance: {
    type: Boolean,
    default: true,
  },
  // 是否显示外部钱包选项
  showExternalOptions: {
    type: Boolean,
    default: true,
  },
  // 是否显示快捷操作
  showQuickActions: {
    type: Boolean,
    default: false,
  },
  // 当前网络 ID（用于获取余额）
  chainId: {
    type: Number,
    default: null,
  },
});

const emit = defineEmits([
  'update:modelValue',
  'change',
  'create-wallet',
  'manage-wallets',
  'external-connect',
]);

const router = useRouter();
const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);

// 从 store 获取数据
const internalWallets = computed(() => blockchainStore.internalWallets);
const externalWalletConnected = computed(() => blockchainStore.externalWalletConnected);
const externalWalletAddress = computed(() => blockchainStore.externalWalletAddress);
const externalWalletProvider = computed(() => blockchainStore.externalWalletProvider);
const currentWallet = computed(() => blockchainStore.currentWallet);
const currentAddress = computed(() => blockchainStore.currentAddress);

// 双向绑定
const selectedValue = computed({
  get: () => {
    if (externalWalletConnected.value) {
      return '__external_connected__';
    }
    return props.modelValue;
  },
  set: (value) => {
    emit('update:modelValue', value);
  },
});

/**
 * 格式化地址显示
 */
const formatAddress = (address) => {
  if (!address) {return '';}
  if (address.length <= 20) {return address;}
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * 获取头像颜色
 */
const getAvatarColor = (address) => {
  if (!address) {return '#1890ff';}

  // 根据地址生成颜色
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    '#f56a00',
    '#7265e6',
    '#ffbf00',
    '#00a2ae',
    '#1890ff',
    '#52c41a',
    '#fa8c16',
    '#eb2f96',
  ];

  return colors[Math.abs(hash) % colors.length];
};

/**
 * 获取钱包余额
 */
const getWalletBalance = (wallet) => {
  if (!props.showBalance || !wallet.address) {
    return '';
  }

  const chainId = props.chainId || blockchainStore.currentChainId;
  const balance = blockchainStore.getBalance(wallet.address, chainId);

  if (!balance || balance === '0') {
    return '0.00 ETH';
  }

  // 简化余额显示（实际应根据网络符号）
  const network = blockchainStore.currentNetwork;
  const symbol = network?.symbol || 'ETH';

  // 将 wei 转换为 ether（简化版本）
  const etherBalance = (parseFloat(balance) / 1e18).toFixed(4);
  return `${etherBalance} ${symbol}`;
};

/**
 * 加载钱包列表
 */
const loadWallets = async () => {
  loading.value = true;
  try {
    await blockchainStore.loadWallets();
  } catch (error) {
    console.error('[WalletSelector] 加载钱包失败:', error);
    message.error('加载钱包失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

/**
 * 选择变化处理
 */
const handleChange = async (value) => {
  console.log('[WalletSelector] 选择钱包:', value);

  // 处理特殊值
  if (value === '__metamask__') {
    await handleConnectMetaMask();
    return;
  } else if (value === '__walletconnect__') {
    await handleConnectWalletConnect();
    return;
  } else if (value === '__external_connected__') {
    // 已连接的外部钱包，不需要操作
    emit('change', {
      type: 'external',
      address: externalWalletAddress.value,
      provider: externalWalletProvider.value,
    });
    return;
  }

  // 内置钱包
  const selectedWallet = internalWallets.value.find(w => w.id === value);
  if (selectedWallet) {
    blockchainStore.selectWallet(selectedWallet);
    emit('change', {
      type: 'internal',
      wallet: selectedWallet,
    });
  }
};

/**
 * 连接 MetaMask
 */
const handleConnectMetaMask = async () => {
  try {
    loading.value = true;
    const result = await blockchainStore.connectMetaMask();
    message.success('MetaMask 连接成功');
    emit('external-connect', {
      provider: 'metamask',
      address: result.address,
      chainId: result.chainId,
    });
  } catch (error) {
    console.error('[WalletSelector] 连接 MetaMask 失败:', error);
    message.error('连接 MetaMask 失败: ' + error.message);
    // 重置选择
    selectedValue.value = props.modelValue;
  } finally {
    loading.value = false;
  }
};

/**
 * 连接 WalletConnect
 */
const handleConnectWalletConnect = async () => {
  try {
    loading.value = true;
    const result = await blockchainStore.connectWalletConnect();
    message.success('WalletConnect 连接成功');
    emit('external-connect', {
      provider: 'walletconnect',
      address: result.address,
      chainId: result.chainId,
    });
  } catch (error) {
    console.error('[WalletSelector] 连接 WalletConnect 失败:', error);
    message.error('连接 WalletConnect 失败: ' + error.message);
    // 重置选择
    selectedValue.value = props.modelValue;
  } finally {
    loading.value = false;
  }
};

/**
 * 复制地址
 */
const handleCopyAddress = async () => {
  if (!currentAddress.value) {
    message.warning('未选择钱包');
    return;
  }

  try {
    await navigator.clipboard.writeText(currentAddress.value);
    message.success('地址已复制到剪贴板');
  } catch (error) {
    console.error('[WalletSelector] 复制失败:', error);
    message.error('复制失败');
  }
};

/**
 * 创建钱包
 */
const handleCreateWallet = () => {
  emit('create-wallet');
  // 默认跳转到钱包管理页
  router.push('/app/wallet');
};

/**
 * 管理钱包
 */
const handleManageWallets = () => {
  emit('manage-wallets');
  router.push('/app/wallet');
};

// 生命周期
onMounted(() => {
  loadWallets();

  // 如果有当前钱包且显示余额，刷新余额
  if (props.showBalance && currentAddress.value) {
    blockchainStore.refreshCurrentBalance();
  }
});

// 监听链 ID 变化，刷新余额
watch(
  () => props.chainId || blockchainStore.currentChainId,
  () => {
    if (props.showBalance && currentAddress.value) {
      blockchainStore.refreshCurrentBalance();
    }
  }
);
</script>

<style scoped>
.wallet-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.wallet-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.wallet-avatar {
  flex-shrink: 0;
}

.wallet-info {
  flex: 1;
  min-width: 0;
}

.wallet-name {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.wallet-balance {
  font-size: 12px;
  color: #8c8c8c;
  font-family: 'Courier New', monospace;
  display: flex;
  align-items: center;
  gap: 4px;
}

.balance-label {
  color: #595959;
}

.balance-value {
  color: #52c41a;
  font-weight: 500;
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  border-left: 1px solid #f0f0f0;
  padding-left: 8px;
}

:deep(.ant-select-selector) {
  min-height: 36px;
}

:deep(.ant-select-selection-item) {
  display: flex;
  align-items: center;
}

:deep(.ant-select-item-group) {
  font-weight: 600;
  color: #262626;
}
</style>
