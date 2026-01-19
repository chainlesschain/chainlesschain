<template>
  <div class="email-account-manager">
    <a-card
      title="邮件账户管理"
      :bordered="false"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="showAddAccountModal"
        >
          <template #icon>
            <PlusOutlined />
          </template>
          添加账户
        </a-button>
      </template>

      <a-list
        :data-source="accounts"
        :loading="loading"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip title="同步">
                <a-button
                  type="text"
                  size="small"
                  :loading="item.syncing"
                  @click="syncAccount(item.id)"
                >
                  <SyncOutlined />
                </a-button>
              </a-tooltip>

              <a-tooltip :title="item.status === 'active' ? '暂停' : '启用'">
                <a-button
                  type="text"
                  size="small"
                  @click="toggleAccountStatus(item)"
                >
                  <PauseCircleOutlined v-if="item.status === 'active'" />
                  <PlayCircleOutlined v-else />
                </a-button>
              </a-tooltip>

              <a-tooltip title="设置">
                <a-button
                  type="text"
                  size="small"
                  @click="editAccount(item)"
                >
                  <SettingOutlined />
                </a-button>
              </a-tooltip>

              <a-popconfirm
                title="确定要删除这个账户吗？"
                @confirm="deleteAccount(item.id)"
              >
                <a-button
                  type="text"
                  size="small"
                  danger
                >
                  <DeleteOutlined />
                </a-button>
              </a-popconfirm>
            </template>

            <a-list-item-meta>
              <template #avatar>
                <a-avatar style="background-color: #1890ff">
                  <template #icon>
                    <MailOutlined />
                  </template>
                </a-avatar>
              </template>

              <template #title>
                <a @click="viewEmails(item)">{{ item.display_name || item.email }}</a>
                <a-tag
                  v-if="item.status === 'error'"
                  color="error"
                  style="margin-left: 8px"
                >
                  错误
                </a-tag>
                <a-tag
                  v-else-if="item.status === 'paused'"
                  color="warning"
                  style="margin-left: 8px"
                >
                  已暂停
                </a-tag>
                <a-tag
                  v-else
                  color="success"
                  style="margin-left: 8px"
                >
                  正常
                </a-tag>
              </template>

              <template #description>
                <div>{{ item.email }}</div>
                <div style="margin-top: 4px; font-size: 12px; color: #999">
                  <span>IMAP: {{ item.imap_host }}:{{ item.imap_port }}</span>
                  <span style="margin-left: 16px">SMTP: {{ item.smtp_host }}:{{ item.smtp_port }}</span>
                </div>
                <div style="margin-top: 4px; font-size: 12px; color: #999">
                  <span v-if="item.last_sync_at">
                    最后同步: {{ formatTime(item.last_sync_at) }}
                  </span>
                  <span
                    v-if="item.error_message"
                    style="color: #ff4d4f; margin-left: 8px"
                  >
                    {{ item.error_message }}
                  </span>
                </div>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 添加/编辑账户对话框 -->
    <a-modal
      v-model:open="accountModalVisible"
      :title="editingAccount ? '编辑账户' : '添加邮件账户'"
      :confirm-loading="saving"
      width="600px"
      @ok="handleSaveAccount"
    >
      <a-form
        :model="accountForm"
        layout="vertical"
      >
        <a-form-item
          label="邮箱地址"
          required
        >
          <a-input
            v-model:value="accountForm.email"
            placeholder="user@example.com"
            :disabled="!!editingAccount"
          />
        </a-form-item>

        <a-form-item label="显示名称">
          <a-input
            v-model:value="accountForm.displayName"
            placeholder="我的邮箱"
          />
        </a-form-item>

        <a-form-item
          label="密码"
          required
        >
          <a-input-password
            v-model:value="accountForm.password"
            placeholder="邮箱密码或应用专用密码"
          />
          <div style="font-size: 12px; color: #999; margin-top: 4px">
            Gmail 用户请使用应用专用密码
          </div>
        </a-form-item>

        <a-divider>IMAP 设置</a-divider>

        <a-row :gutter="16">
          <a-col :span="16">
            <a-form-item
              label="IMAP 服务器"
              required
            >
              <a-input
                v-model:value="accountForm.imapHost"
                placeholder="imap.example.com"
              />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item
              label="端口"
              required
            >
              <a-input-number
                v-model:value="accountForm.imapPort"
                :min="1"
                :max="65535"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item>
          <a-checkbox v-model:checked="accountForm.imapTls">
            使用 TLS/SSL
          </a-checkbox>
        </a-form-item>

        <a-divider>SMTP 设置</a-divider>

        <a-row :gutter="16">
          <a-col :span="16">
            <a-form-item
              label="SMTP 服务器"
              required
            >
              <a-input
                v-model:value="accountForm.smtpHost"
                placeholder="smtp.example.com"
              />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item
              label="端口"
              required
            >
              <a-input-number
                v-model:value="accountForm.smtpPort"
                :min="1"
                :max="65535"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item>
          <a-checkbox v-model:checked="accountForm.smtpSecure">
            使用 SSL (通常用于 465 端口)
          </a-checkbox>
        </a-form-item>

        <a-divider>同步设置</a-divider>

        <a-form-item label="同步频率（秒）">
          <a-input-number
            v-model:value="accountForm.syncFrequency"
            :min="60"
            :max="86400"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item>
          <a-checkbox v-model:checked="accountForm.autoSync">
            启用自动同步
          </a-checkbox>
        </a-form-item>

        <a-divider />

        <a-space>
          <a-button
            :loading="testing"
            @click="testConnection"
          >
            <CheckCircleOutlined /> 测试连接
          </a-button>

          <a-button @click="usePreset">
            <ThunderboltOutlined /> 使用预设
          </a-button>
        </a-space>

        <div
          v-if="testResult"
          style="margin-top: 12px"
        >
          <a-alert
            :type="testResult.success ? 'success' : 'error'"
            :message="testResult.success ? '连接成功' : '连接失败'"
            :description="testResult.message"
            show-icon
          />
        </div>
      </a-form>
    </a-modal>

    <!-- 预设配置对话框 -->
    <a-modal
      v-model:open="presetModalVisible"
      title="选择邮件服务商"
      width="500px"
      @ok="applyPreset"
    >
      <a-list
        :data-source="presets"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item
            style="cursor: pointer"
            :class="{ 'preset-selected': selectedPreset?.name === item.name }"
            @click="selectedPreset = item"
          >
            <a-list-item-meta>
              <template #title>
                {{ item.name }}
              </template>
              <template #description>
                IMAP: {{ item.imapHost }}:{{ item.imapPort }} |
                SMTP: {{ item.smtpHost }}:{{ item.smtpPort }}
              </template>
            </a-list-item-meta>
            <template #actions>
              <CheckCircleOutlined
                v-if="selectedPreset?.name === item.name"
                style="color: #52c41a"
              />
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  PlusOutlined,
  SyncOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  DeleteOutlined,
  MailOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const router = useRouter();

// 状态
const loading = ref(false);
const accounts = ref([]);
const accountModalVisible = ref(false);
const editingAccount = ref(null);
const saving = ref(false);
const testing = ref(false);
const testResult = ref(null);

// 预设配置
const presetModalVisible = ref(false);
const selectedPreset = ref(null);
const presets = [
  {
    name: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    name: 'Outlook/Hotmail',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    name: 'QQ 邮箱',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.qq.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    name: '163 邮箱',
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    name: '126 邮箱',
    imapHost: 'imap.126.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.126.com',
    smtpPort: 465,
    smtpSecure: true,
  },
];

const accountForm = reactive({
  email: '',
  displayName: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapTls: true,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  syncFrequency: 300,
  autoSync: true,
});

// 方法
const loadAccounts = async () => {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('email:get-accounts');
    if (result.success) {
      accounts.value = result.accounts;
    }
  } catch (error) {
    message.error('加载账户失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const showAddAccountModal = () => {
  editingAccount.value = null;
  resetForm();
  testResult.value = null;
  accountModalVisible.value = true;
};

const resetForm = () => {
  accountForm.email = '';
  accountForm.displayName = '';
  accountForm.password = '';
  accountForm.imapHost = '';
  accountForm.imapPort = 993;
  accountForm.imapTls = true;
  accountForm.smtpHost = '';
  accountForm.smtpPort = 587;
  accountForm.smtpSecure = false;
  accountForm.syncFrequency = 300;
  accountForm.autoSync = true;
};

const handleSaveAccount = async () => {
  if (!accountForm.email || !accountForm.password) {
    message.error('请填写邮箱地址和密码');
    return;
  }

  if (!accountForm.imapHost || !accountForm.smtpHost) {
    message.error('请填写 IMAP 和 SMTP 服务器地址');
    return;
  }

  saving.value = true;
  try {
    if (editingAccount.value) {
      // 更新账户
      const result = await window.electron.ipcRenderer.invoke(
        'email:update-account',
        editingAccount.value.id,
        accountForm
      );

      if (result.success) {
        message.success('账户更新成功');
        accountModalVisible.value = false;
        await loadAccounts();
      }
    } else {
      // 添加账户
      const result = await window.electron.ipcRenderer.invoke('email:add-account', accountForm);

      if (result.success) {
        message.success('账户添加成功');
        accountModalVisible.value = false;
        await loadAccounts();
      }
    }
  } catch (error) {
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

const testConnection = async () => {
  if (!accountForm.email || !accountForm.password) {
    message.error('请填写邮箱地址和密码');
    return;
  }

  testing.value = true;
  testResult.value = null;

  try {
    const result = await window.electron.ipcRenderer.invoke('email:test-connection', accountForm);

    if (result.success && result.result.success) {
      testResult.value = {
        success: true,
        message: `连接成功！发现 ${result.result.mailboxes} 个邮箱`,
      };
    } else {
      testResult.value = {
        success: false,
        message: result.result.error || '连接失败',
      };
    }
  } catch (error) {
    testResult.value = {
      success: false,
      message: error.message,
    };
  } finally {
    testing.value = false;
  }
};

const usePreset = () => {
  selectedPreset.value = null;
  presetModalVisible.value = true;
};

const applyPreset = () => {
  if (!selectedPreset.value) {
    message.warning('请选择一个预设');
    return;
  }

  accountForm.imapHost = selectedPreset.value.imapHost;
  accountForm.imapPort = selectedPreset.value.imapPort;
  accountForm.imapTls = selectedPreset.value.imapTls;
  accountForm.smtpHost = selectedPreset.value.smtpHost;
  accountForm.smtpPort = selectedPreset.value.smtpPort;
  accountForm.smtpSecure = selectedPreset.value.smtpSecure;

  presetModalVisible.value = false;
  message.success('已应用预设配置');
};

const editAccount = (account) => {
  editingAccount.value = account;
  accountForm.email = account.email;
  accountForm.displayName = account.display_name;
  accountForm.password = ''; // 不显示密码
  accountForm.imapHost = account.imap_host;
  accountForm.imapPort = account.imap_port;
  accountForm.imapTls = account.imap_tls === 1;
  accountForm.smtpHost = account.smtp_host;
  accountForm.smtpPort = account.smtp_port;
  accountForm.smtpSecure = account.smtp_secure === 1;
  accountForm.syncFrequency = account.sync_frequency;
  accountForm.autoSync = true;
  testResult.value = null;
  accountModalVisible.value = true;
};

const deleteAccount = async (accountId) => {
  try {
    const result = await window.electron.ipcRenderer.invoke('email:remove-account', accountId);
    if (result.success) {
      message.success('账户已删除');
      await loadAccounts();
    }
  } catch (error) {
    message.error('删除失败: ' + error.message);
  }
};

const syncAccount = async (accountId) => {
  const account = accounts.value.find(a => a.id === accountId);
  if (account) {
    account.syncing = true;
  }

  try {
    const result = await window.electron.ipcRenderer.invoke('email:fetch-emails', accountId, {
      limit: 50,
      unseen: true,
    });

    if (result.success) {
      message.success(`已同步 ${result.count} 封新邮件`);
      await loadAccounts();
    }
  } catch (error) {
    message.error('同步失败: ' + error.message);
  } finally {
    if (account) {
      account.syncing = false;
    }
  }
};

const toggleAccountStatus = async (account) => {
  const newStatus = account.status === 'active' ? 'paused' : 'active';

  try {
    const result = await window.electron.ipcRenderer.invoke('email:update-account', account.id, {
      status: newStatus,
    });

    if (result.success) {
      message.success(newStatus === 'active' ? '已启用' : '已暂停');
      await loadAccounts();
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const viewEmails = (account) => {
  router.push(`/email/inbox/${account.id}`);
};

const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

// 生命周期
onMounted(() => {
  loadAccounts();
});
</script>

<style scoped>
.email-account-manager {
  padding: 24px;
}

.preset-selected {
  background-color: #e6f7ff;
}
</style>
