<template>
  <div style="display: flex; height: calc(100vh - 56px - 48px); gap: 16px;">
    <!-- Session Sidebar -->
    <div style="width: 240px; flex-shrink: 0; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden;">
      <!-- Project/Global Scope Indicator -->
      <div v-if="isProject" style="padding: 6px 12px 4px; font-size: 11px; color: #1677ff; background: rgba(22,119,255,.07); border-bottom: 1px solid rgba(22,119,255,.15); display: flex; align-items: center; gap: 4px;">
        <FolderOutlined />
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="cfg.projectRoot">
          {{ cfg.projectName || $t('chat.scope.fallbackProjectName') }}
        </span>
      </div>
      <div v-else style="padding: 6px 12px 4px; font-size: 11px; color: #722ed1; background: rgba(114,46,209,.07); border-bottom: 1px solid rgba(114,46,209,.15); display: flex; align-items: center; gap: 4px;">
        <GlobalOutlined />
        <span>{{ $t('chat.scope.globalSessions') }}</span>
      </div>
      <div style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px;">
        <a-button type="primary" size="small" style="flex: 1;" @click="newSession('chat')">
          <template #icon><MessageOutlined /></template>
          {{ $t('chat.newChat') }}
        </a-button>
        <a-button size="small" style="flex: 1;" @click="newSession('agent')">
          <template #icon><RobotOutlined /></template>
          {{ $t('chat.newAgent') }}
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
            <div class="session-title">{{ session.title || $t('chat.session.untitled') }}</div>
            <div class="session-meta">{{ $t('chat.session.messageCountSuffix', { n: session.messageCount || 0 }) }}</div>
          </div>
        </div>

        <div v-if="!chatStore.sessions.length" style="text-align: center; color: var(--text-muted); padding: 24px 0; font-size: 13px;">
          {{ $t('chat.sidebarEmpty') }}
        </div>
      </div>
    </div>

    <!-- Chat Area -->
    <div style="flex: 1; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden;">
      <!-- Empty State -->
      <div v-if="!currentSessionId" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted);">
        <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
        <div style="font-size: 16px; margin-bottom: 8px; color: #777;">{{ $t('chat.empty.title') }}</div>
        <div style="font-size: 13px; color: var(--text-muted);">{{ $t('chat.empty.subtitle') }}</div>
        <div style="margin-top: 24px; display: flex; gap: 12px;">
          <a-button type="primary" @click="newSession('chat')">{{ $t('chat.empty.newChat') }}</a-button>
          <a-button style="" @click="newSession('agent')">{{ $t('chat.empty.newAgent') }}</a-button>
        </div>
      </div>

      <!-- Chat header: context mode + intent toggle -->
      <div v-if="currentSessionId" class="chat-header">
        <a-radio-group
          :value="contextMode"
          size="small"
          button-style="solid"
          @update:value="setContextMode"
        >
          <a-radio-button value="project" :disabled="!isProject">
            <FolderOutlined />
            {{ $t('chat.contextMode.project') }}
          </a-radio-button>
          <a-radio-button value="file" disabled>
            <FileTextOutlined />
            {{ $t('chat.contextMode.file') }}
          </a-radio-button>
          <a-radio-button value="global">
            <GlobalOutlined />
            {{ $t('chat.contextMode.global') }}
          </a-radio-button>
        </a-radio-group>
        <a-tooltip
          v-if="contextMode !== 'global'"
          :title="$t('chat.intent.toggleHint')"
          placement="bottom"
        >
          <label class="chat-intent-toggle">
            <a-switch
              :checked="intentEnabled"
              size="small"
              @update:checked="setIntentEnabled"
            />
            <span class="chat-intent-toggle-label">{{ $t('chat.intent.toggleLabel') }}</span>
          </label>
        </a-tooltip>
      </div>

      <!-- Messages -->
      <div v-if="currentSessionId" class="chat-area-body">
        <!-- Empty state with quick prompts when session has no messages -->
        <div v-if="messagesWithStreaming.length === 0" class="chat-empty-prompts">
          <div class="empty-icon">💬</div>
          <div class="empty-title">{{ $t('chat.empty.startTitle') }}</div>
          <div class="empty-hint">{{ emptyHint }}</div>
          <div class="quick-prompts">
            <a-button
              v-for="prompt in QUICK_PROMPTS"
              :key="prompt"
              size="small"
              class="quick-prompt-btn"
              @click="usePrompt(prompt)"
            >{{ prompt }}</a-button>
            <a-button
              size="small"
              type="dashed"
              class="quick-prompt-btn quick-prompt-edit"
              @click="openPromptEditor"
            >{{ $t('chat.quickPromptsEditor.openButton') }}</a-button>
          </div>
        </div>

        <VirtualMessageList
          v-else
          ref="virtualListRef"
          :messages="messagesWithStreaming"
          :estimate-size="120"
          class="chat-virtual-list"
        >
          <template #default="{ message: msg, index: i }">
            <div class="message-row" :class="msg.role">
              <!-- Intent confirmation card (V5 parity) -->
              <IntentConfirmationMessage
                v-if="msg.type === MessageType.INTENT_CONFIRMATION"
                :message="msg"
                @confirm="handleIntentConfirm"
                @correct="handleIntentCorrect"
              />
              <!-- System banner (follow-up intent feedback etc.) -->
              <div v-else-if="msg.role === 'system'" class="system-banner">
                {{ msg.content }}
              </div>
              <!-- Tool message -->
              <div v-else-if="msg.role === 'tool'" class="tool-msg">
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
              <!-- User / Assistant message with avatar + meta row -->
              <div v-else class="msg-with-avatar" :class="msg.role">
                <a-avatar
                  :size="32"
                  :style="{ backgroundColor: msg.role === 'user' ? '#1890ff' : '#52c41a', flexShrink: 0 }"
                >
                  <template #icon>
                    <UserOutlined v-if="msg.role === 'user'" />
                    <RobotOutlined v-else />
                  </template>
                </a-avatar>
                <div class="msg-body">
                  <div class="msg-meta-row">
                    <span class="msg-role">{{ msg.role === 'user' ? $t('chat.role.me') : 'AI' }}</span>
                    <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
                    <span v-if="msg.tokens" class="msg-tokens">· {{ msg.tokens }} tokens</span>
                  </div>
                  <div v-if="msg.role === 'user'" class="bubble user">{{ msg.content }}</div>
                  <MarkdownRenderer
                    v-else
                    class="bubble assistant"
                    :class="{ streaming: msg._streaming }"
                    :content="msg.content"
                  />
                </div>
              </div>
            </div>
          </template>
        </VirtualMessageList>

        <!-- Interactive Question (sticky below the list) -->
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
            :placeholder="$t('chat.input.answerPlaceholder')"
            :enter-button="$t('chat.input.send')"
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
            :placeholder="isLoading ? $t('chat.input.loading') : $t('chat.input.placeholder')"
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

    <!-- Custom quick-prompts editor (Improvement 4) — placed at root so the
         chat-area-body's v-if/v-else pair stays unbroken. -->
    <a-modal
      v-model:open="editingPrompts"
      :title="$t('chat.quickPromptsEditor.title')"
      :ok-text="$t('chat.quickPromptsEditor.save')"
      :cancel-text="$t('chat.quickPromptsEditor.cancel')"
      @ok="savePromptEditor"
    >
      <div style="margin-bottom: 8px; font-size: 12px; color: var(--text-muted);">
        {{ $t('chat.quickPromptsEditor.hint') }}
      </div>
      <a-textarea
        v-model:value="promptDraft"
        :rows="8"
        :placeholder="$t('chat.quickPromptsEditor.placeholder')"
      />
      <div style="margin-top: 8px;">
        <a-button size="small" @click="resetPromptsToDefault">
          {{ $t('chat.quickPromptsEditor.reset') }}
        </a-button>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessageOutlined, RobotOutlined, SendOutlined, FolderOutlined, GlobalOutlined, UserOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '../stores/chat.js'
import ToolInvocationCard from '../components/ToolInvocationCard.vue'
import MarkdownRenderer from '../components/MarkdownRenderer.vue'
import VirtualMessageList from '../components/VirtualMessageList.vue'
import IntentConfirmationMessage from '../components/IntentConfirmationMessage.vue'
import { MessageType } from '../utils/messageTypes.js'

const { t, tm, rt } = useI18n()
// Smoke tests mount Chat.vue without a router plugin (views-mount-smoke.test).
// Both helpers must be optional — autoSendMessage simply degrades to "Pinia
// staging only" when the component runs outside a vue-router context.
const route = useRoute() || null
const router = useRouter() || null
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')

const chatStore = useChatStore()

// Tracks which auto-send tokens we've already consumed so the watcher
// doesn't re-fire on benign re-renders. Cleared when the query changes.
const consumedAutoSendTokens = new Set()
const virtualListRef = ref(null)
const inputText = ref('')

const contextMode = computed(() => chatStore.contextMode)
function setContextMode(mode) {
  chatStore.setContextMode(mode)
}

const intentEnabled = computed(() => chatStore.intentEnabled)
function setIntentEnabled(val) {
  chatStore.setIntentEnabled(val)
}

const currentSessionId = computed(() => chatStore.currentSessionId)
const currentMessages = computed(() => {
  if (!currentSessionId.value) return []
  return chatStore.getMessages(currentSessionId.value)
})
const streamingContent = computed(() => {
  const s = chatStore.streaming[currentSessionId.value]
  return s?.active ? s.content : null
})
const messagesWithStreaming = computed(() => {
  const base = currentMessages.value
  if (streamingContent.value) {
    return [
      ...base,
      { role: 'assistant', content: streamingContent.value, _streaming: true, timestamp: Date.now() },
    ]
  }
  return base
})
const pendingQuestion = computed(() => chatStore.pendingQuestion[currentSessionId.value])
const isLoading = computed(() => chatStore.getIsLoading(currentSessionId.value))

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const expandedTools = reactive(new Set())

function toggleToolDetail(index) {
  if (expandedTools.has(index)) expandedTools.delete(index)
  else expandedTools.add(index)
}

function toToolItem(msg, index) {
  return {
    id: `tool-${index}`,
    label: msg.tool || t('chat.tool.unknownTool'),
    detail: toolDetail(msg),
    status: msg.status === 'done' ? 'done' : 'running',
  }
}

function toolDetail(msg) {
  if (msg.status === 'running') {
    const keys = msg.input && typeof msg.input === 'object' ? Object.keys(msg.input) : []
    return keys.length
      ? t('chat.tool.argsPreview', { n: keys.length, key: keys[0] })
      : t('chat.tool.running')
  }
  if (msg.result == null) return t('chat.tool.done')
  const text = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result)
  const firstLine = text.split('\n')[0] || ''
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine || t('chat.tool.done')
}

async function newSession(type) {
  await chatStore.createSession(type)
}

async function sendMessage() {
  if (!inputText.value.trim() || isLoading.value || !currentSessionId.value) return
  const content = inputText.value
  inputText.value = ''
  await chatStore.submitUserInput(currentSessionId.value, content)
}

function handleIntentConfirm(payload) {
  chatStore.confirmIntent(currentSessionId.value, payload.messageId)
}

function handleIntentCorrect(payload) {
  chatStore.correctIntent(currentSessionId.value, payload.messageId, payload.correction)
}

const QUICK_PROMPTS = computed(() => {
  // User override (per-localStorage) wins when set; otherwise defaults to
  // the i18n catalog. The seed stores quickPrompts as an object for
  // parity-test stability so we surface the values as an array.
  const custom = chatStore.customQuickPrompts
  if (Array.isArray(custom) && custom.length > 0) return custom
  const raw = tm('chat.quickPrompts')
  if (!raw) return []
  return Object.values(raw).map((item) => rt(item))
})

const editingPrompts = ref(false)
const promptDraft = ref('')

function openPromptEditor() {
  promptDraft.value = QUICK_PROMPTS.value.join('\n')
  editingPrompts.value = true
}
function savePromptEditor() {
  const lines = promptDraft.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  chatStore.setCustomQuickPrompts(lines.length > 0 ? lines : null)
  editingPrompts.value = false
}
function resetPromptsToDefault() {
  chatStore.setCustomQuickPrompts(null)
  editingPrompts.value = false
}

const emptyHint = computed(() => t(`chat.empty.hint.${contextMode.value}`))

async function usePrompt(prompt) {
  if (!currentSessionId.value) {
    await chatStore.createSession('chat')
  }
  inputText.value = prompt
  await sendMessage()
}

function answerQuestion(answer) {
  chatStore.answerQuestion(currentSessionId.value, answer)
}

// Auto-scroll to bottom (delegate to VirtualMessageList)
watch([currentMessages, streamingContent], () => {
  nextTick(() => {
    virtualListRef.value?.scrollToBottom()
  })
}, { deep: true })

/**
 * autoSendMessage protocol — supports deep-linking into the chat panel
 * with a pre-filled (and optionally auto-dispatched) message. Two surfaces:
 *
 * 1. URL query (deep link): `/#/chat?prompt=<text>&autoSend=true&session=<id>`
 *    - prompt: text to load; required for the watcher to fire
 *    - autoSend: 'true' (default) sends immediately, 'false' just prefills
 *    - session: optional sessionId to target; otherwise creates a fresh one
 * 2. Pinia API: `chatStore.scheduleAutoSend({ prompt, autoSend, session })`
 *    Other views can stage an auto-send and route here without touching URLs.
 *
 * To prevent duplicate fires on hot-reload / route flicker, every auto-send
 * carries a token (the prompt + session + a millisecond stamp). Consumed
 * tokens are remembered for the panel's lifetime.
 */
async function consumeAutoSend({ prompt, autoSend, session, token }) {
  if (!prompt) return
  if (consumedAutoSendTokens.has(token)) return
  consumedAutoSendTokens.add(token)

  let sessionId = session || currentSessionId.value
  if (!sessionId) {
    sessionId = await chatStore.createSession('chat')
  } else if (sessionId !== currentSessionId.value) {
    await chatStore.switchSession(sessionId)
  }

  inputText.value = prompt
  if (autoSend === false) return
  // Defer to next tick so v-model reflects the prefilled value before we
  // clear it inside sendMessage.
  await nextTick()
  await sendMessage()
}

function readAutoSendFromQuery() {
  const q = route?.query || {}
  if (!q.prompt) return null
  const promptStr = Array.isArray(q.prompt) ? q.prompt[0] : String(q.prompt)
  if (!promptStr.trim()) return null
  const autoSendStr = Array.isArray(q.autoSend) ? q.autoSend[0] : q.autoSend
  const autoSend = autoSendStr !== 'false' // default true
  const sessionStr = Array.isArray(q.session) ? q.session[0] : q.session
  const session = sessionStr ? String(sessionStr) : null
  // Token: stable for the same query+session pair so identical pushes don't
  // double-fire, but a new prompt creates a new token.
  const token = `query::${promptStr}::${session || ''}::${autoSend}`
  return { prompt: promptStr, autoSend, session, token }
}

async function handleAutoSendIfPending() {
  const fromQuery = readAutoSendFromQuery()
  if (fromQuery) {
    await consumeAutoSend(fromQuery)
    // Strip the query so a refresh / nav doesn't re-send.
    if (router && route) {
      router.replace({ path: route.path, query: {} }).catch(() => {})
    }
    return
  }
  // Pinia-staged auto-send takes precedence after URL.
  const staged = chatStore.pendingAutoSend
  if (staged?.prompt) {
    const token = staged.token || `staged::${staged.prompt}::${Date.now()}`
    await consumeAutoSend({ ...staged, token })
    chatStore.clearAutoSend?.()
  }
}

if (route) {
  watch(
    () => [route.query.prompt, route.query.autoSend, route.query.session],
    () => { handleAutoSendIfPending() },
    { immediate: false },
  )
}

watch(
  () => chatStore.pendingAutoSend,
  () => { handleAutoSendIfPending() },
  { deep: true },
)

onMounted(async () => {
  await chatStore.loadSessions()
  await handleAutoSendIfPending()
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

.chat-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.chat-intent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.chat-intent-toggle-label {
  font-size: 12px;
  color: var(--text-muted);
}
.chat-area-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px 0;
}
.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: -4px;
}
.chat-virtual-list { flex: 1; }
.chat-empty-prompts {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
}
.empty-icon { font-size: 40px; }
.empty-title { font-size: 14px; color: var(--text-secondary, #aaa); }
.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-width: 480px;
  margin-top: 8px;
}
.quick-prompt-btn { font-size: 12px; }

.message-row { margin-bottom: 16px; padding: 0 4px; }
.msg-with-avatar {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.msg-with-avatar.user { flex-direction: row-reverse; }
.msg-with-avatar.user .msg-meta-row { justify-content: flex-end; }
.msg-with-avatar.user .msg-body { display: flex; flex-direction: column; align-items: flex-end; }
.msg-body { flex: 1; min-width: 0; max-width: calc(100% - 50px); }
.msg-meta-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.msg-role { color: var(--text-secondary, #aaa); font-weight: 500; }
.msg-time { font-size: 10px; }
.msg-tokens { font-size: 10px; }
.bubble { padding: 10px 14px; border-radius: 12px; max-width: 100%; line-height: 1.6; font-size: 14px; word-wrap: break-word; }
.bubble.user { background: #1677ff; color: var(--text-primary); border-bottom-right-radius: 4px; }
.bubble.assistant { background: var(--bg-card-hover); color: var(--text-primary); border-bottom-left-radius: 4px; }
.bubble.streaming::after { content: '▋'; animation: blink 0.7s step-start infinite; color: #1677ff; }
@keyframes blink { 50% { opacity: 0; } }
.system-banner {
  margin: 8px 0;
  padding: 10px 14px;
  background: var(--bg-card-hover);
  border-left: 3px solid #722ed1;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #aaa);
  white-space: pre-wrap;
}
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
