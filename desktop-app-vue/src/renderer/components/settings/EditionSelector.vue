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
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import {
  UserOutlined,
  TeamOutlined,
  CheckCircleOutlined,
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

const selectEdition = (edition) => {
  emit('update:modelValue', edition);
};

const emitEnterpriseConfig = () => {
  emit('update:enterpriseConfig', { ...enterpriseConfig });
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
