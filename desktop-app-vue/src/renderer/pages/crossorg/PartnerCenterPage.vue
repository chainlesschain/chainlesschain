<template>
  <div class="partner-center-page">
    <a-page-header title="合作伙伴中心" sub-title="管理跨组织合作关系">
      <template #extra>
        <a-space>
          <a-button @click="showDiscovery = true">
            <template #icon><SearchOutlined /></template>
            发现组织
          </a-button>
          <a-button type="primary" @click="showInvite = true">
            <template #icon><UserAddOutlined /></template>
            邀请合作
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row :gutter="24}>
      <!-- 合作伙伴列表 -->
      <a-col :span="16}>
        <a-card title="我的合作伙伴">
          <template #extra>
            <a-segmented v-model:value="partnerFilter" :options="filterOptions" />
          </template>

          <a-spin :spinning="loading">
            <a-list
              :data-source="filteredPartners"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta
                    :title="getPartnerName(item)"
                    :description="`${item.partnershipType} | 信任级别: ${item.trustLevel}`"
                  >
                    <template #avatar>
                      <a-avatar size="large" :style="{ backgroundColor: '#1890ff' }">
                        {{ getPartnerName(item)?.charAt(0) }}
                      </a-avatar>
                    </template>
                  </a-list-item-meta>
                  <div class="partner-info">
                    <a-tag :color="getStatusColor(item.status)">
                      {{ getStatusLabel(item.status) }}
                    </a-tag>
                    <p>合作时间: {{ formatDate(item.acceptedAt || item.createdAt) }}</p>
                  </div>
                  <template #actions>
                    <template v-if="item.status === 'pending'">
                      <a-button type="primary" size="small" @click="acceptPartnership(item.id)">
                        接受
                      </a-button>
                      <a-button danger size="small" @click="rejectPartnership(item.id)">
                        拒绝
                      </a-button>
                    </template>
                    <template v-else-if="item.status === 'active'">
                      <a-button type="link" @click="viewPartner(item)">查看详情</a-button>
                      <a-dropdown>
                        <a-button type="link">更多</a-button>
                        <template #overlay>
                          <a-menu>
                            <a-menu-item @click="showTrustSettings(item)">
                              调整信任级别
                            </a-menu-item>
                            <a-menu-item danger @click="terminatePartnership(item.id)">
                              终止合作
                            </a-menu-item>
                          </a-menu>
                        </template>
                      </a-dropdown>
                    </template>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-spin>
        </a-card>
      </a-col>

      <!-- 统计和快捷操作 -->
      <a-col :span="8">
        <a-card title="合作统计">
          <a-row :gutter="[16, 16]">
            <a-col :span="12">
              <a-statistic title="活跃合作" :value="stats.activeCount" :value-style="{ color: '#52c41a' }" />
            </a-col>
            <a-col :span="12">
              <a-statistic title="待处理" :value="stats.pendingCount" :value-style="{ color: '#faad14' }" />
            </a-col>
            <a-col :span="12">
              <a-statistic title="共享资源" :value="stats.sharedResourceCount" />
            </a-col>
            <a-col :span="12">
              <a-statistic title="共享工作空间" :value="stats.workspaceCount" />
            </a-col>
          </a-row>
        </a-card>

        <a-card title="快捷操作" style="margin-top: 16px">
          <a-space direction="vertical" style="width: 100%">
            <a-button block @click="$router.push('/crossorg/workspaces')">
              <template #icon><TeamOutlined /></template>
              共享工作空间
            </a-button>
            <a-button block @click="$router.push('/crossorg/transactions')">
              <template #icon><SwapOutlined /></template>
              B2B 数据交换
            </a-button>
            <a-button block @click="$router.push('/crossorg/audit')">
              <template #icon><AuditOutlined /></template>
              审计日志
            </a-button>
          </a-space>
        </a-card>
      </a-col>
    </a-row>

    <!-- 邀请合作对话框 -->
    <a-modal
      v-model:open="showInvite"
      title="邀请合作"
      @ok="handleInvite"
      :confirm-loading="inviting"
    >
      <a-form :model="inviteForm" layout="vertical">
        <a-form-item label="合作伙伴组织ID" required>
          <a-input v-model:value="inviteForm.partnerOrgId" placeholder="输入组织ID" />
        </a-form-item>
        <a-form-item label="合作伙伴名称" required>
          <a-input v-model:value="inviteForm.partnerOrgName" placeholder="输入组织名称" />
        </a-form-item>
        <a-form-item label="合作类型">
          <a-select v-model:value="inviteForm.partnershipType">
            <a-select-option value="collaboration">协作</a-select-option>
            <a-select-option value="vendor">供应商</a-select-option>
            <a-select-option value="client">客户</a-select-option>
            <a-select-option value="partner">合作伙伴</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="初始信任级别">
          <a-select v-model:value="inviteForm.trustLevel">
            <a-select-option value="minimal">最小</a-select-option>
            <a-select-option value="standard">标准</a-select-option>
            <a-select-option value="elevated">提升</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 发现组织对话框 -->
    <a-modal
      v-model:open="showDiscovery"
      title="发现组织"
      :footer="null"
      width="700px"
    >
      <a-form layout="inline" style="margin-bottom: 16px">
        <a-form-item>
          <a-input v-model:value="searchParams.keyword" placeholder="搜索组织..." allow-clear />
        </a-form-item>
        <a-form-item>
          <a-select v-model:value="searchParams.industry" placeholder="行业" allow-clear style="width: 120px">
            <a-select-option value="tech">科技</a-select-option>
            <a-select-option value="finance">金融</a-select-option>
            <a-select-option value="manufacturing">制造</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-button type="primary" @click="searchOrgs">搜索</a-button>
        </a-form-item>
      </a-form>

      <a-list
        :data-source="discoveredOrgs"
        :loading="searching"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="item.name"
              :description="item.description"
            />
            <a-button type="link" @click="inviteOrg(item)">发起合作</a-button>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  SearchOutlined,
  UserAddOutlined,
  TeamOutlined,
  SwapOutlined,
  AuditOutlined,
} from '@ant-design/icons-vue';
import { useCrossOrgStore } from '@/stores/crossOrg';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const router = useRouter();
const crossOrgStore = useCrossOrgStore();
const authStore = useAuthStore();

const loading = ref(false);
const inviting = ref(false);
const searching = ref(false);
const showInvite = ref(false);
const showDiscovery = ref(false);
const partnerFilter = ref('all');

const partnerships = computed(() => crossOrgStore.partnerships);
const discoveredOrgs = computed(() => crossOrgStore.discoveredOrgs);

const filterOptions = ['all', 'active', 'pending'];
const filteredPartners = computed(() => {
  if (partnerFilter.value === 'all') return partnerships.value;
  return partnerships.value.filter((p) => p.status === partnerFilter.value);
});

const stats = computed(() => ({
  activeCount: partnerships.value.filter((p) => p.status === 'active').length,
  pendingCount: partnerships.value.filter((p) => p.status === 'pending').length,
  sharedResourceCount: crossOrgStore.outgoingShares.length + crossOrgStore.incomingShares.length,
  workspaceCount: crossOrgStore.workspaces.length,
}));

const inviteForm = ref({
  partnerOrgId: '',
  partnerOrgName: '',
  partnershipType: 'collaboration',
  trustLevel: 'standard',
});

const searchParams = ref({
  keyword: '',
  industry: null,
});

const formatDate = (timestamp) => dayjs(timestamp).format('YYYY-MM-DD');

const getPartnerName = (partnership) => {
  const currentOrgId = authStore.currentOrg?.id;
  return partnership.initiatorOrgId === currentOrgId
    ? partnership.partnerOrgName
    : partnership.initiatorOrgName;
};

const getStatusColor = (status) => {
  const colors = { active: 'green', pending: 'orange', terminated: 'red', rejected: 'gray' };
  return colors[status] || 'default';
};

const getStatusLabel = (status) => {
  const labels = { active: '活跃', pending: '待确认', terminated: '已终止', rejected: '已拒绝' };
  return labels[status] || status;
};

const acceptPartnership = async (partnershipId) => {
  try {
    await crossOrgStore.acceptPartnership(partnershipId, authStore.currentUser?.did);
    message.success('已接受合作');
  } catch (error) {
    message.error('操作失败');
  }
};

const rejectPartnership = async (partnershipId) => {
  try {
    await crossOrgStore.rejectPartnership(partnershipId, authStore.currentUser?.did);
    message.success('已拒绝');
  } catch (error) {
    message.error('操作失败');
  }
};

const terminatePartnership = async (partnershipId) => {
  try {
    await crossOrgStore.terminatePartnership(partnershipId, authStore.currentUser?.did);
    message.success('合作已终止');
  } catch (error) {
    message.error('操作失败');
  }
};

const viewPartner = (partner) => {
  // 查看详情
};

const showTrustSettings = (partner) => {
  // 显示信任级别设置
};

const handleInvite = async () => {
  if (!inviteForm.value.partnerOrgId || !inviteForm.value.partnerOrgName) {
    message.warning('请填写合作伙伴信息');
    return;
  }

  inviting.value = true;
  try {
    await crossOrgStore.createPartnership({
      initiatorOrgId: authStore.currentOrg?.id,
      initiatorOrgName: authStore.currentOrg?.name,
      ...inviteForm.value,
      invitedByDid: authStore.currentUser?.did,
    });
    message.success('合作邀请已发送');
    showInvite.value = false;
  } catch (error) {
    message.error('邀请失败');
  } finally {
    inviting.value = false;
  }
};

const searchOrgs = async () => {
  searching.value = true;
  try {
    await crossOrgStore.discoverOrgs(searchParams.value);
  } catch (error) {
    message.error('搜索失败');
  } finally {
    searching.value = false;
  }
};

const inviteOrg = (org) => {
  inviteForm.value.partnerOrgId = org.orgId;
  inviteForm.value.partnerOrgName = org.name;
  showDiscovery.value = false;
  showInvite.value = true;
};

onMounted(async () => {
  loading.value = true;
  try {
    await crossOrgStore.loadPartnerships(authStore.currentOrg?.id);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.partner-center-page {
  padding: 0 24px 24px;
}

.partner-info {
  margin: 0 16px;
}

.partner-info p {
  margin: 4px 0;
  color: #666;
}
</style>
