<template>
  <a-modal
    :open="open"
    :width="1080"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="审批中心"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <AuditOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="!orgId"
      type="info"
      show-icon
      message="请先选择组织"
      description="审批中心按组织维度工作，请先在组织管理中选择或加入一个组织。"
    />

    <template v-else>
      <div class="ac-toolbar">
        <span class="ac-subtitle">管理审批工作流和待审批请求</span>
        <a-space>
          <a-button size="small" :loading="loadingAny" @click="loadAll">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button
            type="primary"
            size="small"
            @click="showCreateWorkflow = true"
          >
            <template #icon><PlusOutlined /></template>
            创建工作流
          </a-button>
        </a-space>
      </div>

      <a-row :gutter="16">
        <a-col :span="15">
          <a-card title="待审批请求" size="small">
            <template #extra>
              <a-badge :count="pendingCount" :offset="[10, 0]">
                <a-tag color="orange">待处理</a-tag>
              </a-badge>
            </template>

            <a-spin :spinning="permissionStore.loading.approvals">
              <a-list
                :data-source="pendingApprovals"
                :pagination="{ pageSize: 5 }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta
                      :title="`${item.requesterName || item.requesterDid || '未知'} 的 ${item.action} 请求`"
                      :description="`工作流: ${item.workflowName} | 步骤 ${item.currentStep + 1}/${item.totalSteps} | 资源: ${item.resourceType} - ${item.resourceId} | ${formatTime(item.createdAt)}`"
                    >
                      <template #avatar>
                        <a-avatar>
                          {{ (item.requesterName || "?").charAt(0) }}
                        </a-avatar>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-button
                        type="primary"
                        size="small"
                        @click="approveRequest(item.id)"
                      >
                        批准
                      </a-button>
                      <a-button
                        danger
                        size="small"
                        @click="showRejectModal(item)"
                      >
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

          <a-card title="审批历史" size="small" style="margin-top: 12px">
            <a-table
              :columns="historyColumns"
              :data-source="approvalHistory"
              :loading="permissionStore.loading.approvals"
              :pagination="{ pageSize: 5 }"
              size="small"
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

        <a-col :span="9">
          <a-card title="审批工作流" size="small">
            <a-list
              :data-source="workflows"
              :loading="permissionStore.loading.workflows"
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
                  </template>
                </a-list-item>
              </template>
              <template #empty>
                <a-empty description="暂无工作流" />
              </template>
            </a-list>
          </a-card>
        </a-col>
      </a-row>
    </template>

    <!-- 拒绝原因对话框 -->
    <a-modal
      v-model:open="showReject"
      title="拒绝申请"
      :confirm-loading="rejecting"
      @ok="handleReject"
    >
      <a-form layout="vertical">
        <a-form-item label="拒绝原因">
          <a-textarea
            v-model:value="rejectReason"
            :rows="4"
            placeholder="请说明拒绝原因..."
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 创建工作流对话框 -->
    <a-modal
      v-model:open="showCreateWorkflow"
      title="创建审批工作流"
      :confirm-loading="creatingWorkflow"
      width="600px"
      @ok="handleCreateWorkflow"
    >
      <a-form :model="newWorkflow" layout="vertical">
        <a-form-item label="工作流名称" required>
          <a-input
            v-model:value="newWorkflow.name"
            placeholder="输入工作流名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="newWorkflow.description"
            placeholder="工作流描述"
          />
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
          <a-input-number
            v-model:value="newWorkflow.timeoutHours"
            :min="1"
            :max="720"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  AuditOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { usePermissionStore } from "@/stores/permission";
import { useIdentityStore } from "@/stores/identity";
import dayjs from "dayjs";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
defineEmits(["update:open"]);

const permissionStore = usePermissionStore();
const identityStore = useIdentityStore();

const orgId = computed(() => identityStore.currentOrgId);
const userDID = computed(() => identityStore.currentDID);

const rejecting = ref(false);
const creatingWorkflow = ref(false);
const showReject = ref(false);
const showCreateWorkflow = ref(false);
const rejectReason = ref("");
const selectedRequest = ref(null);

const pendingApprovals = computed(() => permissionStore.pendingApprovals);
const approvalHistory = computed(() => permissionStore.approvalHistory);
const workflows = computed(() => permissionStore.workflows);
const pendingCount = computed(() => permissionStore.pendingApprovalCount);
const loadingAny = computed(
  () => permissionStore.loading.approvals || permissionStore.loading.workflows,
);

const newWorkflow = ref({
  name: "",
  description: "",
  triggerResourceType: "permission",
  triggerAction: "grant",
  approvalType: "sequential",
  approversText: "",
  timeoutHours: 72,
});

const historyColumns = [
  { title: "申请人", dataIndex: "requesterName", key: "requester" },
  { title: "工作流", dataIndex: "workflowName", key: "workflow" },
  { title: "状态", key: "status" },
  {
    title: "提交时间",
    dataIndex: "createdAt",
    key: "createdAt",
    customRender: ({ text }) => formatTime(text),
  },
];

const formatTime = (timestamp) => dayjs(timestamp).format("YYYY-MM-DD HH:mm");

const getStatusColor = (status) => {
  const colors = {
    approved: "green",
    rejected: "red",
    pending: "orange",
    expired: "gray",
  };
  return colors[status] || "default";
};

const getStatusLabel = (status) => {
  const labels = {
    approved: "已批准",
    rejected: "已拒绝",
    pending: "待审批",
    expired: "已过期",
  };
  return labels[status] || status;
};

async function loadAll() {
  if (!orgId.value) {
    return;
  }
  try {
    await Promise.all([
      permissionStore.loadPendingApprovals(userDID.value, orgId.value),
      permissionStore.loadApprovalHistory(orgId.value, { limit: 50 }),
      permissionStore.loadWorkflows(orgId.value),
    ]);
  } catch (_error) {
    message.error("加载失败");
  }
}

async function approveRequest(requestId) {
  try {
    await permissionStore.approveRequest(requestId, userDID.value);
    message.success("已批准");
  } catch (_error) {
    message.error("操作失败");
  }
}

function showRejectModal(request) {
  selectedRequest.value = request;
  rejectReason.value = "";
  showReject.value = true;
}

async function handleReject() {
  if (!rejectReason.value) {
    message.warning("请填写拒绝原因");
    return;
  }

  rejecting.value = true;
  try {
    await permissionStore.rejectRequest(
      selectedRequest.value.id,
      userDID.value,
      rejectReason.value,
    );
    message.success("已拒绝");
    showReject.value = false;
  } catch (_error) {
    message.error("操作失败");
  } finally {
    rejecting.value = false;
  }
}

async function toggleWorkflow(workflowId, enabled) {
  try {
    await permissionStore.updateWorkflow(workflowId, { enabled });
    message.success(enabled ? "已启用" : "已禁用");
  } catch (_error) {
    message.error("操作失败");
  }
}

async function handleCreateWorkflow() {
  if (!newWorkflow.value.name) {
    message.warning("请输入工作流名称");
    return;
  }

  creatingWorkflow.value = true;
  try {
    const approvers = newWorkflow.value.approversText
      .split("\n")
      .map((line) =>
        line
          .trim()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .filter((arr) => arr.length > 0);

    await permissionStore.createWorkflow({
      ...newWorkflow.value,
      orgId: orgId.value,
      approvers,
    });
    message.success("工作流创建成功");
    showCreateWorkflow.value = false;
  } catch (_error) {
    message.error("创建失败");
  } finally {
    creatingWorkflow.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadAll();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.ac-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ac-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
