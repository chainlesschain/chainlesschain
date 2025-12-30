<template>
  <div class="project-management-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <a-page-header
        title="项目列表管理"
        sub-title="管理和维护所有项目"
      >
        <template #extra>
          <a-space>
            <a-button @click="handleExport">
              <template #icon>
                <ExportOutlined />
              </template>
              导出Excel
            </a-button>
            <a-button
              danger
              :disabled="!hasSelected"
              @click="handleBatchDelete"
            >
              <template #icon>
                <DeleteOutlined />
              </template>
              批量删除
            </a-button>
            <a-button type="primary" @click="showCreateModal">
              <template #icon>
                <PlusOutlined />
              </template>
              新建项目
            </a-button>
          </a-space>
        </template>
      </a-page-header>
    </div>

    <!-- 统计卡片区域 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="项目总数"
            :value="projectStats.total"
            suffix="个"
            :value-style="{ color: '#1890ff' }"
          >
            <template #prefix>
              <FolderOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="活跃项目"
            :value="projectStats.byStatus?.active || 0"
            suffix="个"
            :value-style="{ color: '#52c41a' }"
          >
            <template #prefix>
              <FolderOpenOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic
            title="已完成"
            :value="projectStats.byStatus?.completed || 0"
            suffix="个"
            :value-style="{ color: '#722ed1' }"
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
            title="已归档"
            :value="projectStats.byStatus?.archived || 0"
            suffix="个"
            :value-style="{ color: '#fa8c16' }"
          >
            <template #prefix>
              <InboxOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- 筛选和搜索区域 -->
    <a-card class="filter-card" title="筛选和搜索">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索项目名称或描述"
            allow-clear
            @search="handleSearch"
          />
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filterType"
            placeholder="项目类型"
            allow-clear
            style="width: 100%"
            @change="handleFilterChange"
          >
            <a-select-option value="">全部类型</a-select-option>
            <a-select-option value="web">网页</a-select-option>
            <a-select-option value="document">文档</a-select-option>
            <a-select-option value="data">数据</a-select-option>
            <a-select-option value="app">应用</a-select-option>
            <a-select-option value="presentation">演示</a-select-option>
            <a-select-option value="spreadsheet">表格</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filterStatus"
            placeholder="项目状态"
            allow-clear
            style="width: 100%"
            @change="handleFilterChange"
          >
            <a-select-option value="">全部状态</a-select-option>
            <a-select-option value="draft">草稿</a-select-option>
            <a-select-option value="active">活跃</a-select-option>
            <a-select-option value="completed">已完成</a-select-option>
            <a-select-option value="archived">已归档</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="2">
          <a-button @click="handleResetFilters">重置</a-button>
        </a-col>
      </a-row>
    </a-card>

    <!-- 表格区域 -->
    <a-card class="table-card">
      <a-table
        :columns="columns"
        :data-source="paginatedData"
        :row-selection="rowSelection"
        :loading="loading"
        :pagination="pagination"
        :scroll="{ x: 1500 }"
        row-key="id"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="project-name-cell">
              <div class="name">{{ record.name }}</div>
              <div class="description" v-if="record.description">
                {{ record.description }}
              </div>
            </div>
          </template>

          <template v-else-if="column.key === 'project_type'">
            <a-tag :color="getProjectTypeColor(record.project_type)">
              {{ getProjectTypeLabel(record.project_type) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'status'">
            <a-tag :color="getStatusColor(record.status)">
              {{ getStatusLabel(record.status) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'file_count'">
            {{ record.file_count || 0 }}
          </template>

          <template v-else-if="column.key === 'total_size'">
            {{ formatFileSize(record.total_size || 0) }}
          </template>

          <template v-else-if="column.key === 'created_at'">
            {{ formatDateTime(record.created_at) }}
          </template>

          <template v-else-if="column.key === 'updated_at'">
            {{ formatDateTime(record.updated_at) }}
          </template>

          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="handleView(record)">
                <template #icon>
                  <EyeOutlined />
                </template>
                查看
              </a-button>
              <a-button type="link" size="small" @click="handleEdit(record)">
                <template #icon>
                  <EditOutlined />
                </template>
                编辑
              </a-button>
              <a-popconfirm
                title="确定要删除此项目吗？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleDelete(record.id)"
              >
                <a-button type="link" danger size="small">
                  <template #icon>
                    <DeleteOutlined />
                  </template>
                  删除
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 新建/编辑项目对话框 -->
    <a-modal
      v-model:open="modalVisible"
      :title="isEditing ? '编辑项目' : '新建项目'"
      :width="600"
      @ok="handleModalOk"
      @cancel="handleModalCancel"
    >
      <a-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        :label-col="{ span: 5 }"
        :wrapper-col="{ span: 19 }"
      >
        <a-form-item label="项目名称" name="name">
          <a-input v-model:value="formData.name" placeholder="请输入项目名称" />
        </a-form-item>

        <a-form-item label="项目描述" name="description">
          <a-textarea
            v-model:value="formData.description"
            placeholder="请输入项目描述（可选）"
            :rows="3"
          />
        </a-form-item>

        <a-form-item label="项目类型" name="project_type">
          <a-select v-model:value="formData.project_type" placeholder="请选择项目类型">
            <a-select-option value="web">网页</a-select-option>
            <a-select-option value="document">文档</a-select-option>
            <a-select-option value="data">数据</a-select-option>
            <a-select-option value="app">应用</a-select-option>
            <a-select-option value="presentation">演示</a-select-option>
            <a-select-option value="spreadsheet">表格</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="项目状态" name="status">
          <a-select v-model:value="formData.status" placeholder="请选择项目状态">
            <a-select-option value="draft">草稿</a-select-option>
            <a-select-option value="active">活跃</a-select-option>
            <a-select-option value="completed">已完成</a-select-option>
            <a-select-option value="archived">已归档</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="标签" name="tags">
          <a-select
            v-model:value="formData.tags"
            mode="tags"
            placeholder="输入标签后按回车添加"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import * as XLSX from 'xlsx';
import {
  FolderOutlined,
  FolderOpenOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  EyeOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();

// 响应式状态
const loading = ref(false);
const selectedRowKeys = ref([]);
const searchKeyword = ref('');
const filterType = ref('');
const filterStatus = ref('');

// 对话框状态
const modalVisible = ref(false);
const isEditing = ref(false);
const currentEditId = ref(null);
const formRef = ref();

// 表单数据
const formData = reactive({
  name: '',
  description: '',
  project_type: '',
  status: 'draft',
  tags: [],
});

// 表单验证规则
const formRules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { min: 1, max: 100, message: '项目名称长度为1-100字符', trigger: 'blur' },
  ],
  project_type: [
    { required: true, message: '请选择项目类型', trigger: 'change' },
  ],
  status: [
    { required: true, message: '请选择项目状态', trigger: 'change' },
  ],
};

// 表格列定义
const columns = [
  {
    title: '项目名称',
    dataIndex: 'name',
    key: 'name',
    width: 250,
    ellipsis: true,
  },
  {
    title: '项目类型',
    dataIndex: 'project_type',
    key: 'project_type',
    width: 100,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 100,
  },
  {
    title: '文件数',
    dataIndex: 'file_count',
    key: 'file_count',
    width: 80,
    align: 'right',
    sorter: true,
  },
  {
    title: '文件大小',
    dataIndex: 'total_size',
    key: 'total_size',
    width: 100,
    align: 'right',
    sorter: true,
  },
  {
    title: '创建时间',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 160,
    sorter: true,
  },
  {
    title: '更新时间',
    dataIndex: 'updated_at',
    key: 'updated_at',
    width: 160,
    sorter: true,
  },
  {
    title: '操作',
    key: 'action',
    width: 200,
    fixed: 'right',
  },
];

// 计算属性
const projectStats = computed(() => projectStore.projectStats);

const paginatedData = computed(() => projectStore.paginatedProjects);

const hasSelected = computed(() => selectedRowKeys.value.length > 0);

const pagination = computed(() => ({
  current: projectStore.pagination.current,
  pageSize: projectStore.pagination.pageSize,
  total: projectStore.filteredProjects.length,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 条记录`,
  pageSizeOptions: ['10', '20', '50', '100'],
}));

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys) => {
    selectedRowKeys.value = keys;
  },
}));

// 辅助函数
const getProjectTypeLabel = (type) => {
  const map = {
    web: '网页',
    document: '文档',
    data: '数据',
    app: '应用',
    presentation: '演示',
    spreadsheet: '表格',
  };
  return map[type] || type;
};

const getProjectTypeColor = (type) => {
  const map = {
    web: 'blue',
    document: 'green',
    data: 'orange',
    app: 'purple',
    presentation: 'cyan',
    spreadsheet: 'magenta',
  };
  return map[type] || 'default';
};

const getStatusLabel = (status) => {
  const map = {
    draft: '草稿',
    active: '活跃',
    completed: '已完成',
    archived: '已归档',
  };
  return map[status] || status;
};

const getStatusColor = (status) => {
  const map = {
    draft: 'default',
    active: 'success',
    completed: 'processing',
    archived: 'warning',
  };
  return map[status] || 'default';
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 事件处理
const handleSearch = () => {
  projectStore.setFilter('searchKeyword', searchKeyword.value);
  projectStore.setPagination(1);
};

const handleFilterChange = () => {
  projectStore.setFilter('projectType', filterType.value);
  projectStore.setFilter('status', filterStatus.value);
  projectStore.setPagination(1);
};

const handleResetFilters = () => {
  searchKeyword.value = '';
  filterType.value = '';
  filterStatus.value = '';
  projectStore.resetFilters();
};

const handleTableChange = (pag, filters, sorter) => {
  // 分页
  projectStore.setPagination(pag.current, pag.pageSize);

  // 排序
  if (sorter.field && sorter.order) {
    const order = sorter.order === 'ascend' ? 'asc' : 'desc';
    projectStore.setSort(sorter.field, order);
  }
};

// CRUD 操作
const showCreateModal = () => {
  isEditing.value = false;
  currentEditId.value = null;
  Object.assign(formData, {
    name: '',
    description: '',
    project_type: '',
    status: 'draft',
    tags: [],
  });
  modalVisible.value = true;
};

const handleView = (record) => {
  router.push(`/projects/${record.id}`);
};

const handleEdit = (record) => {
  isEditing.value = true;
  currentEditId.value = record.id;

  // 回显数据
  Object.assign(formData, {
    name: record.name,
    description: record.description || '',
    project_type: record.project_type,
    status: record.status,
    tags: record.tags ? JSON.parse(record.tags) : [],
  });

  modalVisible.value = true;
};

const handleDelete = async (id) => {
  try {
    loading.value = true;
    await projectStore.deleteProject(id);
    message.success('删除成功');

    // 如果当前页没有数据了，返回上一页
    if (paginatedData.value.length === 0 && projectStore.pagination.current > 1) {
      projectStore.setPagination(projectStore.pagination.current - 1);
    }
  } catch (error) {
    console.error('删除项目失败:', error);
    message.error('删除失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleBatchDelete = () => {
  if (selectedRowKeys.value.length === 0) {
    message.warning('请先选择要删除的项目');
    return;
  }

  Modal.confirm({
    title: '批量删除确认',
    content: `确定要删除选中的 ${selectedRowKeys.value.length} 个项目吗？此操作不可恢复。`,
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        loading.value = true;

        // 逐个删除
        for (const id of selectedRowKeys.value) {
          await projectStore.deleteProject(id);
        }

        message.success(`成功删除 ${selectedRowKeys.value.length} 个项目`);
        selectedRowKeys.value = [];

        // 如果当前页没有数据了，返回第一页
        if (paginatedData.value.length === 0) {
          projectStore.setPagination(1);
        }
      } catch (error) {
        console.error('批量删除失败:', error);
        message.error('批量删除失败：' + error.message);
      } finally {
        loading.value = false;
      }
    },
  });
};

const handleModalOk = async () => {
  try {
    await formRef.value.validate();

    loading.value = true;

    const submitData = {
      name: formData.name,
      description: formData.description,
      project_type: formData.project_type,
      status: formData.status,
      tags: JSON.stringify(formData.tags),
      userId: authStore.currentUser?.id || 'default-user',
    };

    if (isEditing.value) {
      // 编辑
      await projectStore.updateProject(currentEditId.value, submitData);
      message.success('编辑成功');
    } else {
      // 新建
      await projectStore.createProject(submitData);
      message.success('创建成功');
    }

    modalVisible.value = false;
  } catch (error) {
    if (error.errorFields) {
      // 表单验证失败
      return;
    }
    console.error('保存项目失败:', error);
    message.error('保存失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleModalCancel = () => {
  modalVisible.value = false;
};

// 导出 Excel
const handleExport = () => {
  try {
    const data = projectStore.filteredProjects.map((item) => ({
      '项目名称': item.name,
      '项目描述': item.description || '',
      '项目类型': getProjectTypeLabel(item.project_type),
      '状态': getStatusLabel(item.status),
      '文件数': item.file_count || 0,
      '文件大小': formatFileSize(item.total_size || 0),
      '创建时间': formatDateTime(item.created_at),
      '更新时间': formatDateTime(item.updated_at),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '项目列表');

    const filename = `项目列表_${new Date().toLocaleDateString('zh-CN')}.xlsx`;
    XLSX.writeFile(wb, filename);

    message.success('导出成功');
  } catch (error) {
    console.error('导出失败:', error);
    message.error('导出失败：' + error.message);
  }
};

// 加载数据
const loadProjects = async () => {
  try {
    loading.value = true;
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
  } catch (error) {
    console.error('加载项目列表失败:', error);
    message.error('加载失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadProjects();
});
</script>

<style scoped lang="scss">
.project-management-page {
  padding: 24px;
  background: #f5f7fa;
  min-height: calc(100vh - 120px);
}

.page-header {
  background: white;
  border-radius: 8px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.stats-row {
  margin-bottom: 24px;
}

.filter-card {
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.table-card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.project-name-cell {
  .name {
    font-weight: 500;
    color: #1f2937;
    margin-bottom: 4px;
  }

  .description {
    font-size: 12px;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
