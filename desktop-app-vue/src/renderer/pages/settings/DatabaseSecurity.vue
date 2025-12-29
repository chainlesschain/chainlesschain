<template>
  <div class="database-security-settings">
    <a-page-header
      title="数据库安全"
      sub-title="管理数据库加密和安全设置"
    />

    <a-card title="加密状态" style="margin-bottom: 16px">
      <a-descriptions bordered :column="2">
        <a-descriptions-item label="加密状态">
          <DatabaseEncryptionStatus ref="statusRef" />
        </a-descriptions-item>
        <a-descriptions-item label="加密方法">
          {{ encryptionMethodText }}
        </a-descriptions-item>
        <a-descriptions-item label="数据库引擎" :span="2">
          <a-tag :color="engineColor">
            {{ config.engine || 'sql.js' }}
          </a-tag>
          <span style="margin-left: 8px; color: #666">
            {{ engineDescription }}
          </span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card title="加密设置" style="margin-bottom: 16px">
      <a-form layout="vertical">
        <a-form-item
          label="启用数据库加密"
          extra="开启后将使用 AES-256 加密保护您的数据。修改后需要重启应用。"
        >
          <a-switch
            v-model:checked="config.encryptionEnabled"
            :loading="loading"
            @change="handleEncryptionToggle"
          >
            <template #checkedChildren>已启用</template>
            <template #unCheckedChildren>已禁用</template>
          </a-switch>
        </a-form-item>

        <a-form-item
          v-if="config.encryptionEnabled"
          label="加密方法"
          extra="选择加密密钥的派生方式"
        >
          <a-radio-group
            v-model:value="config.encryptionMethod"
            :disabled="!config.firstTimeSetup"
            @change="handleMethodChange"
          >
            <a-radio-button value="password">
              <KeyOutlined /> 密码加密
            </a-radio-button>
            <a-radio-button value="ukey">
              <UsbOutlined /> U-Key 加密
            </a-radio-button>
          </a-radio-group>
          <a-alert
            v-if="!config.firstTimeSetup"
            message="加密方法已锁定"
            description="为保证数据安全，加密方法设置后无法更改。"
            type="info"
            show-icon
            style="margin-top: 8px"
          />
        </a-form-item>

        <a-form-item
          v-if="config.encryptionEnabled"
          label="自动迁移"
          extra="首次启动加密时自动迁移现有数据"
        >
          <a-switch
            v-model:checked="config.autoMigrate"
            @change="handleAutoMigrateChange"
          />
        </a-form-item>
      </a-form>
    </a-card>

    <a-card title="密码管理" v-if="config.encryptionEnabled && config.encryptionMethod === 'password'">
      <a-space direction="vertical" style="width: 100%">
        <a-button
          v-if="config.firstTimeSetup"
          type="primary"
          :loading="loading"
          @click="showSetPasswordDialog"
        >
          <LockOutlined /> 设置加密密码
        </a-button>

        <a-button
          v-else
          :loading="loading"
          @click="showChangePasswordDialog"
        >
          <EditOutlined /> 修改加密密码
        </a-button>

        <a-alert
          message="密码安全提示"
          description="请设置一个强密码（至少12位，包含大小写字母、数字和特殊字符）。密码一旦忘记将无法找回，请妥善保管。"
          type="warning"
          show-icon
        />
      </a-space>
    </a-card>

    <a-card title="高级选项" style="margin-top: 16px">
      <a-space direction="vertical" style="width: 100%">
        <div>
          <h4>性能信息</h4>
          <p>
            当前使用的{{ config.engine === 'sqlcipher' ? 'SQLCipher' : 'sql.js' }}引擎。
            SQLCipher 性能是 sql.js 的 <strong>25 倍</strong>。
          </p>
        </div>

        <a-divider />

        <div>
          <h4>重置加密配置</h4>
          <a-button danger @click="showResetConfirm">
            <DeleteOutlined /> 重置配置
          </a-button>
          <p style="margin-top: 8px; color: #999">
            ⚠️ 这将清除所有加密设置，需要重新配置。
          </p>
        </div>
      </a-space>
    </a-card>

    <!-- 密码设置对话框 -->
    <DatabasePasswordDialog
      v-model="showPasswordDialog"
      :is-first-time="config.firstTimeSetup"
      :show-old-password="!config.firstTimeSetup"
      @submit="handlePasswordSubmit"
    />

    <!-- 首次设置向导 -->
    <DatabaseEncryptionWizard
      v-model="showWizard"
      @complete="handleWizardComplete"
      @skip="handleWizardSkip"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import {
  LockOutlined,
  KeyOutlined,
  UsbOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';
import DatabaseEncryptionStatus from '../../components/DatabaseEncryptionStatus.vue';
import DatabasePasswordDialog from '../../components/DatabasePasswordDialog.vue';
import DatabaseEncryptionWizard from '../../components/DatabaseEncryptionWizard.vue';

const statusRef = ref();
const loading = ref(false);
const showPasswordDialog = ref(false);
const showWizard = ref(false);

const config = reactive({
  encryptionEnabled: false,
  encryptionMethod: 'password',
  autoMigrate: true,
  firstTimeSetup: true,
  engine: null
});

const encryptionMethodText = computed(() => {
  if (!config.encryptionEnabled) return '未启用';
  return config.encryptionMethod === 'ukey' ? 'U-Key 硬件加密' : '密码派生';
});

const engineColor = computed(() => {
  return config.engine === 'sqlcipher' ? 'success' : 'default';
});

const engineDescription = computed(() => {
  return config.engine === 'sqlcipher'
    ? '高性能加密数据库'
    : '传统数据库（建议启用加密）';
});

// 加载配置
const loadConfig = async () => {
  try {
    const [statusResult, configResult] = await Promise.all([
      window.electron.ipcRenderer.invoke('database:get-encryption-status'),
      window.electron.ipcRenderer.invoke('database:get-encryption-config')
    ]);

    if (statusResult) {
      Object.assign(config, {
        encryptionEnabled: statusResult.isEncrypted,
        encryptionMethod: statusResult.method || 'password',
        firstTimeSetup: statusResult.firstTimeSetup,
        engine: statusResult.engine
      });
    }

    if (configResult.success) {
      Object.assign(config, configResult.config);
    }
  } catch (error) {
    console.error('加载配置失败:', error);
    message.error('加载配置失败: ' + error.message);
  }
};

// 处理加密开关
const handleEncryptionToggle = async (enabled) => {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      enabled ? 'database:enable-encryption' : 'database:disable-encryption'
    );

    if (result.success) {
      message.success(result.message);

      if (enabled && config.firstTimeSetup) {
        // 首次启用，显示向导
        showWizard.value = true;
      } else if (result.requiresRestart) {
        Modal.info({
          title: '需要重启',
          content: '加密设置已更新，请重启应用以使更改生效。',
          okText: '立即重启',
          onOk: () => {
            window.electron.ipcRenderer.invoke('app:restart');
          }
        });
      }

      statusRef.value?.refresh();
    } else {
      config.encryptionEnabled = !enabled; // 回滚
      message.error(result.error || '操作失败');
    }
  } catch (error) {
    config.encryptionEnabled = !enabled; // 回滚
    message.error('操作失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 处理加密方法变更
const handleMethodChange = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('database:update-encryption-config', {
      encryptionMethod: config.encryptionMethod
    });

    if (result.success) {
      message.success('加密方法已更新');
    }
  } catch (error) {
    message.error('更新失败: ' + error.message);
  }
};

// 处理自动迁移变更
const handleAutoMigrateChange = async () => {
  try {
    await window.electron.ipcRenderer.invoke('database:update-encryption-config', {
      autoMigrate: config.autoMigrate
    });
    message.success('设置已更新');
  } catch (error) {
    message.error('更新失败: ' + error.message);
  }
};

// 显示设置密码对话框
const showSetPasswordDialog = () => {
  showPasswordDialog.value = true;
};

// 显示修改密码对话框
const showChangePasswordDialog = () => {
  showPasswordDialog.value = true;
};

// 处理密码提交
const handlePasswordSubmit = async (data) => {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      config.firstTimeSetup ? 'database:setup-encryption' : 'database:change-encryption-password',
      {
        method: config.encryptionMethod,
        password: data.password,
        oldPassword: data.oldPassword
      }
    );

    if (result.success) {
      message.success(result.message);
      showPasswordDialog.value = false;
      await loadConfig();
      statusRef.value?.refresh();
    } else {
      message.error(result.error || '操作失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 向导完成
const handleWizardComplete = async () => {
  message.success('加密设置完成');
  await loadConfig();
  statusRef.value?.refresh();
};

// 跳过向导
const handleWizardSkip = () => {
  config.encryptionEnabled = false;
  handleEncryptionToggle(false);
};

// 重置配置确认
const showResetConfirm = () => {
  Modal.confirm({
    title: '确认重置配置？',
    content: '这将清除所有加密设置，需要重新配置。此操作不会删除已加密的数据库文件。',
    okText: '确认重置',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('database:reset-encryption-config');
        if (result.success) {
          message.success('配置已重置');
          await loadConfig();
        } else {
          message.error(result.error);
        }
      } catch (error) {
        message.error('重置失败: ' + error.message);
      }
    }
  });
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped lang="scss">
.database-security-settings {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;

  h4 {
    margin-bottom: 8px;
    font-weight: 600;
  }

  p {
    margin-bottom: 0;
    color: #666;
  }
}
</style>
