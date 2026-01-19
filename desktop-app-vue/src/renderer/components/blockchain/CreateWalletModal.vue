<template>
  <a-modal
    v-model:open="modalVisible"
    title="创建新钱包"
    :width="600"
    :confirm-loading="loading"
    :mask-closable="false"
    @ok="handleCreate"
    @cancel="handleCancel"
  >
    <a-steps
      :current="currentStep"
      size="small"
      :style="{ marginBottom: '24px' }"
    >
      <a-step title="设置密码" />
      <a-step title="备份助记词" />
      <a-step title="确认完成" />
    </a-steps>

    <!-- 步骤1: 设置密码 -->
    <div
      v-if="currentStep === 0"
      class="step-content"
    >
      <a-alert
        message="重要提示"
        description="密码用于加密您的私钥。请务必牢记密码，密码丢失将无法找回！"
        type="warning"
        show-icon
        :style="{ marginBottom: '16px' }"
      />

      <a-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        layout="vertical"
      >
        <a-form-item
          label="钱包密码"
          name="password"
        >
          <a-input-password
            v-model:value="formData.password"
            placeholder="请输入密码（至少8位）"
            :maxlength="32"
            autocomplete="new-password"
          >
            <template #prefix>
              <lock-outlined />
            </template>
          </a-input-password>
          <template #extra>
            <div class="password-strength">
              密码强度:
              <a-progress
                :percent="passwordStrength"
                :show-info="false"
                :stroke-color="passwordColor"
                :style="{ width: '120px', marginLeft: '8px' }"
              />
              <span :style="{ color: passwordColor, marginLeft: '8px' }">
                {{ passwordStrengthText }}
              </span>
            </div>
          </template>
        </a-form-item>

        <a-form-item
          label="确认密码"
          name="confirmPassword"
        >
          <a-input-password
            v-model:value="formData.confirmPassword"
            placeholder="请再次输入密码"
            :maxlength="32"
            autocomplete="new-password"
          >
            <template #prefix>
              <lock-outlined />
            </template>
          </a-input-password>
        </a-form-item>

        <a-form-item name="useUKey">
          <a-checkbox v-model:checked="formData.useUKey">
            使用 U-Key 硬件加密（推荐）
          </a-checkbox>
          <div class="form-item-hint">
            启用后，将使用 U-Key 硬件设备进行额外的签名保护
          </div>
        </a-form-item>
      </a-form>
    </div>

    <!-- 步骤2: 备份助记词 -->
    <div
      v-if="currentStep === 1"
      class="step-content"
    >
      <a-alert
        message="请备份助记词"
        description="这是恢复钱包的唯一方式。请将助记词抄写在纸上，并妥善保管。切勿截图或通过网络传输！"
        type="error"
        show-icon
        :style="{ marginBottom: '16px' }"
      />

      <div class="mnemonic-container">
        <div class="mnemonic-words">
          <div
            v-for="(word, index) in mnemonicWords"
            :key="index"
            class="mnemonic-word"
          >
            <span class="word-index">{{ index + 1 }}</span>
            <span class="word-text">{{ word }}</span>
          </div>
        </div>

        <div class="mnemonic-actions">
          <a-button @click="handleCopyMnemonic">
            <template #icon>
              <copy-outlined />
            </template>
            复制助记词
          </a-button>
          <a-button @click="handleRegenerateMnemonic">
            <template #icon>
              <reload-outlined />
            </template>
            重新生成
          </a-button>
        </div>
      </div>

      <a-form
        :model="formData"
        layout="vertical"
        :style="{ marginTop: '16px' }"
      >
        <a-form-item>
          <a-checkbox v-model:checked="formData.confirmedBackup">
            我已将助记词抄写在纸上，并确认备份无误
          </a-checkbox>
        </a-form-item>
      </a-form>
    </div>

    <!-- 步骤3: 确认完成 -->
    <div
      v-if="currentStep === 2"
      class="step-content"
    >
      <a-result
        status="success"
        title="钱包创建成功！"
        sub-title="您的钱包已经创建并加密保存"
      >
        <template #extra>
          <div class="wallet-info">
            <a-descriptions
              :column="1"
              bordered
              size="small"
            >
              <a-descriptions-item label="钱包地址">
                <div class="wallet-address">
                  {{ walletAddress || '生成中...' }}
                  <copy-outlined
                    v-if="walletAddress"
                    class="copy-icon"
                    @click="handleCopyAddress"
                  />
                </div>
              </a-descriptions-item>
              <a-descriptions-item label="U-Key 保护">
                {{ formData.useUKey ? '已启用' : '未启用' }}
              </a-descriptions-item>
              <a-descriptions-item label="创建时间">
                {{ new Date().toLocaleString('zh-CN') }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </template>
      </a-result>
    </div>

    <template #footer>
      <a-space>
        <a-button
          v-if="currentStep > 0"
          @click="handlePrevStep"
        >
          上一步
        </a-button>
        <a-button @click="handleCancel">
          {{ currentStep === 2 ? '关闭' : '取消' }}
        </a-button>
        <a-button
          v-if="currentStep < 2"
          type="primary"
          :loading="loading"
          :disabled="!canProceed"
          @click="handleNextStep"
        >
          {{ currentStep === 1 ? '创建钱包' : '下一步' }}
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  CopyOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import { useBlockchainStore } from '@/stores/blockchain';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});


const emit = defineEmits(['update:open', 'created']);

// Computed property for modal visibility (two-way binding with prop)
const modalVisible = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);
const currentStep = ref(0);
const formRef = ref(null);
const walletAddress = ref('');
const mnemonicWords = ref([]);

// 表单数据
const formData = ref({
  password: '',
  confirmPassword: '',
  useUKey: false,
  confirmedBackup: false,
});

// 表单验证规则
const formRules = {
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少8位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value) => {
        if (value !== formData.value.password) {
          return Promise.reject('两次输入的密码不一致');
        }
        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
};

// 密码强度计算
const passwordStrength = computed(() => {
  const password = formData.value.password;
  if (!password) {return 0;}

  let strength = 0;
  // 长度
  if (password.length >= 8) {strength += 25;}
  if (password.length >= 12) {strength += 25;}
  // 包含数字
  if (/\d/.test(password)) {strength += 15;}
  // 包含小写字母
  if (/[a-z]/.test(password)) {strength += 15;}
  // 包含大写字母
  if (/[A-Z]/.test(password)) {strength += 10;}
  // 包含特殊字符
  if (/[^a-zA-Z0-9]/.test(password)) {strength += 10;}

  return Math.min(strength, 100);
});

const passwordStrengthText = computed(() => {
  const strength = passwordStrength.value;
  if (strength < 30) {return '弱';}
  if (strength < 60) {return '中等';}
  if (strength < 80) {return '强';}
  return '非常强';
});

const passwordColor = computed(() => {
  const strength = passwordStrength.value;
  if (strength < 30) {return '#ff4d4f';}
  if (strength < 60) {return '#faad14';}
  if (strength < 80) {return '#52c41a';}
  return '#1890ff';
});

// 是否可以继续
const canProceed = computed(() => {
  if (currentStep.value === 0) {
    return formData.value.password.length >= 8 &&
           formData.value.password === formData.value.confirmPassword;
  } else if (currentStep.value === 1) {
    return formData.value.confirmedBackup && mnemonicWords.value.length === 12;
  }
  return true;
});

/**
 * 生成助记词
 */
const generateMnemonic = () => {
  // 模拟生成12个助记词
  // 实际应该调用后端 API 生成真实的 BIP39 助记词
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent',
    'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
  ];

  mnemonicWords.value = words.sort(() => Math.random() - 0.5).slice(0, 12);
};

/**
 * 复制助记词
 */
const handleCopyMnemonic = async () => {
  const mnemonic = mnemonicWords.value.join(' ');
  try {
    await navigator.clipboard.writeText(mnemonic);
    message.success('助记词已复制到剪贴板');
  } catch (error) {
    console.error('[CreateWalletModal] 复制失败:', error);
    message.error('复制失败');
  }
};

/**
 * 重新生成助记词
 */
const handleRegenerateMnemonic = () => {
  generateMnemonic();
  formData.value.confirmedBackup = false;
  message.info('已重新生成助记词');
};

/**
 * 复制地址
 */
const handleCopyAddress = async () => {
  try {
    await navigator.clipboard.writeText(walletAddress.value);
    message.success('地址已复制到剪贴板');
  } catch (error) {
    console.error('[CreateWalletModal] 复制地址失败:', error);
    message.error('复制失败');
  }
};

/**
 * 下一步
 */
const handleNextStep = async () => {
  if (currentStep.value === 0) {
    // 验证表单
    try {
      await formRef.value.validate();
    } catch (error) {
      return;
    }

    // 生成助记词
    generateMnemonic();
    currentStep.value = 1;
  } else if (currentStep.value === 1) {
    // 创建钱包
    await handleCreate();
  }
};

/**
 * 上一步
 */
const handlePrevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

/**
 * 创建钱包
 */
const handleCreate = async () => {
  if (currentStep.value === 1) {
    if (!formData.value.confirmedBackup) {
      message.warning('请确认已备份助记词');
      return;
    }

    loading.value = true;
    try {
      const wallet = await blockchainStore.createWallet(formData.value.password);
      walletAddress.value = wallet.address;
      currentStep.value = 2;
      message.success('钱包创建成功');
      emit('created', wallet);
    } catch (error) {
      console.error('[CreateWalletModal] 创建钱包失败:', error);
      message.error('创建钱包失败: ' + error.message);
    } finally {
      loading.value = false;
    }
  } else if (currentStep.value === 2) {
    // 完成，关闭对话框
    handleCancel();
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
const resetForm = () => {
  currentStep.value = 0;
  formData.value = {
    password: '',
    confirmPassword: '',
    useUKey: false,
    confirmedBackup: false,
  };
  mnemonicWords.value = [];
  walletAddress.value = '';
};

// 监听 open 变化
watch(
  () => props.open,
  (newValue) => {
    if (!newValue) {
      // 对话框关闭时重置表单
      resetForm();
    }
  }
);
</script>

<style scoped>
.step-content {
  padding: 8px 0;
}

.password-strength {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: #8c8c8c;
}

.form-item-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}

.mnemonic-container {
  background-color: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
}

.mnemonic-words {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: white;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #d9d9d9;
}

.word-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background-color: #1890ff;
  color: white;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.word-text {
  font-family: 'Courier New', monospace;
  font-size: 14px;
  font-weight: 500;
  color: #262626;
}

.mnemonic-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.wallet-info {
  margin-top: 16px;
}

.wallet-address {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.copy-icon {
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
}

.copy-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
}

:deep(.ant-steps-item-title) {
  font-size: 13px;
}

:deep(.ant-result-title) {
  font-size: 18px;
}

:deep(.ant-result-subtitle) {
  font-size: 14px;
}
</style>
