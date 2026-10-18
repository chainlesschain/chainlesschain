<template>
  <div class="task-board-page">
    <a-page-header
      :title="currentBoard?.name || '任务看板'"
      :sub-title="currentBoard?.description"
      @back="goBack"
    >
      <template #extra>
        <a-space>
          <a-radio-group
            v-model:value="viewMode"
            button-style="solid"
            size="small"
          >
            <a-radio-button value="kanban"> 看板 </a-radio-button>
            <a-radio-button value="list"> 列表 </a-radio-button>
          </a-radio-group>
          <a-button @click="showFilters = !showFilters">
            <template #icon>
              <FilterOutlined />
            </template>
            筛选
          </a-button>
          <a-button type="primary" @click="createTaskInColumn(null)">
            <template #icon>
              <PlusOutlined />
            </template>
            新建任务
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <!-- 筛选栏 -->
    <a-card v-if="showFilters" class="filter-card" size="small">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-input
            v-model:value="filters.searchQuery"
            placeholder="搜索任务..."
            allow-clear
          >
            <template #prefix>
              <SearchOutlined />
            </template>
          </a-input>
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filters.priority"
            placeholder="优先级"
            allow-clear
            style="width: 100%"
          >
            <a-select-option value="critical"> 紧急 </a-select-option>
            <a-select-option value="high"> 高 </a-select-option>
            <a-select-option value="medium"> 中 </a-select-option>
            <a-select-option value="low"> 低 </a-select-option>
          </a-select>
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filters.assigneeDid"
            placeholder="负责人"
            allow-clear
            style="width: 100%"
          >
            <!-- 成员选项 -->
          </a-select>
        </a-col>
        <a-col :span="2">
          <a-button @click="clearFilters"> 清空 </a-button>
        </a-col>
      </a-row>
    </a-card>

    <!-- 看板视图 -->
    <div v-if="viewMode === 'kanban'" class="kanban-container">
      <a-spin :spinning="loading">
        <div class="kanban-board">
          <div v-for="column in columns" :key="column.id" class="kanban-column">
            <div class="column-header">
              <span class="column-title">{{ column.name }}</span>
              <a-badge
                :count="getColumnTasks(column.id).length"
                :overflow-count="99"
              />
            </div>
            <div class="column-content">
              <div
                v-for="task in getColumnTasks(column.id)"
                :key="task.id"
                class="task-card"
                @click="openTaskDetail(task.id)"
              >
                <div class="task-title">
                  {{ task.title }}
                </div>
                <div class="task-meta">
                  <a-tag :color="getPriorityColor(task.priority)">
                    {{ getPriorityLabel(task.priority) }}
                  </a-tag>
                  <span v-if="task.dueDate" class="due-date">
                    {{ formatDate(task.dueDate) }}
                  </span>
                </div>
                <div v-if="task.assigneeName" class="task-assignee">
                  <a-avatar size="small">
                    {{ task.assigneeName?.charAt(0) }}
                  </a-avatar>
                  <span>{{ task.assigneeName }}</span>
                </div>
              </div>
              <a-button
                type="dashed"
                block
                class="add-task-btn"
                @click="createTaskInColumn(column.id)"
              >
                <PlusOutlined /> 添加任务
              </a-button>
            </div>
          </div>
        </div>
      </a-spin>
    </div>

    <!-- 列表视图 -->
    <div v-else class="list-container">
      <a-table
        :columns="tableColumns"
        :data-source="filteredTasks"
        :loading="loading"
        row-key="id"
        @row-click="(record) => openTaskDetail(record.id)"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'priority'">
            <a-tag :color="getPriorityColor(record.priority)">
              {{ getPriorityLabel(record.priority) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="getStatusColor(record.status)">
              {{ getStatusLabel(record.status) }}
            </a-tag>
          </template>
        </template>
      </a-table>
    </div>

    <TaskReportsPanel
      v-if="currentBoard?.id === boardId && currentBoard?.orgId"
      :org-id="currentBoard.orgId"
      :board-id="boardId"
    />

    <!-- 创建任务对话框 -->
    <a-modal
      v-model:open="showCreateTask"
      title="新建任务"
      :footer="null"
      width="600px"
    >
      <BoardTaskCreator
        v-if="showCreateTask"
        :board-id="boardId"
        :initial-column-id="initialCreateColumn"
        @created="refreshCreatedTask"
      />
    </a-modal>

    <!-- 任务详情抽屉 -->
    <a-drawer
      v-model:open="taskDetailVisible"
      :title="currentTask?.title"
      placement="right"
      :width="600"
    >
      <template v-if="currentTask">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="状态">
            <a-tag :color="getStatusColor(currentTask.status)">
              {{ getStatusLabel(currentTask.status) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="优先级">
            <a-tag :color="getPriorityColor(currentTask.priority)">
              {{ getPriorityLabel(currentTask.priority) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="负责人">
            {{ currentTask.assigneeName || "未分配" }}
          </a-descriptions-item>
          <a-descriptions-item label="截止日期">
            {{ currentTask.dueDate ? formatDate(currentTask.dueDate) : "无" }}
          </a-descriptions-item>
        </a-descriptions>
        <a-divider />
        <h4>描述</h4>
        <p>{{ currentTask.description || "无描述" }}</p>
        <BoardTaskEditor
          :task-id="currentTask.id"
          @updated="refreshEditedTask"
        />
        <BoardAttachments :task-id="currentTask.id" />
        <a-divider />
        <a-form layout="vertical" @submit.prevent="mentionMember">
          <a-form-item label="提及成员">
            <a-input
              v-model:value="mentionDid"
              placeholder="输入成员 DID"
              :maxlength="1024"
            />
          </a-form-item>
          <a-button
            :loading="mentioning"
            :disabled="!mentionDid.trim()"
            @click="mentionMember"
          >
            发送任务通知
          </a-button>
          <p v-if="mentionError" role="alert">{{ mentionError }}</p>
        </a-form>
      </template>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  FilterOutlined,
  SearchOutlined,
} from "@ant-design/icons-vue";
import { useTaskBoardStore } from "@/stores/taskBoard";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { useIdentityStore } from "@/stores/identity";
import BoardAttachments from "@/components/task/BoardAttachments.vue";
import BoardTaskEditor from "@/components/task/BoardTaskEditor.vue";
import BoardTaskCreator from "@/components/task/BoardTaskCreator.vue";
import TaskReportsPanel from "@/components/task/TaskReportsPanel.vue";
import dayjs from "dayjs";

const route = useRoute();
const router = useRouter();
const taskBoardStore = useTaskBoardStore();
const authStore = useAuthStore();
const appStore = useAppStore();
const identityStore = useIdentityStore();

const boardId = computed(() => route.params.id);
const loading = ref(false);
const initialCreateColumn = ref(null);
const showFilters = ref(false);
const showCreateTask = ref(false);
const viewMode = ref("kanban");
const mentionDid = ref("");
const mentioning = ref(false);
const mentionError = ref("");

const currentBoard = computed(() => taskBoardStore.currentBoard);
const columns = computed(() => taskBoardStore.columns);
const tasks = computed(() => taskBoardStore.tasks);
const filteredTasks = computed(() => taskBoardStore.filteredTasks);
const currentTask = computed(() => taskBoardStore.currentTask);
const taskDetailVisible = computed(() => taskBoardStore.taskDetailVisible);
const filters = computed(() => taskBoardStore.filters);

const tableColumns = [
  { title: "标题", dataIndex: "title", key: "title" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "优先级", dataIndex: "priority", key: "priority" },
  { title: "负责人", dataIndex: "assigneeName", key: "assigneeName" },
  { title: "截止日期", dataIndex: "dueDate", key: "dueDate" },
];

const getColumnTasks = (columnId) => {
  return filteredTasks.value.filter((t) => t.columnId === columnId);
};

const formatDate = (timestamp) => dayjs(timestamp).format("MM-DD");

const getPriorityColor = (priority) => {
  const colors = {
    critical: "magenta",
    high: "red",
    medium: "orange",
    low: "blue",
  };
  return colors[priority] || "default";
};

const getPriorityLabel = (priority) => {
  const labels = { critical: "紧急", high: "高", medium: "中", low: "低" };
  return labels[priority] || priority;
};

const getStatusColor = (status) => {
  const colors = {
    open: "default",
    review: "warning",
    cancelled: "default",
    todo: "default",
    in_progress: "processing",
    done: "success",
  };
  return colors[status] || "default";
};

const getStatusLabel = (status) => {
  const labels = {
    open: "待处理",
    todo: "待办",
    in_progress: "进行中",
    review: "待审核",
    done: "已完成",
    cancelled: "已取消",
  };
  return labels[status] || status;
};

const goBack = () => router.push("/tasks/dashboard");

const clearFilters = () => taskBoardStore.clearFilters();

const openTaskDetail = async (taskId) => {
  await taskBoardStore.openTaskDetail(taskId);
};

const createTaskInColumn = (columnId) => {
  initialCreateColumn.value = columnId;
  showCreateTask.value = true;
};

async function refreshCreatedTask(taskId) {
  const selectedBoard = boardId.value,
    stamp = noticeEpoch,
    createStamp = createEpoch;
  if (!appStore.isAuthenticated || typeof taskId !== "string" || !taskId)
    return;
  const current = () =>
    stamp === noticeEpoch &&
    createStamp === createEpoch &&
    appStore.isAuthenticated &&
    boardId.value === selectedBoard &&
    showCreateTask.value;
  try {
    const list = await window.electronAPI?.task?.getTasks({
      boardId: selectedBoard,
    });
    if (!current()) return;
    if (
      list?.success !== true ||
      !Array.isArray(list.tasks) ||
      !list.tasks.some((task) => task.id === taskId) ||
      list.tasks.some((task) => task.boardId !== selectedBoard)
    )
      throw new Error("TASK_REFRESH_DENIED");
    taskBoardStore.tasks = list.tasks;
    showCreateTask.value = false;
    message.success("任务创建成功");
  } catch {
    if (current()) message.error("任务已创建，列表刷新失败，请重新读取看板。");
  }
}

let noticeEpoch = 0;
let createEpoch = 0;
watch(
  () => [showCreateTask.value, initialCreateColumn.value],
  () => {
    createEpoch++;
  },
  { flush: "sync" },
);
let unsubscribeNotice;
async function refreshEditedTask() {
  const taskId = currentTask.value?.id,
    selectedBoard = boardId.value,
    stamp = noticeEpoch;
  if (!taskId || !appStore.isAuthenticated) return;
  const current = () =>
    stamp === noticeEpoch &&
    appStore.isAuthenticated &&
    boardId.value === selectedBoard &&
    currentTask.value?.id === taskId;
  try {
    const task = await window.electronAPI?.task?.getTask({ taskId });
    if (!current()) return;
    const list = await window.electronAPI?.task?.getTasks({
      boardId: selectedBoard,
    });
    if (!current()) return;
    if (
      task?.success !== true ||
      task.task?.id !== taskId ||
      task.task?.boardId !== selectedBoard ||
      list?.success !== true ||
      !Array.isArray(list.tasks) ||
      !list.tasks.some((item) => item.id === taskId) ||
      list.tasks.some((item) => item.boardId !== selectedBoard)
    )
      throw new Error("TASK_REFRESH_DENIED");
    taskBoardStore.currentTask = task.task;
    taskBoardStore.tasks = list.tasks;
  } catch {
    if (current()) taskBoardStore.closeTaskDetail();
  }
}
watch(
  () => currentTask.value?.id,
  () => {
    mentionDid.value = "";
    mentionError.value = "";
    mentioning.value = false;
  },
);
async function mentionMember() {
  const taskId = currentTask.value?.id,
    userDid = mentionDid.value.trim();
  if (!taskId || !userDid || mentioning.value) return;
  const stamp = noticeEpoch;
  mentioning.value = true;
  mentionError.value = "";
  try {
    const result = await window.electronAPI?.task?.mentionUser({
      taskId,
      userDid,
    });
    if (stamp !== noticeEpoch || currentTask.value?.id !== taskId) return;
    if (result?.success !== true) throw new Error("MENTION_DENIED");
    mentionDid.value = "";
    message.success("任务通知已发送");
  } catch {
    if (stamp === noticeEpoch && currentTask.value?.id === taskId)
      mentionError.value = "无法发送任务通知，请检查成员 DID 与当前权限。";
  } finally {
    if (stamp === noticeEpoch) mentioning.value = false;
  }
}
function invalidateNotice() {
  noticeEpoch++;
  showCreateTask.value = false;
  mentionDid.value = "";
  mentioning.value = false;
  mentionError.value = "";
  taskBoardStore.closeTaskDetail();
}
let authentication = appStore.isAuthenticated,
  deviceId = appStore.deviceId;
appStore.$subscribe(
  (_mutation, state) => {
    if (
      state.isAuthenticated !== authentication ||
      state.deviceId !== deviceId
    ) {
      authentication = state.isAuthenticated;
      deviceId = state.deviceId;
      invalidateNotice();
    }
  },
  { flush: "sync" },
);
watch(
  () => [
    identityStore.primaryDID,
    identityStore.currentContext,
    identityStore.currentIdentity.localDB,
    route.params.id,
    route.query.taskNoticeId,
    route.query.taskId,
  ],
  invalidateNotice,
  { flush: "sync" },
);
onBeforeUnmount(() => {
  noticeEpoch++;
  unsubscribeNotice?.();
  taskBoardStore.closeTaskDetail();
});

async function openNoticeTask() {
  const noticeId = route.query.taskNoticeId;
  if (
    !appStore.isAuthenticated ||
    typeof noticeId !== "string" ||
    !noticeId.startsWith("cc-board-mention:")
  )
    return;
  const stamp = ++noticeEpoch;
  taskBoardStore.closeTaskDetail();
  try {
    const result = await window.electronAPI?.notification?.openTask(noticeId);
    if (
      stamp !== noticeEpoch ||
      result?.success !== true ||
      result.target?.boardId !== boardId.value ||
      result.target?.taskId !== route.query.taskId
    )
      return;
    const board = await window.electronAPI.invoke("task:get-board", {
      boardId: result.target.boardId,
    });
    if (
      stamp !== noticeEpoch ||
      board?.success !== true ||
      board.board?.id !== result.target.boardId ||
      board.board?.orgId !== result.target.orgId
    )
      return;
    const task = await window.electronAPI.invoke("task:get-task", {
      taskId: result.target.taskId,
    });
    if (
      stamp !== noticeEpoch ||
      task?.success !== true ||
      task.task?.id !== result.target.taskId ||
      task.task?.boardId !== result.target.boardId
    )
      return;
    const checked = await window.electronAPI.notification.openTask(noticeId);
    if (
      stamp !== noticeEpoch ||
      checked?.success !== true ||
      JSON.stringify(checked.target) !== JSON.stringify(result.target)
    )
      return;
    taskBoardStore.currentTask = task.task;
    taskBoardStore.taskDetailVisible = true;
  } catch {
    if (stamp === noticeEpoch) taskBoardStore.closeTaskDetail();
  }
}

watch(
  () => route.query.taskNoticeId,
  () => {
    void openNoticeTask();
  },
);

onMounted(async () => {
  unsubscribeNotice =
    window.electronAPI?.notification?.onInvalidated?.(invalidateNotice);
  loading.value = true;
  try {
    await taskBoardStore.loadBoard(boardId.value);
    if (columns.value.length > 0) {
      newTask.value.columnId = columns.value[0].id;
    }
    await openNoticeTask();
  } catch (_error) {
    message.error("加载看板失败");
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.task-board-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.filter-card {
  margin: 0 24px 16px;
}

.kanban-container {
  flex: 1;
  padding: 0 24px;
  overflow-x: auto;
}

.kanban-board {
  display: flex;
  gap: 16px;
  min-height: 500px;
}

.kanban-column {
  width: 300px;
  min-width: 300px;
  background: #f5f5f5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.column-header {
  padding: 12px 16px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e8e8e8;
}

.column-content {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.task-card {
  background: #fff;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.task-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.task-title {
  font-weight: 500;
  margin-bottom: 8px;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.due-date {
  font-size: 12px;
  color: #999;
}

.task-assignee {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #666;
}

.add-task-btn {
  margin-top: 8px;
}

.list-container {
  flex: 1;
  padding: 0 24px;
}
</style>
