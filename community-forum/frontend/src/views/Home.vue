<template>
  <div class="home-page">
    <!-- Hero横幅 -->
    <section class="hero-banner">
      <div class="hero-content">
        <h1 class="hero-title">欢迎来到ChainlessChain社区</h1>
        <p class="hero-subtitle">讨论、分享、共建去中心化AI生态</p>
        <div class="hero-actions">
          <el-button
            v-if="userStore.isLoggedIn"
            type="primary"
            size="large"
            :icon="EditPen"
            @click="router.push('/create')"
          >
            发布帖子
          </el-button>
          <el-button
            v-else
            type="primary"
            size="large"
            @click="router.push('/login')"
          >
            立即登录
          </el-button>
          <el-button
            size="large"
            @click="scrollToContent"
          >
            浏览内容
          </el-button>
        </div>
      </div>
      <div class="hero-image">
        <el-icon :size="120" color="#409eff"><Connection /></el-icon>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="quick-links">
      <router-link
        v-for="category in quickCategories"
        :key="category.slug"
        :to="`/categories/${category.slug}`"
        class="quick-link-card"
      >
        <div class="card-icon" :style="{ background: category.color }">
          <el-icon :size="32">
            <component :is="category.icon" />
          </el-icon>
        </div>
        <h3>{{ category.name }}</h3>
        <p>{{ category.description }}</p>
        <div class="card-count">{{ category.postsCount }} 帖子</div>
      </router-link>
    </section>

    <!-- 帖子列表 -->
    <section ref="contentSection" class="posts-section">
      <div class="section-header">
        <h2>最新讨论</h2>
        <el-button
          v-if="userStore.isLoggedIn"
          type="primary"
          :icon="EditPen"
          @click="router.push('/create')"
        >
          发布帖子
        </el-button>
      </div>

      <PostList
        :posts="posts"
        :loading="loading"
        :total="total"
        @update:page="handlePageChange"
        @update:pageSize="handlePageSizeChange"
        @update:sortBy="handleSortChange"
      />
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { EditPen, Connection, QuestionFilled, ChatDotRound, MessageBox, BellFilled } from '@element-plus/icons-vue'
import PostList from '@/components/PostList.vue'
import { getPosts } from '@/api/posts'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()

const contentSection = ref(null)
const loading = ref(false)
const posts = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const sortBy = ref('latest')

// 快捷分类
const quickCategories = ref([
  {
    slug: 'qa',
    name: '问答',
    description: '提出问题或帮助其他用户',
    icon: 'QuestionFilled',
    color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    postsCount: 125
  },
  {
    slug: 'discussion',
    name: '讨论',
    description: '分享经验和技术交流',
    icon: 'ChatDotRound',
    color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    postsCount: 342
  },
  {
    slug: 'feedback',
    name: '反馈',
    description: 'Bug反馈和功能建议',
    icon: 'MessageBox',
    color: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    postsCount: 68
  },
  {
    slug: 'announcement',
    name: '公告',
    description: '官方公告和版本更新',
    icon: 'BellFilled',
    color: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    postsCount: 12
  }
])

// 滚动到内容区域
const scrollToContent = () => {
  contentSection.value?.scrollIntoView({ behavior: 'smooth' })
}

// 加载帖子列表
const loadPosts = async () => {
  loading.value = true
  try {
    const response = await getPosts({
      page: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value
    })
    posts.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    ElMessage.error('加载帖子失败')
    // 使用模拟数据
    posts.value = generateMockPosts()
    total.value = 50
  } finally {
    loading.value = false
  }
}

// 生成模拟数据
const generateMockPosts = () => {
  const mockPosts = []
  for (let i = 1; i <= 20; i++) {
    mockPosts.push({
      id: i,
      title: `这是第 ${i} 个帖子标题 - 关于ChainlessChain的讨论`,
      excerpt: '这是帖子摘要内容，提供了简短的预览文字。这里可以展示帖子的主要内容概述...',
      author: {
        id: i,
        nickname: `用户${i}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`
      },
      category: {
        id: 1,
        name: '问答',
        slug: 'qa'
      },
      tags: [
        { id: 1, name: 'U盾', slug: 'ukey' },
        { id: 2, name: 'AI', slug: 'ai' }
      ],
      viewsCount: Math.floor(Math.random() * 1000) + 50,
      repliesCount: Math.floor(Math.random() * 50),
      likesCount: Math.floor(Math.random() * 100),
      isPinned: i === 1,
      isResolved: i % 3 === 0,
      createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
    })
  }
  return mockPosts
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

onMounted(() => {
  loadPosts()
})
</script>

<style scoped lang="scss">
.home-page {
  padding-bottom: 40px;
}

.hero-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
  padding: 60px 40px;
  margin-bottom: 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  color: white;

  .hero-content {
    flex: 1;

    .hero-title {
      margin: 0 0 16px;
      font-size: 42px;
      font-weight: 700;
      line-height: 1.2;
    }

    .hero-subtitle {
      margin: 0 0 32px;
      font-size: 18px;
      opacity: 0.9;
    }

    .hero-actions {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
  }

  .hero-image {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    backdrop-filter: blur(10px);
  }
}

.quick-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 40px;

  .quick-link-card {
    display: flex;
    flex-direction: column;
    padding: 24px;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 12px;
    text-decoration: none;
    color: inherit;
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
      border-color: var(--el-color-primary);
    }

    .card-icon {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      color: white;
      margin-bottom: 16px;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    p {
      margin: 0 0 12px;
      font-size: 14px;
      color: var(--el-text-color-secondary);
      line-height: 1.6;
      flex: 1;
    }

    .card-count {
      font-size: 12px;
      color: var(--el-text-color-disabled);
    }
  }
}

.posts-section {
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }
  }
}

@media (max-width: 1024px) {
  .hero-banner {
    padding: 40px 24px;

    .hero-image {
      display: none;
    }
  }

  .quick-links {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
}

@media (max-width: 768px) {
  .hero-banner {
    padding: 32px 20px;

    .hero-content {
      .hero-title {
        font-size: 32px;
      }

      .hero-subtitle {
        font-size: 16px;
      }

      .hero-actions {
        flex-direction: column;

        .el-button {
          width: 100%;
        }
      }
    }
  }

  .quick-links {
    grid-template-columns: 1fr;
  }

  .posts-section {
    .section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;

      .el-button {
        width: 100%;
      }
    }
  }
}
</style>
