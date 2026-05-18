<template>
  <div class="tag-page">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading">
      <el-skeleton :rows="8" animated />
    </div>

    <!-- 标签信息 -->
    <div v-else-if="tag" class="tag-container">
      <!-- 标签头部 -->
      <div class="tag-header">
        <div class="tag-badge">
          <el-tag size="large" effect="dark">{{ tag.name }}</el-tag>
        </div>
        <div class="tag-info">
          <h1>标签：{{ tag.name }}</h1>
          <p class="tag-description">{{ tag.description }}</p>
          <div class="tag-stats">
            <span>{{ tag.postsCount }} 帖子</span>
            <span>·</span>
            <span>{{ tag.followersCount }} 关注</span>
          </div>
        </div>
        <el-button
          v-if="userStore.isLoggedIn"
          type="primary"
          :icon="Plus"
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
    <el-empty v-else description="标签不存在">
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
import { Plus } from '@element-plus/icons-vue'
import PostList from '@/components/PostList.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(true)
const postsLoading = ref(false)
const tag = ref(null)
const posts = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const sortBy = ref('latest')

// 加载标签信息
const loadTag = async () => {
  loading.value = true
  try {
    // 模拟数据
    const tags = {
      ukey: {
        slug: 'ukey',
        name: 'U盾',
        description: '关于U盾硬件认证设备的讨论',
        postsCount: 89,
        followersCount: 234
      },
      simkey: {
        slug: 'simkey',
        name: 'SIMKey',
        description: 'SIM卡密钥相关技术和应用',
        postsCount: 76,
        followersCount: 198
      },
      'ai-training': {
        slug: 'ai-training',
        name: 'AI训练',
        description: '去中心化AI模型训练相关内容',
        postsCount: 145,
        followersCount: 567
      },
      decentralized: {
        slug: 'decentralized',
        name: '去中心化',
        description: '去中心化技术和架构讨论',
        postsCount: 234,
        followersCount: 789
      },
      python: {
        slug: 'python',
        name: 'Python',
        description: 'Python开发相关内容',
        postsCount: 178,
        followersCount: 456
      },
      javascript: {
        slug: 'javascript',
        name: 'JavaScript',
        description: 'JavaScript和前端开发',
        postsCount: 156,
        followersCount: 423
      }
    }

    tag.value = tags[route.params.slug]

    if (tag.value) {
      await loadPosts()
    }
  } catch (error) {
    ElMessage.error('加载标签失败')
  } finally {
    loading.value = false
  }
}

// 加载帖子
const loadPosts = async () => {
  postsLoading.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    posts.value = generateMockPosts()
    total.value = tag.value.postsCount
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
    title: `关于${tag.value.name}的讨论 ${i + 1} - ChainlessChain应用`,
    excerpt: `这是关于${tag.value.name}标签的帖子内容，提供了详细的技术讨论和实践经验...`,
    author: {
      id: i + 1,
      nickname: `${tag.value.name}爱好者${i + 1}`,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 100}`
    },
    category: {
      id: Math.floor(Math.random() * 3) + 1,
      name: ['问答', '讨论', '展示'][Math.floor(Math.random() * 3)],
      slug: ['qa', 'discussion', 'showcase'][Math.floor(Math.random() * 3)]
    },
    tags: [
      { id: 1, name: tag.value.name, slug: tag.value.slug },
      { id: 2, name: 'ChainlessChain', slug: 'chainlesschain' }
    ],
    viewsCount: Math.floor(Math.random() * 1000) + 50,
    repliesCount: Math.floor(Math.random() * 50),
    likesCount: Math.floor(Math.random() * 100),
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
    loadTag()
  }
})

onMounted(() => {
  loadTag()
})
</script>

<style scoped lang="scss">
.tag-page {
  max-width: 1000px;
  margin: 0 auto;
}

.loading {
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.tag-container {
  .tag-header {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    padding: 32px;
    margin-bottom: 24px;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    border-radius: 12px;
    color: white;

    .tag-badge {
      flex-shrink: 0;

      :deep(.el-tag) {
        font-size: 24px;
        padding: 12px 24px;
        border-radius: 8px;
      }
    }

    .tag-info {
      flex: 1;

      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        font-weight: 700;
      }

      .tag-description {
        margin: 0 0 12px;
        font-size: 16px;
        opacity: 0.9;
      }

      .tag-stats {
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
  .tag-page {
    padding: 0;
  }

  .tag-container {
    .tag-header {
      flex-direction: column;
      padding: 24px;
      border-radius: 0;
      margin-bottom: 16px;

      .tag-info {
        h1 {
          font-size: 24px;
        }

        .tag-description {
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
