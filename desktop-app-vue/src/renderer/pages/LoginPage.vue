<template>
  <div class="login-container" data-testid="login-container">
    <a-card class="login-card" data-testid="login-card">
      <!-- 设置按钮 -->
      <div class="settings-trigger">
        <a-tooltip title="系统设置" placement="left">
          <a-button
            type="text"
            shape="circle"
            @click="showSettings = true"
          >
            <template #icon>
              <SettingOutlined />
            </template>
          </a-button>
        </a-tooltip>
      </div>

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
            data-testid="pin-input"
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
              data-testid="username-input"
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
              data-testid="password-input"
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
          data-testid="login-button"
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

    <!-- 全局设置对话框 -->
    <GlobalSettingsWizard
      :open="showSettings"
      :canSkip="true"
      @complete="handleSettingsComplete"
      @cancel="showSettings = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  LockOutlined,
  UsbOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { ukeyAPI, authAPI, systemAPI } from '../utils/ipc';
import GlobalSettingsWizard from '../components/GlobalSettingsWizard.vue';

const router = useRouter();
const store = useAppStore();

const pin = ref('');
const username = ref('');
const password = ref('');
const loading = ref(false);
const ukeyStatus = ref({ detected: false, unlocked: false });
const showSettings = ref(false);

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

      console.log('[Login] 尝试登录 - 用户名:', username.value, '密码长度:', password.value.length);
      const result = await authAPI.verifyPassword(username.value, password.value);
      console.log('[Login] 登录结果:', result);
      success = result.success;

      if (success) {
        console.log('[Login] 登录成功');
        // 设置用户信息
        store.setDeviceId(result.userId || 'local-user');
      } else {
        console.log('[Login] 登录失败:', result.error);
        message.error(result.error || '用户名或密码错误');
        password.value = '';
      }
    }

    // 登录成功后的处理
    if (success) {
      message.success('登录成功!');

      // 设置为已认证
      store.setAuthenticated(true);

      // 生成或获取设备ID
      let deviceId = store.deviceId;
      if (!deviceId) {
        deviceId = `device-${Date.now()}`;
        store.setDeviceId(deviceId);
      }

      // 启动后台同步（异步，不阻塞）
      window.electronAPI.sync.start(deviceId)
        .then(() => {
          console.log('[Login] 数据同步完成');
          message.success('数据同步完成', 2);
        })
        .catch(error => {
          console.error('[Login] 数据同步失败:', error);
          message.warning('数据同步失败，请稍后手动同步', 3);
        });

      // 最大化窗口（不等待同步完成）
      try {
        await systemAPI.maximize();
      } catch (error) {
        console.error('窗口最大化失败:', error);
      }

      // 立即跳转到我的项目
      router.push('/projects');
    }
  } catch (error) {
    console.error('登录失败:', error);
    message.error('登录失败,请重试');
  } finally {
    loading.value = false;
  }
};

// 设置完成处理
const handleSettingsComplete = async () => {
  showSettings.value = false;
  message.success('设置已保存，部分配置需要重启应用后生效');

  // 询问是否立即重启
  Modal.confirm({
    title: '需要重启应用',
    content: '配置已更新，是否立即重启应用使配置生效？',
    okText: '立即重启',
    cancelText: '稍后重启',
    onOk: async () => {
      try {
        await window.electronAPI.app.restart();
      } catch (error) {
        console.error('重启应用失败:', error);
        message.error('重启失败，请手动重启应用');
      }
    },
  });
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
  position: relative;
}

.settings-trigger {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1;
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
