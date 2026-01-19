<template>
  <a-modal
    v-model:open="visible"
    title="加入组织"
    width="600px"
    :confirm-loading="loading"
    @ok="handleAccept"
    @cancel="handleReject"
  >
    <a-spin :spinning="validating">
      <div
        v-if="invitationInfo"
        class="invitation-accept"
      >
        <!-- 组织信息 -->
        <a-card class="org-card">
          <div class="org-header">
            <a-avatar
              :size="64"
              :src="invitationInfo.orgAvatar"
              style="background-color: #1890ff"
            >
              {{ invitationInfo.orgName?.charAt(0) }}
            </a-avatar>
            <div class="org-info">
              <h3>{{ invitationInfo.orgName }}</h3>
              <p v-if="invitationInfo.orgDescription">
                {{ invitationInfo.orgDescription }}
              </p>
            </div>
          </div>
        </a-card>

        <!-- 邀请信息 -->
        <a-descriptions
          bordered
          :column="1"
          style="margin-top: 16px"
        >
          <a-descriptions-item label="邀请人">
            {{ invitationInfo.inviterName }}
          </a-descriptions-item>
          <a-descriptions-item label="分配角色">
            <a-tag :color="getRoleColor(invitationInfo.role)">
              {{ getRoleLabel(invitationInfo.role) }}
            </a-tag>
            <div style="margin-top: 8px; color: #8c8c8c; font-size: 12px">
              {{ getRoleDescription(invitationInfo.role) }}
            </div>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="invitationInfo.message"
            label="邀请消息"
          >
            {{ invitationInfo.message }}
          </a-descriptions-item>
          <a-descriptions-item label="链接状态">
            <a-space>
              <span>剩余使用次数: {{ invitationInfo.remainingUses }}</span>
              <a-divider type="vertical" />
              <span v-if="invitationInfo.expiresAt">
                {{ getTimeRemaining(invitationInfo.expiresAt) }}
              </span>
              <span v-else>永不过期</span>
            </a-space>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 权限说明 -->
        <a-alert
          message="加入后您将获得以下权限"
          :description="getPermissionDescription(invitationInfo.role)"
          type="info"
          show-icon
          style="margin-top: 16px"
        />

        <!-- 错误提示 -->
        <a-alert
          v-if="error"
          :message="error"
          type="error"
          show-icon
          closable
          style="margin-top: 16px"
          @close="error = ''"
        />
      </div>

      <a-result
        v-else-if="!validating && !invitationInfo"
        status="error"
        title="邀请链接无效"
        sub-title="此邀请链接可能已过期、已撤销或不存在"
      >
        <template #extra>
          <a-button
            type="primary"
            @click="visible = false"
          >
            关闭
          </a-button>
        </template>
      </a-result>
    </a-spin>

    <template #footer>
      <a-space>
        <a-button @click="handleReject">
          拒绝
        </a-button>
        <a-button
          type="primary"
          :loading="loading"
          :disabled="!invitationInfo"
          @click="handleAccept"
        >
          接受并加入
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  token: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:visible', 'accepted', 'rejected']);

const validating = ref(false);
const loading = ref(false);
const invitationInfo = ref(null);
const error = ref('');

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const validateToken = async () => {
  if (!props.token) {return;}

  validating.value = true;
  error.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:validate-invitation-token',
      props.token
    );

    if (result.success) {
      invitationInfo.value = result.linkInfo;
    } else {
      error.value = result.error || '验证邀请链接失败';
      invitationInfo.value = null;
    }
  } catch (err) {
    console.error('验证邀请链接失败:', err);
    error.value = '验证邀请链接失败';
    invitationInfo.value = null;
  } finally {
    validating.value = false;
  }
};

const handleAccept = async () => {
  loading.value = true;
  error.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:accept-invitation-link',
      props.token,
      {}
    );

    if (result.success) {
      message.success(`成功加入组织: ${result.org.name}`);
      emit('accepted', result.org);
      visible.value = false;
    } else {
      error.value = result.error || '加入组织失败';
    }
  } catch (err) {
    console.error('加入组织失败:', err);
    error.value = err.message || '加入组织失败';
  } finally {
    loading.value = false;
  }
};

const handleReject = () => {
  emit('rejected');
  visible.value = false;
};

const getRoleColor = (role) => {
  const colors = {
    owner: 'red',
    admin: 'orange',
    member: 'blue',
    viewer: 'green'
  };
  return colors[role] || 'default';
};

const getRoleLabel = (role) => {
  const labels = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客'
  };
  return labels[role] || role;
};

const getRoleDescription = (role) => {
  const descriptions = {
    owner: '拥有组织的完全控制权，可以管理所有设置和成员',
    admin: '可以管理成员、内容和组织设置',
    member: '可以创建和编辑内容，参与协作',
    viewer: '只能查看内容，不能编辑'
  };
  return descriptions[role] || '';
};

const getPermissionDescription = (role) => {
  const permissions = {
    owner: '• 管理组织设置\n• 邀请和移除成员\n• 创建和管理角色\n• 完全的内容访问权限',
    admin: '• 邀请和管理成员\n• 创建和编辑内容\n• 管理项目和知识库\n• 查看活动日志',
    member: '• 创建和编辑内容\n• 参与项目协作\n• 访问知识库\n• 发送消息',
    viewer: '• 查看内容\n• 阅读知识库\n• 查看项目信息'
  };
  return permissions[role] || '';
};

const getTimeRemaining = (expiresAt) => {
  const now = Date.now();
  if (expiresAt < now) {
    return '已过期';
  }
  return `${dayjs(expiresAt).fromNow()}过期`;
};

watch(() => props.visible, (val) => {
  if (val) {
    validateToken();
  } else {
    invitationInfo.value = null;
    error.value = '';
  }
});

watch(() => props.token, () => {
  if (props.visible) {
    validateToken();
  }
});
</script>

<style scoped lang="scss">
.invitation-accept {
  .org-card {
    .org-header {
      display: flex;
      gap: 16px;
      align-items: center;

      .org-info {
        flex: 1;

        h3 {
          margin: 0 0 8px 0;
          font-size: 20px;
          font-weight: 600;
        }

        p {
          margin: 0;
          color: #8c8c8c;
          font-size: 14px;
        }
      }
    }
  }
}
</style>
