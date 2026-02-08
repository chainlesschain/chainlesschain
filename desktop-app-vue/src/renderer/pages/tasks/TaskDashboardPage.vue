<template>
  <div class="task-dashboard-page">
    <a-page-header title="任务仪表板" sub-title="团队任务管理中心">
      <template #extra>
        <a-button type="primary" @click="showCreateBoard = true">
          <template #icon>
            <PlusOutlined />
          </template>
          新建看板
        </a-button>
      </template>
    </a-page-header>

    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="待办任务"
            :value="stats.todoCount"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix>
              <ClockCircleOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="进行中"
            :value="stats.inProgressCount"
            :value-style="{ color: '#faad14' }"
          >
            <template #prefix>
              <SyncOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="已完成"
            :value="stats.completedCount"
            :value-style="{ color: '#52c41a' }"
          >
            <template #prefix>
              <CheckCircleOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="已过期"
            :value="stats.overdueCount"
            :value-style="{ color: '#ff4d4f' }"
          >
            <template #prefix>
              <ExclamationCircleOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- 看板列表 -->
    <a-card title="我的看板" class="boards-card">
      <a-spin :spinning="loading">
        <a-row :gutter="16">
          <a-col v-for="board in boards" :key="board.id" :span="8">
            <a-card hoverable class="board-card" @click="goToBoard(board.id)">
              <template #cover>
                <div
                  class="board-cover"
                  :style="{ backgroundColor: board.color || '#1890ff' }"
                >
                  <AppstoreOutlined class="board-icon" />
                </div>
              </template>
              <a-card-meta
                :title="board.name"
                :description="board.description"
              />
              <div class="board-stats">
                <a-tag>{{ board.taskCount || 0 }} 个任务</a-tag>
                <a-tag v-if="board.boardType === 'scrum'"> Scrum </a-tag>
                <a-tag v-else> Kanban </a-tag>
              </div>
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card
              hoverable
              class="board-card create-card"
              @click="showCreateBoard = true"
            >
              <div class="create-placeholder">
                <PlusOutlined class="create-icon" />
                <p>创建新看板</p>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-spin>
    </a-card>

    <!-- 创建看板对话框 -->
    <a-modal
      v-model:open="showCreateBoard"
      title="创建看板"
      :confirm-loading="creating"
      @ok="handleCreateBoard"
    >
      <a-form :model="newBoard" layout="vertical">
        <a-form-item label="看板名称" required>
          <a-input v-model:value="newBoard.name" placeholder="输入看板名称" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="newBoard.description"
            placeholder="看板描述"
          />
        </a-form-item>
        <a-form-item label="类型">
          <a-radio-group v-model:value="newBoard.boardType">
            <a-radio value="kanban"> Kanban </a-radio>
            <a-radio value="scrum"> Scrum </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import { useTaskBoardStore } from "@/stores/taskBoard";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const taskBoardStore = useTaskBoardStore();
const authStore = useAuthStore();

const loading = ref(false);
const creating = ref(false);
const showCreateBoard = ref(false);
const newBoard = ref({
  name: "",
  description: "",
  boardType: "kanban",
});

const boards = computed(() => taskBoardStore.boards);
const stats = computed(() => ({
  todoCount: taskBoardStore.todoCount,
  inProgressCount: taskBoardStore.inProgressCount,
  completedCount: taskBoardStore.completedCount,
  overdueCount: taskBoardStore.overdueCount,
}));

const goToBoard = (boardId) => {
  router.push(`/tasks/board/${boardId}`);
};

const handleCreateBoard = async () => {
  if (!newBoard.value.name) {
    message.warning("请输入看板名称");
    return;
  }

  creating.value = true;
  try {
    const result = await taskBoardStore.createBoard({
      ...newBoard.value,
      orgId: authStore.currentOrg?.id,
      ownerDid: authStore.currentUser?.did,
    });

    if (result.success) {
      message.success("看板创建成功");
      showCreateBoard.value = false;
      newBoard.value = { name: "", description: "", boardType: "kanban" };
      goToBoard(result.boardId);
    }
  } catch (error) {
    message.error("创建失败");
  } finally {
    creating.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await taskBoardStore.loadBoards(authStore.currentOrg?.id);
  } catch (error) {
    message.error("加载看板失败");
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.task-dashboard-page {
  padding: 0 24px 24px;
}

.stats-row {
  margin-bottom: 24px;
}

.boards-card {
  margin-bottom: 24px;
}

.board-card {
  margin-bottom: 16px;
}

.board-cover {
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.board-icon {
  font-size: 40px;
  color: rgba(255, 255, 255, 0.8);
}

.board-stats {
  margin-top: 12px;
}

.create-card {
  height: 100%;
  min-height: 200px;
}

.create-placeholder {
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #999;
}

.create-icon {
  font-size: 40px;
  margin-bottom: 8px;
}
</style>
