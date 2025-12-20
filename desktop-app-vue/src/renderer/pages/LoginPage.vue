<template>
  <div class="login-container">
    <a-card class="login-card">
      <a-space direction="vertical" :size="24" style="width: 100%">
        <!-- Logo和标题 -->
        <div class="login-header">
          <LockOutlined :style="{ fontSize: '48px', color: '#1890ff' }" />
          <h2 class="login-title">ChainlessChain</h2>
          <p class="login-subtitle">个人AI知识库</p>
        </div>

        <!-- U盾状态 -->
        <a-alert
          :type="ukeyStatus.detected ? 'success' : 'warning'"
          :show-icon="false"
        >
          <template #message>
            <a-space>
              <UsbOutlined />
              <span>{{ ukeyStatus.detected ? 'U盾已连接' : '未检测到U盾' }}</span>
              <CheckCircleOutlined
                v-if="ukeyStatus.detected"
                :style="{ color: '#52c41a' }"
              />
              <CloseCircleOutlined
                v-else
                :style="{ color: '#ff4d4f' }"
              />
            </a-space>
          </template>
        </a-alert>

        <!-- PIN输入 -->
        <div>
          <div style="margin-bottom: 8px">
            <strong>请输入PIN码:</strong>
          </div>
          <a-input-password
            v-model:value="pin"
            size="large"
            placeholder="输入6位PIN码"
            :maxlength="6"
            :disabled="!ukeyStatus.detected || loading"
            @keypress.enter="handleLogin"
          >
            <template #prefix>
              <LockOutlined />
            </template>
          </a-input-password>
        </div>

        <!-- 登录按钮 -->
        <a-button
          type="primary"
          size="large"
          block
          :loading="loading"
          :disabled="!ukeyStatus.detected"
          @click="handleLogin"
        >
          {{ loading ? '验证中...' : '登录' }}
        </a-button>

        <!-- 提示信息 -->
        <div class="login-hint">
          <a-typography-text type="secondary" :style="{ fontSize: '12px' }">
            开发模式: 默认PIN为 <a-typography-text code>123456</a-typography-text>
          </a-typography-text>
        </div>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  UsbOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { ukeyAPI, systemAPI } from '../utils/ipc';

const router = useRouter();
const store = useAppStore();

const pin = ref('');
const loading = ref(false);
const ukeyStatus = ref({ detected: true, unlocked: false });

let checkInterval = null;

// 定期检测U盾状态
const checkUKey = async () => {
  const status = await ukeyAPI.detect();
  ukeyStatus.value = status;
  store.setUKeyStatus(status);
};

onMounted(() => {
  checkUKey();
  checkInterval = setInterval(checkUKey, 3000); // 每3秒检查一次
});

onUnmounted(() => {
  if (checkInterval) {
    clearInterval(checkInterval);
  }
});

// 处理登录
const handleLogin = async () => {
  if (!pin.value) {
    message.warning('请输入PIN码');
    return;
  }

  if (!ukeyStatus.value.detected) {
    message.error('未检测到U盾,请插入U盾后重试');
    return;
  }

  loading.value = true;

  try {
    const success = await ukeyAPI.verifyPIN(pin.value);

    if (success) {
      message.success('登录成功!');

      // 更新U盾状态
      const newStatus = await ukeyAPI.detect();
      store.setUKeyStatus(newStatus);
      store.setDeviceId(newStatus.deviceId || null);

      // 设置为已认证
      store.setAuthenticated(true);

      // 最大化窗口
      try {
        await systemAPI.maximize();
      } catch (error) {
        console.error('窗口最大化失败:', error);
      }

      // 跳转到首页
      router.push('/');
    } else {
      message.error('PIN码错误,请重试');
      pin.value = '';
    }
  } catch (error) {
    console.error('登录失败:', error);
    message.error('登录失败,请重试');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  width: 400px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  animation: fadeIn 0.3s ease-in;
}

.login-header {
  text-align: center;
}

.login-title {
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 24px;
  font-weight: 500;
}

.login-subtitle {
  margin: 0;
  color: rgba(0, 0, 0, 0.45);
}

.login-hint {
  text-align: center;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
