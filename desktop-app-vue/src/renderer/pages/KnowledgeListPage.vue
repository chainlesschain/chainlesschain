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
              placeholder="搜索知识..."
              style="width: 300px"
              v-model:value="searchQuery"
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
      <a-list
        :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }"
        :data-source="filteredKnowledgeItems"
        :loading="loading"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-card
              hoverable
              @click="viewDetail(item)"
              class="knowledge-card"
            >
              <template #cover>
                <div class="card-cover" :style="{ background: getRandomGradient() }">
                  <FileTextOutlined style="font-size: 48px; color: white" />
                </div>
              </template>
              <a-card-meta
                :title="item.title"
                :description="item.content.substring(0, 100) + '...'"
              >
                <template #avatar>
                  <a-avatar :style="{ backgroundColor: getRandomColor() }">
                    {{ item.title.charAt(0) }}
                  </a-avatar>
                </template>
              </a-card-meta>
              <template #actions>
                <a-tooltip title="编辑">
                  <EditOutlined key="edit" />
                </a-tooltip>
                <a-tooltip title="删除">
                  <DeleteOutlined key="delete" />
                </a-tooltip>
              </template>
            </a-card>
          </a-list-item>
        </template>
        <template #header>
          <div class="list-header">
            <span>共 {{ filteredKnowledgeItems.length }} 条知识</span>
            <a-space>
              <a-select v-model:value="sortBy" style="width: 120px">
                <a-select-option value="time">按时间</a-select-option>
                <a-select-option value="title">按标题</a-select-option>
              </a-select>
            </a-space>
          </div>
        </template>
      </a-list>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import {
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();
const store = useAppStore();

const searchQuery = ref('');
const sortBy = ref('time');
const loading = ref(false);

const filteredKnowledgeItems = computed(() => {
  let items = [...store.knowledgeItems];

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(item =>
      item.title.toLowerCase().includes(query) ||
      item.content.toLowerCase().includes(query)
    );
  }

  // 排序
  if (sortBy.value === 'time') {
    items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } else if (sortBy.value === 'title') {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  return items;
});

const handleSearch = () => {
  // 搜索逻辑已在computed中实现
};

const viewDetail = (item) => {
  router.push(`/knowledge/${item.id}`);
};

const getRandomGradient = () => {
  const gradients = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  ];
  return gradients[Math.floor(Math.random() * gradients.length)];
};

const getRandomColor = () => {
  const colors = ['#667eea', '#f093fb', '#4facfe', '#43e97b'];
  return colors[Math.floor(Math.random() * colors.length)];
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
