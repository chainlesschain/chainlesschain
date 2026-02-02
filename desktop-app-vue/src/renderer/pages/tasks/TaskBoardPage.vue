<template>
  <div class="task-board-page">
    <a-page-header
      :title="currentBoard?.name || '任务看板'"
      :sub-title="currentBoard?.description"
      @back="goBack"
    >
      <template #extra>
        <a-space>
          <a-radio-group v-model:value="viewMode" button-style="solid" size="small">
            <a-radio-button value="kanban">看板</a-radio-button>
            <a-radio-button value="list">列表</a-radio-button>
          </a-radio-group>
          <a-button @click="showFilters = !showFilters">
            <template #icon><FilterOutlined /></template>
            筛选
          </a-button>
          <a-button type="primary" @click="showCreateTask = true">
            <template #icon><PlusOutlined /></template>
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
            <template #prefix><SearchOutlined /></template>
          </a-input>
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filters.priority"
            placeholder="优先级"
            allow-clear
            style="width: 100%"
          >
            <a-select-option value="high">高</a-select-option>
            <a-select-option value="medium">中</a-select-option>
            <a-select-option value="low">低</a-select-option>
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
          <a-button @click="clearFilters">清空</a-button>
        </a-col>
      </a-row>
    </a-card>

    <!-- 看板视图 -->
    <div v-if="viewMode === 'kanban'" class="kanban-container">
      <a-spin :spinning="loading">
        <div class="kanban-board">
          <div
            v-for="column in columns"
            :key="column.id"
            class="kanban-column"
          >
            <div class="column-header">
              <span class="column-title">{{ column.name }}</span>
              <a-badge :count="getColumnTasks(column.id).length" :overflow-count="99" />
            </div>
            <div class="column-content">
              <div
                v-for="task in getColumnTasks(column.id)"
                :key="task.id"
                class="task-card"
                @click="openTaskDetail(task.id)"
              >
                <div class="task-title">{{ task.title }}</div>
                <div class="task-meta">
                  <a-tag v-if="task.priority === 'high'" color="red">高</a-tag>
                  <a-tag v-else-if="task.priority === 'medium'" color="orange">中</a-tag>
                  <a-tag v-else color="blue">低</a-tag>
                  <span v-if="task.dueDate" class="due-date">
                    {{ formatDate(task.dueDate) }}
                  </span>
                </div>
                <div v-if="task.assigneeName" class="task-assignee">
                  <a-avatar size="small">{{ task.assigneeName?.charAt(0) }}</a-avatar>
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

    <!-- 创建任务对话框 -->
    <a-modal
      v-model:open="showCreateTask"
      title="新建任务"
      @ok="handleCreateTask"
      :confirm-loading="creating"
      width="600px"
    >
      <a-form :model="newTask" layout="vertical">
        <a-form-item label="标题" required>
          <a-input v-model:value="newTask.title" placeholder="任务标题" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="newTask.description" :rows="4" placeholder="任务描述" />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="优先级">
              <a-select v-model:value="newTask.priority" style="width: 100%">
                <a-select-option value="high">高</a-select-option>
                <a-select-option value="medium">中</a-select-option>
                <a-select-option value="low">低</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="截止日期">
              <a-date-picker v-model:value="newTask.dueDate" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="所属列">
          <a-select v-model:value="newTask.columnId" style="width: 100%">
            <a-select-option v-for="col in columns" :key="col.id" :value="col.id">
              {{ col.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
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
            {{ currentTask.assigneeName || '未分配' }}
          </a-descriptions-item>
          <a-descriptions-item label="截止日期">
            {{ currentTask.dueDate ? formatDate(currentTask.dueDate) : '无' }}
          </a-descriptions-item>
        </a-descriptions>
        <a-divider />
        <h4>描述</h4>
        <p>{{ currentTask.description || '无描述' }}</p>
      </template>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { PlusOutlined, FilterOutlined, SearchOutlined } from '@ant-design/icons-vue';
import { useTaskBoardStore } from '@/stores/taskBoard';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const route = useRoute();
const router = useRouter();
const taskBoardStore = useTaskBoardStore();
const authStore = useAuthStore();

const boardId = computed(() => route.params.id);
const loading = ref(false);
const creating = ref(false);
const showFilters = ref(false);
const showCreateTask = ref(false);
const viewMode = ref('kanban');

const currentBoard = computed(() => taskBoardStore.currentBoard);
const columns = computed(() => taskBoardStore.columns);
const tasks = computed(() => taskBoardStore.tasks);
const filteredTasks = computed(() => taskBoardStore.filteredTasks);
const currentTask = computed(() => taskBoardStore.currentTask);
const taskDetailVisible = computed(() => taskBoardStore.taskDetailVisible);
const filters = computed(() => taskBoardStore.filters);

const newTask = ref({
  title: '',
  description: '',
  priority: 'medium',
  dueDate: null,
  columnId: null,
});

const tableColumns = [
  { title: '标题', dataIndex: 'title', key: 'title' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '优先级', dataIndex: 'priority', key: 'priority' },
  { title: '负责人', dataIndex: 'assigneeName', key: 'assigneeName' },
  { title: '截止日期', dataIndex: 'dueDate', key: 'dueDate' },
];

const getColumnTasks = (columnId) => {
  return filteredTasks.value.filter((t) => t.columnId === columnId);
};

const formatDate = (timestamp) => dayjs(timestamp).format('MM-DD');

const getPriorityColor = (priority) => {
  const colors = { high: 'red', medium: 'orange', low: 'blue' };
  return colors[priority] || 'default';
};

const getPriorityLabel = (priority) => {
  const labels = { high: '高', medium: '中', low: '低' };
  return labels[priority] || priority;
};

const getStatusColor = (status) => {
  const colors = { todo: 'default', in_progress: 'processing', done: 'success' };
  return colors[status] || 'default';
};

const getStatusLabel = (status) => {
  const labels = { todo: '待办', in_progress: '进行中', done: '已完成' };
  return labels[status] || status;
};

const goBack = () => router.push('/tasks/dashboard');

const clearFilters = () => taskBoardStore.clearFilters();

const openTaskDetail = async (taskId) => {
  await taskBoardStore.openTaskDetail(taskId);
};

const createTaskInColumn = (columnId) => {
  newTask.value.columnId = columnId;
  showCreateTask.value = true;
};

const handleCreateTask = async () => {
  if (!newTask.value.title) {
    message.warning('请输入任务标题');
    return;
  }

  creating.value = true;
  try {
    const result = await taskBoardStore.createTask({
      ...newTask.value,
      boardId: boardId.value,
      dueDate: newTask.value.dueDate?.valueOf(),
    });

    if (result.success) {
      message.success('任务创建成功');
      showCreateTask.value = false;
      newTask.value = { title: '', description: '', priority: 'medium', dueDate: null, columnId: null };
    }
  } catch (error) {
    message.error('创建失败');
  } finally {
    creating.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await taskBoardStore.loadBoard(boardId.value);
    if (columns.value.length > 0) {
      newTask.value.columnId = columns.value[0].id;
    }
  } catch (error) {
    message.error('加载看板失败');
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
