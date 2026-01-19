<template>
  <a-modal
    v-model:open="open"
    title="数据库加密设置"
    :closable="!isRequired"
    :mask-closable="!isRequired"
    :keyboard="!isRequired"
    width="500px"
    @ok="handleSubmit"
    @cancel="handleCancel"
  >
    <a-form
      ref="formRef"
      :model="formState"
      :rules="rules"
      layout="vertical"
    >
      <a-alert
        v-if="isFirstTime"
        message="首次使用数据库加密"
        description="为了保护您的隐私数据，请设置一个强密码来加密数据库。密码一旦设置不可找回，请妥善保管。"
        type="info"
        show-icon
        style="margin-bottom: 16px"
      />

      <a-alert
        v-if="developmentMode && canSkipPassword"
        message="开发模式"
        description="开发模式下可以跳过密码设置，数据库将不加密存储。注意：生产环境下请务必设置密码。"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
      />

      <a-form-item
        :label="developmentMode && canSkipPassword ? '加密密码（可选）' : '加密密码'"
        name="password"
      >
        <a-input-password
          v-model:value="formState.password"
          :placeholder="developmentMode && canSkipPassword ? '请输入加密密码（可跳过）' : '请输入加密密码（至少12位）'"
          autocomplete="new-password"
        >
          <template #prefix>
            <LockOutlined />
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
            <LockOutlined />
          </template>
        </a-input-password>
      </a-form-item>

      <a-form-item
        v-if="showOldPassword"
        label="当前密码"
        name="oldPassword"
      >
        <a-input-password
          v-model:value="formState.oldPassword"
          placeholder="请输入当前密码"
          autocomplete="current-password"
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

    <template #footer>
      <a-space>
        <a-button
          v-if="!isRequired"
          @click="handleCancel"
        >
          取消
        </a-button>
        <a-button
          v-if="developmentMode && canSkipPassword"
          @click="handleSkip"
        >
          跳过密码设置
        </a-button>
        <a-button
          type="primary"
          :loading="loading"
          :disabled="!canSubmit && !(developmentMode && canSkipPassword)"
          @click="handleSubmit"
        >
          {{ submitButtonText }}
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, watch } from 'vue';
import {
  LockOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  isFirstTime: {
    type: Boolean,
    default: false
  },
  isRequired: {
    type: Boolean,
    default: false
  },
  showOldPassword: {
    type: Boolean,
    default: false
  },
  developmentMode: {
    type: Boolean,
    default: false
  },
  canSkipPassword: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel']);

const formRef = ref();
const loading = ref(false);

const formState = reactive({
  password: '',
  confirmPassword: '',
  oldPassword: ''
});

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

// 密码要求检查
const requirements = computed(() => ({
  length: formState.password.length >= 12,
  uppercase: /[A-Z]/.test(formState.password),
  lowercase: /[a-z]/.test(formState.password),
  number: /\d/.test(formState.password),
  special: /[!@#$%^&*(),.?":{}|<>]/.test(formState.password)
}));

// 密码强度计算
const passwordStrength = computed(() => {
  const password = formState.password;
  if (!password) {
    return { width: '0%', class: '', text: '' };
  }

  let score = 0;
  if (requirements.value.length) {score++;}
  if (requirements.value.uppercase) {score++;}
  if (requirements.value.lowercase) {score++;}
  if (requirements.value.number) {score++;}
  if (requirements.value.special) {score++;}

  if (score <= 2) {
    return { width: '33%', class: 'weak', text: '弱' };
  } else if (score <= 4) {
    return { width: '66%', class: 'medium', text: '中' };
  } else {
    return { width: '100%', class: 'strong', text: '强' };
  }
});

// 是否可以提交
const canSubmit = computed(() => {
  return (
    Object.values(requirements.value).every(v => v) &&
    formState.password === formState.confirmPassword &&
    (!props.showOldPassword || formState.oldPassword)
  );
});

const submitButtonText = computed(() => {
  if (props.isFirstTime) {return '设置密码';}
  if (props.showOldPassword) {return '修改密码';}
  return '确定';
});

// 表单验证规则
const rules = computed(() => ({
  password: [
    {
      required: !(props.developmentMode && props.canSkipPassword),
      message: '请输入密码'
    },
    { min: 12, message: '密码至少需要12个字符' },
    {
      validator: (_, value) => {
        if (!value && props.developmentMode && props.canSkipPassword) {
          return Promise.resolve();
        }
        if (!value) {return Promise.resolve();}
        if (!Object.values(requirements.value).every(v => v)) {
          return Promise.reject('密码不符合安全要求');
        }
        return Promise.resolve();
      }
    }
  ],
  confirmPassword: [
    {
      required: !(props.developmentMode && props.canSkipPassword),
      message: '请确认密码'
    },
    {
      validator: (_, value) => {
        if (!value && props.developmentMode && props.canSkipPassword) {
          return Promise.resolve();
        }
        if (value !== formState.password) {
          return Promise.reject('两次输入的密码不一致');
        }
        return Promise.resolve();
      }
    }
  ],
  oldPassword: [
    {
      required: props.showOldPassword,
      message: '请输入当前密码'
    }
  ]
}));

// 提交表单
const handleSubmit = async () => {
  try {
    await formRef.value.validate();
    loading.value = true;

    const data = {
      password: formState.password,
      oldPassword: formState.oldPassword || undefined
    };

    emit('submit', data);
  } catch (error) {
    logger.error('表单验证失败:', error);
  } finally {
    loading.value = false;
  }
};

// 取消
const handleCancel = () => {
  if (props.isRequired && !props.canSkipPassword) {
    message.warning('必须设置数据库密码才能继续使用');
    return;
  }
  emit('cancel');
  visible.value = false;
};

// 跳过密码设置（仅开发模式）
const handleSkip = () => {
  if (!props.developmentMode || !props.canSkipPassword) {
    message.warning('仅开发模式下可以跳过密码设置');
    return;
  }

  loading.value = true;

  try {
    emit('submit', { skipPassword: true });
    message.success('已跳过密码设置（开发模式）');
  } finally {
    loading.value = false;
  }
};

// 重置表单
const resetForm = () => {
  formState.password = '';
  formState.confirmPassword = '';
  formState.oldPassword = '';
  formRef.value?.resetFields();
};

// 监听对话框关闭
watch(visible, (val) => {
  if (!val) {
    resetForm();
  }
});

defineExpose({
  resetForm
});
</script>

<style scoped lang="scss">
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
