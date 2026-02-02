<template>
  <div class="approval-center-page">
    <a-page-header title="审批中心" sub-title="管理审批工作流和待审批请求" @back="goBack">
      <template #extra>
        <a-button @click="showCreateWorkflow = true">
          <template #icon><PlusOutlined /></template>
          创建工作流
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="24">
      <!-- 待审批请求 -->
      <a-col :span="16">
        <a-card title="待审批请求">
          <template #extra>
            <a-badge :count="pendingCount" :offset="[10, 0]">
              <a-tag color="orange">待处理</a-tag>
            </a-badge>
          </template>

          <a-spin :spinning="loadingApprovals">
            <a-list
              :data-source="pendingApprovals"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta
                    :title="`${item.requesterName} 的 ${item.action} 请求`"
                    :description="`工作流: ${item.workflowName} | 步骤 ${item.currentStep + 1}/${item.totalSteps}`"
                  >
                    <template #avatar>
                      <a-avatar>{{ item.requesterName?.charAt(0) }}</a-avatar>
                    </template>
                  </a-list-item-meta>
                  <div class="request-info">
                    <p><strong>资源：</strong>{{ item.resourceType }} - {{ item.resourceId }}</p>
                    <p><strong>提交时间：</strong>{{ formatTime(item.createdAt) }}</p>
                  </div>
                  <template #actions>
                    <a-button type="primary" size="small" @click="approveRequest(item.id)">
                      批准
                    </a-button>
                    <a-button danger size="small" @click="showRejectModal(item)">
                      拒绝
                    </a-button>
                  </template>
                </a-list-item>
              </template>
              <template #empty>
                <a-empty description="暂无待审批请求" />
              </template>
            </a-list>
          </a-spin>
        </a-card>

        <!-- 审批历史 -->
        <a-card title="审批历史" style="margin-top: 16px">
          <a-table
            :columns="historyColumns"
            :data-source="approvalHistory"
            :loading="loadingHistory"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <a-tag :color="getStatusColor(record.status)">
                  {{ getStatusLabel(record.status) }}
                </a-tag>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>

      <!-- 工作流管理 -->
      <a-col :span="8">
        <a-card title="审批工作流">
          <a-list
            :data-source="workflows"
            :loading="loadingWorkflows"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.name"
                  :description="item.description"
                />
                <template #actions>
                  <a-switch
                    :checked="item.enabled"
                    size="small"
                    @change="(checked) => toggleWorkflow(item.id, checked)"
                  />
                  <a-button type="link" size="small" @click="editWorkflow(item)">
                    编辑
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>
    </a-row>

    <!-- 拒绝原因对话框 -->
    <a-modal
      v-model:open="showReject"
      title="拒绝申请"
      @ok="handleReject"
      :confirm-loading="rejecting"
    >
      <a-form layout="vertical">
        <a-form-item label="拒绝原因">
          <a-textarea v-model:value="rejectReason" :rows="4" placeholder="请说明拒绝原因..." />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 创建工作流对话框 -->
    <a-modal
      v-model:open="showCreateWorkflow"
      title="创建审批工作流"
      @ok="handleCreateWorkflow"
      :confirm-loading="creatingWorkflow"
      width="600px"
    >
      <a-form :model="newWorkflow" layout="vertical">
        <a-form-item label="工作流名称" required>
          <a-input v-model:value="newWorkflow.name" placeholder="输入工作流名称" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="newWorkflow.description" placeholder="工作流描述" />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="触发资源类型">
              <a-select v-model:value="newWorkflow.triggerResourceType">
                <a-select-option value="permission">权限</a-select-option>
                <a-select-option value="knowledge">知识库</a-select-option>
                <a-select-option value="project">项目</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="触发操作">
              <a-select v-model:value="newWorkflow.triggerAction">
                <a-select-option value="grant">授权</a-select-option>
                <a-select-option value="delete">删除</a-select-option>
                <a-select-option value="publish">发布</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="审批类型">
          <a-radio-group v-model:value="newWorkflow.approvalType">
            <a-radio value="sequential">顺序审批</a-radio>
            <a-radio value="parallel">并行审批</a-radio>
            <a-radio value="any_one">任一审批</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="审批人（按步骤）">
          <a-textarea
            v-model:value="newWorkflow.approversText"
            placeholder="每行一个步骤，多个审批人用逗号分隔"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="超时时间（小时）">
          <a-input-number v-model:value="newWorkflow.timeoutHours" :min="1" :max="720" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import { usePermissionStore } from '@/stores/permission';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const route = useRoute();
const router = useRouter();
const permissionStore = usePermissionStore();
const authStore = useAuthStore();

const orgId = computed(() => route.params.orgId);
const loadingApprovals = ref(false);
const loadingHistory = ref(false);
const loadingWorkflows = ref(false);
const rejecting = ref(false);
const creatingWorkflow = ref(false);
const showReject = ref(false);
const showCreateWorkflow = ref(false);
const rejectReason = ref('');
const selectedRequest = ref(null);

const pendingApprovals = computed(() => permissionStore.pendingApprovals);
const approvalHistory = computed(() => permissionStore.approvalHistory);
const workflows = computed(() => permissionStore.workflows);
const pendingCount = computed(() => permissionStore.pendingApprovalCount);

const newWorkflow = ref({
  name: '',
  description: '',
  triggerResourceType: 'permission',
  triggerAction: 'grant',
  approvalType: 'sequential',
  approversText: '',
  timeoutHours: 72,
});

const historyColumns = [
  { title: '申请人', dataIndex: 'requesterName', key: 'requester' },
  { title: '工作流', dataIndex: 'workflowName', key: 'workflow' },
  { title: '状态', key: 'status' },
  { title: '提交时间', dataIndex: 'createdAt', key: 'createdAt', customRender: ({ text }) => formatTime(text) },
];

const formatTime = (timestamp) => dayjs(timestamp).format('YYYY-MM-DD HH:mm');

const getStatusColor = (status) => {
  const colors = { approved: 'green', rejected: 'red', pending: 'orange', expired: 'gray' };
  return colors[status] || 'default';
};

const getStatusLabel = (status) => {
  const labels = { approved: '已批准', rejected: '已拒绝', pending: '待审批', expired: '已过期' };
  return labels[status] || status;
};

const goBack = () => router.back();

const approveRequest = async (requestId) => {
  try {
    await permissionStore.approveRequest(requestId, authStore.currentUser?.did);
    message.success('已批准');
  } catch (error) {
    message.error('操作失败');
  }
};

const showRejectModal = (request) => {
  selectedRequest.value = request;
  rejectReason.value = '';
  showReject.value = true;
};

const handleReject = async () => {
  if (!rejectReason.value) {
    message.warning('请填写拒绝原因');
    return;
  }

  rejecting.value = true;
  try {
    await permissionStore.rejectRequest(
      selectedRequest.value.id,
      authStore.currentUser?.did,
      rejectReason.value
    );
    message.success('已拒绝');
    showReject.value = false;
  } catch (error) {
    message.error('操作失败');
  } finally {
    rejecting.value = false;
  }
};

const toggleWorkflow = async (workflowId, enabled) => {
  try {
    await permissionStore.updateWorkflow(workflowId, { enabled });
    message.success(enabled ? '已启用' : '已禁用');
  } catch (error) {
    message.error('操作失败');
  }
};

const editWorkflow = (workflow) => {
  // 编辑工作流
};

const handleCreateWorkflow = async () => {
  if (!newWorkflow.value.name) {
    message.warning('请输入工作流名称');
    return;
  }

  creatingWorkflow.value = true;
  try {
    const approvers = newWorkflow.value.approversText
      .split('\n')
      .map((line) => line.trim().split(',').map((s) => s.trim()))
      .filter((arr) => arr.length > 0);

    await permissionStore.createWorkflow({
      ...newWorkflow.value,
      orgId: orgId.value,
      approvers,
    });
    message.success('工作流创建成功');
    showCreateWorkflow.value = false;
  } catch (error) {
    message.error('创建失败');
  } finally {
    creatingWorkflow.value = false;
  }
};

onMounted(async () => {
  loadingApprovals.value = true;
  loadingHistory.value = true;
  loadingWorkflows.value = true;

  try {
    await Promise.all([
      permissionStore.loadPendingApprovals(authStore.currentUser?.did, orgId.value),
      permissionStore.loadApprovalHistory(orgId.value, { limit: 20 }),
      permissionStore.loadWorkflows(orgId.value),
    ]);
  } catch (error) {
    message.error('加载失败');
  } finally {
    loadingApprovals.value = false;
    loadingHistory.value = false;
    loadingWorkflows.value = false;
  }
});
</script>

<style scoped>
.approval-center-page {
  padding: 0 24px 24px;
}

.request-info {
  margin: 0 16px;
}

.request-info p {
  margin: 4px 0;
  color: #666;
}
</style>
