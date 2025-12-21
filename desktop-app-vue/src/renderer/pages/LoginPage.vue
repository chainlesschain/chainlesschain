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
          :type="ukeyStatus.detected ? 'success' : 'info'"
          :show-icon="false"
        >
          <template #message>
            <a-space>
              <UsbOutlined />
              <span>{{ ukeyStatus.detected ? 'U盾已连接 - 使用PIN码登录' : '未检测到U盾 - 使用密码登录' }}</span>
              <CheckCircleOutlined
                v-if="ukeyStatus.detected"
                :style="{ color: '#52c41a' }"
              />
              <InfoCircleOutlined
                v-else
                :style="{ color: '#1890ff' }"
              />
            </a-space>
          </template>
        </a-alert>

        <!-- U盾PIN输入 -->
        <div v-if="ukeyStatus.detected">
          <div style="margin-bottom: 8px">
            <strong>请输入PIN码:</strong>
          </div>
          <a-input-password
            v-model:value="pin"
            size="large"
            placeholder="输入6位PIN码"
            :maxlength="6"
            :disabled="loading"
            @keypress.enter="handleLogin"
          >
            <template #prefix>
              <LockOutlined />
            </template>
          </a-input-password>
        </div>

        <!-- 密码登录表单 -->
        <div v-else>
          <div style="margin-bottom: 16px">
            <div style="margin-bottom: 8px">
              <strong>用户名:</strong>
            </div>
            <a-input
              v-model:value="username"
              size="large"
              placeholder="输入用户名"
              :disabled="loading"
              @keypress.enter="handleLogin"
            >
              <template #prefix>
                <UserOutlined />
              </template>
            </a-input>
          </div>
          <div>
            <div style="margin-bottom: 8px">
              <strong>密码:</strong>
            </div>
            <a-input-password
              v-model:value="password"
              size="large"
              placeholder="输入密码"
              :disabled="loading"
              @keypress.enter="handleLogin"
            >
              <template #prefix>
                <LockOutlined />
              </template>
            </a-input-password>
          </div>
        </div>

        <!-- 登录按钮 -->
        <a-button
          type="primary"
          size="large"
          block
          :loading="loading"
          @click="handleLogin"
        >
          {{ loading ? '验证中...' : '登录' }}
        </a-button>

        <!-- 提示信息 -->
        <div class="login-hint">
          <a-typography-text type="secondary" :style="{ fontSize: '12px' }">
            {{ ukeyStatus.detected
              ? '开发模式: 默认PIN为 123456'
              : '开发模式: 默认用户名 admin, 密码 123456'
            }}
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
  InfoCircleOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { ukeyAPI, authAPI, systemAPI } from '../utils/ipc';

const router = useRouter();
const store = useAppStore();

const pin = ref('');
const username = ref('');
const password = ref('');
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
  loading.value = true;

  try {
    let success = false;

    // 根据U盾状态选择登录方式
    if (ukeyStatus.value.detected) {
      // U盾PIN码登录
      if (!pin.value) {
        message.warning('请输入PIN码');
        loading.value = false;
        return;
      }

      const result = await ukeyAPI.verifyPIN(pin.value);
      success = result;

      if (success) {
        // 更新U盾状态
        const newStatus = await ukeyAPI.detect();
        store.setUKeyStatus(newStatus);
        store.setDeviceId(newStatus.deviceId || null);
      } else {
        message.error('PIN码错误,请重试');
        pin.value = '';
      }
    } else {
      // 用户名密码登录
      if (!username.value) {
        message.warning('请输入用户名');
        loading.value = false;
        return;
      }

      if (!password.value) {
        message.warning('请输入密码');
        loading.value = false;
        return;
      }

      const result = await authAPI.verifyPassword(username.value, password.value);
      success = result.success;

      if (success) {
        // 设置用户信息
        store.setDeviceId(result.userId || 'local-user');
      } else {
        message.error(result.error || '用户名或密码错误');
        password.value = '';
      }
    }

    // 登录成功后的处理
    if (success) {
      message.success('登录成功!');

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
