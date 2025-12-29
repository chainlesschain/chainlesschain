<template>
  <a-modal
    v-model:open="modalVisible"
    title="导入钱包"
    :width="600"
    :confirm-loading="loading"
    :maskClosable="false"
    ok-text="导入"
    cancel-text="取消"
    @ok="handleImport"
    @cancel="handleCancel"
  >
    <a-alert
      message="安全提示"
      description="请确保在安全的环境中导入钱包。切勿在不信任的设备或网络上输入您的助记词或私钥！"
      type="warning"
      show-icon
      :style="{ marginBottom: '16px' }"
    />

    <a-tabs v-model:activeKey="activeTab">
      <!-- 助记词导入 -->
      <a-tab-pane key="mnemonic" tab="助记词导入">
        <a-form
          :model="mnemonicForm"
          :rules="mnemonicRules"
          ref="mnemonicFormRef"
          layout="vertical"
        >
          <a-form-item
            label="助记词"
            name="mnemonic"
            :help="`请输入 12 个单词，用空格分隔 (已输入 ${wordCount}/12)`"
          >
            <a-textarea
              v-model:value="mnemonicForm.mnemonic"
              :rows="4"
              placeholder="请输入 12 个助记词，用空格分隔&#10;例如: word1 word2 word3 ..."
              :maxlength="200"
            />
          </a-form-item>

          <a-form-item label="钱包密码" name="password">
            <a-input-password
              v-model:value="mnemonicForm.password"
              placeholder="请输入密码（至少8位）"
              :maxlength="32"
              autocomplete="new-password"
            >
              <template #prefix>
                <lock-outlined />
              </template>
            </a-input-password>
          </a-form-item>

          <a-form-item label="确认密码" name="confirmPassword">
            <a-input-password
              v-model:value="mnemonicForm.confirmPassword"
              placeholder="请再次输入密码"
              :maxlength="32"
              autocomplete="new-password"
            >
              <template #prefix>
                <lock-outlined />
              </template>
            </a-input-password>
          </a-form-item>
        </a-form>
      </a-tab-pane>

      <!-- 私钥导入 -->
      <a-tab-pane key="privateKey" tab="私钥导入">
        <a-form
          :model="privateKeyForm"
          :rules="privateKeyRules"
          ref="privateKeyFormRef"
          layout="vertical"
        >
          <a-form-item
            label="私钥"
            name="privateKey"
            help="请输入 64 位十六进制私钥（0x 开头可选）"
          >
            <a-input
              v-model:value="privateKeyForm.privateKey"
              placeholder="请输入私钥（如: 0x1234567890abcdef...）"
              :maxlength="66"
              autocomplete="off"
            >
              <template #prefix>
                <key-outlined />
              </template>
            </a-input>
          </a-form-item>

          <a-form-item label="钱包密码" name="password">
            <a-input-password
              v-model:value="privateKeyForm.password"
              placeholder="请输入密码（至少8位）"
              :maxlength="32"
              autocomplete="new-password"
            >
              <template #prefix>
                <lock-outlined />
              </template>
            </a-input-password>
          </a-form-item>

          <a-form-item label="确认密码" name="confirmPassword">
            <a-input-password
              v-model:value="privateKeyForm.confirmPassword"
              placeholder="请再次输入密码"
              :maxlength="32"
              autocomplete="new-password"
            >
              <template #prefix>
                <lock-outlined />
              </template>
            </a-input-password>
          </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>

    <!-- 导入成功提示 -->
    <a-alert
      v-if="importedWallet"
      type="success"
      :style="{ marginTop: '16px' }"
    >
      <template #message>
        <div class="import-success">
          <check-circle-outlined :style="{ color: '#52c41a', fontSize: '18px' }" />
          <span>钱包导入成功！</span>
        </div>
      </template>
      <template #description>
        <div class="wallet-info">
          <div class="info-item">
            <span class="info-label">地址:</span>
            <span class="info-value">
              {{ formatAddress(importedWallet.address) }}
              <copy-outlined class="copy-icon" @click="handleCopyAddress" />
            </span>
          </div>
        </div>
      </template>
    </a-alert>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  KeyOutlined,
  CopyOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import { useBlockchainStore } from '@/stores/blockchain';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:open', 'imported']);

// Computed property for modal visibility (two-way binding with prop)
const modalVisible = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);
const activeTab = ref('mnemonic');
const mnemonicFormRef = ref(null);
const privateKeyFormRef = ref(null);
const importedWallet = ref(null);

// 助记词表单
const mnemonicForm = ref({
  mnemonic: '',
  password: '',
  confirmPassword: '',
});

// 私钥表单
const privateKeyForm = ref({
  privateKey: '',
  password: '',
  confirmPassword: '',
});

// 助记词单词数量
const wordCount = computed(() => {
  const words = mnemonicForm.value.mnemonic.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length;
});

// 助记词表单验证规则
const mnemonicRules = {
  mnemonic: [
    { required: true, message: '请输入助记词', trigger: 'blur' },
    {
      validator: (rule, value) => {
        const words = value.trim().split(/\s+/).filter(w => w.length > 0);
        if (words.length !== 12) {
          return Promise.reject('请输入 12 个助记词');
        }
        // 简单验证：每个词应该是字母且长度在2-10之间
        const invalidWords = words.filter(w => !/^[a-z]{2,10}$/i.test(w));
        if (invalidWords.length > 0) {
          return Promise.reject('助记词格式不正确');
        }
        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少8位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value) => {
        if (value !== mnemonicForm.value.password) {
          return Promise.reject('两次输入的密码不一致');
        }
        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
};

// 私钥表单验证规则
const privateKeyRules = {
  privateKey: [
    { required: true, message: '请输入私钥', trigger: 'blur' },
    {
      validator: (rule, value) => {
        // 移除可选的 0x 前缀
        const cleanKey = value.startsWith('0x') ? value.slice(2) : value;

        // 验证长度（64位十六进制）
        if (cleanKey.length !== 64) {
          return Promise.reject('私钥必须是 64 位十六进制字符');
        }

        // 验证是否为有效的十六进制
        if (!/^[0-9a-f]{64}$/i.test(cleanKey)) {
          return Promise.reject('私钥格式不正确，必须是十六进制字符');
        }

        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少8位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value) => {
        if (value !== privateKeyForm.value.password) {
          return Promise.reject('两次输入的密码不一致');
        }
        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
};

/**
 * 格式化地址显示
 */
const formatAddress = (address) => {
  if (!address) return '';
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
};

/**
 * 复制地址
 */
const handleCopyAddress = async () => {
  if (!importedWallet.value?.address) {
    return;
  }

  try {
    await navigator.clipboard.writeText(importedWallet.value.address);
    message.success('地址已复制到剪贴板');
  } catch (error) {
    console.error('[ImportWalletModal] 复制地址失败:', error);
    message.error('复制失败');
  }
};

/**
 * 导入钱包
 */
const handleImport = async () => {
  loading.value = true;
  importedWallet.value = null;

  try {
    let wallet;

    if (activeTab.value === 'mnemonic') {
      // 验证助记词表单
      await mnemonicFormRef.value.validate();

      // 导入助记词
      const mnemonic = mnemonicForm.value.mnemonic.trim().toLowerCase();
      wallet = await blockchainStore.importFromMnemonic(
        mnemonic,
        mnemonicForm.value.password
      );
    } else if (activeTab.value === 'privateKey') {
      // 验证私钥表单
      await privateKeyFormRef.value.validate();

      // 导入私钥
      let privateKey = privateKeyForm.value.privateKey.trim();
      // 确保有 0x 前缀
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }

      wallet = await blockchainStore.importFromPrivateKey(
        privateKey,
        privateKeyForm.value.password
      );
    }

    importedWallet.value = wallet;
    message.success('钱包导入成功');
    emit('imported', wallet);

    // 2秒后自动关闭对话框
    setTimeout(() => {
      handleCancel();
    }, 2000);
  } catch (error) {
    console.error('[ImportWalletModal] 导入钱包失败:', error);
    message.error('导入钱包失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

/**
 * 取消
 */
const handleCancel = () => {
  emit('update:open', false);
};

/**
 * 重置表单
 */
const resetForms = () => {
  mnemonicForm.value = {
    mnemonic: '',
    password: '',
    confirmPassword: '',
  };
  privateKeyForm.value = {
    privateKey: '',
    password: '',
    confirmPassword: '',
  };
  importedWallet.value = null;
  activeTab.value = 'mnemonic';
};

// 监听 open 变化
watch(
  () => props.open,
  (newValue) => {
    if (!newValue) {
      // 对话框关闭时重置表单
      resetForms();
    }
  }
);
</script>

<style scoped>
.import-success {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.wallet-info {
  margin-top: 8px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.info-label {
  font-weight: 500;
  color: #595959;
}

.info-value {
  font-family: 'Courier New', monospace;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 8px;
}

.copy-icon {
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 14px;
}

.copy-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
}

:deep(.ant-tabs-tab) {
  padding: 8px 0;
}

:deep(.ant-form-item-label) {
  padding-bottom: 4px;
}

:deep(.ant-input-textarea) {
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

:deep(.ant-alert-with-description .ant-alert-message) {
  font-size: 14px;
  margin-bottom: 4px;
}
</style>
