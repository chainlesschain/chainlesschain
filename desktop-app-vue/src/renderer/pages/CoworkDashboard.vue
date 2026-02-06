<template>
  <div class="cowork-dashboard-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <TeamOutlined />
          Cowork 多代理协作
        </h1>
        <p class="page-description">
          管理多代理团队、分配任务、监控进度
        </p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button @click="handleRefresh" :loading="isLoading">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button type="primary" @click="showCreateTeamModal">
            <PlusOutlined />
            创建团队
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 全局统计卡片 -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="总团队数"
              :value="globalStats.totalTeams"
              :prefix="h(TeamOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="活跃团队"
              :value="globalStats.activeTeams"
              :prefix="h(RocketOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="运行中任务"
              :value="globalStats.runningTasks"
              :prefix="h(SyncOutlined, { spin: true })"
              :value-style="{ color: '#faad14' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="任务成功率"
              :value="globalStats.successRate"
              suffix="%"
              :precision="1"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{
                color: globalStats.successRate >= 80 ? '#52c41a' : '#faad14'
              }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 快速操作区 -->
    <a-card title="快速操作" class="quick-actions-card">
      <a-space :size="12" wrap>
        <a-button @click="$router.push('/cowork/tasks')">
          <UnorderedListOutlined />
          查看所有任务
        </a-button>
        <a-button @click="$router.push('/cowork/skills')">
          <ToolOutlined />
          技能管理
        </a-button>
        <a-button @click="showCreateTeamModal">
          <PlusOutlined />
          创建新团队
        </a-button>
      </a-space>
    </a-card>

    <!-- 团队列表 -->
    <div class="teams-section">
      <a-card title="我的团队" :bordered="false">
        <!-- 筛选和搜索 -->
        <div class="filters-bar">
          <a-space>
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索团队..."
              style="width: 300px"
              @search="handleSearch"
              allow-clear
            />
            <a-select
              v-model:value="statusFilter"
              placeholder="筛选状态"
              style="width: 150px"
              allow-clear
              @change="handleFilterChange"
            >
              <a-select-option value="active">活跃</a-select-option>
              <a-select-option value="paused">暂停</a-select-option>
              <a-select-option value="completed">已完成</a-select-option>
              <a-select-option value="failed">失败</a-select-option>
            </a-select>
          </a-space>
        </div>

        <!-- 团队卡片网格 -->
        <div v-if="filteredTeams.length > 0" class="teams-grid">
          <a-row :gutter="[16, 16]">
            <a-col
              v-for="team in filteredTeams"
              :key="team.id"
              :xs="24"
              :sm="12"
              :md="8"
              :lg="6"
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

        <!-- 空状态 -->
        <a-empty
          v-else-if="!loading.teams"
          description="暂无团队"
          style="margin-top: 40px"
        >
          <a-button type="primary" @click="showCreateTeamModal">
            立即创建
          </a-button>
        </a-empty>

        <!-- 加载状态 -->
        <div v-if="loading.teams" class="loading-container">
          <a-spin size="large" tip="加载团队列表..." />
        </div>
      </a-card>
    </div>

    <!-- 创建团队模态框 -->
    <a-modal
      v-model:open="createTeamModalVisible"
      title="创建新团队"
      :confirm-loading="creatingTeam"
      @ok="confirmCreateTeam"
      width="600px"
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
          <div class="form-item-hint">
            允许代理在团队运行时动态加入
          </div>
        </a-form-item>

        <a-form-item label="自动分配任务">
          <a-switch v-model:checked="teamForm.autoAssignTasks" />
          <div class="form-item-hint">
            根据代理能力自动分配任务
          </div>
        </a-form-item>

        <a-form-item label="共识阈值">
          <a-slider
            v-model:value="teamForm.consensusThreshold"
            :min="0.5"
            :max="1.0"
            :step="0.1"
            :marks="{ 0.5: '50%', 0.75: '75%', 1.0: '100%' }"
          />
          <div class="form-item-hint">
            投票决策时需要的最低同意比例
          </div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 团队详情抽屉 -->
    <a-drawer
      v-model:open="teamDetailDrawerVisible"
      title="团队详情"
      placement="right"
      :width="800"
      :destroy-on-close="true"
    >
      <TeamDetailPanel
        v-if="currentTeam"
        :team="currentTeam"
        @refresh="handleRefreshTeamDetail"
        @close="teamDetailDrawerVisible = false"
      />
    </a-drawer>
  </div>
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
import { logger, createLogger } from '@/utils/logger';

const coworkLogger = createLogger('cowork-dashboard');
const router = useRouter();

// Store
const store = useCoworkStore();

// 状态
const createTeamModalVisible = ref(false);
const teamDetailDrawerVisible = ref(false);
const creatingTeam = ref(false);
const searchQuery = ref("");
const statusFilter = ref(null);

// 团队表单
const teamForm = ref({
  name: "",
  description: "",
  maxAgents: 5,
  allowDynamicJoin: true,
  autoAssignTasks: true,
  consensusThreshold: 0.75,
});

// 从 Store 获取状态
const loading = computed(() => store.loading);
const globalStats = computed(() => store.globalStats);
const teams = computed(() => store.teams);
const currentTeam = computed(() => store.currentTeam);
const filteredTeams = computed(() => store.filteredTeams);
const isLoading = computed(() => store.isLoading);

// ==========================================
// 生命周期钩子
// ==========================================

onMounted(async () => {
  coworkLogger.info("CoworkDashboard 挂载");

  // 初始化事件监听
  store.initEventListeners();

  // 加载初始数据
  await loadInitialData();
});

onUnmounted(() => {
  coworkLogger.info("CoworkDashboard 卸载");

  // 清理事件监听
  store.cleanupEventListeners();
});

// ==========================================
// 数据加载
// ==========================================

async function loadInitialData() {
  try {
    // 并行加载团队列表和统计信息
    await Promise.all([
      store.loadTeams(),
      store.loadStats(),
    ]);

    coworkLogger.info("初始数据加载完成");
  } catch (error) {
    coworkLogger.error("初始数据加载失败:", error);
    message.error("数据加载失败，请刷新页面重试");
  }
}

async function handleRefresh() {
  coworkLogger.info("刷新数据");
  await loadInitialData();
  message.success("刷新成功");
}

// ==========================================
// 团队管理
// ==========================================

function showCreateTeamModal() {
  createTeamModalVisible.value = true;

  // 重置表单
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

      // 跳转到团队详情
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
  coworkLogger.info("查看团队详情:", team.id);

  try {
    await store.loadTeamDetail(team.id);
    teamDetailDrawerVisible.value = true;
  } catch (error) {
    coworkLogger.error("加载团队详情失败:", error);
    message.error("加载团队详情失败");
  }
}

async function handleRefreshTeamDetail() {
  if (!currentTeam.value) return;

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

          // 关闭详情抽屉（如果打开）
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
    coworkLogger.info("暂停团队:", team.id);
    const result = await window.electronAPI.invoke("cowork:pause-team", {
      teamId: team.id,
    });

    if (result.success) {
      // 更新本地状态
      team.status = "paused";
      message.success("团队已暂停");
      // 刷新团队列表
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
    coworkLogger.info("恢复团队:", team.id);
    const result = await window.electronAPI.invoke("cowork:resume-team", {
      teamId: team.id,
    });

    if (result.success) {
      // 更新本地状态
      team.status = "active";
      message.success("团队已恢复");
      // 刷新团队列表
      await store.loadTeams();
    } else {
      message.error(result.error || "恢复团队失败");
    }
  } catch (error) {
    coworkLogger.error("恢复团队失败:", error);
    message.error("恢复团队失败: " + error.message);
  }
}

// ==========================================
// 筛选和搜索
// ==========================================

function handleSearch(value) {
  coworkLogger.info("搜索团队:", value);
  store.setTeamFilters({ searchQuery: value });
}

function handleFilterChange(value) {
  coworkLogger.info("筛选状态:", value);
  store.setTeamFilters({ status: value });
}

// 监听搜索框变化
watch(searchQuery, (newValue) => {
  store.setTeamFilters({ searchQuery: newValue });
});

// 监听状态筛选变化
watch(statusFilter, (newValue) => {
  store.setTeamFilters({ status: newValue });
});
</script>

<style scoped lang="scss">
.cowork-dashboard-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }

    .header-right {
      display: flex;
      gap: 12px;
    }
  }

  .stats-section {
    margin-bottom: 24px;

    .ant-card {
      border-radius: 8px;
    }
  }

  .quick-actions-card {
    margin-bottom: 24px;
    border-radius: 8px;
  }

  .teams-section {
    .ant-card {
      border-radius: 8px;

      :deep(.ant-card-head) {
        font-weight: 600;
        font-size: 16px;
      }
    }

    .filters-bar {
      margin-bottom: 24px;
    }

    .teams-grid {
      min-height: 200px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 60px 0;
    }
  }

  .form-item-hint {
    margin-top: 4px;
    font-size: 12px;
    color: #8c8c8c;
  }
}

// 响应式调整
@media (max-width: 768px) {
  .cowork-dashboard-page {
    padding: 16px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      .header-right {
        width: 100%;

        :deep(.ant-space) {
          width: 100%;
          justify-content: flex-end;
        }
      }
    }

    .filters-bar {
      :deep(.ant-space) {
        width: 100%;
        flex-direction: column;

        .ant-input-search,
        .ant-select {
          width: 100% !important;
        }
      }
    }
  }
}
</style>
