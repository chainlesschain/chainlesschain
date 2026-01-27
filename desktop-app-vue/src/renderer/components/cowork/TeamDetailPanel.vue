<template>
  <div class="team-detail-panel">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载团队详情..." />
    </div>

    <!-- 团队详情 -->
    <div v-else>
      <!-- 基本信息 -->
      <a-descriptions
        title="基本信息"
        :column="1"
        bordered
        class="info-section"
      >
        <a-descriptions-item label="团队 ID">
          <a-typography-text copyable>{{ team.id }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="团队名称">
          {{ team.name }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="getStatusColor(team.status)">
            {{ getStatusText(team.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="描述">
          {{ team.description || "-" }}
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatDateTime(team.createdAt) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="team.completedAt" label="完成时间">
          {{ formatDateTime(team.completedAt) }}
        </a-descriptions-item>
      </a-descriptions>

      <!-- 配置信息 -->
      <a-descriptions
        title="配置"
        :column="2"
        bordered
        class="info-section"
      >
        <a-descriptions-item label="最大成员数">
          {{ team.config?.maxAgents || team.maxAgents || 5 }}
        </a-descriptions-item>
        <a-descriptions-item label="允许动态加入">
          <a-tag :color="team.config?.allowDynamicJoin ? 'green' : 'default'">
            {{ team.config?.allowDynamicJoin ? "是" : "否" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="自动分配任务">
          <a-tag :color="team.config?.autoAssignTasks ? 'green' : 'default'">
            {{ team.config?.autoAssignTasks ? "是" : "否" }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="共识阈值">
          {{ ((team.config?.consensusThreshold || 0.75) * 100).toFixed(0) }}%
        </a-descriptions-item>
      </a-descriptions>

      <!-- 成员列表 -->
      <div class="info-section">
        <h3 class="section-title">
          <UserOutlined />
          团队成员
          <a-button
            type="link"
            size="small"
            @click="loadMembers"
            :loading="loadingMembers"
          >
            <ReloadOutlined />
            刷新
          </a-button>
        </h3>

        <a-table
          :columns="memberColumns"
          :data-source="members"
          :loading="loadingMembers"
          :pagination="false"
          size="small"
          row-key="agentId"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'agentId'">
              <a-typography-text copyable>{{ record.agentId }}</a-typography-text>
            </template>

            <template v-else-if="column.key === 'role'">
              <a-tag :color="record.role === 'leader' ? 'blue' : 'default'">
                {{ getRoleText(record.role) }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'status'">
              <a-tag :color="record.status === 'active' ? 'green' : 'default'">
                {{ record.status === 'active' ? '在线' : '离线' }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'skills'">
              <a-tag v-for="skill in record.skills" :key="skill" color="geekblue">
                {{ skill }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'currentLoad'">
              <a-progress
                :percent="(record.currentLoad || 0) * 100"
                :status="record.currentLoad >= 0.9 ? 'exception' : 'normal'"
                size="small"
                :show-info="false"
              />
              <span style="margin-left: 8px">
                {{ ((record.currentLoad || 0) * 100).toFixed(0) }}%
              </span>
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space>
                <a-button
                  type="link"
                  size="small"
                  danger
                  @click="handleTerminateAgent(record)"
                >
                  移除
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>

        <a-empty v-if="!loadingMembers && members.length === 0" description="暂无成员" style="margin: 20px 0;" />

        <a-button
          type="dashed"
          block
          style="margin-top: 16px"
          @click="showAddMemberModal"
        >
          <PlusOutlined />
          添加成员
        </a-button>
      </div>

      <!-- 任务列表 -->
      <div class="info-section">
        <h3 class="section-title">
          <UnorderedListOutlined />
          团队任务
        </h3>

        <a-list
          :data-source="team.tasks || []"
          :loading="loading"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  {{ item.name }}
                  <a-tag
                    :color="getTaskStatusColor(item.status)"
                    style="margin-left: 8px"
                  >
                    {{ getTaskStatusText(item.status) }}
                  </a-tag>
                </template>
                <template #description>
                  分配给: {{ item.assignedTo || "未分配" }}
                  <a-divider type="vertical" />
                  进度: {{ item.progress || 0 }}%
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <a-empty
          v-if="!loading && (!team.tasks || team.tasks.length === 0)"
          description="暂无任务"
          style="margin: 20px 0;"
        />
      </div>

      <!-- 操作按钮 -->
      <div class="actions-section">
        <a-space>
          <a-button @click="emit('refresh')">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button type="primary" @click="showCreateCheckpointModal">
            <SaveOutlined />
            创建检查点
          </a-button>
          <a-button danger @click="handleDestroyTeam">
            <DeleteOutlined />
            销毁团队
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 添加成员模态框 -->
    <a-modal
      v-model:open="addMemberModalVisible"
      title="添加成员"
      :confirm-loading="addingMember"
      @ok="confirmAddMember"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="代理 ID" required>
          <a-input
            v-model:value="memberForm.agentId"
            placeholder="输入代理 ID"
          />
        </a-form-item>
        <a-form-item label="技能">
          <a-select
            v-model:value="memberForm.skills"
            mode="tags"
            placeholder="选择或输入技能"
            style="width: 100%"
          >
            <a-select-option value="coding">编程</a-select-option>
            <a-select-option value="testing">测试</a-select-option>
            <a-select-option value="design">设计</a-select-option>
            <a-select-option value="documentation">文档</a-select-option>
            <a-select-option value="data-analysis">数据分析</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="最大任务数">
          <a-input-number
            v-model:value="memberForm.maxTasks"
            :min="1"
            :max="10"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  UserOutlined,
  UnorderedListOutlined,
  ReloadOutlined,
  PlusOutlined,
  SaveOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import { format } from "date-fns";
import { useCoworkStore } from "../../stores/cowork";
import { h } from "vue";
import { logger, createLogger } from '@/utils/logger';

const teamLogger = createLogger('team-detail');
const store = useCoworkStore();

// Props
const props = defineProps({
  team: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(["refresh", "close"]);

// 状态
const loading = ref(false);
const loadingMembers = ref(false);
const addMemberModalVisible = ref(false);
const addingMember = ref(false);
const members = ref([]);

// 成员表单
const memberForm = ref({
  agentId: "",
  skills: [],
  maxTasks: 3,
});

// 表格列定义
const memberColumns = [
  {
    title: "代理 ID",
    dataIndex: "agentId",
    key: "agentId",
    width: 150,
  },
  {
    title: "角色",
    dataIndex: "role",
    key: "role",
    width: 100,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 100,
  },
  {
    title: "技能",
    dataIndex: "skills",
    key: "skills",
  },
  {
    title: "负载",
    dataIndex: "currentLoad",
    key: "currentLoad",
    width: 150,
  },
  {
    title: "操作",
    key: "actions",
    width: 100,
  },
];

// ==========================================
// 生命周期
// ==========================================

onMounted(async () => {
  await loadMembers();
});

// ==========================================
// 数据加载
// ==========================================

async function loadMembers() {
  loadingMembers.value = true;

  try {
    const result = await store.listTeamMembers(props.team.id);

    if (result.success) {
      members.value = result.members || [];
    }
  } catch (error) {
    teamLogger.error("加载成员列表失败:", error);
    message.error("加载成员列表失败");
  } finally {
    loadingMembers.value = false;
  }
}

// ==========================================
// 成员管理
// ==========================================

function showAddMemberModal() {
  addMemberModalVisible.value = true;

  // 重置表单
  memberForm.value = {
    agentId: "",
    skills: [],
    maxTasks: 3,
  };
}

async function confirmAddMember() {
  if (!memberForm.value.agentId.trim()) {
    message.error("请输入代理 ID");
    return;
  }

  addingMember.value = true;

  try {
    const agentInfo = {
      skills: memberForm.value.skills,
      maxTasks: memberForm.value.maxTasks,
    };

    const result = await store.requestJoinTeam(
      props.team.id,
      memberForm.value.agentId.trim(),
      agentInfo,
    );

    if (result.success) {
      message.success("添加成员成功");
      addMemberModalVisible.value = false;

      // 刷新成员列表
      await loadMembers();
    } else {
      message.error(result.error || "添加成员失败");
    }
  } catch (error) {
    teamLogger.error("添加成员失败:", error);
    message.error("添加成员失败: " + error.message);
  } finally {
    addingMember.value = false;
  }
}

async function handleTerminateAgent(member) {
  Modal.confirm({
    title: "确认移除成员",
    content: `确定要移除成员 "${member.agentId}" 吗？`,
    icon: h(ExclamationCircleOutlined),
    okText: "确认",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.terminateAgent(
          props.team.id,
          member.agentId,
          "用户主动移除",
        );

        if (result.success) {
          message.success("移除成员成功");

          // 刷新成员列表
          await loadMembers();
        } else {
          message.error(result.error || "移除成员失败");
        }
      } catch (error) {
        teamLogger.error("移除成员失败:", error);
        message.error("移除成员失败: " + error.message);
      }
    },
  });
}

// ==========================================
// 团队操作
// ==========================================

function showCreateCheckpointModal() {
  message.info("创建检查点功能即将上线");
}

function handleDestroyTeam() {
  Modal.confirm({
    title: "确认销毁团队",
    content: `确定要销毁团队 "${props.team.name}" 吗？此操作不可撤销。`,
    icon: h(ExclamationCircleOutlined),
    okText: "确认",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.destroyTeam(props.team.id, "用户主动销毁");

        if (result.success) {
          message.success("团队已销毁");
          emit("close");
        } else {
          message.error(result.error || "销毁团队失败");
        }
      } catch (error) {
        teamLogger.error("销毁团队失败:", error);
        message.error("销毁团队失败: " + error.message);
      }
    },
  });
}

// ==========================================
// 辅助函数
// ==========================================

function getStatusColor(status) {
  const colors = {
    active: "green",
    paused: "orange",
    completed: "blue",
    failed: "red",
    destroyed: "default",
  };
  return colors[status] || "default";
}

function getStatusText(status) {
  const texts = {
    active: "活跃",
    paused: "暂停",
    completed: "已完成",
    failed: "失败",
    destroyed: "已销毁",
  };
  return texts[status] || status;
}

function getRoleText(role) {
  const texts = {
    leader: "领导者",
    member: "成员",
  };
  return texts[role] || role;
}

function getTaskStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colors[status] || "default";
}

function getTaskStatusText(status) {
  const texts = {
    pending: "待处理",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return texts[status] || status;
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";

  try {
    return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
  } catch (error) {
    return "-";
  }
}
</script>

<style scoped lang="scss">
.team-detail-panel {
  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 60px 0;
  }

  .info-section {
    margin-bottom: 24px;

    :deep(.ant-descriptions-title) {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 16px;
    }
  }

  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;

    :deep(.anticon) {
      color: #1890ff;
    }

    :deep(.ant-btn) {
      margin-left: auto;
    }
  }

  .actions-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
  }
}
</style>
