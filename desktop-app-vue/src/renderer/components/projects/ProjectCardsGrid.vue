<template>
  <div class="project-cards-grid-wrapper">
    <!-- 网格布局 -->
    <div
      :class="['projects-grid', `grid-cols-${columns}`]"
      :style="gridStyle"
    >
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        @view="handleView"
        @edit="handleEdit"
        @delete="handleDelete"
        @share="handleShare"
        @favorite="handleFavorite"
      />
    </div>

    <!-- 空状态 -->
    <div
      v-if="projects.length === 0 && !loading"
      class="empty-state"
    >
      <div class="empty-icon">
        <InboxOutlined />
      </div>
      <h3 class="empty-title">
        {{ emptyTitle }}
      </h3>
      <p class="empty-description">
        {{ emptyDescription }}
      </p>
      <a-button
        v-if="showCreateButton"
        type="primary"
        @click="handleCreate"
      >
        <PlusOutlined />
        {{ createButtonText }}
      </a-button>
    </div>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="loading-state"
    >
      <a-spin
        size="large"
        :tip="loadingText"
      />
    </div>

    <!-- 分页 -->
    <div
      v-if="showPagination && totalProjects > pageSize"
      class="pagination-wrapper"
    >
      <a-pagination
        v-model:current="currentPage"
        v-model:page-size="currentPageSize"
        :total="totalProjects"
        :show-total="showTotal ? (total) => `共 ${total} 个项目` : undefined"
        :show-size-changer="showSizeChanger"
        :page-size-options="pageSizeOptions"
        @change="handlePageChange"
        @show-size-change="handlePageSizeChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons-vue';
import ProjectCard from './ProjectCard.vue';

const props = defineProps({
  projects: {
    type: Array,
    default: () => [],
  },
  columns: {
    type: Number,
    default: 4,
    validator: (value) => [2, 3, 4, 6].includes(value),
  },
  gap: {
    type: String,
    default: '24px',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: '加载中...',
  },
  emptyTitle: {
    type: String,
    default: '暂无项目',
  },
  emptyDescription: {
    type: String,
    default: '开始创建您的第一个项目吧',
  },
  showCreateButton: {
    type: Boolean,
    default: true,
  },
  createButtonText: {
    type: String,
    default: '创建项目',
  },
  showPagination: {
    type: Boolean,
    default: true,
  },
  page: {
    type: Number,
    default: 1,
  },
  pageSize: {
    type: Number,
    default: 12,
  },
  total: {
    type: Number,
    default: 0,
  },
  showTotal: {
    type: Boolean,
    default: true,
  },
  showSizeChanger: {
    type: Boolean,
    default: true,
  },
  pageSizeOptions: {
    type: Array,
    default: () => ['12', '24', '48'],
  },
});

const emit = defineEmits([
  'view',
  'edit',
  'delete',
  'share',
  'favorite',
  'create',
  'page-change',
  'page-size-change',
  'update:page',
  'update:pageSize',
]);

const currentPage = ref(props.page);
const currentPageSize = ref(props.pageSize);

const totalProjects = computed(() => props.total || props.projects.length);

const gridStyle = computed(() => ({
  gap: props.gap,
}));

// 监听外部page变化
watch(() => props.page, (newVal) => {
  currentPage.value = newVal;
});

watch(() => props.pageSize, (newVal) => {
  currentPageSize.value = newVal;
});

const handleView = (project) => {
  emit('view', project);
};

const handleEdit = (project) => {
  emit('edit', project);
};

const handleDelete = (project) => {
  emit('delete', project);
};

const handleShare = (project) => {
  emit('share', project);
};

const handleFavorite = (project) => {
  emit('favorite', project);
};

const handleCreate = () => {
  emit('create');
};

const handlePageChange = (page, pageSize) => {
  currentPage.value = page;
  emit('update:page', page);
  emit('page-change', page, pageSize);
};

const handlePageSizeChange = (current, size) => {
  currentPageSize.value = size;
  emit('update:pageSize', size);
  emit('page-size-change', current, size);
};
</script>

<style scoped lang="scss">
.project-cards-grid-wrapper {
  width: 100%;
}

.projects-grid {
  display: grid;
  width: 100%;
  margin-bottom: 32px;

  &.grid-cols-2 {
    grid-template-columns: repeat(2, 1fr);
  }

  &.grid-cols-3 {
    grid-template-columns: repeat(3, 1fr);
  }

  &.grid-cols-4 {
    grid-template-columns: repeat(4, 1fr);
  }

  &.grid-cols-6 {
    grid-template-columns: repeat(6, 1fr);
  }

  // 响应式布局
  @media (max-width: 1600px) {
    &.grid-cols-6 {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @media (max-width: 1200px) {
    &.grid-cols-4,
    &.grid-cols-6 {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 992px) {
    &.grid-cols-3,
    &.grid-cols-4,
    &.grid-cols-6 {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 576px) {
    &.grid-cols-2,
    &.grid-cols-3,
    &.grid-cols-4,
    &.grid-cols-6 {
      grid-template-columns: 1fr;
    }
  }
}

.empty-state {
  text-align: center;
  padding: 80px 20px;

  .empty-icon {
    font-size: 80px;
    color: #D1D5DB;
    margin-bottom: 24px;
  }

  .empty-title {
    font-size: 20px;
    font-weight: 600;
    color: #333;
    margin: 0 0 12px 0;
  }

  .empty-description {
    font-size: 15px;
    color: #666;
    margin: 0 0 24px 0;
  }
}

.loading-state {
  text-align: center;
  padding: 80px 20px;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
