<template>
  <div class="category-page">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading">
      <el-skeleton :rows="8" animated />
    </div>

    <!-- 分类信息 -->
    <div v-else-if="category" class="category-container">
      <!-- 分类头部 -->
      <div class="category-header">
        <div class="category-icon">{{ category.icon }}</div>
        <div class="category-info">
          <h1>{{ category.name }}</h1>
          <p class="category-description">{{ category.description }}</p>
          <div class="category-stats">
            <span>{{ category.postsCount }} 帖子</span>
            <span>·</span>
            <span>{{ category.followersCount }} 关注</span>
          </div>
        </div>
        <el-button
          v-if="userStore.isLoggedIn"
          type="primary"
          :icon="EditPen"
          @click="router.push('/create')"
        >
          发布帖子
        </el-button>
      </div>

      <!-- 帖子列表 -->
      <PostList
        :posts="posts"
        :loading="postsLoading"
        :total="total"
        @update:page="handlePageChange"
        @update:pageSize="handlePageSizeChange"
        @update:sortBy="handleSortChange"
      />
    </div>

    <!-- 错误状态 -->
    <el-empty v-else description="分类不存在">
      <el-button type="primary" @click="router.push('/')">
        返回首页
      </el-button>
    </el-empty>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import { EditPen } from '@element-plus/icons-vue'
import PostList from '@/components/PostList.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(true)
const postsLoading = ref(false)
const category = ref(null)
const posts = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const sortBy = ref('latest')

// 加载分类信息
const loadCategory = async () => {
  loading.value = true
  try {
    // 模拟数据
    const categories = {
      qa: {
        slug: 'qa',
        name: '问答',
        icon: '❓',
        description: '提出问题或帮助其他用户解答疑惑',
        postsCount: 125,
        followersCount: 542
      },
      discussion: {
        slug: 'discussion',
        name: '讨论',
        icon: '💬',
        description: '技术交流和经验分享',
        postsCount: 342,
        followersCount: 1234
      },
      feedback: {
        slug: 'feedback',
        name: '反馈',
        icon: '📝',
        description: 'Bug反馈和功能建议',
        postsCount: 68,
        followersCount: 234
      },
      announcement: {
        slug: 'announcement',
        name: '公告',
        icon: '📢',
        description: '官方公告和版本更新',
        postsCount: 12,
        followersCount: 2134
      },
      showcase: {
        slug: 'showcase',
        name: '作品展示',
        icon: '🎨',
        description: '分享你的插件、脚本或案例',
        postsCount: 87,
        followersCount: 678
      }
    }

    category.value = categories[route.params.slug]

    if (category.value) {
      await loadPosts()
    }
  } catch (error) {
    ElMessage.error('加载分类失败')
  } finally {
    loading.value = false
  }
}

// 加载帖子
const loadPosts = async () => {
  postsLoading.value = true
  try {
    // 生成模拟数据
    await new Promise(resolve => setTimeout(resolve, 500))
    posts.value = generateMockPosts()
    total.value = 50
  } catch (error) {
    ElMessage.error('加载帖子失败')
  } finally {
    postsLoading.value = false
  }
}

// 生成模拟数据
const generateMockPosts = () => {
  return Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    title: `${category.value.name}相关帖子 ${i + 1} - ChainlessChain讨论`,
    excerpt: '这是帖子摘要内容，提供了简短的预览文字...',
    author: {
      id: i + 1,
      nickname: `用户${i + 1}`,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 1}`
    },
    category: {
      id: 1,
      name: category.value.name,
      slug: category.value.slug
    },
    tags: [
      { id: 1, name: 'U盾', slug: 'ukey' },
      { id: 2, name: 'AI', slug: 'ai' }
    ],
    viewsCount: Math.floor(Math.random() * 1000) + 50,
    repliesCount: Math.floor(Math.random() * 50),
    likesCount: Math.floor(Math.random() * 100),
    isPinned: i === 0,
    isResolved: i % 3 === 0,
    createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
  }))
}

// 页码变化
const handlePageChange = (page) => {
  currentPage.value = page
  loadPosts()
}

// 每页数量变化
const handlePageSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  loadPosts()
}

// 排序变化
const handleSortChange = (sort) => {
  sortBy.value = sort
  currentPage.value = 1
  loadPosts()
}

// 监听路由变化
watch(() => route.params.slug, () => {
  if (route.params.slug) {
    loadCategory()
  }
})

onMounted(() => {
  loadCategory()
})
</script>

<style scoped lang="scss">
.category-page {
  max-width: 1000px;
  margin: 0 auto;
}

.loading {
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.category-container {
  .category-header {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    padding: 32px;
    margin-bottom: 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    color: white;

    .category-icon {
      font-size: 64px;
      line-height: 1;
    }

    .category-info {
      flex: 1;

      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        font-weight: 700;
      }

      .category-description {
        margin: 0 0 12px;
        font-size: 16px;
        opacity: 0.9;
      }

      .category-stats {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        opacity: 0.85;
      }
    }

    .el-button {
      flex-shrink: 0;
    }
  }
}

@media (max-width: 768px) {
  .category-page {
    padding: 0;
  }

  .category-container {
    .category-header {
      flex-direction: column;
      padding: 24px;
      border-radius: 0;
      margin-bottom: 16px;

      .category-icon {
        font-size: 48px;
      }

      .category-info {
        h1 {
          font-size: 24px;
        }

        .category-description {
          font-size: 14px;
        }
      }

      .el-button {
        width: 100%;
      }
    }
  }
}
</style>
