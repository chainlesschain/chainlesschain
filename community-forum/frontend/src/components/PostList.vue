<template>
  <div class="post-list">
    <!-- 筛选和排序 -->
    <div class="list-header">
      <div class="filter-tabs">
        <el-radio-group v-model="sortBy" @change="handleSortChange">
          <el-radio-button value="latest">最新</el-radio-button>
          <el-radio-button value="hot">最热</el-radio-button>
          <el-radio-button value="unanswered">未回答</el-radio-button>
        </el-radio-group>
      </div>

      <div class="view-mode">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="list">
            <el-icon><List /></el-icon>
          </el-radio-button>
          <el-radio-button value="grid">
            <el-icon><Grid /></el-icon>
          </el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-skeleton v-for="i in 5" :key="i" :rows="3" animated />
    </div>

    <!-- 帖子列表 -->
    <div v-else-if="posts.length > 0" :class="['posts-container', `view-${viewMode}`]">
      <PostCard
        v-for="post in posts"
        :key="post.id"
        :post="post"
        :view-mode="viewMode"
        @click="handlePostClick(post.id)"
      />
    </div>

    <!-- 空状态 -->
    <el-empty v-else description="暂无帖子" />

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { List, Grid } from '@element-plus/icons-vue'
import PostCard from './PostCard.vue'

const props = defineProps({
  posts: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  total: {
    type: Number,
    default: 0
  },
  defaultPageSize: {
    type: Number,
    default: 20
  }
})

const emit = defineEmits(['update:page', 'update:pageSize', 'update:sortBy'])

const router = useRouter()

const sortBy = ref('latest')
const viewMode = ref('list')
const currentPage = ref(1)
const pageSize = ref(props.defaultPageSize)

// 排序变化
const handleSortChange = (value) => {
  emit('update:sortBy', value)
  currentPage.value = 1
}

// 页码变化
const handlePageChange = (page) => {
  emit('update:page', page)
}

// 每页数量变化
const handleSizeChange = (size) => {
  emit('update:pageSize', size)
  currentPage.value = 1
}

// 点击帖子
const handlePostClick = (postId) => {
  router.push(`/posts/${postId}`)
}
</script>

<style scoped lang="scss">
.post-list {
  background: var(--el-bg-color);
  border-radius: 8px;
  overflow: hidden;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color);

  .filter-tabs {
    flex: 1;
  }

  .view-mode {
    margin-left: 16px;
  }
}

.loading-container {
  padding: 16px;

  .el-skeleton {
    margin-bottom: 16px;
    padding: 16px;
    border-bottom: 1px solid var(--el-border-color);

    &:last-child {
      border-bottom: none;
    }
  }
}

.posts-container {
  &.view-list {
    .post-card {
      border-bottom: 1px solid var(--el-border-color);

      &:last-child {
        border-bottom: none;
      }
    }
  }

  &.view-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    padding: 16px;
  }
}

.pagination {
  display: flex;
  justify-content: center;
  padding: 20px;
  border-top: 1px solid var(--el-border-color);
}

@media (max-width: 768px) {
  .list-header {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;

    .view-mode {
      margin-left: 0;
      align-self: flex-end;
    }
  }

  .posts-container.view-grid {
    grid-template-columns: 1fr;
  }
}
</style>
