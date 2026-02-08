<template>
  <div class="task-board">
    <!-- 看板头部 -->
    <div class="board-header">
      <div class="header-left">
        <h3 class="board-title">
          <project-outlined />
          {{ currentBoard?.name || "任务看板" }}
        </h3>
        <a-space>
          <a-select
            v-model:value="selectedBoardId"
            style="width: 200px"
            placeholder="选择看板"
            @change="handleBoardChange"
          >
            <a-select-option
              v-for="board in taskStore.boards"
              :key="board.id"
              :value="board.id"
            >
              {{ board.name }}
            </a-select-option>
          </a-select>

          <a-button @click="showCreateBoard = true">
            <plus-outlined /> 新建看板
          </a-button>
        </a-space>
      </div>

      <div class="header-right">
        <a-space>
          <!-- 筛选器 -->
          <a-dropdown>
            <a-button>
              <filter-outlined /> 筛选
              <down-outlined />
            </a-button>
            <template #overlay>
              <a-menu>
                <a-menu-item-group title="状态">
                  <a-menu-item
                    key="all"
                    @click="() => filterBy('status', null)"
                  >
                    全部
                  </a-menu-item>
                  <a-menu-item
                    key="pending"
                    @click="() => filterBy('status', 'pending')"
                  >
                    待处理
                  </a-menu-item>
                  <a-menu-item
                    key="in_progress"
                    @click="() => filterBy('status', 'in_progress')"
                  >
                    进行中
                  </a-menu-item>
                  <a-menu-item
                    key="completed"
                    @click="() => filterBy('status', 'completed')"
                  >
                    已完成
                  </a-menu-item>
                </a-menu-item-group>
                <a-menu-divider />
                <a-menu-item-group title="优先级">
                  <a-menu-item
                    key="urgent"
                    @click="() => filterBy('priority', 'urgent')"
                  >
                    紧急
                  </a-menu-item>
                  <a-menu-item
                    key="high"
                    @click="() => filterBy('priority', 'high')"
                  >
                    高
                  </a-menu-item>
                  <a-menu-item
                    key="medium"
                    @click="() => filterBy('priority', 'medium')"
                  >
                    中
                  </a-menu-item>
                  <a-menu-item
                    key="low"
                    @click="() => filterBy('priority', 'low')"
                  >
                    低
                  </a-menu-item>
                </a-menu-item-group>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 搜索 -->
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索任务..."
            style="width: 200px"
            @search="handleSearch"
          />

          <!-- 创建任务 -->
          <a-button type="primary" @click="showCreateTask = true">
            <plus-outlined /> 新建任务
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 看板列 -->
    <div v-loading="taskStore.loading" class="board-columns">
      <div v-for="column in boardColumns" :key="column.id" class="board-column">
        <!-- 列头 -->
        <div class="column-header">
          <div class="header-title">
            <component :is="column.icon" :style="{ color: column.color }" />
            <span>{{ column.name }}</span>
            <a-badge
              :count="getColumnTaskCount(column.status)"
              :number-style="{ backgroundColor: column.color }"
            />
          </div>
          <a-button
            type="text"
            size="small"
            @click="() => handleAddTask(column.status)"
          >
            <plus-outlined />
          </a-button>
        </div>

        <!-- 任务卡片列表 -->
        <div class="column-content">
          <draggable
            v-model="columnTasks[column.status]"
            :group="{ name: 'tasks' }"
            item-key="id"
            :animation="200"
            ghost-class="task-ghost"
            drag-class="task-drag"
            @change="(evt) => handleDragChange(evt, column.status)"
          >
            <template #item="{ element }">
              <task-card
                :task="element"
                @click="handleTaskClick"
                @edit="handleTaskEdit"
                @delete="handleTaskDelete"
              />
            </template>
          </draggable>

          <!-- 空状态 -->
          <a-empty
            v-if="columnTasks[column.status].length === 0"
            description="暂无任务"
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
            style="margin: 20px 0"
          />
        </div>
      </div>
    </div>

    <!-- 创建看板对话框 -->
    <a-modal
      v-model:open="showCreateBoard"
      title="创建看板"
      @ok="handleCreateBoard"
      @cancel="showCreateBoard = false"
    >
      <a-form
        :model="boardFormData"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="看板名称" required>
          <a-input
            v-model:value="boardFormData.name"
            placeholder="请输入看板名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="boardFormData.description"
            placeholder="请输入看板描述"
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 创建/编辑任务对话框 -->
    <a-modal
      v-model:open="showCreateTask"
      :title="editingTask ? '编辑任务' : '创建任务'"
      width="700px"
      @ok="handleSaveTask"
      @cancel="handleCancelTask"
    >
      <a-form
        :model="taskFormData"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="任务标题" required>
          <a-input
            v-model:value="taskFormData.title"
            placeholder="请输入任务标题"
          />
        </a-form-item>

        <a-form-item label="任务描述">
          <a-textarea
            v-model:value="taskFormData.description"
            placeholder="请输入任务描述"
            :rows="4"
          />
        </a-form-item>

        <a-form-item label="状态">
          <a-select v-model:value="taskFormData.status">
            <a-select-option value="pending"> 待处理 </a-select-option>
            <a-select-option value="in_progress"> 进行中 </a-select-option>
            <a-select-option value="completed"> 已完成 </a-select-option>
            <a-select-option value="cancelled"> 已取消 </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="优先级">
          <a-select v-model:value="taskFormData.priority">
            <a-select-option value="low"> 低 </a-select-option>
            <a-select-option value="medium"> 中 </a-select-option>
            <a-select-option value="high"> 高 </a-select-option>
            <a-select-option value="urgent"> 紧急 </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="截止日期">
          <a-date-picker
            v-model:value="taskFormData.due_date"
            show-time
            placeholder="选择截止日期"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="预估工时">
          <a-input-number
            v-model:value="taskFormData.estimate_hours"
            :min="0"
            :step="0.5"
            placeholder="小时"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="标签">
          <a-select
            v-model:value="taskFormData.labels"
            mode="tags"
            placeholder="添加标签"
            style="width: 100%"
          >
            <a-select-option v-for="tag in commonTags" :key="tag" :value="tag">
              {{ tag }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, watch } from "vue";
import { Empty } from "ant-design-vue";
import draggable from "vuedraggable";
import {
  ProjectOutlined,
  PlusOutlined,
  FilterOutlined,
  DownOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons-vue";
import TaskCard from "./TaskCard.vue";
import { useTaskStore } from "../../stores/task";
import { useWorkspaceStore } from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";
import { useRoute } from "vue-router";

// Stores
const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const route = useRoute();

// State
const selectedBoardId = ref(null);
const searchKeyword = ref("");
const showCreateBoard = ref(false);
const showCreateTask = ref(false);
const editingTask = ref(null);

const boardFormData = ref({
  name: "",
  description: "",
});

const taskFormData = ref({
  title: "",
  description: "",
  status: "pending",
  priority: "medium",
  due_date: null,
  estimate_hours: null,
  labels: [],
});

const commonTags = ["功能开发", "Bug修复", "性能优化", "文档", "测试", "重构"];

// 看板列配置
const boardColumns = [
  {
    id: "pending",
    name: "待处理",
    status: "pending",
    icon: ClockCircleOutlined,
    color: "#8c8c8c",
  },
  {
    id: "in_progress",
    name: "进行中",
    status: "in_progress",
    icon: SyncOutlined,
    color: "#1890ff",
  },
  {
    id: "completed",
    name: "已完成",
    status: "completed",
    icon: CheckCircleOutlined,
    color: "#52c41a",
  },
  {
    id: "cancelled",
    name: "已取消",
    status: "cancelled",
    icon: CloseCircleOutlined,
    color: "#ff4d4f",
  },
];

// Computed
const currentBoard = computed(() => {
  return (
    taskStore.boards.find((b) => b.id === selectedBoardId.value) ||
    taskStore.currentBoard
  );
});

const columnTasks = computed(() => {
  const grouped = {
    pending: [],
    in_progress: [],
    completed: [],
    cancelled: [],
  };

  // 获取搜索关键词进行本地过滤
  const keyword = searchKeyword.value.toLowerCase().trim();

  taskStore.tasks.forEach((task) => {
    // 如果有搜索关键词，过滤不匹配的任务
    if (keyword) {
      const matchTitle = task.title?.toLowerCase().includes(keyword);
      const matchDescription = task.description
        ?.toLowerCase()
        .includes(keyword);
      const matchLabels = task.labels?.some((label) =>
        label.toLowerCase().includes(keyword),
      );
      if (!matchTitle && !matchDescription && !matchLabels) {
        return;
      }
    }
    if (grouped[task.status]) {
      grouped[task.status].push(task);
    }
  });

  return grouped;
});

// Methods
function getColumnTaskCount(status) {
  return columnTasks.value[status]?.length || 0;
}

function filterBy(type, value) {
  taskStore.updateFilters({ [type]: value });
}

function handleSearch() {
  // 实现搜索功能 - 根据关键词过滤任务
  const keyword = searchKeyword.value.toLowerCase().trim();
  if (keyword) {
    taskStore.updateFilters({ keyword });
  } else {
    // 清空搜索时移除关键词过滤
    const { keyword: _, ...restFilters } = taskStore.filters;
    taskStore.filters = restFilters;
    taskStore.loadTasks();
  }
  logger.info("Search:", searchKeyword.value);
}

function handleBoardChange(boardId) {
  selectedBoardId.value = boardId;
  taskStore.currentBoard = taskStore.boards.find((b) => b.id === boardId);
}

async function handleCreateBoard() {
  if (!boardFormData.value.name) {
    return;
  }

  const created = await taskStore.createBoard(
    workspaceStore.currentWorkspace?.org_id,
    {
      name: boardFormData.value.name,
      description: boardFormData.value.description,
      workspace_id: workspaceStore.currentWorkspaceId,
    },
  );

  if (created) {
    showCreateBoard.value = false;
    boardFormData.value = { name: "", description: "" };
  }
}

function handleAddTask(status) {
  taskFormData.value.status = status;
  showCreateTask.value = true;
}

function handleTaskClick(task) {
  taskStore.openTaskDetail(task.id);
}

function handleTaskEdit(task) {
  editingTask.value = task;
  taskFormData.value = {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date ? new Date(task.due_date) : null,
    estimate_hours: task.estimate_hours,
    labels: task.labels || [],
  };
  showCreateTask.value = true;
}

function handleTaskDelete() {
  // Task deletion is handled in TaskCard
  logger.info("Task deleted");
}

async function handleSaveTask() {
  if (!taskFormData.value.title) {
    return;
  }

  const taskData = {
    ...taskFormData.value,
    project_id:
      route.params.projectId || projectStore.currentProject?.id || null,
    workspace_id: workspaceStore.currentWorkspaceId,
    org_id: workspaceStore.currentWorkspace?.org_id,
    due_date: taskFormData.value.due_date
      ? taskFormData.value.due_date.getTime()
      : null,
  };

  if (editingTask.value) {
    await taskStore.updateTask(editingTask.value.id, taskData);
  } else {
    await taskStore.createTask(taskData);
  }

  handleCancelTask();
}

function handleCancelTask() {
  showCreateTask.value = false;
  editingTask.value = null;
  taskFormData.value = {
    title: "",
    description: "",
    status: "pending",
    priority: "medium",
    due_date: null,
    estimate_hours: null,
    labels: [],
  };
}

async function handleDragChange(evt, targetStatus) {
  if (evt.added) {
    const task = evt.added.element;
    await taskStore.changeStatus(task.id, targetStatus);
  }
}

// Lifecycle
onMounted(async () => {
  // Load tasks
  await taskStore.loadTasks({
    workspace_id: workspaceStore.currentWorkspaceId,
    org_id: workspaceStore.currentWorkspace?.org_id,
  });

  // Load boards
  if (workspaceStore.currentWorkspace?.org_id) {
    await taskStore.loadBoards(
      workspaceStore.currentWorkspace.org_id,
      workspaceStore.currentWorkspaceId,
    );
  }

  if (taskStore.boards.length > 0) {
    selectedBoardId.value = taskStore.boards[0].id;
  }
});

// Watch workspace changes
watch(
  () => workspaceStore.currentWorkspaceId,
  async (newWorkspaceId) => {
    if (newWorkspaceId) {
      await taskStore.loadTasks({
        workspace_id: newWorkspaceId,
        org_id: workspaceStore.currentWorkspace?.org_id,
      });
    }
  },
);
</script>

<style scoped lang="less">
.task-board {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;

  .board-header {
    background: #fff;
    padding: 16px 24px;
    border-bottom: 1px solid #e8e8e8;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;

      .board-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }
  }

  .board-columns {
    flex: 1;
    display: flex;
    gap: 16px;
    padding: 16px;
    overflow-x: auto;
    overflow-y: hidden;

    .board-column {
      flex: 0 0 320px;
      background: #f0f0f0;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 180px);

      .column-header {
        padding: 12px 16px;
        background: #fff;
        border-radius: 8px 8px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 2px solid #e8e8e8;
        flex-shrink: 0;

        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
        }
      }

      .column-content {
        flex: 1;
        padding: 12px;
        overflow-y: auto;
        overflow-x: hidden;

        &::-webkit-scrollbar {
          width: 6px;
        }

        &::-webkit-scrollbar-thumb {
          background: #d9d9d9;
          border-radius: 3px;
        }
      }
    }
  }
}

.task-ghost {
  opacity: 0.5;
}

.task-drag {
  cursor: move;
}
</style>
