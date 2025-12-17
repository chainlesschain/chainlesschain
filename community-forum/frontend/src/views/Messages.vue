<template>
  <div class="messages-page">
    <div class="page-header">
      <h1>私信</h1>
      <el-button type="primary" :icon="Edit" @click="showNewMessageDialog = true">
        新建对话
      </el-button>
    </div>

    <div class="messages-container">
      <!-- 会话列表 -->
      <el-card class="conversations-card">
        <template #header>
          <div class="card-header">
            <span>会话列表</span>
            <el-badge :value="unreadCount" :max="99" />
          </div>
        </template>

        <el-input
          v-model="searchQuery"
          placeholder="搜索会话..."
          :prefix-icon="Search"
          clearable
          class="search-input"
        />

        <div v-if="filteredConversations.length > 0" class="conversations-list">
          <div
            v-for="conversation in filteredConversations"
            :key="conversation.id"
            class="conversation-item"
            :class="{ active: selectedConversation?.id === conversation.id, unread: conversation.unreadCount > 0 }"
            @click="selectConversation(conversation)"
          >
            <el-badge :value="conversation.unreadCount" :hidden="conversation.unreadCount === 0">
              <el-avatar :size="48" :src="conversation.user.avatar" />
            </el-badge>
            <div class="conversation-info">
              <div class="conversation-header">
                <span class="user-name">{{ conversation.user.nickname }}</span>
                <span class="last-time">{{ formatRelativeTime(conversation.lastMessageTime) }}</span>
              </div>
              <p class="last-message">{{ conversation.lastMessage }}</p>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无会话" />
      </el-card>

      <!-- 聊天区域 -->
      <el-card class="chat-card">
        <template v-if="selectedConversation" #header>
          <div class="chat-header">
            <div class="user-info">
              <el-avatar :size="40" :src="selectedConversation.user.avatar" />
              <div class="user-details">
                <span class="user-name">{{ selectedConversation.user.nickname }}</span>
                <span class="user-status">{{ selectedConversation.user.online ? '在线' : '离线' }}</span>
              </div>
            </div>
            <div class="chat-actions">
              <el-button size="small" :icon="User" @click="viewUserProfile">
                查看主页
              </el-button>
              <el-button size="small" :icon="Delete" type="danger" @click="deleteConversation">
                删除会话
              </el-button>
            </div>
          </div>
        </template>

        <div v-if="selectedConversation" class="chat-content">
          <!-- 消息列表 -->
          <div ref="messagesContainer" class="messages-list">
            <div
              v-for="message in currentMessages"
              :key="message.id"
              class="message-item"
              :class="{ 'message-sent': message.isSent, 'message-received': !message.isSent }"
            >
              <el-avatar
                v-if="!message.isSent"
                :size="36"
                :src="selectedConversation.user.avatar"
                class="message-avatar"
              />
              <div class="message-bubble">
                <div class="message-content">{{ message.content }}</div>
                <div class="message-time">{{ formatMessageTime(message.createdAt) }}</div>
              </div>
              <el-avatar
                v-if="message.isSent"
                :size="36"
                :src="currentUser.avatar"
                class="message-avatar"
              />
            </div>
          </div>

          <!-- 输入框 -->
          <div class="message-input">
            <el-input
              v-model="messageContent"
              type="textarea"
              :rows="3"
              placeholder="输入消息... (Ctrl+Enter 发送)"
              @keydown.ctrl.enter="sendMessage"
            />
            <div class="input-actions">
              <el-button type="primary" :icon="Position" :disabled="!messageContent.trim()" @click="sendMessage">
                发送
              </el-button>
            </div>
          </div>
        </div>

        <el-empty v-else description="选择一个会话开始聊天" :image-size="120" />
      </el-card>
    </div>

    <!-- 新建对话对话框 -->
    <el-dialog
      v-model="showNewMessageDialog"
      title="新建对话"
      width="500px"
    >
      <el-form :model="newMessageForm" label-position="top">
        <el-form-item label="选择用户">
          <el-select
            v-model="newMessageForm.userId"
            placeholder="输入用户名搜索"
            filterable
            remote
            :remote-method="searchUsers"
            :loading="searchingUsers"
            style="width: 100%"
          >
            <el-option
              v-for="user in searchedUsers"
              :key="user.id"
              :label="user.nickname"
              :value="user.id"
            >
              <div class="user-option">
                <el-avatar :size="32" :src="user.avatar" />
                <span>{{ user.nickname }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="消息内容">
          <el-input
            v-model="newMessageForm.content"
            type="textarea"
            :rows="4"
            placeholder="输入第一条消息..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewMessageDialog = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!newMessageForm.userId || !newMessageForm.content.trim()"
          @click="createConversation"
        >
          发送
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Edit, Search, User, Delete, Position
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const router = useRouter()
const userStore = useUserStore()

const searchQuery = ref('')
const conversations = ref([])
const selectedConversation = ref(null)
const currentMessages = ref([])
const messageContent = ref('')
const messagesContainer = ref(null)

const showNewMessageDialog = ref(false)
const searchingUsers = ref(false)
const searchedUsers = ref([])
const newMessageForm = reactive({
  userId: null,
  content: ''
})

// 当前用户
const currentUser = computed(() => ({
  id: userStore.user?.id || 1,
  nickname: userStore.user?.nickname || '我',
  avatar: userStore.user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=1'
}))

// 未读数量
const unreadCount = computed(() =>
  conversations.value.reduce((sum, conv) => sum + conv.unreadCount, 0)
)

// 过滤后的会话
const filteredConversations = computed(() => {
  if (!searchQuery.value) return conversations.value

  return conversations.value.filter(conv =>
    conv.user.nickname.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

// 格式化相对时间
const formatRelativeTime = (date) => {
  return dayjs(date).fromNow()
}

// 格式化消息时间
const formatMessageTime = (date) => {
  const now = dayjs()
  const messageDate = dayjs(date)

  if (now.diff(messageDate, 'day') === 0) {
    return messageDate.format('HH:mm')
  } else if (now.diff(messageDate, 'day') === 1) {
    return '昨天 ' + messageDate.format('HH:mm')
  } else if (now.diff(messageDate, 'day') < 7) {
    return messageDate.format('ddd HH:mm')
  } else {
    return messageDate.format('MM-DD HH:mm')
  }
}

// 加载会话列表
const loadConversations = async () => {
  try {
    // 这里应该调用API
    // const response = await getConversations()

    // 模拟数据
    conversations.value = [
      {
        id: 1,
        user: {
          id: 2,
          nickname: '技术达人',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=2',
          online: true
        },
        lastMessage: '好的，我明白了，谢谢你的帮助！',
        lastMessageTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        unreadCount: 2
      },
      {
        id: 2,
        user: {
          id: 3,
          nickname: 'AI爱好者',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=3',
          online: false
        },
        lastMessage: '你好，请问U盾怎么配置？',
        lastMessageTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        unreadCount: 0
      },
      {
        id: 3,
        user: {
          id: 4,
          nickname: '开发者123',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=4',
          online: true
        },
        lastMessage: '收到，我试试看',
        lastMessageTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        unreadCount: 1
      },
      {
        id: 4,
        user: {
          id: 5,
          nickname: '新手小白',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=5',
          online: false
        },
        lastMessage: '谢谢指导！',
        lastMessageTime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        unreadCount: 0
      }
    ]
  } catch (error) {
    ElMessage.error('加载会话失败')
  }
}

// 选择会话
const selectConversation = async (conversation) => {
  selectedConversation.value = conversation
  conversation.unreadCount = 0

  // 加载消息
  await loadMessages(conversation.id)

  // 滚动到底部
  nextTick(() => {
    scrollToBottom()
  })
}

// 加载消息
const loadMessages = async (conversationId) => {
  try {
    // 这里应该调用API
    // const response = await getMessages(conversationId)

    // 模拟数据
    const mockMessages = [
      {
        id: 1,
        content: '你好，请问你对ChainlessChain熟悉吗？',
        isSent: false,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      },
      {
        id: 2,
        content: '你好！我对ChainlessChain比较了解，有什么问题可以帮你解答',
        isSent: true,
        createdAt: new Date(Date.now() - 55 * 60 * 1000).toISOString()
      },
      {
        id: 3,
        content: '我想了解一下如何开始进行AI训练',
        isSent: false,
        createdAt: new Date(Date.now() - 50 * 60 * 1000).toISOString()
      },
      {
        id: 4,
        content: '首先你需要配置好硬件环境，然后安装必要的依赖。我可以给你分享一些教程链接',
        isSent: true,
        createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString()
      },
      {
        id: 5,
        content: '好的，我明白了，谢谢你的帮助！',
        isSent: false,
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
      }
    ]

    currentMessages.value = mockMessages
  } catch (error) {
    ElMessage.error('加载消息失败')
  }
}

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 发送消息
const sendMessage = async () => {
  if (!messageContent.value.trim()) return

  try {
    // 这里应该调用API
    // await sendMessage({ conversationId: selectedConversation.value.id, content: messageContent.value })

    // 添加到消息列表
    const newMessage = {
      id: Date.now(),
      content: messageContent.value,
      isSent: true,
      createdAt: new Date().toISOString()
    }
    currentMessages.value.push(newMessage)

    // 更新会话最后消息
    if (selectedConversation.value) {
      selectedConversation.value.lastMessage = messageContent.value
      selectedConversation.value.lastMessageTime = new Date().toISOString()
    }

    messageContent.value = ''

    // 滚动到底部
    nextTick(() => {
      scrollToBottom()
    })
  } catch (error) {
    ElMessage.error('发送失败')
  }
}

// 搜索用户
const searchUsers = async (query) => {
  if (!query) {
    searchedUsers.value = []
    return
  }

  searchingUsers.value = true
  try {
    // 这里应该调用API
    // const response = await searchUsers(query)

    // 模拟数据
    await new Promise(resolve => setTimeout(resolve, 500))
    searchedUsers.value = [
      {
        id: 10,
        nickname: '测试用户1',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=10'
      },
      {
        id: 11,
        nickname: '测试用户2',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=11'
      }
    ]
  } catch (error) {
    ElMessage.error('搜索失败')
  } finally {
    searchingUsers.value = false
  }
}

// 创建新对话
const createConversation = async () => {
  try {
    // 这里应该调用API
    // await createConversation(newMessageForm)

    const selectedUser = searchedUsers.value.find(u => u.id === newMessageForm.userId)
    if (!selectedUser) return

    // 检查是否已存在会话
    const existingConv = conversations.value.find(c => c.user.id === selectedUser.id)
    if (existingConv) {
      selectConversation(existingConv)
      showNewMessageDialog.value = false
      ElMessage.info('会话已存在')
      return
    }

    // 创建新会话
    const newConversation = {
      id: Date.now(),
      user: {
        ...selectedUser,
        online: false
      },
      lastMessage: newMessageForm.content,
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0
    }

    conversations.value.unshift(newConversation)
    selectConversation(newConversation)

    // 重置表单
    newMessageForm.userId = null
    newMessageForm.content = ''
    showNewMessageDialog.value = false

    ElMessage.success('对话创建成功')
  } catch (error) {
    ElMessage.error('创建失败')
  }
}

// 查看用户主页
const viewUserProfile = () => {
  if (selectedConversation.value) {
    router.push(`/users/${selectedConversation.value.user.id}`)
  }
}

// 删除会话
const deleteConversation = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这个会话吗？删除后无法恢复',
      '提示',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 这里应该调用API
    // await deleteConversation(selectedConversation.value.id)

    conversations.value = conversations.value.filter(c => c.id !== selectedConversation.value.id)
    selectedConversation.value = null
    currentMessages.value = []

    ElMessage.success('删除成功')
  } catch (error) {
    // 用户取消
  }
}

onMounted(() => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  loadConversations()
})
</script>

<style scoped lang="scss">
.messages-page {
  max-width: 1400px;
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

.messages-container {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 24px;
  height: calc(100vh - 200px);
}

.conversations-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  :deep(.el-card__body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-input {
    margin-bottom: 16px;
  }

  .conversations-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .conversation-item {
      display: flex;
      gap: 12px;
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        background: var(--el-fill-color-light);
      }

      &.active {
        background: var(--el-color-primary-light-9);
        border-left: 3px solid var(--el-color-primary);
      }

      &.unread {
        .conversation-info {
          .user-name {
            font-weight: 700;
          }

          .last-message {
            font-weight: 600;
            color: var(--el-text-color-primary);
          }
        }
      }

      .conversation-info {
        flex: 1;
        min-width: 0;

        .conversation-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;

          .user-name {
            font-size: 15px;
            font-weight: 500;
            color: var(--el-text-color-primary);
          }

          .last-time {
            font-size: 12px;
            color: var(--el-text-color-disabled);
          }
        }

        .last-message {
          margin: 0;
          font-size: 13px;
          color: var(--el-text-color-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    }
  }
}

.chat-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;

      .user-details {
        display: flex;
        flex-direction: column;

        .user-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }

        .user-status {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }
    }

    .chat-actions {
      display: flex;
      gap: 8px;
    }
  }

  :deep(.el-card__body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }

  .chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .messages-list {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;

    .message-item {
      display: flex;
      gap: 12px;
      align-items: flex-end;

      &.message-sent {
        flex-direction: row-reverse;

        .message-bubble {
          background: var(--el-color-primary);
          color: white;
          align-items: flex-end;

          .message-time {
            text-align: right;
            color: rgba(255, 255, 255, 0.8);
          }
        }
      }

      &.message-received {
        .message-bubble {
          background: var(--el-fill-color-light);
          color: var(--el-text-color-primary);
        }
      }

      .message-avatar {
        flex-shrink: 0;
      }

      .message-bubble {
        max-width: 60%;
        padding: 12px 16px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;

        .message-content {
          font-size: 14px;
          line-height: 1.6;
          word-wrap: break-word;
        }

        .message-time {
          font-size: 11px;
          color: var(--el-text-color-disabled);
        }
      }
    }
  }

  .message-input {
    padding: 16px 24px;
    border-top: 1px solid var(--el-border-color);
    background: var(--el-bg-color);

    .input-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 12px;
    }
  }
}

.user-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 1024px) {
  .messages-container {
    grid-template-columns: 1fr;
    height: auto;

    .conversations-card {
      height: 400px;
    }

    .chat-card {
      height: 600px;
    }
  }
}

@media (max-width: 768px) {
  .messages-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h1 {
      font-size: 22px;
    }

    .el-button {
      width: 100%;
    }
  }

  .chat-card {
    .chat-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;

      .chat-actions {
        width: 100%;

        .el-button {
          flex: 1;
        }
      }
    }

    .messages-list {
      .message-item {
        .message-bubble {
          max-width: 80%;
        }
      }
    }
  }
}
</style>
