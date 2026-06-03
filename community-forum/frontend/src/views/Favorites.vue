<template>
  <div class="favorites-page">
    <div class="page-header">
      <h1>我的收藏</h1>
      <el-dropdown @command="handleSort">
        <el-button>
          {{ sortLabel }}
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="latest">最新收藏</el-dropdown-item>
            <el-dropdown-item command="oldest">最早收藏</el-dropdown-item>
            <el-dropdown-item command="hot">最热门</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <el-card class="favorites-card">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="全部收藏" name="all">
          <div v-if="filteredFavorites.length > 0" class="favorites-list">
            <PostCard
              v-for="post in filteredFavorites"
              :key="post.id"
              :post="post"
              view-mode="list"
              @click="router.push(`/posts/${post.id}`)"
            >
              <template #actions>
                <el-button
                  size="small"
                  text
                  type="danger"
                  :icon="Delete"
                  @click.stop="removeFavorite(post.id)"
                >
                  取消收藏
                </el-button>
              </template>
            </PostCard>
          </div>
          <el-empty v-else description="还没有收藏任何帖子">
            <el-button type="primary" @click="router.push('/')">去首页逛逛</el-button>
          </el-empty>
        </el-tab-pane>

        <el-tab-pane label="问答" name="qa">
          <div v-if="qaFavorites.length > 0" class="favorites-list">
            <PostCard
              v-for="post in qaFavorites"
              :key="post.id"
              :post="post"
              view-mode="list"
            />
          </div>
          <el-empty v-else description="暂无问答类收藏" />
        </el-tab-pane>

        <el-tab-pane label="讨论" name="discussion">
          <div v-if="discussionFavorites.length > 0" class="favorites-list">
            <PostCard
              v-for="post in discussionFavorites"
              :key="post.id"
              :post="post"
              view-mode="list"
            />
          </div>
          <el-empty v-else description="暂无讨论类收藏" />
        </el-tab-pane>
      </el-tabs>

      <div v-if="filteredFavorites.length > 0" class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Delete } from '@element-plus/icons-vue'
import PostCard from '@/components/PostCard.vue'

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref('all')
const sortBy = ref('latest')
const favorites = ref([])
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const sortLabel = computed(() => {
  const labels = {
    latest: '最新收藏',
    oldest: '最早收藏',
    hot: '最热门'
  }
  return labels[sortBy.value]
})

const filteredFavorites = computed(() => {
  let filtered = favorites.value

  if (activeTab.value === 'qa') {
    filtered = filtered.filter(post => post.category.slug === 'qa')
  } else if (activeTab.value === 'discussion') {
    filtered = filtered.filter(post => post.category.slug === 'discussion')
  }

  return filtered
})

const qaFavorites = computed(() =>
  favorites.value.filter(post => post.category.slug === 'qa')
)

const discussionFavorites = computed(() =>
  favorites.value.filter(post => post.category.slug === 'discussion')
)

const handleSort = (command) => {
  sortBy.value = command
  loadFavorites()
}

const loadFavorites = async () => {
  try {
    // 模拟数据
    const mockFavorites = []
    for (let i = 1; i <= 15; i++) {
      mockFavorites.push({
        id: i,
        title: `收藏的帖子 ${i} - ${i % 2 === 0 ? 'U盾使用技巧' : 'AI训练经验分享'}`,
        excerpt: '这是一篇很有价值的帖子，值得收藏学习...',
        author: {
          id: i + 10,
          nickname: `作者${i}`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 10}`
        },
        category: {
          id: i % 2 + 1,
          name: i % 2 === 0 ? '问答' : '讨论',
          slug: i % 2 === 0 ? 'qa' : 'discussion'
        },
        tags: [
          { id: 1, name: i % 2 === 0 ? 'U盾' : 'AI', slug: i % 2 === 0 ? 'ukey' : 'ai' }
        ],
        viewsCount: Math.floor(Math.random() * 2000) + 100,
        repliesCount: Math.floor(Math.random() * 80),
        likesCount: Math.floor(Math.random() * 200),
        isPinned: false,
        isResolved: i % 3 === 0,
        createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    favorites.value = mockFavorites
    pagination.total = 15
  } catch (error) {
    ElMessage.error('加载收藏失败')
  }
}

const removeFavorite = async (postId) => {
  try {
    await ElMessageBox.confirm('确定要取消收藏这篇帖子吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    favorites.value = favorites.value.filter(post => post.id !== postId)
    pagination.total--
    ElMessage.success('已取消收藏')
  } catch {
    // 取消
  }
}

onMounted(() => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  loadFavorites()
})
</script>

<style scoped lang="scss">
.favorites-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }
}

.favorites-card {
  .favorites-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }
}

@media (max-width: 768px) {
  .favorites-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h1 {
      font-size: 22px;
    }
  }
}
</style>
