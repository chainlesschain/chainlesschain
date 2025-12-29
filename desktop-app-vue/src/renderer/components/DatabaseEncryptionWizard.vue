<template>
  <a-modal
    v-model:open="visible"
    title="数据库加密设置向导"
    :closable="false"
    :maskClosable="false"
    :keyboard="false"
    width="600px"
    :footer="null"
  >
    <a-steps :current="currentStep" style="margin-bottom: 24px">
      <a-step title="欢迎" />
      <a-step title="选择加密方式" />
      <a-step title="设置密码" />
      <a-step title="完成" />
    </a-steps>

    <!-- 步骤 0: 欢迎 -->
    <div v-if="currentStep === 0" class="step-content">
      <a-result
        status="info"
        title="欢迎使用 ChainlessChain"
      >
        <template #icon>
          <SafetyOutlined style="color: #1890ff" />
        </template>
        <template #subTitle>
          <div style="text-align: left; max-width: 500px; margin: 0 auto">
            <p>为了保护您的隐私数据，我们强烈建议启用数据库加密功能。</p>
            <a-divider />
            <h4>🔐 加密功能特性：</h4>
            <ul>
              <li>AES-256 军用级加密</li>
              <li>支持 U-Key 硬件加密（可选）</li>
              <li>性能提升 25 倍（相比未加密版本）</li>
              <li>数据自动迁移，无需手动操作</li>
            </ul>
          </div>
        </template>
        <template #extra>
          <a-space>
            <a-button @click="skipEncryption">暂不启用</a-button>
            <a-button type="primary" @click="nextStep">
              开始设置
              <RightOutlined />
            </a-button>
          </a-space>
        </template>
      </a-result>
    </div>

    <!-- 步骤 1: 选择加密方式 -->
    <div v-if="currentStep === 1" class="step-content">
      <h3>选择加密方式</h3>
      <a-radio-group v-model:value="encryptionMethod" style="width: 100%">
        <a-space direction="vertical" style="width: 100%" :size="16">
          <a-card
            hoverable
            :class="{ selected: encryptionMethod === 'password' }"
            @click="encryptionMethod = 'password'"
          >
            <template #title>
              <a-radio value="password">
                <KeyOutlined /> 密码加密（推荐）
              </a-radio>
            </template>
            <p>使用强密码派生加密密钥，适合大多数用户。</p>
            <ul>
              <li>✅ 跨平台支持</li>
              <li>✅ 无需额外硬件</li>
              <li>✅ 简单易用</li>
            </ul>
          </a-card>

          <a-card
            hoverable
            :class="{ selected: encryptionMethod === 'ukey' }"
            @click="encryptionMethod = 'ukey'"
          >
            <template #title>
              <a-radio value="ukey">
                <UsbOutlined /> U-Key 硬件加密
              </a-radio>
            </template>
            <p>使用 U-Key 硬件派生密钥，最高安全级别。</p>
            <ul>
              <li>✅ 最高安全性</li>
              <li>✅ 密钥存储在硬件中</li>
              <li>⚠️ 需要 U-Key 设备</li>
            </ul>
          </a-card>
        </a-space>
      </a-radio-group>

      <div class="step-footer">
        <a-space>
          <a-button @click="prevStep">上一步</a-button>
          <a-button type="primary" @click="nextStep">下一步</a-button>
        </a-space>
      </div>
    </div>

    <!-- 步骤 2: 设置密码 -->
    <div v-if="currentStep === 2" class="step-content">
      <h3>{{ encryptionMethod === 'ukey' ? '设置 U-Key PIN 码' : '设置加密密码' }}</h3>

      <DatabasePasswordDialog
        v-model="showPasswordDialog"
        :is-first-time="true"
        :is-required="true"
        @submit="handlePasswordSubmit"
      />

      <div class="step-footer">
        <a-space>
          <a-button @click="prevStep">上一步</a-button>
        </a-space>
      </div>
    </div>

    <!-- 步骤 3: 完成 -->
    <div v-if="currentStep === 3" class="step-content">
      <a-result
        v-if="setupSuccess"
        status="success"
        title="加密设置成功！"
        sub-title="您的数据库已启用加密保护，所有数据将安全存储。"
      >
        <template #extra>
          <a-button type="primary" @click="finish">
            开始使用
          </a-button>
        </template>
      </a-result>

      <a-result
        v-else
        status="error"
        title="加密设置失败"
        :sub-title="errorMessage"
      >
        <template #extra>
          <a-space>
            <a-button @click="retrySetup">重试</a-button>
            <a-button type="primary" @click="skipEncryption">跳过加密</a-button>
          </a-space>
        </template>
      </a-result>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import {
  SafetyOutlined,
  KeyOutlined,
  UsbOutlined,
  RightOutlined
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import DatabasePasswordDialog from './DatabasePasswordDialog.vue';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'complete', 'skip']);

const visible = ref(props.modelValue);
const currentStep = ref(0);
const encryptionMethod = ref('password');
const showPasswordDialog = ref(false);
const setupSuccess = ref(false);
const errorMessage = ref('');

watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (val) {
    // 重置状态
    currentStep.value = 0;
    setupSuccess.value = false;
    errorMessage.value = '';
  }
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

watch(currentStep, (val) => {
  if (val === 2) {
    showPasswordDialog.value = true;
  }
});

const nextStep = () => {
  if (currentStep.value < 3) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

const handlePasswordSubmit = async (data) => {
  try {
    // 调用后端设置加密
    const result = await window.electron.ipcRenderer.invoke('database:setup-encryption', {
      method: encryptionMethod.value,
      password: data.password
    });

    if (result.success) {
      setupSuccess.value = true;
      showPasswordDialog.value = false;
      currentStep.value = 3;
      message.success('数据库加密设置成功');
    } else {
      throw new Error(result.error || '设置失败');
    }
  } catch (error) {
    setupSuccess.value = false;
    errorMessage.value = error.message;
    currentStep.value = 3;
    message.error('加密设置失败: ' + error.message);
  }
};

const retrySetup = () => {
  currentStep.value = 1;
  setupSuccess.value = false;
  errorMessage.value = '';
};

const skipEncryption = () => {
  message.info('您可以稍后在设置中启用加密');
  emit('skip');
  visible.value = false;
};

const finish = () => {
  emit('complete');
  visible.value = false;
};
</script>

<style scoped lang="scss">
.step-content {
  min-height: 300px;

  h3 {
    margin-bottom: 16px;
  }

  ul {
    margin: 8px 0;
    padding-left: 20px;

    li {
      margin: 4px 0;
    }
  }
}

.step-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  text-align: right;
}

.selected {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}
</style>
