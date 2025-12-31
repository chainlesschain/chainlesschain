<template>
  <div class="edition-selector">
    <a-typography-title :level="4">选择版本类型</a-typography-title>
    <a-typography-paragraph type="secondary">
      选择适合您的版本。个人版适合个人使用，数据存储在本地；企业版适合团队协作，数据存储在企业服务器。
    </a-typography-paragraph>

    <div class="edition-cards">
      <!-- 个人版 -->
      <a-card
        class="edition-card"
        :class="{ selected: modelValue === 'personal' }"
        @click="selectEdition('personal')"
        hoverable
      >
        <div class="card-icon personal">
          <UserOutlined :style="{ fontSize: '48px' }" />
        </div>
        <a-typography-title :level="5">个人版</a-typography-title>
        <a-typography-paragraph type="secondary">
          适合个人知识管理和学习
        </a-typography-paragraph>
        <a-space direction="vertical" size="small" class="features">
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            本地数据存储
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            完全离线可用
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            数据隐私保护
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            免费使用
          </div>
        </a-space>
      </a-card>

      <!-- 企业版 -->
      <a-card
        class="edition-card"
        :class="{ selected: modelValue === 'enterprise' }"
        @click="selectEdition('enterprise')"
        hoverable
      >
        <div class="card-icon enterprise">
          <TeamOutlined :style="{ fontSize: '48px' }" />
        </div>
        <a-typography-title :level="5">企业版</a-typography-title>
        <a-typography-paragraph type="secondary">
          适合团队协作和企业知识库
        </a-typography-paragraph>
        <a-space direction="vertical" size="small" class="features">
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            云端数据存储
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            多人协作编辑
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            企业级安全
          </div>
          <div class="feature-item">
            <CheckCircleOutlined class="feature-icon" />
            数据同步备份
          </div>
        </a-space>
      </a-card>
    </div>

    <!-- 企业版配置表单（仅在选择企业版时显示） -->
    <a-card
      v-if="modelValue === 'enterprise'"
      class="enterprise-config"
      title="企业服务器配置"
    >
      <a-form layout="vertical">
        <a-form-item label="服务器地址" required>
          <a-input
            v-model:value="enterpriseConfig.serverUrl"
            placeholder="https://enterprise.example.com"
            @change="emitEnterpriseConfig"
          />
          <template #extra>
            请输入企业服务器的完整地址，包括协议（http:// 或 https://）
          </template>
        </a-form-item>

        <a-form-item label="租户ID" required>
          <a-input
            v-model:value="enterpriseConfig.tenantId"
            placeholder="your-tenant-id"
            @change="emitEnterpriseConfig"
          />
          <template #extra>
            请联系您的系统管理员获取租户ID
          </template>
        </a-form-item>

        <a-form-item label="API密钥" required>
          <a-input-password
            v-model:value="enterpriseConfig.apiKey"
            placeholder="输入企业版API密钥"
            @change="emitEnterpriseConfig"
          />
          <template #extra>
            API密钥将被加密存储，请妥善保管
          </template>
        </a-form-item>

        <!-- 测试连接按钮和状态 -->
        <a-form-item>
          <a-space direction="vertical" style="width: 100%">
            <a-button
              type="primary"
              :loading="testing"
              :disabled="!canTestConnection"
              @click="testConnection"
              block
            >
              <template #icon>
                <ApiOutlined v-if="!testing" />
                <LoadingOutlined v-else />
              </template>
              {{ testing ? '正在测试连接...' : '测试服务器连接' }}
            </a-button>

            <!-- 连接状态显示 -->
            <a-alert
              v-if="connectionStatus === 'success'"
              type="success"
              :message="connectionMessage"
              show-icon
            >
              <template #icon>
                <CheckCircleOutlined />
              </template>
            </a-alert>

            <a-alert
              v-if="connectionStatus === 'error'"
              type="error"
              :message="connectionMessage"
              show-icon
            >
              <template #icon>
                <CloseCircleOutlined />
              </template>
              <template #description>
                请检查：
                <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                  <li>服务器地址是否正确（包括协议和端口）</li>
                  <li>租户ID是否正确</li>
                  <li>API密钥是否有效</li>
                  <li>网络连接是否正常</li>
                </ul>
              </template>
            </a-alert>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  UserOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ApiOutlined,
  LoadingOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: 'personal',
  },
});

const emit = defineEmits(['update:modelValue', 'update:enterpriseConfig']);

const enterpriseConfig = reactive({
  serverUrl: '',
  tenantId: '',
  apiKey: '',
});

const testing = ref(false);
const connectionStatus = ref(null); // 'success' | 'error' | null
const connectionMessage = ref('');
const latency = ref(null);

const selectEdition = (edition) => {
  emit('update:modelValue', edition);
};

const emitEnterpriseConfig = () => {
  emit('update:enterpriseConfig', { ...enterpriseConfig });
};

// 验证配置完整性
const canTestConnection = computed(() => {
  return (
    enterpriseConfig.serverUrl &&
    enterpriseConfig.tenantId &&
    enterpriseConfig.apiKey
  );
});

// 测试企业服务器连接
const testConnection = async () => {
  if (!canTestConnection.value) {
    message.warning('请先填写完整的服务器配置信息');
    return;
  }

  try {
    testing.value = true;
    connectionStatus.value = null;
    connectionMessage.value = '正在连接...';

    const startTime = Date.now();

    // 尝试连接企业服务器的健康检查端点
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(`${enterpriseConfig.serverUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${enterpriseConfig.apiKey}`,
        'X-Tenant-ID': enterpriseConfig.tenantId,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const endTime = Date.now();
    latency.value = endTime - startTime;

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      connectionStatus.value = 'success';
      connectionMessage.value = `连接成功 (延迟: ${latency.value}ms)`;
      message.success('企业服务器连接成功！');
    } else if (response.status === 401 || response.status === 403) {
      connectionStatus.value = 'error';
      connectionMessage.value = '认证失败：API密钥或租户ID无效';
      message.error('认证失败，请检查API密钥和租户ID');
    } else {
      connectionStatus.value = 'error';
      connectionMessage.value = `连接失败：服务器返回 ${response.status}`;
      message.error(`连接失败 (HTTP ${response.status})`);
    }
  } catch (error) {
    connectionStatus.value = 'error';

    if (error.name === 'AbortError') {
      connectionMessage.value = '连接超时：服务器无响应';
      message.error('连接超时，请检查服务器地址是否正确');
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      connectionMessage.value = '网络错误：无法连接到服务器';
      message.error('无法连接到服务器，请检查网络和服务器地址');
    } else {
      connectionMessage.value = `连接失败：${error.message}`;
      message.error('连接失败: ' + error.message);
    }
  } finally {
    testing.value = false;
  }
};
</script>

<style scoped>
.edition-selector {
  padding: 20px 0;
}

.edition-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.edition-card {
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid transparent;
}

.edition-card.selected {
  border-color: #1890ff;
  box-shadow: 0 4px 12px rgba(24, 144, 255, 0.15);
}

.edition-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
}

.card-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.card-icon.personal {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.card-icon.enterprise {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.features {
  margin-top: 16px;
  width: 100%;
}

.feature-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-size: 14px;
}

.feature-icon {
  color: #52c41a;
}

.enterprise-config {
  margin-top: 20px;
  animation: fadeIn 0.3s ease-in;
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
