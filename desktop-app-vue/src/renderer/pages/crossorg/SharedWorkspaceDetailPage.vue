<template>
  <div class="shared-workspace-detail-page">
    <a-page-header
      :title="currentWorkspace?.name || '共享工作空间'"
      :sub-title="currentWorkspace?.description"
      @back="goBack"
    >
      <template #extra>
        <a-space>
          <a-button @click="showInviteOrg = true" v-if="isAdmin">
            <template #icon><TeamOutlined /></template>
            邀请组织
          </a-button>
          <a-button type="primary" @click="showShareResource = true">
            <template #icon><ShareAltOutlined /></template>
            共享资源
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs v-model:activeKey="activeTab">
      <!-- 成员 -->
      <a-tab-pane key="members" tab="成员管理">
        <a-row :gutter="24}>
          <a-col :span="8}>
            <a-card title="参与组织">
              <a-list :data-source="workspaceOrgs" :loading="loading">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :title="item.orgName" :description="item.role" />
                    <a-tag :color="item.role === 'admin' ? 'gold' : 'default'">
                      {{ item.role }}
                    </a-tag>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
          <a-col :span="16}>
            <a-card title="成员列表">
              <template #extra>
                <a-button type="primary" size="small" @click="showAddMember = true">
                  添加成员
                </a-button>
              </template>
              <a-table
                :columns="memberColumns"
                :data-source="workspaceMembers"
                :loading="loading"
                row-key="id"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'permissions'">
                    <a-tag v-for="perm in record.permissions" :key="perm">{{ perm }}</a-tag>
                  </template>
                  <template v-else-if="column.key === 'action'">
                    <a-button type="link" danger size="small" @click="removeMember(record.memberDid)">
                      移除
                    </a-button>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- 共享资源 -->
      <a-tab-pane key="resources" tab="共享资源">
        <a-table
          :columns="resourceColumns"
          :data-source="sharedResources"
          :loading="loadingResources"
          row-key="id"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'permissions'">
              <a-tag v-for="perm in record.permissions" :key="perm">{{ perm }}</a-tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a-button type="link" @click="accessResource(record)">访问</a-button>
                <a-button type="link" danger @click="unshareResource(record.id)">取消共享</a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- 活动 -->
      <a-tab-pane key="activity" tab="活动日志">
        <a-timeline>
          <a-timeline-item v-for="log in activityLogs" :key="log.id">
            <p><strong>{{ log.actorDid }}</strong> {{ log.action }}</p>
            <p>{{ formatTime(log.createdAt) }}</p>
          </a-timeline-item>
        </a-timeline>
      </a-tab-pane>
    </a-tabs>

    <!-- 邀请组织对话框 -->
    <a-modal v-model:open="showInviteOrg" title="邀请组织" @ok="handleInviteOrg" :confirm-loading="inviting">
      <a-form :model="inviteOrgForm" layout="vertical">
        <a-form-item label="组织ID" required>
          <a-input v-model:value="inviteOrgForm.orgId" placeholder="输入组织ID" />
        </a-form-item>
        <a-form-item label="组织名称" required>
          <a-input v-model:value="inviteOrgForm.orgName" placeholder="输入组织名称" />
        </a-form-item>
        <a-form-item label="角色">
          <a-select v-model:value="inviteOrgForm.role">
            <a-select-option value="member">成员</a-select-option>
            <a-select-option value="admin">管理员</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 共享资源对话框 -->
    <a-modal v-model:open="showShareResource" title="共享资源" @ok="handleShareResource" :confirm-loading="sharing">
      <a-form :model="shareForm" layout="vertical">
        <a-form-item label="资源类型" required>
          <a-select v-model:value="shareForm.resourceType">
            <a-select-option value="knowledge">知识库</a-select-option>
            <a-select-option value="project">项目</a-select-option>
            <a-select-option value="document">文档</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="资源ID" required>
          <a-input v-model:value="shareForm.resourceId" placeholder="输入资源ID" />
        </a-form-item>
        <a-form-item label="资源名称" required>
          <a-input v-model:value="shareForm.resourceName" placeholder="输入资源名称" />
        </a-form-item>
        <a-form-item label="权限">
          <a-checkbox-group v-model:value="shareForm.permissions">
            <a-checkbox value="read">读取</a-checkbox>
            <a-checkbox value="write">写入</a-checkbox>
            <a-checkbox value="delete">删除</a-checkbox>
          </a-checkbox-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { TeamOutlined, ShareAltOutlined } from '@ant-design/icons-vue';
import { useCrossOrgStore } from '@/stores/crossOrg';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const route = useRoute();
const router = useRouter();
const crossOrgStore = useCrossOrgStore();
const authStore = useAuthStore();

const workspaceId = computed(() => route.params.id);
const loading = ref(false);
const loadingResources = ref(false);
const inviting = ref(false);
const sharing = ref(false);
const activeTab = ref('members');
const showInviteOrg = ref(false);
const showAddMember = ref(false);
const showShareResource = ref(false);

const currentWorkspace = computed(() => crossOrgStore.currentWorkspace);
const workspaceOrgs = computed(() => crossOrgStore.workspaceOrgs);
const workspaceMembers = computed(() => crossOrgStore.workspaceMembers);
const sharedResources = computed(() => crossOrgStore.incomingShares);
const activityLogs = computed(() => crossOrgStore.auditLogs);

const isAdmin = computed(() => currentWorkspace.value?.orgRole === 'admin');

const inviteOrgForm = ref({ orgId: '', orgName: '', role: 'member' });
const shareForm = ref({ resourceType: 'knowledge', resourceId: '', resourceName: '', permissions: ['read'] });

const memberColumns = [
  { title: '成员', dataIndex: 'memberName', key: 'name' },
  { title: '组织', dataIndex: 'memberOrgId', key: 'org' },
  { title: '角色', dataIndex: 'role', key: 'role' },
  { title: '权限', key: 'permissions' },
  { title: '操作', key: 'action' },
];

const resourceColumns = [
  { title: '名称', dataIndex: 'resourceName', key: 'name' },
  { title: '类型', dataIndex: 'resourceType', key: 'type' },
  { title: '来源', dataIndex: 'sourceOrgId', key: 'source' },
  { title: '权限', key: 'permissions' },
  { title: '操作', key: 'action' },
];

const formatTime = (timestamp) => dayjs(timestamp).format('YYYY-MM-DD HH:mm');
const goBack = () => router.push('/crossorg/workspaces');

const handleInviteOrg = async () => {
  if (!inviteOrgForm.value.orgId) {
    message.warning('请输入组织ID');
    return;
  }
  inviting.value = true;
  try {
    await crossOrgStore.inviteOrgToWorkspace(workspaceId.value, inviteOrgForm.value, authStore.currentUser?.did);
    message.success('邀请已发送');
    showInviteOrg.value = false;
  } catch (error) {
    message.error('邀请失败');
  } finally {
    inviting.value = false;
  }
};

const handleShareResource = async () => {
  if (!shareForm.value.resourceId) {
    message.warning('请输入资源ID');
    return;
  }
  sharing.value = true;
  try {
    await crossOrgStore.shareResource({
      ...shareForm.value,
      sourceOrgId: authStore.currentOrg?.id,
      targetWorkspaceId: workspaceId.value,
      sharedByDid: authStore.currentUser?.did,
    });
    message.success('资源已共享');
    showShareResource.value = false;
  } catch (error) {
    message.error('共享失败');
  } finally {
    sharing.value = false;
  }
};

const removeMember = async (memberDid) => {
  // 移除成员
};

const accessResource = (resource) => {
  // 访问资源
};

const unshareResource = async (shareId) => {
  try {
    await crossOrgStore.unshareResource(shareId, authStore.currentUser?.did);
    message.success('已取消共享');
  } catch (error) {
    message.error('操作失败');
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await crossOrgStore.loadWorkspaceMembers(workspaceId.value);
    await crossOrgStore.loadSharedResources(authStore.currentOrg?.id, { workspaceId: workspaceId.value });
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.shared-workspace-detail-page {
  padding: 0 24px 24px;
}
</style>
