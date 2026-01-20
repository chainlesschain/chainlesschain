<template>
  <div class="knowledge-list-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <FileTextOutlined />
            我的知识
          </h1>
          <p>管理你的所有知识条目</p>
        </div>
        <div class="header-right">
          <a-space>
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索知识..."
              style="width: 300px"
              @search="handleSearch"
            />
            <a-button type="primary" size="large">
              <PlusOutlined />
              新建知识
            </a-button>
          </a-space>
        </div>
      </div>
    </div>

    <!-- 知识列表 -->
    <div class="knowledge-list">
      <!-- 列表头部 -->
      <div class="list-header">
        <span>共 {{ filteredKnowledgeItems.length }} 条知识</span>
        <a-space>
          <a-select v-model:value="sortBy" style="width: 120px">
            <a-select-option value="time"> 按时间 </a-select-option>
            <a-select-option value="title"> 按标题 </a-select-option>
          </a-select>
        </a-space>
      </div>

      <!-- 使用虚拟滚动网格 -->
      <virtual-grid
        ref="virtualGridRef"
        :items="filteredKnowledgeItems"
        :item-height="320"
        :responsive="{ xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }"
        :gap="16"
        :loading="loading"
        empty-text="暂无知识条目"
        class="knowledge-grid"
      >
        <template #default="{ item }">
          <a-card hoverable class="knowledge-card" @click="viewDetail(item)">
            <template #cover>
              <div
                class="card-cover"
                :style="{ background: getGradientByIndex(item.id) }"
              >
                <FileTextOutlined style="font-size: 48px; color: white" />
              </div>
            </template>
            <a-card-meta
              :title="item.title"
              :description="getDescription(item)"
            >
              <template #avatar>
                <a-avatar
                  :style="{ backgroundColor: getColorByIndex(item.id) }"
                >
                  {{ item.title.charAt(0) }}
                </a-avatar>
              </template>
            </a-card-meta>
            <template #actions>
              <a-tooltip title="编辑">
                <EditOutlined key="edit" @click.stop="editItem(item)" />
              </a-tooltip>
              <a-tooltip title="删除">
                <DeleteOutlined key="delete" @click.stop="deleteItem(item)" />
              </a-tooltip>
            </template>
          </a-card>
        </template>
        <template #empty>
          <a-empty description="暂无知识条目">
            <a-button type="primary"> <PlusOutlined /> 新建知识 </a-button>
          </a-empty>
        </template>
      </virtual-grid>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { Modal, message } from "ant-design-vue";
import {
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import VirtualGrid from "../components/common/VirtualGrid.vue";

const router = useRouter();
const store = useAppStore();

const searchQuery = ref("");
const sortBy = ref("time");
const loading = ref(false);
const virtualGridRef = ref(null);

// 渐变色和颜色数组
const gradients = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
];
const colors = ["#667eea", "#f093fb", "#4facfe", "#43e97b"];

const filteredKnowledgeItems = computed(() => {
  let items = [...store.knowledgeItems];

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query),
    );
  }

  // 排序
  if (sortBy.value === "time") {
    items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } else if (sortBy.value === "title") {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  return items;
});

const handleSearch = () => {
  // 搜索逻辑已在computed中实现
  // 重置虚拟滚动位置
  virtualGridRef.value?.scrollToTop();
};

const viewDetail = (item) => {
  router.push(`/knowledge/${item.id}`);
};

const editItem = (item) => {
  router.push(`/knowledge/${item.id}/edit`);
};

const deleteItem = (item) => {
  Modal.confirm({
    title: "确认删除",
    content: `确定要删除「${item.title}」吗？`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        await store.deleteKnowledgeItem(item.id);
        message.success("删除成功");
      } catch (error) {
        message.error("删除失败: " + error.message);
      }
    },
  });
};

const getDescription = (item) => {
  if (!item.content) {
    return "";
  }
  return item.content.length > 100
    ? item.content.substring(0, 100) + "..."
    : item.content;
};

// 基于 ID 获取稳定的渐变色（避免重渲染时颜色变化）
const getGradientByIndex = (id) => {
  const hash = typeof id === "string" ? id.charCodeAt(0) : id;
  return gradients[hash % gradients.length];
};

const getColorByIndex = (id) => {
  const hash = typeof id === "string" ? id.charCodeAt(0) : id;
  return colors[hash % colors.length];
};

onMounted(() => {
  // 加载知识列表
  loading.value = true;
  setTimeout(() => {
    loading.value = false;
  }, 500);
});
</script>

<style scoped>
.knowledge-list-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-header {
  background: white;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2937;
}

.header-left p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.knowledge-list {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  height: calc(100vh - 280px);
  display: flex;
  flex-direction: column;
}

.knowledge-grid {
  flex: 1;
  min-height: 0;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  font-weight: 500;
  color: #374151;
}

.knowledge-card {
  height: 100%;
}

.card-cover {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.ant-card-body) {
  padding: 16px;
}

:deep(.ant-card-meta-description) {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
