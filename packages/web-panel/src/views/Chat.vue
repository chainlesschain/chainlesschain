<template>
  <div style="display: flex; height: calc(100vh - 56px - 48px); gap: 16px;">
    <!-- Session Sidebar -->
    <div style="width: 240px; flex-shrink: 0; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden;">
      <!-- Project/Global Scope Indicator -->
      <div v-if="isProject" style="padding: 6px 12px 4px; font-size: 11px; color: #1677ff; background: rgba(22,119,255,.07); border-bottom: 1px solid rgba(22,119,255,.15); display: flex; align-items: center; gap: 4px;">
        <FolderOutlined />
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="cfg.projectRoot">
          {{ cfg.projectName || '项目' }}
        </span>
      </div>
      <div v-else style="padding: 6px 12px 4px; font-size: 11px; color: #722ed1; background: rgba(114,46,209,.07); border-bottom: 1px solid rgba(114,46,209,.15); display: flex; align-items: center; gap: 4px;">
        <GlobalOutlined />
        <span>全局会话</span>
      </div>
      <div style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px;">
        <a-button type="primary" size="small" style="flex: 1;" @click="newSession('chat')">
          <template #icon><MessageOutlined /></template>
          Chat
        </a-button>
        <a-button size="small" style="flex: 1;" @click="newSession('agent')">
          <template #icon><RobotOutlined /></template>
          Agent
        </a-button>
      </div>

      <div style="flex: 1; overflow-y: auto; padding: 8px;">
        <div
          v-for="session in chatStore.sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === chatStore.currentSessionId }"
          @click="chatStore.switchSession(session.id)"
        >
          <span class="session-icon">{{ session.type === 'agent' ? '🤖' : '💬' }}</span>
          <div class="session-info">
            <div class="session-title">{{ session.title || '新对话' }}</div>
            <div class="session-meta">{{ session.messageCount || 0 }} 条消息</div>
          </div>
        </div>

        <div v-if="!chatStore.sessions.length" style="text-align: center; color: var(--text-muted); padding: 24px 0; font-size: 13px;">
          点击上方按钮<br>开始新对话
        </div>
      </div>
    </div>

    <!-- Chat Area -->
    <div style="flex: 1; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden;">
      <!-- Empty State -->
      <div v-if="!currentSessionId" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted);">
        <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
        <div style="font-size: 16px; margin-bottom: 8px; color: #777;">开始 AI 对话</div>
        <div style="font-size: 13px; color: var(--text-muted);">选择左侧会话或创建新对话</div>
        <div style="margin-top: 24px; display: flex; gap: 12px;">
          <a-button type="primary" @click="newSession('chat')">新建 Chat</a-button>
          <a-button style="" @click="newSession('agent')">新建 Agent</a-button>
        </div>
      </div>

      <!-- Messages -->
      <div v-else style="flex: 1; overflow-y: auto; padding: 20px;" ref="messagesEl">
        <div v-for="(msg, i) in currentMessages" :key="i" class="message-row" :class="msg.role">
          <!-- Tool message -->
          <div v-if="msg.role === 'tool'" class="tool-msg">
            <ToolInvocationCard
              :item="toToolItem(msg, i)"
              expandable
              :expanded="expandedTools.has(i)"
              @toggle="toggleToolDetail(i)"
            />
            <div v-if="expandedTools.has(i)" class="tool-detail">
              <pre class="tool-detail__pre tool-detail__pre--input">{{ JSON.stringify(msg.input, null, 2) }}</pre>
              <div v-if="msg.result" class="tool-detail__result">
                <pre class="tool-detail__pre tool-detail__pre--result">{{ typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2) }}</pre>
              </div>
            </div>
          </div>
          <!-- User message -->
          <div v-else-if="msg.role === 'user'" class="user-msg">
            <div class="bubble user">{{ msg.content }}</div>
          </div>
          <!-- Assistant message -->
          <div v-else class="assistant-msg">
            <div class="avatar">AI</div>
            <div class="bubble assistant" v-html="renderMarkdown(msg.content)"></div>
          </div>
        </div>

        <!-- Streaming indicator -->
        <div v-if="streamingContent" class="assistant-msg">
          <div class="avatar">AI</div>
          <div class="bubble assistant streaming" v-html="renderMarkdown(streamingContent)"></div>
        </div>

        <!-- Interactive Question -->
        <div v-if="pendingQuestion" class="question-card">
          <div class="question-text">{{ pendingQuestion.question }}</div>
          <div v-if="pendingQuestion.choices?.length" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
            <a-button
              v-for="choice in pendingQuestion.choices"
              :key="choice"
              size="small"
              @click="answerQuestion(choice)"
            >{{ choice }}</a-button>
          </div>
          <a-input-search
            v-else
            placeholder="输入回答..."
            enter-button="发送"
            style="margin-top: 10px;"
            @search="answerQuestion"
          />
        </div>
      </div>

      <!-- Input Area -->
      <div v-if="currentSessionId" style="padding: 16px; border-top: 1px solid var(--border-color);">
        <div style="display: flex; gap: 8px; align-items: flex-end;">
          <a-textarea
            v-model:value="inputText"
            :placeholder="isLoading ? '等待响应中...' : '输入消息，Shift+Enter 换行，Enter 发送'"
            :auto-size="{ minRows: 1, maxRows: 6 }"
            :disabled="isLoading"
            style="background: var(--bg-card-hover); border-color: var(--border-color); color: var(--text-primary); resize: none; flex: 1;"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <a-button type="primary" :loading="isLoading" @click="sendMessage" style="height: 40px;">
            <template #icon><SendOutlined /></template>
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import { MessageOutlined, RobotOutlined, SendOutlined, FolderOutlined, GlobalOutlined } from '@ant-design/icons-vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { useChatStore } from '../stores/chat.js'
import ToolInvocationCard from '../components/ToolInvocationCard.vue'

const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')

// Configure marked
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true
})

const chatStore = useChatStore()
const messagesEl = ref(null)
const inputText = ref('')

const currentSessionId = computed(() => chatStore.currentSessionId)
const currentMessages = computed(() => {
  if (!currentSessionId.value) return []
  return chatStore.getMessages(currentSessionId.value)
})
const streamingContent = computed(() => {
  const s = chatStore.streaming[currentSessionId.value]
  return s?.active ? s.content : null
})
const pendingQuestion = computed(() => chatStore.pendingQuestion[currentSessionId.value])
const isLoading = computed(() => chatStore.isLoading)

function renderMarkdown(text) {
  try { return marked(text || '') } catch { return text || '' }
}

const expandedTools = reactive(new Set())

function toggleToolDetail(index) {
  if (expandedTools.has(index)) expandedTools.delete(index)
  else expandedTools.add(index)
}

function toToolItem(msg, index) {
  return {
    id: `tool-${index}`,
    label: msg.tool || 'unknown',
    detail: toolDetail(msg),
    status: msg.status === 'done' ? 'done' : 'running',
  }
}

function toolDetail(msg) {
  if (msg.status === 'running') {
    const keys = msg.input && typeof msg.input === 'object' ? Object.keys(msg.input) : []
    return keys.length ? `参数 ${keys.length} · ${keys[0]}…` : '执行中'
  }
  if (msg.result == null) return '完成'
  const text = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result)
  const firstLine = text.split('\n')[0] || ''
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine || '完成'
}

async function newSession(type) {
  await chatStore.createSession(type)
}

async function sendMessage() {
  if (!inputText.value.trim() || isLoading.value || !currentSessionId.value) return
  const content = inputText.value
  inputText.value = ''
  await chatStore.sendMessage(currentSessionId.value, content)
}

function answerQuestion(answer) {
  chatStore.answerQuestion(currentSessionId.value, answer)
}

// Auto-scroll to bottom
watch([currentMessages, streamingContent], () => {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}, { deep: true })

onMounted(() => {
  chatStore.loadSessions()
})
</script>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}
.session-item:hover { background: var(--bg-card-hover); }
.session-item.active { background: #1677ff20; border: 1px solid #1677ff40; }
.session-icon { font-size: 16px; }
.session-info { flex: 1; min-width: 0; }
.session-title { color: #ccc; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-meta { color: var(--text-muted); font-size: 11px; margin-top: 2px; }

.message-row { margin-bottom: 16px; }
.user-msg { display: flex; justify-content: flex-end; }
.assistant-msg { display: flex; gap: 10px; align-items: flex-start; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: #1677ff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.bubble { padding: 10px 14px; border-radius: 12px; max-width: 80%; line-height: 1.6; font-size: 14px; }
.bubble.user { background: #1677ff; color: var(--text-primary); border-bottom-right-radius: 4px; }
.bubble.assistant { background: var(--bg-card-hover); color: var(--text-primary); border-bottom-left-radius: 4px; }
.bubble.streaming::after { content: '▋'; animation: blink 0.7s step-start infinite; color: #1677ff; }
@keyframes blink { 50% { opacity: 0; } }
.tool-msg { margin: 8px 0; }
.tool-detail {
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-base);
}
.tool-detail__result {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}
.tool-detail__pre {
  margin: 0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tool-detail__pre--input { color: #aaa; }
.tool-detail__pre--result { color: #52c41a; }

.question-card {
  background: var(--bg-card-hover);
  border: 1px solid #1677ff40;
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 8px;
}
.question-text { color: #aaa; font-size: 13px; }

:deep(.bubble.assistant pre) { background: var(--bg-base); border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12px; }
:deep(.bubble.assistant code:not(pre code)) { background: var(--bg-card-hover); padding: 1px 5px; border-radius: 3px; font-size: 12px; color: #f0a500; }
:deep(.bubble.assistant p) { margin: 0 0 8px; }
:deep(.bubble.assistant p:last-child) { margin: 0; }
</style>
