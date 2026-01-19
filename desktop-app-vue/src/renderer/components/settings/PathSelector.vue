<template>
  <div class="path-selector">
    <a-typography-title :level="4">
      {{ label }}
    </a-typography-title>
    <a-typography-paragraph type="secondary">
      {{ description }}
    </a-typography-paragraph>

    <a-form layout="vertical">
      <a-form-item :label="label">
        <a-input-group compact>
          <a-input
            v-model:value="localPath"
            :placeholder="defaultPath || '选择文件夹路径'"
            style="width: calc(100% - 100px)"
            @change="handleInputChange"
          />
          <a-button
            type="primary"
            style="width: 100px"
            @click="browsePath"
          >
            <FolderOpenOutlined />
            浏览...
          </a-button>
        </a-input-group>

        <!-- 默认路径提示 -->
        <template #extra>
          <div
            v-if="defaultPath"
            class="path-hint"
          >
            <InfoCircleOutlined />
            默认路径: {{ defaultPath }}
          </div>
          <div
            v-if="useDefault"
            class="path-hint success"
          >
            <CheckCircleOutlined />
            将使用默认路径
          </div>
        </template>
      </a-form-item>

      <!-- 路径验证信息 -->
      <div
        v-if="validation.checking"
        class="validation-info"
      >
        <a-spin size="small" />
        <span class="validation-text">正在验证路径...</span>
      </div>
      <div
        v-else-if="validation.error"
        class="validation-info error"
      >
        <CloseCircleOutlined />
        <span class="validation-text">{{ validation.error }}</span>
      </div>
      <div
        v-else-if="validation.success"
        class="validation-info success"
      >
        <CheckCircleOutlined />
        <span class="validation-text">{{ validation.success }}</span>
      </div>
    </a-form>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch } from 'vue';
import {
  FolderOpenOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  defaultPath: {
    type: String,
    default: '',
  },
  validatePath: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update:modelValue']);

const localPath = ref(props.modelValue || '');
const validation = ref({
  checking: false,
  success: '',
  error: '',
});

const useDefault = computed(() => {
  return !localPath.value && props.defaultPath;
});

watch(() => props.modelValue, (newValue) => {
  localPath.value = newValue || '';
});

const browsePath = async () => {
  try {
    const result = await window.electronAPI.dialog.selectFolder({
      title: `选择${props.label}`,
      defaultPath: localPath.value || props.defaultPath || undefined,
    });

    if (result && !result.canceled && result.filePaths.length > 0) {
      localPath.value = result.filePaths[0];
      handleInputChange();
    }
  } catch (error) {
    logger.error('选择路径失败:', error);
    message.error('打开文件夹选择对话框失败');
  }
};

const handleInputChange = async () => {
  const path = localPath.value.trim();
  emit('update:modelValue', path);

  if (!path) {
    validation.value = {
      checking: false,
      success: '',
      error: '',
    };
    return;
  }

  if (props.validatePath) {
    await validatePathAccess(path);
  }
};

const validatePathAccess = async (path) => {
  validation.value.checking = true;
  validation.value.success = '';
  validation.value.error = '';

  try {
    // 调用主进程验证路径
    const result = await window.electronAPI.fs.checkPathAccess(path);

    if (result.exists && result.writable) {
      validation.value.success = '路径有效且可写';
    } else if (result.exists && !result.writable) {
      validation.value.error = '路径无写入权限';
    } else {
      validation.value.error = '路径不存在，将在首次使用时自动创建';
      // 不存在的路径不算错误，只是提示
      setTimeout(() => {
        validation.value.error = '';
        validation.value.success = '路径将在首次使用时自动创建';
      }, 2000);
    }
  } catch (error) {
    logger.error('路径验证失败:', error);
    validation.value.error = '路径验证失败: ' + error.message;
  } finally {
    validation.value.checking = false;
  }
};
</script>

<style scoped>
.path-selector {
  padding: 20px 0;
}

.path-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: #8c8c8c;
}

.path-hint.success {
  color: #52c41a;
}

.validation-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  animation: fadeIn 0.3s ease-in;
}

.validation-info.success {
  background-color: #f6ffed;
  color: #52c41a;
  border: 1px solid #b7eb8f;
}

.validation-info.error {
  background-color: #fff1f0;
  color: #ff4d4f;
  border: 1px solid #ffccc7;
}

.validation-text {
  flex: 1;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
