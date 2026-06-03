<template>
  <div class="post-detail-page">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading">
      <el-skeleton :rows="10" animated />
    </div>

    <!-- 帖子内容 -->
    <div v-else-if="post" class="post-container">
      <!-- 帖子头部 -->
      <div class="post-header">
        <div class="post-breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item :to="`/categories/${post.category?.slug}`">
              {{ post.category?.name }}
            </el-breadcrumb-item>
            <el-breadcrumb-item>{{ post.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <h1 class="post-title">
          {{ post.title }}
          <el-tag v-if="post.isPinned" type="danger">置顶</el-tag>
          <el-tag v-if="post.isResolved" type="success">已解决</el-tag>
        </h1>

        <div class="post-meta">
          <router-link :to="`/users/${post.author?.id}`" class="author-link">
            <el-avatar :src="post.author?.avatar" :size="32">
              {{ post.author?.nickname?.[0] }}
            </el-avatar>
            <span class="author-name">{{ post.author?.nickname }}</span>
          </router-link>
          <span class="separator">·</span>
          <span class="time">发布于 {{ formatTime(post.createdAt) }}</span>
          <span class="separator">·</span>
          <span class="views">
            <el-icon><View /></el-icon>
            {{ formatNumber(post.viewsCount) }} 浏览
          </span>
        </div>

        <div class="post-tags" v-if="post.tags && post.tags.length > 0">
          <el-tag
            v-for="tag in post.tags"
            :key="tag.id"
            @click="router.push(`/tags/${tag.slug}`)"
          >
            {{ tag.name }}
          </el-tag>
        </div>
      </div>

      <!-- 帖子正文 -->
      <div class="post-body">
        <div class="post-content" v-html="renderedContent"></div>

        <div class="post-actions">
          <el-button
            :type="post.isLiked ? 'primary' : 'default'"
            :icon="Star"
            @click="handleLike"
          >
            {{ post.isLiked ? '已点赞' : '点赞' }} ({{ post.likesCount }})
          </el-button>
          <el-button
            :type="post.isFavorited ? 'warning' : 'default'"
            :icon="Collection"
            @click="handleFavorite"
          >
            {{ post.isFavorited ? '已收藏' : '收藏' }} ({{ post.favoritesCount }})
          </el-button>
          <el-button :icon="Share" @click="handleShare">分享</el-button>

          <div class="action-right">
            <el-button
              v-if="canEdit"
              :icon="Edit"
              @click="router.push(`/edit/${post.id}`)"
            >
              编辑
            </el-button>
            <el-button
              v-if="canDelete"
              type="danger"
              :icon="Delete"
              @click="handleDelete"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>

      <!-- 回复区域 -->
      <div class="replies-section">
        <div class="section-header">
          <h2>{{ post.repliesCount }} 条回复</h2>
          <el-button
            v-if="userStore.isLoggedIn"
            type="primary"
            :icon="EditPen"
            @click="showReplyEditor = true"
          >
            写回复
          </el-button>
        </div>

        <!-- 回复编辑器 -->
        <div v-if="showReplyEditor || !userStore.isLoggedIn" class="reply-editor">
          <template v-if="userStore.isLoggedIn">
            <el-input
              v-model="replyContent"
              type="textarea"
              :rows="6"
              placeholder="写下你的回复..."
            />
            <div class="editor-actions">
              <el-button @click="showReplyEditor = false">取消</el-button>
              <el-button
                type="primary"
                :loading="submittingReply"
                @click="handleSubmitReply"
              >
                发布回复
              </el-button>
            </div>
          </template>
          <div v-else class="login-prompt">
            <p>登录后才能回复</p>
            <el-button type="primary" @click="router.push('/login')">
              立即登录
            </el-button>
          </div>
        </div>

        <!-- 回复列表 -->
        <div class="replies-list">
          <div
            v-for="reply in replies"
            :key="reply.id"
            class="reply-item"
          >
            <div class="reply-avatar">
              <router-link :to="`/users/${reply.author?.id}`">
                <el-avatar :src="reply.author?.avatar" :size="40">
                  {{ reply.author?.nickname?.[0] }}
                </el-avatar>
              </router-link>
            </div>

            <div class="reply-content">
              <div class="reply-header">
                <router-link :to="`/users/${reply.author?.id}`" class="author-name">
                  {{ reply.author?.nickname }}
                </router-link>
                <el-tag v-if="reply.author?.id === post.author?.id" size="small" type="info">
                  作者
                </el-tag>
                <el-tag v-if="reply.isBestAnswer" size="small" type="success">
                  最佳答案
                </el-tag>
                <span class="reply-time">{{ formatTime(reply.createdAt) }}</span>
              </div>

              <div class="reply-body" v-html="renderMarkdown(reply.content)"></div>

              <div class="reply-actions">
                <el-button
                  text
                  :icon="Star"
                  @click="handleReplyLike(reply)"
                >
                  {{ reply.likesCount || 0 }}
                </el-button>
                <el-button
                  text
                  :icon="ChatDotRound"
                  @click="handleReplyTo(reply)"
                >
                  回复
                </el-button>
                <el-button
                  v-if="canMarkBestAnswer(reply)"
                  text
                  type="success"
                  @click="handleMarkBestAnswer(reply)"
                >
                  采纳答案
                </el-button>
              </div>
            </div>
          </div>

          <el-empty v-if="replies.length === 0" description="暂无回复" />
        </div>
      </div>
    </div>

    <!-- 错误状态 -->
    <el-empty v-else description="帖子不存在或已被删除">
      <el-button type="primary" @click="router.push('/')">
        返回首页
      </el-button>
    </el-empty>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  View, Star, Collection, Share, Edit, Delete, EditPen, ChatDotRound
} from '@element-plus/icons-vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(true)
const post = ref(null)
const replies = ref([])
const showReplyEditor = ref(false)
const replyContent = ref('')
const submittingReply = ref(false)

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

const renderedContent = computed(() => {
  return post.value?.content ? md.render(post.value.content) : ''
})

const canEdit = computed(() => {
  return userStore.isLoggedIn &&
    (userStore.user?.id === post.value?.author?.id || userStore.isAdmin)
})

const canDelete = computed(() => {
  return userStore.isLoggedIn &&
    (userStore.user?.id === post.value?.author?.id || userStore.isAdmin)
})

const canMarkBestAnswer = (reply) => {
  return userStore.isLoggedIn &&
    userStore.user?.id === post.value?.author?.id &&
    post.value?.category?.slug === 'qa' &&
    !post.value?.isResolved
}

// 格式化时间
const formatTime = (time) => {
  if (!time) return ''
  return dayjs(time).fromNow()
}

// 格式化数字
const formatNumber = (num) => {
  if (num >= 10000) return (num / 10000).toFixed(1) + 'w'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num
}

// 渲染Markdown
const renderMarkdown = (content) => {
  return content ? md.render(content) : ''
}

// 加载帖子
const loadPost = async () => {
  loading.value = true
  try {
    // 这里应该调用API
    // const response = await getPost(route.params.id)
    // post.value = response.data
    // replies.value = response.data.replies

    // 模拟数据
    post.value = {
      id: route.params.id,
      title: 'ChainlessChain如何实现去中心化AI训练？',
      content: `# 问题描述

我想了解ChainlessChain是如何实现去中心化的AI模型训练的？

## 主要关注点

1. **数据隐私**: 如何确保训练数据不会泄露？
2. **算力分配**: 如何有效分配算力资源？
3. **模型聚合**: 如何聚合不同节点的训练结果？

## 示例代码

\`\`\`python
import chainlesschain as cc

# 初始化训练配置
config = cc.TrainingConfig(
    model_type="bert",
    dataset="custom",
    epochs=10
)

# 开始训练
trainer = cc.DistributedTrainer(config)
trainer.start()
\`\`\`

有没有人能详细解答一下？谢谢！`,
      author: {
        id: 1,
        nickname: '技术探索者',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=1'
      },
      category: {
        id: 1,
        name: '问答',
        slug: 'qa'
      },
      tags: [
        { id: 1, name: 'AI训练', slug: 'ai-training' },
        { id: 2, name: '去中心化', slug: 'decentralized' },
        { id: 3, name: 'Python', slug: 'python' }
      ],
      viewsCount: 1234,
      likesCount: 42,
      favoritesCount: 18,
      repliesCount: 5,
      isPinned: false,
      isResolved: false,
      isLiked: false,
      isFavorited: false,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    }

    replies.value = [
      {
        id: 1,
        content: '这是一个很好的问题！ChainlessChain使用联邦学习技术来实现去中心化训练。简单来说，每个节点在本地训练模型，然后只上传模型参数的更新，而不是原始数据。',
        author: {
          id: 2,
          nickname: 'AI专家',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=2'
        },
        likesCount: 15,
        isBestAnswer: false,
        createdAt: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 2,
        content: '补充一点，ChainlessChain还使用了同态加密技术来保护模型参数，确保即使是参数更新也无法被逆向推导出原始数据。',
        author: {
          id: 3,
          nickname: '密码学爱好者',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=3'
        },
        likesCount: 8,
        isBestAnswer: false,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  } catch (error) {
    ElMessage.error('加载帖子失败')
  } finally {
    loading.value = false
  }
}

// 点赞
const handleLike = async () => {
  if (!userStore.isLoggedIn) {
    router.push('/login')
    return
  }

  post.value.isLiked = !post.value.isLiked
  post.value.likesCount += post.value.isLiked ? 1 : -1
  ElMessage.success(post.value.isLiked ? '点赞成功' : '取消点赞')
}

// 收藏
const handleFavorite = async () => {
  if (!userStore.isLoggedIn) {
    router.push('/login')
    return
  }

  post.value.isFavorited = !post.value.isFavorited
  post.value.favoritesCount += post.value.isFavorited ? 1 : -1
  ElMessage.success(post.value.isFavorited ? '收藏成功' : '取消收藏')
}

// 分享
const handleShare = async () => {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

// 删除帖子
const handleDelete = async () => {
  try {
    await ElMessageBox.confirm('确定要删除这个帖子吗？', '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    ElMessage.success('删除成功')
    router.push('/')
  } catch {}
}

// 提交回复
const handleSubmitReply = async () => {
  if (!replyContent.value.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }

  submittingReply.value = true
  try {
    // 这里应该调用API
    // await createReply(post.value.id, replyContent.value)

    // 模拟添加回复
    replies.value.unshift({
      id: Date.now(),
      content: replyContent.value,
      author: {
        id: userStore.user?.id,
        nickname: userStore.user?.nickname,
        avatar: userStore.user?.avatar
      },
      likesCount: 0,
      isBestAnswer: false,
      createdAt: new Date().toISOString()
    })

    post.value.repliesCount++
    replyContent.value = ''
    showReplyEditor.value = false
    ElMessage.success('回复成功')
  } catch (error) {
    ElMessage.error('回复失败')
  } finally {
    submittingReply.value = false
  }
}

// 回复的点赞
const handleReplyLike = (reply) => {
  if (!userStore.isLoggedIn) {
    router.push('/login')
    return
  }

  reply.likesCount = (reply.likesCount || 0) + 1
  ElMessage.success('点赞成功')
}

// 回复某条回复
const handleReplyTo = (reply) => {
  if (!userStore.isLoggedIn) {
    router.push('/login')
    return
  }

  showReplyEditor.value = true
  replyContent.value = `@${reply.author?.nickname} `
}

// 标记最佳答案
const handleMarkBestAnswer = async (reply) => {
  try {
    await ElMessageBox.confirm('确定要将此回复标记为最佳答案吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info'
    })

    reply.isBestAnswer = true
    post.value.isResolved = true
    ElMessage.success('已标记为最佳答案')
  } catch {}
}

onMounted(() => {
  loadPost()
})
</script>

<style scoped lang="scss">
.post-detail-page {
  max-width: 900px;
  margin: 0 auto;
}

.loading {
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.post-container {
  background: var(--el-bg-color);
  border-radius: 8px;
  overflow: hidden;
}

.post-header {
  padding: 24px;
  border-bottom: 1px solid var(--el-border-color);

  .post-breadcrumb {
    margin-bottom: 16px;
  }

  .post-title {
    margin: 0 0 12px;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--el-text-color-primary);
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .post-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    font-size: 14px;
    color: var(--el-text-color-secondary);

    .author-link {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: inherit;

      &:hover .author-name {
        color: var(--el-color-primary);
      }

      .author-name {
        font-weight: 500;
      }
    }

    .separator {
      color: var(--el-text-color-disabled);
    }

    .views {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }

  .post-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    .el-tag {
      cursor: pointer;
    }
  }
}

.post-body {
  padding: 32px 24px;

  .post-content {
    line-height: 1.8;
    font-size: 16px;
    color: var(--el-text-color-regular);
    margin-bottom: 32px;

    :deep(h1), :deep(h2), :deep(h3) {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.3;
    }

    :deep(h1) { font-size: 24px; }
    :deep(h2) { font-size: 20px; }
    :deep(h3) { font-size: 18px; }

    :deep(p) {
      margin-bottom: 16px;
    }

    :deep(ul), :deep(ol) {
      padding-left: 28px;
      margin-bottom: 16px;
    }

    :deep(li) {
      margin-bottom: 8px;
    }

    :deep(code) {
      padding: 2px 6px;
      background: var(--el-fill-color-light);
      border-radius: 4px;
      font-size: 14px;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    :deep(pre) {
      padding: 16px;
      background: var(--el-fill-color);
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 16px;

      code {
        padding: 0;
        background: none;
      }
    }

    :deep(blockquote) {
      padding: 12px 16px;
      margin: 16px 0;
      border-left: 4px solid var(--el-color-primary);
      background: var(--el-fill-color-light);
      color: var(--el-text-color-secondary);
    }
  }

  .post-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;

    .action-right {
      margin-left: auto;
      display: flex;
      gap: 12px;
    }
  }
}

.replies-section {
  border-top: 8px solid var(--el-fill-color);
  padding: 24px;

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
  }

  .reply-editor {
    margin-bottom: 24px;
    padding: 16px;
    background: var(--el-fill-color-light);
    border-radius: 8px;

    .editor-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 12px;
    }

    .login-prompt {
      text-align: center;
      padding: 32px;

      p {
        margin: 0 0 16px;
        color: var(--el-text-color-secondary);
      }
    }
  }

  .replies-list {
    .reply-item {
      display: flex;
      gap: 16px;
      padding: 20px 0;
      border-bottom: 1px solid var(--el-border-color-lighter);

      &:last-child {
        border-bottom: none;
      }

      .reply-avatar {
        flex-shrink: 0;
      }

      .reply-content {
        flex: 1;
        min-width: 0;

        .reply-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          flex-wrap: wrap;

          .author-name {
            font-weight: 500;
            color: var(--el-text-color-primary);
            text-decoration: none;

            &:hover {
              color: var(--el-color-primary);
            }
          }

          .reply-time {
            margin-left: auto;
            font-size: 13px;
            color: var(--el-text-color-secondary);
          }
        }

        .reply-body {
          margin-bottom: 12px;
          line-height: 1.6;
          color: var(--el-text-color-regular);

          :deep(p) {
            margin-bottom: 8px;
          }

          :deep(code) {
            padding: 2px 4px;
            background: var(--el-fill-color-light);
            border-radius: 3px;
            font-size: 14px;
          }
        }

        .reply-actions {
          display: flex;
          gap: 4px;
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .post-header {
    padding: 16px;

    .post-title {
      font-size: 22px;
    }
  }

  .post-body {
    padding: 20px 16px;

    .post-actions {
      .action-right {
        margin-left: 0;
        width: 100%;
      }
    }
  }

  .replies-section {
    padding: 16px;

    .section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;

      .el-button {
        width: 100%;
      }
    }

    .replies-list .reply-item {
      flex-direction: column;
    }
  }
}
</style>
