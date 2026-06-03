<template>
  <div class="my-profile-page">
    <el-skeleton v-if="loading" :rows="12" animated />

    <template v-else-if="user">
      <!-- 个人信息卡片 -->
      <el-card class="profile-card">
        <template #header>
          <div class="card-header">
            <h2>个人资料</h2>
            <el-button
              v-if="!editing"
              type="primary"
              :icon="Edit"
              @click="startEdit"
            >
              编辑资料
            </el-button>
            <div v-else class="edit-actions">
              <el-button
                type="primary"
                :loading="saving"
                @click="saveProfile"
              >
                保存
              </el-button>
              <el-button @click="cancelEdit">取消</el-button>
            </div>
          </div>
        </template>

        <div class="profile-content">
          <div class="avatar-section">
            <el-avatar :size="120" :src="editing ? editForm.avatar : user.avatar" />
            <el-button v-if="editing" size="small" class="change-avatar-btn" @click="showAvatarDialog = true">
              更换头像
            </el-button>
          </div>

          <div class="info-section">
            <el-form
              ref="formRef"
              :model="editing ? editForm : user"
              :rules="rules"
              label-position="top"
              :disabled="!editing"
            >
              <el-row :gutter="20">
                <el-col :span="12">
                  <el-form-item label="昵称" prop="nickname">
                    <el-input
                      v-if="editing"
                      v-model="editForm.nickname"
                      placeholder="请输入昵称"
                    />
                    <el-input
                      v-else
                      :value="user.nickname"
                      readonly
                      disabled
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="用户ID">
                    <el-input :value="user.id" readonly disabled />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-form-item label="个人简介" prop="bio">
                <el-input
                  v-if="editing"
                  v-model="editForm.bio"
                  type="textarea"
                  :rows="4"
                  placeholder="介绍一下自己..."
                  maxlength="200"
                  show-word-limit
                />
                <el-input
                  v-else
                  :value="user.bio"
                  type="textarea"
                  :rows="4"
                  readonly
                  disabled
                />
              </el-form-item>

              <el-row :gutter="20">
                <el-col :span="12">
                  <el-form-item label="所在地" prop="location">
                    <el-input
                      v-if="editing"
                      v-model="editForm.location"
                      placeholder="如：北京"
                    />
                    <el-input
                      v-else
                      :value="user.location"
                      readonly
                      disabled
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="个人网站" prop="website">
                    <el-input
                      v-if="editing"
                      v-model="editForm.website"
                      placeholder="https://..."
                    />
                    <el-input
                      v-else
                      :value="user.website"
                      readonly
                      disabled
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </div>
        </div>

        <el-divider />

        <div class="account-info">
          <h3>账户信息</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">注册时间</span>
              <span class="value">{{ formatDate(user.createdAt) }}</span>
            </div>
            <div class="info-item">
              <span class="label">用户角色</span>
              <span class="value">
                <el-tag v-if="user.role === 'admin'" type="danger">管理员</el-tag>
                <el-tag v-else-if="user.role === 'moderator'" type="warning">版主</el-tag>
                <el-tag v-else type="info">普通用户</el-tag>
              </span>
            </div>
            <div class="info-item">
              <span class="label">认证设备</span>
              <span class="value">{{ user.deviceType || 'U盾' }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 统计信息 -->
      <el-row :gutter="20" class="stats-row">
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
              <el-icon :size="32"><Document /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ user.postsCount }}</div>
              <div class="stat-label">我的帖子</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)">
              <el-icon :size="32"><ChatDotRound /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ user.repliesCount }}</div>
              <div class="stat-label">我的回复</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)">
              <el-icon :size="32"><Star /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ user.likesCount }}</div>
              <div class="stat-label">获得点赞</div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card">
            <div class="stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%)">
              <el-icon :size="32"><User /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ user.followersCount }}</div>
              <div class="stat-label">粉丝数量</div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 内容Tab -->
      <el-card class="content-card">
        <el-tabs v-model="activeTab" @tab-change="handleTabChange">
          <el-tab-pane label="我的帖子" name="posts">
            <div v-if="posts.length > 0" class="posts-list">
              <PostCard
                v-for="post in posts"
                :key="post.id"
                :post="post"
                view-mode="list"
              />
            </div>
            <el-empty v-else description="还没有发布帖子">
              <el-button type="primary" @click="router.push('/create')">发布第一篇帖子</el-button>
            </el-empty>

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

          <el-tab-pane label="我的回复" name="replies">
            <div v-if="replies.length > 0" class="replies-list">
              <div v-for="reply in replies" :key="reply.id" class="reply-item">
                <div class="reply-header">
                  <router-link :to="`/posts/${reply.post.id}`" class="post-title">
                    回复了: {{ reply.post.title }}
                  </router-link>
                  <span class="reply-time">{{ formatRelativeTime(reply.createdAt) }}</span>
                </div>
                <div class="reply-content markdown-body" v-html="renderMarkdown(reply.content)"></div>
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

          <el-tab-pane label="我的收藏" name="favorites">
            <div v-if="favorites.length > 0" class="posts-list">
              <PostCard
                v-for="post in favorites"
                :key="post.id"
                :post="post"
                view-mode="list"
              />
            </div>
            <el-empty v-else description="还没有收藏" />
          </el-tab-pane>

          <el-tab-pane label="草稿箱" name="drafts">
            <div v-if="drafts.length > 0" class="drafts-list">
              <div v-for="draft in drafts" :key="draft.id" class="draft-item">
                <div class="draft-header">
                  <h4>{{ draft.title || '未命名草稿' }}</h4>
                  <div class="draft-actions">
                    <el-button size="small" type="primary" @click="continueDraft(draft)">
                      继续编辑
                    </el-button>
                    <el-popconfirm
                      title="确定删除这个草稿吗？"
                      @confirm="deleteDraft(draft.id)"
                    >
                      <template #reference>
                        <el-button size="small" type="danger">删除</el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </div>
                <div class="draft-info">
                  <span class="draft-time">保存于 {{ formatRelativeTime(draft.updatedAt) }}</span>
                  <span v-if="draft.category" class="draft-category">
                    分类: {{ draft.category.name }}
                  </span>
                </div>
                <div v-if="draft.content" class="draft-preview">
                  {{ draft.content.substring(0, 200) }}{{ draft.content.length > 200 ? '...' : '' }}
                </div>
              </div>
            </div>
            <el-empty v-else description="没有草稿" />
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>
  </div>

  <!-- 更换头像对话框 -->
  <el-dialog
    v-model="showAvatarDialog"
    title="更换头像"
    width="500px"
  >
    <div class="avatar-selector">
      <p class="tip">选择一个头像：</p>
      <div class="avatar-grid">
        <div
          v-for="i in 16"
          :key="i"
          class="avatar-option"
          :class="{ selected: selectedAvatar === `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}` }"
          @click="selectedAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`"
        >
          <el-avatar :size="60" :src="`https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`" />
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="showAvatarDialog = false">取消</el-button>
      <el-button type="primary" @click="confirmAvatar">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import {
  Edit, Document, ChatDotRound, Star, User
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
const userStore = useUserStore()

const loading = ref(true)
const user = ref(null)
const editing = ref(false)
const saving = ref(false)
const formRef = ref()
const activeTab = ref('posts')
const showAvatarDialog = ref(false)
const selectedAvatar = ref('')

const editForm = reactive({
  nickname: '',
  bio: '',
  location: '',
  website: '',
  avatar: ''
})

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

const favorites = ref([])
const drafts = ref([])

// 表单验证规则
const rules = {
  nickname: [
    { required: true, message: '请输入昵称', trigger: 'blur' },
    { min: 2, max: 20, message: '昵称长度应在2-20字之间', trigger: 'blur' }
  ],
  bio: [
    { max: 200, message: '简介不能超过200字', trigger: 'blur' }
  ],
  website: [
    { type: 'url', message: '请输入有效的网址', trigger: 'blur' }
  ]
}

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
    // 这里应该从store或API获取当前用户信息
    // user.value = userStore.user

    // 模拟数据
    await new Promise(resolve => setTimeout(resolve, 800))
    user.value = {
      id: userStore.user?.id || 1,
      nickname: userStore.user?.nickname || '我的昵称',
      avatar: userStore.user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=1',
      bio: '热爱技术，喜欢分享，专注于去中心化AI和区块链领域的探索与实践。',
      role: 'user',
      location: '北京',
      website: 'https://www.chainlesschain.com',
      deviceType: 'U盾',
      createdAt: '2024-06-15T10:00:00',
      postsCount: 28,
      repliesCount: 142,
      likesCount: 256,
      followersCount: 67,
      followingCount: 43
    }

    // 加载帖子
    await loadPosts()
  } catch (error) {
    ElMessage.error('加载用户信息失败')
  } finally {
    loading.value = false
  }
}

// 开始编辑
const startEdit = () => {
  editForm.nickname = user.value.nickname
  editForm.bio = user.value.bio || ''
  editForm.location = user.value.location || ''
  editForm.website = user.value.website || ''
  editForm.avatar = user.value.avatar
  editing.value = true
}

// 取消编辑
const cancelEdit = () => {
  editing.value = false
}

// 保存资料
const saveProfile = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) {
      ElMessage.warning('请完善表单信息')
      return
    }

    saving.value = true
    try {
      // 这里应该调用API
      // await updateUserProfile(editForm)

      // 模拟延迟
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 更新用户信息
      user.value.nickname = editForm.nickname
      user.value.bio = editForm.bio
      user.value.location = editForm.location
      user.value.website = editForm.website
      user.value.avatar = editForm.avatar

      // 更新store
      if (userStore.user) {
        userStore.user.nickname = editForm.nickname
        userStore.user.avatar = editForm.avatar
      }

      editing.value = false
      ElMessage.success('保存成功')
    } catch (error) {
      ElMessage.error('保存失败，请重试')
    } finally {
      saving.value = false
    }
  })
}

// 确认头像
const confirmAvatar = () => {
  if (selectedAvatar.value) {
    editForm.avatar = selectedAvatar.value
    showAvatarDialog.value = false
  }
}

// 加载帖子列表
const loadPosts = async () => {
  try {
    // 模拟数据
    const mockPosts = []
    for (let i = 1; i <= 10; i++) {
      mockPosts.push({
        id: i,
        title: `我的帖子 ${i} - 分享一些使用经验和技巧`,
        excerpt: '这是帖子摘要内容，提供了简短的预览文字。这里可以展示帖子的主要内容概述...',
        author: user.value,
        category: {
          id: 1,
          name: '讨论',
          slug: 'discussion'
        },
        tags: [
          { id: 1, name: 'U盾', slug: 'ukey' },
          { id: 2, name: '经验分享', slug: 'tips' }
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
    postsPagination.total = 28
  } catch (error) {
    ElMessage.error('加载帖子失败')
  }
}

// 加载回复列表
const loadReplies = async () => {
  try {
    // 模拟数据
    const mockReplies = []
    for (let i = 1; i <= 10; i++) {
      mockReplies.push({
        id: i,
        content: `这是我的回复内容 ${i}。根据我的经验，可以这样解决...\n\n希望对你有帮助！`,
        post: {
          id: i + 100,
          title: `被回复的帖子 ${i}`,
          viewsCount: Math.floor(Math.random() * 500),
          repliesCount: Math.floor(Math.random() * 20)
        },
        createdAt: new Date(Date.now() - Math.random() * 15 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    replies.value = mockReplies
    repliesPagination.total = 142
  } catch (error) {
    ElMessage.error('加载回复失败')
  }
}

// 加载收藏列表
const loadFavorites = async () => {
  try {
    // 模拟数据
    const mockFavorites = []
    for (let i = 1; i <= 8; i++) {
      mockFavorites.push({
        id: i + 200,
        title: `收藏的帖子 ${i} - 很有价值的内容`,
        excerpt: '这是一篇很有价值的帖子，值得收藏学习...',
        author: {
          id: i + 10,
          nickname: `作者${i}`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 10}`
        },
        category: {
          id: 1,
          name: '教程',
          slug: 'tutorial'
        },
        tags: [
          { id: 1, name: '教程', slug: 'tutorial' }
        ],
        viewsCount: Math.floor(Math.random() * 2000) + 100,
        repliesCount: Math.floor(Math.random() * 80),
        likesCount: Math.floor(Math.random() * 200),
        isPinned: false,
        isResolved: true,
        createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    favorites.value = mockFavorites
  } catch (error) {
    ElMessage.error('加载收藏失败')
  }
}

// 加载草稿列表
const loadDrafts = async () => {
  try {
    // 模拟数据
    drafts.value = [
      {
        id: 1,
        title: '如何优化AI训练性能',
        content: '# 性能优化指南\n\n最近在研究如何优化AI训练性能，这里分享一些心得...',
        category: { id: 1, name: '讨论' },
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 2,
        title: '',
        content: '刚开始写的一些想法...',
        category: null,
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  } catch (error) {
    ElMessage.error('加载草稿失败')
  }
}

// Tab切换
const handleTabChange = (tabName) => {
  if (tabName === 'replies' && replies.value.length === 0) {
    loadReplies()
  } else if (tabName === 'favorites' && favorites.value.length === 0) {
    loadFavorites()
  } else if (tabName === 'drafts' && drafts.value.length === 0) {
    loadDrafts()
  }
}

// 继续编辑草稿
const continueDraft = (draft) => {
  // 跳转到编辑页面，传递草稿数据
  router.push({
    path: '/create',
    query: { draftId: draft.id }
  })
}

// 删除草稿
const deleteDraft = async (draftId) => {
  try {
    // 这里应该调用API
    // await deleteDraft(draftId)

    drafts.value = drafts.value.filter(d => d.id !== draftId)
    ElMessage.success('删除成功')
  } catch (error) {
    ElMessage.error('删除失败')
  }
}

onMounted(() => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  loadUser()
})
</script>

<style scoped lang="scss">
.my-profile-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.profile-card {
  margin-bottom: 24px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .edit-actions {
      display: flex;
      gap: 12px;
    }
  }

  .profile-content {
    display: flex;
    gap: 32px;

    .avatar-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;

      .change-avatar-btn {
        width: 100%;
      }
    }

    .info-section {
      flex: 1;
    }
  }

  .account-info {
    h3 {
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;

      .info-item {
        display: flex;
        flex-direction: column;
        gap: 8px;

        .label {
          font-size: 13px;
          color: var(--el-text-color-secondary);
        }

        .value {
          font-size: 14px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
      }
    }
  }
}

.stats-row {
  margin-bottom: 24px;

  .stat-card {
    display: flex;
    align-items: center;
    gap: 16px;

    .stat-icon {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      color: white;
    }

    .stat-info {
      .stat-value {
        font-size: 28px;
        font-weight: 700;
        color: var(--el-text-color-primary);
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
        font-size: 14px;
        line-height: 1.6;
        color: var(--el-text-color-regular);
      }
    }
  }

  .drafts-list {
    display: flex;
    flex-direction: column;
    gap: 16px;

    .draft-item {
      padding: 16px;
      background: var(--el-fill-color-light);
      border-radius: 8px;

      .draft-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        h4 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }

        .draft-actions {
          display: flex;
          gap: 8px;
        }
      }

      .draft-info {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }

      .draft-preview {
        font-size: 14px;
        color: var(--el-text-color-regular);
        line-height: 1.6;
      }
    }
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }
}

.avatar-selector {
  .tip {
    margin: 0 0 16px;
    color: var(--el-text-color-secondary);
  }

  .avatar-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;

    .avatar-option {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        background: var(--el-fill-color-light);
      }

      &.selected {
        border-color: var(--el-color-primary);
        background: var(--el-color-primary-light-9);
      }
    }
  }
}

@media (max-width: 768px) {
  .my-profile-page {
    padding: 16px;
  }

  .profile-card {
    .profile-content {
      flex-direction: column;
      align-items: center;
    }

    .account-info {
      .info-grid {
        grid-template-columns: 1fr;
      }
    }
  }

  .stats-row {
    .el-col {
      margin-bottom: 12px;
    }
  }

  .avatar-selector {
    .avatar-grid {
      grid-template-columns: repeat(3, 1fr);
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
