<template>
  <div class="tag-manager-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <TagsOutlined />
          标签管理
        </h1>
        <p class="page-description">
          管理会话标签，支持重命名、合并和删除
        </p>
      </div>
      <div class="header-right">
        <a-button @click="$router.push('/sessions')">
          <LeftOutlined />
          返回会话管理
        </a-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <a-row
      :gutter="16"
      class="stats-section"
    >
      <a-col :span="6">
        <a-statistic
          title="标签总数"
          :value="allTags.length"
          :loading="loading"
        >
          <template #prefix>
            <TagsOutlined style="color: #1890ff" />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="关联会话"
          :value="totalLinkedSessions"
          :loading="loading"
        >
          <template #prefix>
            <FileTextOutlined style="color: #52c41a" />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="最常用标签"
          :loading="loading"
        >
          <template #formatter>
            <span class="top-tag">{{ topTag?.name || "-" }}</span>
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="未使用标签"
          :value="unusedTagsCount"
          :loading="loading"
        >
          <template #prefix>
            <WarningOutlined style="color: #faad14" />
          </template>
        </a-statistic>
      </a-col>
    </a-row>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="left">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索标签..."
          style="width: 250px"
          allow-clear
          @search="handleSearch"
        />
        <a-select
          v-model:value="sortBy"
          style="width: 150px"
          @change="handleSortChange"
        >
          <a-select-option value="count-desc">
            使用次数 (多-少)
          </a-select-option>
          <a-select-option value="count-asc">
            使用次数 (少-多)
          </a-select-option>
          <a-select-option value="name-asc">
            名称 A-Z
          </a-select-option>
          <a-select-option value="name-desc">
            名称 Z-A
          </a-select-option>
        </a-select>
      </div>
      <div class="right">
        <a-button
          v-if="selectedTags.length > 0"
          type="primary"
          ghost
          @click="handleMergeSelected"
        >
          <MergeCellsOutlined />
          合并 ({{ selectedTags.length }})
        </a-button>
        <a-button
          v-if="selectedTags.length > 0"
          danger
          @click="handleDeleteSelected"
        >
          <DeleteOutlined />
          删除 ({{ selectedTags.length }})
        </a-button>
      </div>
    </div>

    <!-- 标签表格 -->
    <a-table
      :columns="columns"
      :data-source="filteredTags"
      :loading="loading"
      :pagination="pagination"
      :row-selection="rowSelection"
      :row-key="(record) => record.name"
      size="middle"
    >
      <!-- 标签名称列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div class="tag-name">
            <a-tag
              color="blue"
              @click="handleViewSessions(record.name)"
            >
              {{ record.name }}
            </a-tag>
          </div>
        </template>

        <!-- 使用次数列 -->
        <template v-else-if="column.key === 'count'">
          <a-badge
            :count="record.count"
            :number-style="{ backgroundColor: getCountColor(record.count) }"
            :overflow-count="999"
          />
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-tooltip title="查看关联会话">
              <a-button
                type="text"
                size="small"
                @click="handleViewSessions(record.name)"
              >
                <EyeOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="重命名">
              <a-button
                type="text"
                size="small"
                @click="handleRename(record)"
              >
                <EditOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除">
              <a-button
                type="text"
                size="small"
                danger
                @click="handleDelete(record.name)"
              >
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>

      <!-- 空状态 -->
      <template #emptyText>
        <a-empty description="暂无标签">
          <template #image>
            <TagsOutlined style="font-size: 64px; color: #d9d9d9" />
          </template>
        </a-empty>
      </template>
    </a-table>

    <!-- 重命名模态框 -->
    <a-modal
      v-model:open="renameModalVisible"
      title="重命名标签"
      :confirm-loading="renaming"
      @ok="confirmRename"
    >
      <a-form layout="vertical">
        <a-form-item label="原标签名">
          <a-input
            :value="renameForm.oldTag"
            disabled
          />
        </a-form-item>
        <a-form-item
          label="新标签名"
          required
        >
          <a-input
            v-model:value="renameForm.newTag"
            placeholder="输入新标签名"
            @press-enter="confirmRename"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 合并模态框 -->
    <a-modal
      v-model:open="mergeModalVisible"
      title="合并标签"
      :confirm-loading="merging"
      @ok="confirmMerge"
    >
      <a-alert
        message="合并后，所有选中的标签将被替换为目标标签"
        type="info"
        show-icon
        style="margin-bottom: 16px"
      />
      <a-form layout="vertical">
        <a-form-item label="要合并的标签">
          <div class="merge-source-tags">
            <a-tag
              v-for="tag in selectedTags"
              :key="tag"
              color="blue"
            >
              {{ tag }}
            </a-tag>
          </div>
        </a-form-item>
        <a-form-item
          label="合并到（目标标签）"
          required
        >
          <a-select
            v-model:value="mergeTargetTag"
            placeholder="选择或输入目标标签"
            show-search
            :options="mergeTargetOptions"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 关联会话抽屉 -->
    <a-drawer
      v-model:open="sessionsDrawerVisible"
      :title="`标签「${viewingTag}」的关联会话`"
      placement="right"
      :width="500"
    >
      <a-list
        :data-source="linkedSessions"
        :loading="loadingSessions"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="item.title || '未命名会话'"
              :description="formatDate(item.updatedAt)"
            >
              <template #avatar>
                <FileTextOutlined
                  style="font-size: 24px; color: #1890ff; margin-top: 8px"
                />
              </template>
            </a-list-item-meta>
            <template #actions>
              <a @click="goToSession(item.id)">查看</a>
            </template>
          </a-list-item>
        </template>
        <template #empty>
          <a-empty description="暂无关联会话" />
        </template>
      </a-list>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  TagsOutlined,
  LeftOutlined,
  FileTextOutlined,
  WarningOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  MergeCellsOutlined,
} from "@ant-design/icons-vue";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const store = useSessionStore();

// 状态
const loading = ref(false);
const searchQuery = ref("");
const sortBy = ref("count-desc");
const selectedTags = ref([]);
const renameModalVisible = ref(false);
const mergeModalVisible = ref(false);
const sessionsDrawerVisible = ref(false);
const renaming = ref(false);
const merging = ref(false);
const loadingSessions = ref(false);
const viewingTag = ref("");
const linkedSessions = ref([]);

// 重命名表单
const renameForm = ref({
  oldTag: "",
  newTag: "",
});

// 合并目标标签
const mergeTargetTag = ref(null);

// 从 store 获取所有标签
const allTags = computed(() => store.allTags);

// 计算属性：关联会话总数
const totalLinkedSessions = computed(() => {
  return allTags.value.reduce((sum, tag) => sum + (tag.count || 0), 0);
});

// 计算属性：最常用标签
const topTag = computed(() => {
  if (allTags.value.length === 0) {return null;}
  return [...allTags.value].sort((a, b) => b.count - a.count)[0];
});

// 计算属性：未使用标签数量
const unusedTagsCount = computed(() => {
  return allTags.value.filter((tag) => tag.count === 0).length;
});

// 计算属性：筛选和排序后的标签
const filteredTags = computed(() => {
  let result = [...allTags.value];

  // 搜索筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter((tag) => tag.name.toLowerCase().includes(query));
  }

  // 排序
  const [field, order] = sortBy.value.split("-");
  result.sort((a, b) => {
    if (field === "count") {
      return order === "desc" ? b.count - a.count : a.count - b.count;
    } else {
      return order === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    }
  });

  return result;
});

// 计算属性：合并目标选项
const mergeTargetOptions = computed(() => {
  return allTags.value
    .filter((tag) => !selectedTags.value.includes(tag.name))
    .map((tag) => ({
      value: tag.name,
      label: `${tag.name} (${tag.count} 个会话)`,
    }));
});

// 表格列定义
const columns = [
  {
    title: "标签名称",
    dataIndex: "name",
    key: "name",
    width: "50%",
  },
  {
    title: "使用次数",
    dataIndex: "count",
    key: "count",
    width: "25%",
    sorter: (a, b) => a.count - b.count,
  },
  {
    title: "操作",
    key: "actions",
    width: "25%",
    align: "center",
  },
];

// 分页配置
const pagination = computed(() => ({
  pageSize: 20,
  total: filteredTags.value.length,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 个标签`,
}));

// 行选择配置
const rowSelection = computed(() => ({
  selectedRowKeys: selectedTags.value,
  onChange: (keys) => {
    selectedTags.value = keys;
  },
}));

// 加载标签
const loadTags = async () => {
  loading.value = true;
  try {
    await store.loadAllTags();
  } catch (error) {
    message.error("加载标签失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

// 搜索
const handleSearch = () => {
  // 搜索由 computed 属性处理
};

// 排序变化
const handleSortChange = () => {
  // 排序由 computed 属性处理
};

// 查看关联会话
const handleViewSessions = async (tagName) => {
  viewingTag.value = tagName;
  sessionsDrawerVisible.value = true;
  loadingSessions.value = true;

  try {
    const details = await store.getTagDetails(tagName);
    linkedSessions.value = details.sessions || [];
  } catch (error) {
    message.error("加载关联会话失败: " + error.message);
    linkedSessions.value = [];
  } finally {
    loadingSessions.value = false;
  }
};

// 跳转到会话
const goToSession = (sessionId) => {
  router.push(`/sessions?view=${sessionId}`);
};

// 重命名
const handleRename = (tag) => {
  renameForm.value = {
    oldTag: tag.name,
    newTag: tag.name,
  };
  renameModalVisible.value = true;
};

// 确认重命名
const confirmRename = async () => {
  if (!renameForm.value.newTag.trim()) {
    message.warning("请输入新标签名");
    return;
  }

  if (renameForm.value.newTag === renameForm.value.oldTag) {
    renameModalVisible.value = false;
    return;
  }

  renaming.value = true;
  try {
    const result = await store.renameTag(
      renameForm.value.oldTag,
      renameForm.value.newTag,
    );
    message.success(`标签已重命名，影响 ${result.updated} 个会话`);
    renameModalVisible.value = false;
  } catch (error) {
    message.error("重命名失败: " + error.message);
  } finally {
    renaming.value = false;
  }
};

// 删除
const handleDelete = (tagName) => {
  Modal.confirm({
    title: "确认删除",
    content: `确定要删除标签「${tagName}」吗？此操作将从所有关联会话中移除该标签。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.deleteTag(tagName);
        message.success(`标签已删除，影响 ${result.updated} 个会话`);
      } catch (error) {
        message.error("删除失败: " + error.message);
      }
    },
  });
};

// 删除选中
const handleDeleteSelected = () => {
  if (selectedTags.value.length === 0) {return;}

  Modal.confirm({
    title: "确认批量删除",
    content: `确定要删除选中的 ${selectedTags.value.length} 个标签吗？此操作将从所有关联会话中移除这些标签。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.deleteTags([...selectedTags.value]);
        message.success(
          `已删除 ${result.deleted} 个标签，影响 ${result.updated} 个会话`,
        );
        selectedTags.value = [];
      } catch (error) {
        message.error("批量删除失败: " + error.message);
      }
    },
  });
};

// 合并选中
const handleMergeSelected = () => {
  if (selectedTags.value.length < 2) {
    message.info("请选择至少 2 个标签进行合并");
    return;
  }

  mergeTargetTag.value = null;
  mergeModalVisible.value = true;
};

// 确认合并
const confirmMerge = async () => {
  if (!mergeTargetTag.value) {
    message.warning("请选择目标标签");
    return;
  }

  merging.value = true;
  try {
    const result = await store.mergeTags(
      [...selectedTags.value],
      mergeTargetTag.value,
    );
    message.success(
      `已合并 ${result.merged} 个标签到「${mergeTargetTag.value}」，影响 ${result.updated} 个会话`,
    );
    mergeModalVisible.value = false;
    selectedTags.value = [];
  } catch (error) {
    message.error("合并失败: " + error.message);
  } finally {
    merging.value = false;
  }
};

// 获取使用次数颜色
const getCountColor = (count) => {
  if (count === 0) {return "#d9d9d9";}
  if (count < 3) {return "#1890ff";}
  if (count < 10) {return "#52c41a";}
  return "#722ed1";
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) {return "-";}
  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 初始化
onMounted(() => {
  loadTags();
});
</script>

<style lang="less" scoped>
.tag-manager-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 28px;
        font-weight: 600;
        color: #1a202c;
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .page-description {
        font-size: 14px;
        color: #718096;
        margin: 0;
      }
    }
  }

  .stats-section {
    margin-bottom: 24px;

    :deep(.ant-statistic) {
      background: #fff;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    }

    .top-tag {
      font-size: 16px;
      color: #1890ff;
      font-weight: 500;
    }
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding: 16px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);

    .left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  :deep(.ant-table) {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  }

  .tag-name {
    .ant-tag {
      cursor: pointer;
      transition: transform 0.2s;

      &:hover {
        transform: scale(1.05);
      }
    }
  }
}

.merge-source-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

// 响应式布局
@media (max-width: 768px) {
  .tag-manager-page {
    padding: 12px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      h1 {
        font-size: 22px;
      }
    }

    .toolbar {
      flex-direction: column;
      gap: 12px;

      .left,
      .right {
        width: 100%;
      }
    }
  }
}
</style>
