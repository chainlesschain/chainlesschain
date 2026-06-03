<template>
  <div class="user-profile-page">
    <el-skeleton v-if="loading" :rows="12" animated />

    <template v-else-if="user">
      <!-- 用户信息卡片 -->
      <el-card class="user-info-card">
        <div class="user-header">
          <el-avatar :size="100" :src="user.avatar" />
          <div class="user-main">
            <div class="user-title">
              <h1>{{ user.nickname }}</h1>
              <el-tag v-if="user.role === 'admin'" type="danger" effect="dark">管理员</el-tag>
              <el-tag v-else-if="user.role === 'moderator'" type="warning" effect="dark">版主</el-tag>
              <el-tag v-else type="info">用户</el-tag>
            </div>
            <p v-if="user.bio" class="user-bio">{{ user.bio }}</p>
            <p v-else class="user-bio empty">这个人很懒，什么都没写</p>

            <div class="user-meta">
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                加入于 {{ formatDate(user.createdAt) }}
              </span>
              <span v-if="user.location" class="meta-item">
                <el-icon><Location /></el-icon>
                {{ user.location }}
              </span>
              <span v-if="user.website" class="meta-item">
                <el-icon><Link /></el-icon>
                <a :href="user.website" target="_blank" rel="noopener">{{ user.website }}</a>
              </span>
            </div>

            <div class="user-actions">
              <el-button
                v-if="!isCurrentUser"
                type="primary"
                :icon="Plus"
                @click="handleFollow"
              >
                {{ user.isFollowing ? '已关注' : '关注' }}
              </el-button>
              <el-button
                v-if="!isCurrentUser"
                :icon="ChatDotRound"
                @click="handleMessage"
              >
                发私信
              </el-button>
              <el-button
                v-if="isCurrentUser"
                :icon="Edit"
                @click="router.push('/profile')"
              >
                编辑资料
              </el-button>
            </div>
          </div>
        </div>

        <!-- 统计信息 -->
        <el-divider />
        <div class="user-stats">
          <div class="stat-item">
            <div class="stat-value">{{ user.postsCount }}</div>
            <div class="stat-label">帖子</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ user.repliesCount }}</div>
            <div class="stat-label">回复</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ user.likesCount }}</div>
            <div class="stat-label">获赞</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ user.followersCount }}</div>
            <div class="stat-label">粉丝</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ user.followingCount }}</div>
            <div class="stat-label">关注</div>
          </div>
        </div>
      </el-card>

      <!-- 内容Tab -->
      <el-card class="content-card">
        <el-tabs v-model="activeTab" @tab-change="handleTabChange">
          <el-tab-pane label="帖子" name="posts">
            <div v-if="posts.length > 0" class="posts-list">
              <PostCard
                v-for="post in posts"
                :key="post.id"
                :post="post"
                view-mode="list"
              />
            </div>
            <el-empty v-else description="还没有发布帖子" />

            <div v-if="postsPagination.total > postsPagination.pageSize" class="pagination">
              <el-pagination
                v-model:current-page="postsPagination.page"
                v-model:page-size="postsPagination.pageSize"
                :total="postsPagination.total"
                :page-sizes="[10, 20, 50]"
                layout="total, sizes, prev, pager, next"
                @current-change="loadPosts"
                @size-change="loadPosts"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="回复" name="replies">
            <div v-if="replies.length > 0" class="replies-list">
              <div v-for="reply in replies" :key="reply.id" class="reply-item">
                <div class="reply-header">
                  <router-link :to="`/posts/${reply.post.id}`" class="post-title">
                    回复了: {{ reply.post.title }}
                  </router-link>
                  <span class="reply-time">{{ formatRelativeTime(reply.createdAt) }}</span>
                </div>
                <div class="reply-content markdown-body" v-html="renderMarkdown(reply.content)"></div>
                <div class="reply-actions">
                  <span class="action-item">
                    <el-icon><View /></el-icon>
                    {{ reply.post.viewsCount }} 浏览
                  </span>
                  <span class="action-item">
                    <el-icon><ChatDotRound /></el-icon>
                    {{ reply.post.repliesCount }} 回复
                  </span>
                </div>
              </div>
            </div>
            <el-empty v-else description="还没有回复" />

            <div v-if="repliesPagination.total > repliesPagination.pageSize" class="pagination">
              <el-pagination
                v-model:current-page="repliesPagination.page"
                v-model:page-size="repliesPagination.pageSize"
                :total="repliesPagination.total"
                :page-sizes="[10, 20, 50]"
                layout="total, sizes, prev, pager, next"
                @current-change="loadReplies"
                @size-change="loadReplies"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="关注" name="following">
            <div v-if="following.length > 0" class="users-grid">
              <div v-for="followUser in following" :key="followUser.id" class="user-card">
                <router-link :to="`/users/${followUser.id}`">
                  <el-avatar :size="60" :src="followUser.avatar" />
                </router-link>
                <router-link :to="`/users/${followUser.id}`" class="user-name">
                  {{ followUser.nickname }}
                </router-link>
                <p class="user-desc">{{ followUser.bio || '暂无简介' }}</p>
                <div class="user-stats-mini">
                  <span>{{ followUser.postsCount }} 帖子</span>
                  <span>{{ followUser.followersCount }} 粉丝</span>
                </div>
              </div>
            </div>
            <el-empty v-else description="还没有关注任何人" />
          </el-tab-pane>

          <el-tab-pane label="粉丝" name="followers">
            <div v-if="followers.length > 0" class="users-grid">
              <div v-for="follower in followers" :key="follower.id" class="user-card">
                <router-link :to="`/users/${follower.id}`">
                  <el-avatar :size="60" :src="follower.avatar" />
                </router-link>
                <router-link :to="`/users/${follower.id}`" class="user-name">
                  {{ follower.nickname }}
                </router-link>
                <p class="user-desc">{{ follower.bio || '暂无简介' }}</p>
                <div class="user-stats-mini">
                  <span>{{ follower.postsCount }} 帖子</span>
                  <span>{{ follower.followersCount }} 粉丝</span>
                </div>
              </div>
            </div>
            <el-empty v-else description="还没有粉丝" />
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>

    <el-result
      v-else
      icon="error"
      title="用户不存在"
      sub-title="该用户可能已被删除或您没有权限访问"
    >
      <template #extra>
        <el-button type="primary" @click="router.push('/')">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import {
  Calendar, Location, Link, Plus, ChatDotRound, Edit, View
} from '@element-plus/icons-vue'
import PostCard from '@/components/PostCard.vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loading = ref(true)
const user = ref(null)
const activeTab = ref('posts')

const posts = ref([])
const postsPagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const replies = ref([])
const repliesPagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const following = ref([])
const followers = ref([])

// 是否是当前用户
const isCurrentUser = computed(() => {
  return userStore.user && user.value && userStore.user.id === user.value.id
})

// Markdown渲染器
const md = new MarkdownIt({
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value
      } catch {}
    }
    return ''
  }
})

// 渲染Markdown
const renderMarkdown = (content) => {
  return content ? md.render(content) : ''
}

// 格式化日期
const formatDate = (date) => {
  return dayjs(date).format('YYYY年MM月DD日')
}

// 相对时间
const formatRelativeTime = (date) => {
  return dayjs(date).fromNow()
}

// 加载用户信息
const loadUser = async () => {
  loading.value = true
  try {
    const userId = route.params.id
    // 这里应该调用API
    // const response = await getUser(userId)
    // user.value = response.data

    // 模拟数据
    await new Promise(resolve => setTimeout(resolve, 800))
    user.value = {
      id: userId,
      nickname: '技术达人',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
      bio: '热爱分享技术，专注于去中心化AI和区块链领域',
      role: 'user',
      location: '北京',
      website: 'https://www.chainlesschain.com',
      createdAt: '2024-06-15T10:00:00',
      postsCount: 42,
      repliesCount: 156,
      likesCount: 328,
      followersCount: 89,
      followingCount: 53,
      isFollowing: false
    }

    // 加载帖子
    await loadPosts()
  } catch (error) {
    ElMessage.error('加载用户信息失败')
    user.value = null
  } finally {
    loading.value = false
  }
}

// 加载帖子列表
const loadPosts = async () => {
  try {
    // 这里应该调用API
    // const response = await getUserPosts(user.value.id, postsPagination)

    // 模拟数据
    const mockPosts = []
    for (let i = 1; i <= 10; i++) {
      mockPosts.push({
        id: i,
        title: `用户帖子 ${i} - 关于ChainlessChain的讨论和经验分享`,
        excerpt: '这是帖子摘要内容，提供了简短的预览文字。这里可以展示帖子的主要内容概述...',
        author: user.value,
        category: {
          id: 1,
          name: '讨论',
          slug: 'discussion'
        },
        tags: [
          { id: 1, name: 'U盾', slug: 'ukey' },
          { id: 2, name: 'AI', slug: 'ai' }
        ],
        viewsCount: Math.floor(Math.random() * 1000) + 50,
        repliesCount: Math.floor(Math.random() * 50),
        likesCount: Math.floor(Math.random() * 100),
        isPinned: false,
        isResolved: i % 3 === 0,
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    posts.value = mockPosts
    postsPagination.total = 42
  } catch (error) {
    ElMessage.error('加载帖子失败')
  }
}

// 加载回复列表
const loadReplies = async () => {
  try {
    // 这里应该调用API
    // const response = await getUserReplies(user.value.id, repliesPagination)

    // 模拟数据
    const mockReplies = []
    for (let i = 1; i <= 10; i++) {
      mockReplies.push({
        id: i,
        content: `这是一条回复内容 ${i}。我认为这个问题可以通过以下方式解决...\n\n具体步骤如下：\n1. 首先配置环境\n2. 然后安装依赖\n3. 最后运行测试`,
        post: {
          id: i + 100,
          title: `被回复的帖子标题 ${i}`,
          viewsCount: Math.floor(Math.random() * 500),
          repliesCount: Math.floor(Math.random() * 20)
        },
        createdAt: new Date(Date.now() - Math.random() * 15 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    replies.value = mockReplies
    repliesPagination.total = 156
  } catch (error) {
    ElMessage.error('加载回复失败')
  }
}

// 加载关注列表
const loadFollowing = async () => {
  try {
    // 模拟数据
    const mockFollowing = []
    for (let i = 1; i <= 12; i++) {
      mockFollowing.push({
        id: 100 + i,
        nickname: `用户${100 + i}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${100 + i}`,
        bio: '这是用户简介，介绍一下自己的兴趣和专长',
        postsCount: Math.floor(Math.random() * 50),
        followersCount: Math.floor(Math.random() * 100)
      })
    }
    following.value = mockFollowing
  } catch (error) {
    ElMessage.error('加载关注列表失败')
  }
}

// 加载粉丝列表
const loadFollowers = async () => {
  try {
    // 模拟数据
    const mockFollowers = []
    for (let i = 1; i <= 15; i++) {
      mockFollowers.push({
        id: 200 + i,
        nickname: `粉丝${200 + i}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${200 + i}`,
        bio: '热爱学习，喜欢交流技术',
        postsCount: Math.floor(Math.random() * 30),
        followersCount: Math.floor(Math.random() * 80)
      })
    }
    followers.value = mockFollowers
  } catch (error) {
    ElMessage.error('加载粉丝列表失败')
  }
}

// Tab切换
const handleTabChange = (tabName) => {
  if (tabName === 'replies' && replies.value.length === 0) {
    loadReplies()
  } else if (tabName === 'following' && following.value.length === 0) {
    loadFollowing()
  } else if (tabName === 'followers' && followers.value.length === 0) {
    loadFollowers()
  }
}

// 关注/取消关注
const handleFollow = async () => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }

  try {
    // 这里应该调用API
    // await toggleFollow(user.value.id)

    user.value.isFollowing = !user.value.isFollowing
    if (user.value.isFollowing) {
      user.value.followersCount++
      ElMessage.success('关注成功')
    } else {
      user.value.followersCount--
      ElMessage.success('已取消关注')
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

// 发私信
const handleMessage = () => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  ElMessage.info('私信功能开发中...')
}

onMounted(() => {
  loadUser()
})
</script>

<style scoped lang="scss">
.user-profile-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.user-info-card {
  margin-bottom: 24px;

  .user-header {
    display: flex;
    gap: 24px;

    .user-main {
      flex: 1;

      .user-title {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;

        h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          color: var(--el-text-color-primary);
        }
      }

      .user-bio {
        margin: 0 0 16px;
        color: var(--el-text-color-regular);
        font-size: 15px;
        line-height: 1.6;

        &.empty {
          color: var(--el-text-color-disabled);
          font-style: italic;
        }
      }

      .user-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 16px;

        .meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--el-text-color-secondary);
          font-size: 14px;

          a {
            color: var(--el-color-primary);
            text-decoration: none;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      }

      .user-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
    }
  }

  .user-stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 24px;
    margin-top: 24px;

    .stat-item {
      text-align: center;

      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--el-color-primary);
        margin-bottom: 4px;
      }

      .stat-label {
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }
    }
  }
}

.content-card {
  .posts-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .replies-list {
    display: flex;
    flex-direction: column;
    gap: 16px;

    .reply-item {
      padding: 16px;
      background: var(--el-fill-color-light);
      border-radius: 8px;

      .reply-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        .post-title {
          font-weight: 600;
          color: var(--el-color-primary);
          text-decoration: none;

          &:hover {
            text-decoration: underline;
          }
        }

        .reply-time {
          font-size: 12px;
          color: var(--el-text-color-disabled);
        }
      }

      .reply-content {
        margin-bottom: 12px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--el-text-color-regular);
      }

      .reply-actions {
        display: flex;
        gap: 16px;

        .action-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }
    }
  }

  .users-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;

    .user-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      background: var(--el-fill-color-light);
      border-radius: 8px;
      text-align: center;

      .user-name {
        margin-top: 12px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        text-decoration: none;

        &:hover {
          color: var(--el-color-primary);
        }
      }

      .user-desc {
        margin: 8px 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);
        line-height: 1.5;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .user-stats-mini {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: var(--el-text-color-disabled);
      }
    }
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }
}

@media (max-width: 768px) {
  .user-profile-page {
    padding: 16px;
  }

  .user-info-card {
    .user-header {
      flex-direction: column;
      align-items: center;
      text-align: center;

      .user-main {
        .user-title {
          justify-content: center;
          flex-wrap: wrap;

          h1 {
            font-size: 22px;
          }
        }

        .user-meta {
          justify-content: center;
        }

        .user-actions {
          justify-content: center;

          .el-button {
            flex: 1;
          }
        }
      }
    }

    .user-stats {
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;

      .stat-item {
        .stat-value {
          font-size: 20px;
        }
      }
    }
  }

  .content-card {
    .users-grid {
      grid-template-columns: 1fr;
    }
  }
}

.markdown-body {
  :deep(p) {
    margin-bottom: 8px;
  }

  :deep(code) {
    padding: 2px 4px;
    background: var(--el-fill-color);
    border-radius: 3px;
    font-size: 13px;
  }
}
</style>
