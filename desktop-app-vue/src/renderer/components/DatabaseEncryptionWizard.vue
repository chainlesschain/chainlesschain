<template>
  <a-modal
    v-model:open="isOpen"
    title="数据库加密设置向导"
    :closable="(developmentMode && canSkipPassword) || currentStep === 3"
    :mask-closable="(developmentMode && canSkipPassword) || currentStep === 3"
    :keyboard="(developmentMode && canSkipPassword) || currentStep === 3"
    width="600px"
    :footer="null"
    @cancel="handleClose"
  >
    <a-steps
      :current="currentStep"
      style="margin-bottom: 24px"
    >
      <a-step title="欢迎" />
      <a-step title="选择加密方式" />
      <a-step title="设置密码" />
      <a-step title="完成" />
    </a-steps>

    <!-- 步骤 0: 欢迎 -->
    <div
      v-if="currentStep === 0"
      class="step-content"
    >
      <a-alert
        v-if="developmentMode && canSkipPassword"
        message="开发模式"
        description="开发模式下可以跳过数据库加密设置。您可以点击右上角 X 关闭此向导，或者点击下方按钮继续。"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
      />

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
            <a-button @click="skipEncryption">
              暂不启用
            </a-button>
            <a-button
              type="primary"
              @click="nextStep"
            >
              开始设置
              <RightOutlined />
            </a-button>
          </a-space>
        </template>
      </a-result>
    </div>

    <!-- 步骤 1: 选择加密方式 -->
    <div
      v-if="currentStep === 1"
      class="step-content"
    >
      <h3>选择加密方式</h3>
      <a-radio-group
        v-model:value="encryptionMethod"
        style="width: 100%"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
          :size="16"
        >
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
          <a-button @click="prevStep">
            上一步
          </a-button>
          <a-button
            type="primary"
            @click="nextStep"
          >
            下一步
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 步骤 2: 设置密码 -->
    <div
      v-if="currentStep === 2"
      class="step-content"
    >
      <h3>
        {{ encryptionMethod === "ukey" ? "设置 U-Key PIN 码" : "设置加密密码" }}
      </h3>

      <a-form
        ref="formRef"
        :model="formState"
        :rules="passwordRules"
        layout="vertical"
      >
        <a-alert
          message="首次使用数据库加密"
          description="为了保护您的隐私数据，请设置一个强密码来加密数据库。密码一旦设置不可找回，请妥善保管。"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-alert
          v-if="developmentMode && canSkipPassword"
          message="开发模式"
          description="开发模式下可以跳过密码设置，数据库将不加密存储。"
          type="warning"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-form-item
          label="加密密码"
          name="password"
        >
          <a-input-password
            v-model:value="formState.password"
            placeholder="请输入加密密码（至少12位）"
            autocomplete="new-password"
          >
            <template #prefix>
              <KeyOutlined />
            </template>
          </a-input-password>
          <div class="password-strength">
            <div class="strength-bar">
              <div
                class="strength-fill"
                :class="passwordStrength.class"
                :style="{ width: passwordStrength.width }"
              />
            </div>
            <span
              class="strength-text"
              :class="passwordStrength.class"
            >
              {{ passwordStrength.text }}
            </span>
          </div>
        </a-form-item>

        <a-form-item
          label="确认密码"
          name="confirmPassword"
        >
          <a-input-password
            v-model:value="formState.confirmPassword"
            placeholder="请再次输入密码"
            autocomplete="new-password"
          >
            <template #prefix>
              <KeyOutlined />
            </template>
          </a-input-password>
        </a-form-item>

        <a-divider />

        <a-space
          direction="vertical"
          style="width: 100%"
        >
          <a-typography-title :level="5">
            密码要求
          </a-typography-title>
          <a-space
            direction="vertical"
            :size="4"
          >
            <div
              class="requirement-item"
              :class="{ valid: requirements.length }"
            >
              <CheckCircleOutlined v-if="requirements.length" />
              <CloseCircleOutlined v-else />
              <span>至少 12 个字符</span>
            </div>
            <div
              class="requirement-item"
              :class="{ valid: requirements.uppercase }"
            >
              <CheckCircleOutlined v-if="requirements.uppercase" />
              <CloseCircleOutlined v-else />
              <span>包含大写字母</span>
            </div>
            <div
              class="requirement-item"
              :class="{ valid: requirements.lowercase }"
            >
              <CheckCircleOutlined v-if="requirements.lowercase" />
              <CloseCircleOutlined v-else />
              <span>包含小写字母</span>
            </div>
            <div
              class="requirement-item"
              :class="{ valid: requirements.number }"
            >
              <CheckCircleOutlined v-if="requirements.number" />
              <CloseCircleOutlined v-else />
              <span>包含数字</span>
            </div>
            <div
              class="requirement-item"
              :class="{ valid: requirements.special }"
            >
              <CheckCircleOutlined v-if="requirements.special" />
              <CloseCircleOutlined v-else />
              <span>包含特殊字符</span>
            </div>
          </a-space>
        </a-space>
      </a-form>

      <div class="step-footer">
        <a-space>
          <a-button @click="prevStep">
            上一步
          </a-button>
          <a-button
            v-if="developmentMode && canSkipPassword"
            @click="handleSkipPassword"
          >
            跳过密码设置
          </a-button>
          <a-button
            type="primary"
            :loading="loading"
            :disabled="!canSubmit && !(developmentMode && canSkipPassword)"
            @click="handlePasswordSubmit"
          >
            下一步
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 步骤 3: 完成 -->
    <div
      v-if="currentStep === 3"
      class="step-content"
    >
      <a-result
        v-if="setupSuccess"
        status="success"
        title="加密设置成功！"
        sub-title="您的数据库已启用加密保护，所有数据将安全存储。"
      >
        <template #extra>
          <a-button
            type="primary"
            @click="finish"
          >
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
            <a-button @click="retrySetup">
              重试
            </a-button>
            <a-button
              type="primary"
              @click="skipEncryption"
            >
              跳过加密
            </a-button>
          </a-space>
        </template>
      </a-result>
    </div>
  </a-modal>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, watch } from "vue";
import {
  SafetyOutlined,
  KeyOutlined,
  UsbOutlined,
  RightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:open", "complete", "skip"]);

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit("update:open", val),
});
const currentStep = ref(0);
const encryptionMethod = ref("password");
const setupSuccess = ref(false);
const errorMessage = ref("");
const loading = ref(false);
const formRef = ref();
const developmentMode = ref(false);
const canSkipPassword = ref(false);

const formState = reactive({
  password: "",
  confirmPassword: "",
});

// 密码要求检查
const requirements = computed(() => ({
  length: formState.password.length >= 12,
  uppercase: /[A-Z]/.test(formState.password),
  lowercase: /[a-z]/.test(formState.password),
  number: /\d/.test(formState.password),
  special: /[!@#$%^&*(),.?":{}|<>]/.test(formState.password),
}));

// 密码强度计算
const passwordStrength = computed(() => {
  const password = formState.password;
  if (!password) {
    return { width: "0%", class: "", text: "" };
  }

  let score = 0;
  if (requirements.value.length) {
    score++;
  }
  if (requirements.value.uppercase) {
    score++;
  }
  if (requirements.value.lowercase) {
    score++;
  }
  if (requirements.value.number) {
    score++;
  }
  if (requirements.value.special) {
    score++;
  }

  if (score <= 2) {
    return { width: "33%", class: "weak", text: "弱" };
  } else if (score <= 4) {
    return { width: "66%", class: "medium", text: "中" };
  } else {
    return { width: "100%", class: "strong", text: "强" };
  }
});

// 是否可以提交
const canSubmit = computed(() => {
  return (
    Object.values(requirements.value).every((v) => v) &&
    formState.password === formState.confirmPassword &&
    formState.password.length > 0
  );
});

// 表单验证规则
const passwordRules = computed(() => ({
  password: [
    {
      required: !(developmentMode.value && canSkipPassword.value),
      message: "请输入密码",
    },
    { min: 12, message: "密码至少需要12个字符" },
    {
      validator: (_, value) => {
        if (!value && developmentMode.value && canSkipPassword.value) {
          return Promise.resolve();
        }
        if (!value) {
          return Promise.resolve();
        }
        if (!Object.values(requirements.value).every((v) => v)) {
          return Promise.reject("密码不符合安全要求");
        }
        return Promise.resolve();
      },
    },
  ],
  confirmPassword: [
    {
      required: !(developmentMode.value && canSkipPassword.value),
      message: "请确认密码",
    },
    {
      validator: (_, value) => {
        if (!value && developmentMode.value && canSkipPassword.value) {
          return Promise.resolve();
        }
        if (value !== formState.password) {
          return Promise.reject("两次输入的密码不一致");
        }
        return Promise.resolve();
      },
    },
  ],
}));

// 加载开发模式状态
const loadDevelopmentMode = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "database:get-encryption-status",
    );
    if (result) {
      developmentMode.value = result.developmentMode || false;
      canSkipPassword.value = result.canSkipPassword || false;
    }
  } catch (error) {
    logger.error("获取开发模式状态失败:", error);
  }
};

watch(
  () => props.open,
  async (val) => {
    if (val) {
      // 重置状态
      currentStep.value = 0;
      setupSuccess.value = false;
      errorMessage.value = "";
      formState.password = "";
      formState.confirmPassword = "";

      // 加载开发模式状态
      await loadDevelopmentMode();
    }
  },
);

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

const handlePasswordSubmit = async () => {
  try {
    // 开发模式下允许跳过验证
    if (!(developmentMode.value && canSkipPassword.value)) {
      await formRef.value.validate();
    }

    loading.value = true;

    // 调用后端设置加密
    const result = await window.electron.ipcRenderer.invoke(
      "database:setup-encryption",
      {
        method: encryptionMethod.value,
        password: formState.password || undefined,
        skipPassword:
          (developmentMode.value &&
            canSkipPassword.value &&
            !formState.password) ||
          false,
      },
    );

    if (result.success) {
      setupSuccess.value = true;
      currentStep.value = 3;
      message.success("数据库加密设置成功");
    } else {
      throw new Error(result.error || "设置失败");
    }
  } catch (error) {
    logger.error("密码提交失败:", error);
    if (error.message) {
      setupSuccess.value = false;
      errorMessage.value = error.message;
      currentStep.value = 3;
      message.error("加密设置失败: " + error.message);
    }
  } finally {
    loading.value = false;
  }
};

const handleSkipPassword = async () => {
  if (!developmentMode.value || !canSkipPassword.value) {
    message.warning("仅开发模式下可以跳过密码设置");
    return;
  }

  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "database:setup-encryption",
      {
        method: encryptionMethod.value,
        skipPassword: true,
      },
    );

    if (result.success) {
      setupSuccess.value = true;
      currentStep.value = 3;
      message.success("已跳过密码设置（开发模式）");
    } else {
      throw new Error(result.error || "操作失败");
    }
  } catch (error) {
    message.error("操作失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

const retrySetup = () => {
  currentStep.value = 1;
  setupSuccess.value = false;
  errorMessage.value = "";
};

const skipEncryption = () => {
  message.info("您可以稍后在设置中启用加密");
  emit("skip");
  isOpen.value = false;
};

const handleClose = () => {
  if (developmentMode.value && canSkipPassword.value) {
    skipEncryption();
  } else if (currentStep.value === 3) {
    isOpen.value = false;
  }
};

const finish = () => {
  emit("complete");
  isOpen.value = false;
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

.password-strength {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;

  .strength-bar {
    flex: 1;
    height: 4px;
    background-color: #f0f0f0;
    border-radius: 2px;
    overflow: hidden;

    .strength-fill {
      height: 100%;
      transition: all 0.3s;

      &.weak {
        background-color: #ff4d4f;
      }

      &.medium {
        background-color: #faad14;
      }

      &.strong {
        background-color: #52c41a;
      }
    }
  }

  .strength-text {
    font-size: 12px;
    min-width: 24px;
    text-align: center;

    &.weak {
      color: #ff4d4f;
    }

    &.medium {
      color: #faad14;
    }

    &.strong {
      color: #52c41a;
    }
  }
}

.requirement-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 14px;

  &.valid {
    color: #52c41a;
  }

  :deep(.anticon) {
    font-size: 16px;
  }
}
</style>
