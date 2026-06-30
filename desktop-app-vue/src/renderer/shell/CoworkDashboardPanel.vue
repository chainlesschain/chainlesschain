<template>
  <a-modal
    :open="open"
    :width="1040"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="Cowork 多代理协作"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <TeamOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="cd-toolbar">
      <span class="cd-subtitle">管理多代理团队、分配任务、监控进度</span>
      <a-space>
        <a-button size="small" :loading="isLoading" @click="handleRefresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="showCreateTeamModal">
          <template #icon><PlusOutlined /></template>
          创建团队
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16" class="stats-section">
      <a-col :xs="12" :sm="6">
        <a-card size="small" :loading="loading.stats">
          <a-statistic
            title="总团队数"
            :value="globalStats.totalTeams"
            :prefix="h(TeamOutlined)"
            :value-style="{ color: '#1890ff' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card size="small" :loading="loading.stats">
          <a-statistic
            title="活跃团队"
            :value="globalStats.activeTeams"
            :prefix="h(RocketOutlined)"
            :value-style="{ color: '#52c41a' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card size="small" :loading="loading.stats">
          <a-statistic
            title="运行中任务"
            :value="globalStats.runningTasks"
            :prefix="h(SyncOutlined, { spin: true })"
            :value-style="{ color: '#faad14' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card size="small" :loading="loading.stats">
          <a-statistic
            title="任务成功率"
            :value="globalStats.successRate"
            suffix="%"
            :precision="1"
            :prefix="h(CheckCircleOutlined)"
            :value-style="{
              color: globalStats.successRate >= 80 ? '#52c41a' : '#faad14',
            }"
          />
        </a-card>
      </a-col>
    </a-row>

    <a-card title="快速操作" size="small" class="quick-actions-card">
      <a-space :size="12" wrap>
        <a-button size="small" @click="goTo('/cowork/tasks')">
          <template #icon><UnorderedListOutlined /></template>
          查看所有任务
        </a-button>
        <a-button size="small" @click="goTo('/cowork/skills')">
          <template #icon><ToolOutlined /></template>
          技能管理
        </a-button>
        <a-button size="small" @click="showCreateTeamModal">
          <template #icon><PlusOutlined /></template>
          创建新团队
        </a-button>
      </a-space>
    </a-card>

    <a-card
      title="我的团队"
      size="small"
      :bordered="false"
      class="teams-section"
    >
      <div class="filters-bar">
        <a-space>
          <a-input-search
            v-model:value="searchQuery"
            placeholder="搜索团队..."
            style="width: 260px"
            allow-clear
          />
          <a-select
            v-model:value="statusFilter"
            placeholder="筛选状态"
            style="width: 150px"
            allow-clear
          >
            <a-select-option value="active">活跃</a-select-option>
            <a-select-option value="paused">暂停</a-select-option>
            <a-select-option value="completed">已完成</a-select-option>
            <a-select-option value="failed">失败</a-select-option>
          </a-select>
        </a-space>
      </div>

      <div v-if="filteredTeams.length > 0" class="teams-grid">
        <a-row :gutter="[16, 16]">
          <a-col
            v-for="team in filteredTeams"
            :key="team.id"
            :xs="24"
            :sm="12"
            :md="8"
          >
            <TeamCard
              :team="team"
              @view-detail="handleViewTeamDetail"
              @destroy="handleDestroyTeam"
              @pause="handlePauseTeam"
              @resume="handleResumeTeam"
            />
          </a-col>
        </a-row>
      </div>

      <a-empty
        v-else-if="!loading.teams"
        description="暂无团队"
        style="margin-top: 40px"
      >
        <a-button type="primary" @click="showCreateTeamModal">
          立即创建
        </a-button>
      </a-empty>

      <div v-if="loading.teams" class="loading-container">
        <a-spin size="large" tip="加载团队列表..." />
      </div>
    </a-card>

    <a-modal
      v-model:open="createTeamModalVisible"
      title="创建新团队"
      :confirm-loading="creatingTeam"
      width="600px"
      @ok="confirmCreateTeam"
    >
      <a-form
        :model="teamForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="团队名称" required>
          <a-input
            v-model:value="teamForm.name"
            placeholder="输入团队名称"
            :maxlength="50"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="teamForm.description"
            placeholder="输入团队描述（可选）"
            :rows="3"
            :maxlength="200"
          />
        </a-form-item>
        <a-form-item label="最大成员数">
          <a-input-number
            v-model:value="teamForm.maxAgents"
            :min="1"
            :max="20"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="允许动态加入">
          <a-switch v-model:checked="teamForm.allowDynamicJoin" />
          <div class="form-item-hint">允许代理在团队运行时动态加入</div>
        </a-form-item>
        <a-form-item label="自动分配任务">
          <a-switch v-model:checked="teamForm.autoAssignTasks" />
          <div class="form-item-hint">根据代理能力自动分配任务</div>
        </a-form-item>
        <a-form-item label="共识阈值">
          <a-slider
            v-model:value="teamForm.consensusThreshold"
            :min="0.5"
            :max="1.0"
            :step="0.1"
            :marks="{ 0.5: '50%', 0.75: '75%', 1.0: '100%' }"
          />
          <div class="form-item-hint">投票决策时需要的最低同意比例</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-drawer
      v-model:open="teamDetailDrawerVisible"
      title="团队详情"
      placement="right"
      :width="760"
      :destroy-on-close="true"
    >
      <TeamDetailPanel
        v-if="currentTeam"
        :team="currentTeam"
        @refresh="handleRefreshTeamDetail"
        @close="teamDetailDrawerVisible = false"
      />
    </a-drawer>
  </a-modal>
</template>

<script setup>
import { h, ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  TeamOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  UnorderedListOutlined,
  ToolOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import { useCoworkStore } from "../stores/cowork";
import TeamCard from "../components/cowork/TeamCard.vue";
import TeamDetailPanel from "../components/cowork/TeamDetailPanel.vue";
import { createLogger } from "@/utils/logger";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
const emit = defineEmits(["update:open"]);

const coworkLogger = createLogger("cowork-dashboard-panel");
const router = useRouter();
const store = useCoworkStore();

const createTeamModalVisible = ref(false);
const teamDetailDrawerVisible = ref(false);
const creatingTeam = ref(false);
const searchQuery = ref("");
const statusFilter = ref(null);

const teamForm = ref({
  name: "",
  description: "",
  maxAgents: 5,
  allowDynamicJoin: true,
  autoAssignTasks: true,
  consensusThreshold: 0.75,
});

const loading = computed(() => store.loading);
const globalStats = computed(() => store.globalStats);
const currentTeam = computed(() => store.currentTeam);
const filteredTeams = computed(() => store.filteredTeams);
const isLoading = computed(() => store.isLoading);

// Listeners are bound once for the panel's lifetime (it mounts once in AppShell).
onMounted(() => {
  store.initEventListeners();
});

onUnmounted(() => {
  store.cleanupEventListeners();
});

async function loadInitialData() {
  try {
    await Promise.all([store.loadTeams(), store.loadStats()]);
  } catch (error) {
    coworkLogger.error("初始数据加载失败:", error);
    message.error("数据加载失败，请重试");
  }
}

async function handleRefresh() {
  await loadInitialData();
  message.success("刷新成功");
}

function goTo(path) {
  emit("update:open", false);
  router.push(path);
}

function showCreateTeamModal() {
  createTeamModalVisible.value = true;
  teamForm.value = {
    name: "",
    description: "",
    maxAgents: 5,
    allowDynamicJoin: true,
    autoAssignTasks: true,
    consensusThreshold: 0.75,
  };
}

async function confirmCreateTeam() {
  if (!teamForm.value.name.trim()) {
    message.error("请输入团队名称");
    return;
  }
  creatingTeam.value = true;
  try {
    const config = {
      maxAgents: teamForm.value.maxAgents,
      allowDynamicJoin: teamForm.value.allowDynamicJoin,
      autoAssignTasks: teamForm.value.autoAssignTasks,
      consensusThreshold: teamForm.value.consensusThreshold,
    };
    if (teamForm.value.description.trim()) {
      config.description = teamForm.value.description.trim();
    }
    const result = await store.createTeam(teamForm.value.name.trim(), config);
    if (result.success) {
      message.success(`团队 "${teamForm.value.name}" 创建成功`);
      createTeamModalVisible.value = false;
      handleViewTeamDetail(result.team);
    } else {
      message.error(result.error || "创建团队失败");
    }
  } catch (error) {
    coworkLogger.error("创建团队失败:", error);
    message.error("创建团队失败: " + error.message);
  } finally {
    creatingTeam.value = false;
  }
}

async function handleViewTeamDetail(team) {
  try {
    await store.loadTeamDetail(team.id);
    teamDetailDrawerVisible.value = true;
  } catch (error) {
    coworkLogger.error("加载团队详情失败:", error);
    message.error("加载团队详情失败");
  }
}

async function handleRefreshTeamDetail() {
  if (!currentTeam.value) {
    return;
  }
  try {
    await store.loadTeamDetail(currentTeam.value.id);
    message.success("团队详情已刷新");
  } catch (error) {
    coworkLogger.error("刷新团队详情失败:", error);
    message.error("刷新失败");
  }
}

async function handleDestroyTeam(team) {
  Modal.confirm({
    title: "确认销毁团队",
    content: `确定要销毁团队 "${team.name}" 吗？此操作不可撤销。`,
    icon: h(ExclamationCircleOutlined),
    okText: "确认",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.destroyTeam(team.id, "用户主动销毁");
        if (result.success) {
          message.success(`团队 "${team.name}" 已销毁`);
          if (currentTeam.value && currentTeam.value.id === team.id) {
            teamDetailDrawerVisible.value = false;
          }
        } else {
          message.error(result.error || "销毁团队失败");
        }
      } catch (error) {
        coworkLogger.error("销毁团队失败:", error);
        message.error("销毁团队失败: " + error.message);
      }
    },
  });
}

async function handlePauseTeam(team) {
  try {
    const result = await window.electronAPI.invoke("cowork:pause-team", {
      teamId: team.id,
    });
    if (result.success) {
      team.status = "paused";
      message.success("团队已暂停");
      await store.loadTeams();
    } else {
      message.error(result.error || "暂停团队失败");
    }
  } catch (error) {
    coworkLogger.error("暂停团队失败:", error);
    message.error("暂停团队失败: " + error.message);
  }
}

async function handleResumeTeam(team) {
  try {
    const result = await window.electronAPI.invoke("cowork:resume-team", {
      teamId: team.id,
    });
    if (result.success) {
      team.status = "active";
      message.success("团队已恢复");
      await store.loadTeams();
    } else {
      message.error(result.error || "恢复团队失败");
    }
  } catch (error) {
    coworkLogger.error("恢复团队失败:", error);
    message.error("恢复团队失败: " + error.message);
  }
}

watch(searchQuery, (newValue) => {
  store.setTeamFilters({ searchQuery: newValue });
});

watch(statusFilter, (newValue) => {
  store.setTeamFilters({ status: newValue });
});

// Load teams + stats whenever the panel opens.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    loadInitialData();
  },
  { immediate: true },
);
</script>

<style scoped lang="scss">
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

.cd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;

  .cd-subtitle {
    color: rgba(0, 0, 0, 0.45);
    font-size: 13px;
  }
}

.stats-section {
  margin-bottom: 16px;
}

.quick-actions-card {
  margin-bottom: 16px;
}

.teams-section {
  .filters-bar {
    margin-bottom: 16px;
  }

  .teams-grid {
    min-height: 160px;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 50px 0;
  }
}

.form-item-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #8c8c8c;
}
</style>
