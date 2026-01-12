<template>
  <a-modal
    v-model:visible="visible"
    title="邀请链接详情"
    width="900px"
    :footer="null"
  >
    <a-spin :spinning="loading">
      <div v-if="linkDetail" class="link-detail">
        <!-- 基本信息 -->
        <a-descriptions title="基本信息" bordered :column="2">
          <a-descriptions-item label="链接ID">
            {{ linkDetail.link_id }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge
              :status="getStatusBadge(linkDetail).status"
              :text="getStatusBadge(linkDetail).text"
            />
          </a-descriptions-item>
          <a-descriptions-item label="角色">
            <a-tag :color="getRoleColor(linkDetail.role)">
              {{ getRoleLabel(linkDetail.role) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="使用情况">
            {{ linkDetail.used_count }} / {{ linkDetail.max_uses }}
            (剩余 {{ linkDetail.remainingUses }})
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(linkDetail.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="过期时间">
            {{ linkDetail.expires_at ? formatDate(linkDetail.expires_at) : '永不过期' }}
          </a-descriptions-item>
          <a-descriptions-item label="最后使用">
            {{ linkDetail.last_used_at ? formatDate(linkDetail.last_used_at) : '未使用' }}
          </a-descriptions-item>
          <a-descriptions-item label="邀请消息" :span="2" v-if="linkDetail.message">
            {{ linkDetail.message }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- 邀请链接 -->
        <a-card title="邀请链接" size="small" style="margin-top: 16px">
          <div style="display: flex; gap: 12px; align-items: center">
            <a-input
              :value="linkDetail.invitationUrl"
              readonly
              style="flex: 1"
            />
            <a-button @click="copyLink">
              <template #icon><CopyOutlined /></template>
              复制
            </a-button>
            <a-button @click="showQRCode">
              <template #icon><QrcodeOutlined /></template>
              二维码
            </a-button>
          </div>
        </a-card>

        <!-- 使用记录 -->
        <a-card title="使用记录" size="small" style="margin-top: 16px">
          <a-table
            :columns="usageColumns"
            :data-source="linkDetail.usageRecords"
            :pagination="false"
            size="small"
            :scroll="{ y: 300 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'user_did'">
                <a-typography-text
                  :copyable="{ text: record.user_did }"
                  :ellipsis="{ tooltip: record.user_did }"
                  style="max-width: 200px"
                >
                  {{ shortenDID(record.user_did) }}
                </a-typography-text>
              </template>
              <template v-else-if="column.key === 'used_at'">
                {{ formatDate(record.used_at) }}
              </template>
            </template>
          </a-table>
          <a-empty v-if="!linkDetail.usageRecords || linkDetail.usageRecords.length === 0" description="暂无使用记录" />
        </a-card>

        <!-- 元数据 -->
        <a-card
          v-if="linkDetail.metadata && Object.keys(linkDetail.metadata).length > 0"
          title="元数据"
          size="small"
          style="margin-top: 16px"
        >
          <a-descriptions bordered size="small" :column="1">
            <a-descriptions-item
              v-for="(value, key) in linkDetail.metadata"
              :key="key"
              :label="key"
            >
              {{ value }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </div>
    </a-spin>

    <!-- QR码对话框 -->
    <QRCodeDialog
      v-model:visible="showQRDialog"
      :url="linkDetail?.invitationUrl"
      :title="`邀请链接二维码`"
    />
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import { CopyOutlined, QrcodeOutlined } from '@ant-design/icons-vue';
import QRCodeDialog from './QRCodeDialog.vue';
import dayjs from 'dayjs';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  linkId: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:visible', 'refresh']);

const loading = ref(false);
const linkDetail = ref(null);
const showQRDialog = ref(false);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const usageColumns = [
  {
    title: '用户DID',
    key: 'user_did',
    width: 250
  },
  {
    title: '使用时间',
    key: 'used_at',
    width: 180
  },
  {
    title: 'IP地址',
    dataIndex: 'ip_address',
    key: 'ip_address',
    width: 150
  },
  {
    title: 'User Agent',
    dataIndex: 'user_agent',
    key: 'user_agent',
    ellipsis: true
  }
];

const loadLinkDetail = async () => {
  if (!props.linkId) return;

  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:get-invitation-link',
      props.linkId
    );

    if (result.success) {
      linkDetail.value = result.link;
    } else {
      message.error(result.error || '加载链接详情失败');
    }
  } catch (error) {
    console.error('加载链接详情失败:', error);
    message.error('加载链接详情失败');
  } finally {
    loading.value = false;
  }
};

const copyLink = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'org:copy-invitation-link',
      linkDetail.value.invitationUrl
    );

    if (result.success) {
      message.success('链接已复制到剪贴板');
    }
  } catch (error) {
    console.error('复制链接失败:', error);
    message.error('复制链接失败');
  }
};

const showQRCode = () => {
  showQRDialog.value = true;
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

const getStatusBadge = (link) => {
  if (link.isExpired) {
    return { status: 'default', text: '已过期' };
  }
  if (link.isExhausted) {
    return { status: 'default', text: '已用尽' };
  }
  if (link.status === 'revoked') {
    return { status: 'error', text: '已撤销' };
  }
  if (link.status === 'active') {
    return { status: 'success', text: '活跃' };
  }
  return { status: 'default', text: link.status };
};

const formatDate = (timestamp) => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
};

const shortenDID = (did) => {
  if (!did || did.length <= 30) return did;
  return `${did.slice(0, 15)}...${did.slice(-10)}`;
};

watch(() => props.visible, (val) => {
  if (val) {
    loadLinkDetail();
  }
});

watch(() => props.linkId, () => {
  if (props.visible) {
    loadLinkDetail();
  }
});
</script>

<style scoped lang="scss">
.link-detail {
  :deep(.ant-descriptions-item-label) {
    font-weight: 500;
  }
}
</style>
