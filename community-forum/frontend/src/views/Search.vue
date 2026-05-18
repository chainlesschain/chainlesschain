<template>
  <div class="search-page">
    <!-- 搜索框 -->
    <div class="search-header">
      <el-input
        v-model="searchQuery"
        placeholder="搜索帖子、用户、标签..."
        size="large"
        :prefix-icon="Search"
        clearable
        @keyup.enter="handleSearch"
      >
        <template #append>
          <el-button :icon="Search" @click="handleSearch">搜索</el-button>
        </template>
      </el-input>

      <!-- 高级筛选 -->
      <div class="filters">
        <el-button
          :icon="Filter"
          @click="showFilters = !showFilters"
        >
          {{ showFilters ? '收起' : '高级筛选' }}
        </el-button>
      </div>
    </div>

    <!-- 高级筛选面板 -->
    <el-collapse-transition>
      <div v-show="showFilters" class="filters-panel">
        <el-form :inline="true" class="filter-form">
          <el-form-item label="分类">
            <el-select
              v-model="filters.categoryId"
              placeholder="全部分类"
              clearable
              @change="handleSearch"
            >
              <el-option
                v-for="category in categories"
                :key="category.id"
                :label="category.name"
                :value="category.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="标签">
            <el-select
              v-model="filters.tagId"
              placeholder="选择标签"
              clearable
              filterable
              @change="handleSearch"
            >
              <el-option
                v-for="tag in popularTags"
                :key="tag.id"
                :label="tag.name"
                :value="tag.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="时间">
            <el-select
              v-model="filters.timeRange"
              placeholder="全部时间"
              @change="handleSearch"
            >
              <el-option label="全部时间" value="all" />
              <el-option label="最近一天" value="day" />
              <el-option label="最近一周" value="week" />
              <el-option label="最近一月" value="month" />
              <el-option label="最近一年" value="year" />
            </el-select>
          </el-form-item>

          <el-form-item label="排序">
            <el-select
              v-model="filters.sortBy"
              @change="handleSearch"
            >
              <el-option label="相关度" value="relevance" />
              <el-option label="最新发布" value="latest" />
              <el-option label="最多回复" value="replies" />
              <el-option label="最多点赞" value="likes" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
    </el-collapse-transition>

    <!-- 搜索结果 -->
    <div class="search-results">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <!-- 全部结果 -->
        <el-tab-pane name="all">
          <template #label>
            <span>全部 <el-badge v-if="totalResults > 0" :value="totalResults" /></span>
          </template>

          <div v-if="loading" class="loading">
            <el-skeleton :rows="5" animated />
          </div>

          <div v-else-if="searchQuery && totalResults > 0" class="results-container">
            <!-- 帖子结果 -->
            <div v-if="postResults.length > 0" class="result-section">
              <div class="section-header">
                <h3>帖子 ({{ postResults.length }})</h3>
                <el-button text @click="activeTab = 'posts'">查看全部</el-button>
              </div>
              <PostCard
                v-for="post in postResults.slice(0, 5)"
                :key="post.id"
                :post="post"
                view-mode="list"
              />
            </div>

            <!-- 用户结果 -->
            <div v-if="userResults.length > 0" class="result-section">
              <div class="section-header">
                <h3>用户 ({{ userResults.length }})</h3>
                <el-button text @click="activeTab = 'users'">查看全部</el-button>
              </div>
              <div class="user-results">
                <div
                  v-for="user in userResults.slice(0, 5)"
                  :key="user.id"
                  class="user-item"
                  @click="router.push(`/users/${user.id}`)"
                >
                  <el-avatar :src="user.avatar" :size="48">
                    {{ user.nickname?.[0] }}
                  </el-avatar>
                  <div class="user-info">
                    <div class="user-name">{{ user.nickname }}</div>
                    <div class="user-stats">
                      {{ user.postsCount }} 帖子 · {{ user.reputation }} 声望
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <el-empty
            v-else-if="searchQuery"
            description="没有找到相关结果"
          >
            <el-button type="primary" @click="searchQuery = ''">清空搜索</el-button>
          </el-empty>

          <div v-else class="search-tips">
            <el-icon :size="64" color="var(--el-text-color-disabled)"><Search /></el-icon>
            <h3>搜索ChainlessChain社区</h3>
            <p>输入关键词搜索帖子、用户和标签</p>

            <div class="hot-searches">
              <h4>热门搜索</h4>
              <div class="tags">
                <el-tag
                  v-for="tag in popularTags.slice(0, 8)"
                  :key="tag.id"
                  @click="handleHotSearch(tag.name)"
                >
                  {{ tag.name }}
                </el-tag>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 帖子结果 -->
        <el-tab-pane name="posts">
          <template #label>
            <span>帖子 <el-badge v-if="postResults.length > 0" :value="postResults.length" /></span>
          </template>

          <div v-if="loading" class="loading">
            <el-skeleton :rows="5" animated />
          </div>

          <div v-else-if="postResults.length > 0" class="results-list">
            <PostCard
              v-for="post in postResults"
              :key="post.id"
              :post="post"
              view-mode="list"
            />
          </div>

          <el-empty v-else description="没有找到相关帖子" />
        </el-tab-pane>

        <!-- 用户结果 -->
        <el-tab-pane name="users">
          <template #label>
            <span>用户 <el-badge v-if="userResults.length > 0" :value="userResults.length" /></span>
          </template>

          <div v-if="loading" class="loading">
            <el-skeleton :rows="5" animated />
          </div>

          <div v-else-if="userResults.length > 0" class="user-results-full">
            <div
              v-for="user in userResults"
              :key="user.id"
              class="user-card"
              @click="router.push(`/users/${user.id}`)"
            >
              <el-avatar :src="user.avatar" :size="64">
                {{ user.nickname?.[0] }}
              </el-avatar>
              <div class="user-details">
                <div class="user-name">{{ user.nickname }}</div>
                <div class="user-bio">{{ user.bio || '这个人很懒，什么都没留下' }}</div>
                <div class="user-stats">
                  <span><strong>{{ user.postsCount }}</strong> 帖子</span>
                  <span><strong>{{ user.reputation }}</strong> 声望</span>
                  <span><strong>{{ user.followersCount }}</strong> 关注者</span>
                </div>
              </div>
            </div>
          </div>

          <el-empty v-else description="没有找到相关用户" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search, Filter } from '@element-plus/icons-vue'
import PostCard from '@/components/PostCard.vue'

const router = useRouter()
const route = useRoute()

const searchQuery = ref('')
const activeTab = ref('all')
const loading = ref(false)
const showFilters = ref(false)

// 筛选条件
const filters = ref({
  categoryId: null,
  tagId: null,
  timeRange: 'all',
  sortBy: 'relevance'
})

// 搜索结果
const postResults = ref([])
const userResults = ref([])

// 分类列表
const categories = ref([
  { id: 1, name: '问答', slug: 'qa' },
  { id: 2, name: '讨论', slug: 'discussion' },
  { id: 3, name: '反馈', slug: 'feedback' },
  { id: 4, name: '公告', slug: 'announcement' },
  { id: 5, name: '展示', slug: 'showcase' }
])

// 热门标签
const popularTags = ref([
  { id: 1, name: 'U盾' },
  { id: 2, name: 'SIMKey' },
  { id: 3, name: 'AI训练' },
  { id: 4, name: '去中心化' },
  { id: 5, name: 'Python' },
  { id: 6, name: 'JavaScript' },
  { id: 7, name: '安装问题' },
  { id: 8, name: '性能优化' }
])

// 总结果数
const totalResults = computed(() => {
  return postResults.value.length + userResults.value.length
})

// 执行搜索
const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }

  loading.value = true
  try {
    // 这里应该调用API
    // const response = await searchContent(searchQuery.value, filters.value)

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 800))

    // 生成模拟数据
    postResults.value = generateMockPosts(searchQuery.value)
    userResults.value = generateMockUsers(searchQuery.value)

    if (totalResults.value === 0) {
      ElMessage.info('没有找到相关结果')
    }
  } catch (error) {
    ElMessage.error('搜索失败')
  } finally {
    loading.value = false
  }
}

// 生成模拟帖子数据
const generateMockPosts = (query) => {
  const count = Math.floor(Math.random() * 10) + 5
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `${query} 相关的帖子 ${i + 1} - 如何使用ChainlessChain？`,
    excerpt: `这是关于 ${query} 的讨论内容。提供了详细的说明和示例代码...`,
    author: {
      id: i + 1,
      nickname: `用户${i + 1}`,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 1}`
    },
    category: {
      id: 1,
      name: '问答',
      slug: 'qa'
    },
    tags: [
      { id: 1, name: query, slug: query.toLowerCase() },
      { id: 2, name: 'AI', slug: 'ai' }
    ],
    viewsCount: Math.floor(Math.random() * 1000) + 50,
    repliesCount: Math.floor(Math.random() * 50),
    likesCount: Math.floor(Math.random() * 100),
    createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
  }))
}

// 生成模拟用户数据
const generateMockUsers = (query) => {
  const count = Math.floor(Math.random() * 5) + 3
  return Array.from({ length: count }, (_, i) => ({
    id: i + 100,
    nickname: `${query}爱好者${i + 1}`,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=user${i + 100}`,
    bio: `热爱${query}，分享技术经验`,
    postsCount: Math.floor(Math.random() * 100) + 10,
    reputation: Math.floor(Math.random() * 1000) + 100,
    followersCount: Math.floor(Math.random() * 500) + 50
  }))
}

// 热门搜索
const handleHotSearch = (keyword) => {
  searchQuery.value = keyword
  handleSearch()
}

// Tab切换
const handleTabChange = (tab) => {
  console.log('切换到', tab)
}

// 监听路由查询参数
watch(() => route.query.q, (newQuery) => {
  if (newQuery) {
    searchQuery.value = newQuery
    handleSearch()
  }
}, { immediate: true })

onMounted(() => {
  // 如果URL中有查询参数，自动搜索
  if (route.query.q) {
    searchQuery.value = route.query.q
    handleSearch()
  }
})
</script>

<style scoped lang="scss">
.search-page {
  max-width: 1000px;
  margin: 0 auto;
}

.search-header {
  margin-bottom: 24px;

  .filters {
    margin-top: 12px;
  }
}

.filters-panel {
  padding: 20px;
  margin-bottom: 24px;
  background: var(--el-bg-color);
  border-radius: 8px;

  .filter-form {
    :deep(.el-form-item) {
      margin-bottom: 0;
    }
  }
}

.search-results {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 24px;
  min-height: 400px;
}

.loading {
  padding: 20px;
}

.results-container {
  .result-section {
    margin-bottom: 32px;

    &:last-child {
      margin-bottom: 0;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid var(--el-border-color);

      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
    }
  }
}

.user-results {
  display: grid;
  gap: 12px;

  .user-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: var(--el-fill-color-light);
    }

    .user-info {
      flex: 1;

      .user-name {
        font-size: 16px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        margin-bottom: 4px;
      }

      .user-stats {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }
  }
}

.user-results-full {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;

  .user-card {
    display: flex;
    gap: 16px;
    padding: 20px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: var(--el-color-primary);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    }

    .user-details {
      flex: 1;

      .user-name {
        font-size: 16px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        margin-bottom: 8px;
      }

      .user-bio {
        font-size: 14px;
        color: var(--el-text-color-regular);
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .user-stats {
        display: flex;
        gap: 16px;
        font-size: 13px;
        color: var(--el-text-color-secondary);

        span {
          strong {
            color: var(--el-text-color-primary);
          }
        }
      }
    }
  }
}

.search-tips {
  text-align: center;
  padding: 60px 20px;

  .el-icon {
    margin-bottom: 24px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 24px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 0 0 40px;
    color: var(--el-text-color-secondary);
  }

  .hot-searches {
    max-width: 600px;
    margin: 0 auto;

    h4 {
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      text-align: left;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .el-tag {
        cursor: pointer;
      }
    }
  }
}

.results-list {
  .post-card {
    border-bottom: 1px solid var(--el-border-color);

    &:last-child {
      border-bottom: none;
    }
  }
}

@media (max-width: 768px) {
  .search-page {
    padding: 0;
  }

  .search-header {
    padding: 16px;
    margin-bottom: 0;
  }

  .filters-panel {
    border-radius: 0;

    .filter-form {
      :deep(.el-form-item) {
        display: block;
        margin-bottom: 12px;

        .el-form-item__label {
          display: block;
          margin-bottom: 8px;
        }

        .el-form-item__content {
          display: block;

          .el-select {
            width: 100%;
          }
        }
      }
    }
  }

  .search-results {
    border-radius: 0;
    padding: 16px;
  }

  .user-results-full {
    grid-template-columns: 1fr;
  }
}
</style>
