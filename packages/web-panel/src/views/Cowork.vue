<template>
  <div class="cowork-root">
    <!-- Left Panel: Templates -->
    <div class="template-panel">
      <div class="template-header">
        <RocketOutlined class="header-icon" />
        <span class="header-title">日常协作</span>
      </div>
      <div class="template-hint">选择任务类型，或直接输入需求</div>

      <div class="template-list">
        <div
          v-for="tpl in TASK_TEMPLATES"
          :key="tpl.id"
          class="template-card"
          :class="{ active: store.selectedTemplate?.id === tpl.id }"
          @click="store.selectTemplate(tpl)"
        >
          <div class="card-icon">
            <component :is="iconMap[tpl.icon] || RocketOutlined" />
          </div>
          <div class="card-body">
            <div class="card-name">{{ tpl.name }}</div>
            <div class="card-desc">{{ tpl.description }}</div>
          </div>
        </div>

        <!-- Free mode card -->
        <div
          class="template-card free"
          :class="{ active: store.selectedTemplate === null && hasInteracted }"
          @click="store.selectTemplate(null); hasInteracted = true"
        >
          <div class="card-icon"><ThunderboltOutlined /></div>
          <div class="card-body">
            <div class="card-name">自由提问</div>
            <div class="card-desc">任意任务，Agent 自主完成</div>
          </div>
        </div>
      </div>

      <!-- File drop zone -->
      <div
        v-if="store.selectedTemplate?.acceptsFiles !== false"
        class="file-zone"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
        :class="{ dragging: isDragging }"
      >
        <FolderOpenOutlined class="drop-icon" />
        <div class="drop-text">{{ isDragging ? '松开以添加文件' : '拖拽文件到此处' }}</div>
        <div v-if="store.files.length" class="file-list">
          <a-tag
            v-for="f in store.files"
            :key="f"
            closable
            @close="store.removeFile(f)"
            class="file-tag"
          >{{ basename(f) }}</a-tag>
        </div>
        <a-input
          v-model:value="manualFilePath"
          placeholder="或输入文件路径，按 Enter 添加"
          size="small"
          class="path-input"
          @pressEnter="addManualFile"
        />
      </div>
    </div>

    <!-- Right Panel: Execution -->
    <div class="exec-panel">
      <!-- Empty state -->
      <div v-if="!store.agentSessionId && !store.selectedTemplate" class="empty-state">
        <div class="empty-icon"><RocketOutlined /></div>
        <div class="empty-title">选择一个任务模板开始</div>
        <div class="empty-sub">或选择「自由提问」处理任何问题</div>
        <div class="example-grid">
          <div v-for="ex in quickExamples" :key="ex" class="example-chip" @click="quickStart(ex)">
            {{ ex }}
          </div>
        </div>
      </div>

      <!-- Template selected but not started -->
      <div v-else-if="store.selectedTemplate && !store.agentSessionId" class="ready-state">
        <div class="ready-header">
          <component :is="iconMap[store.selectedTemplate.icon] || RocketOutlined" class="ready-icon" />
          <span class="ready-name">{{ store.selectedTemplate.name }}</span>
        </div>
        <div class="ready-examples">
          <div class="example-label">试试这些:</div>
          <div
            v-for="ex in store.selectedTemplate.examples"
            :key="ex"
            class="example-chip"
            @click="quickStart(ex)"
          >{{ ex }}</div>
        </div>
      </div>

      <!-- Messages area (active session) -->
      <div v-else class="messages-area" ref="messagesEl">
        <div v-for="(msg, i) in agentMessages" :key="i" class="message-row" :class="msg.role">
          <!-- Tool call -->
          <div v-if="msg.role === 'tool'" class="tool-msg">
            <a-collapse ghost size="small">
              <a-collapse-panel
                :header="`🔧 ${msg.tool} ${msg.status === 'running' ? '(执行中...)' : '✓'}`"
                class="tool-collapse"
              >
                <pre class="tool-input">{{ JSON.stringify(msg.input, null, 2) }}</pre>
                <div v-if="msg.result" class="tool-result-box">
                  <pre class="tool-result">{{ typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2) }}</pre>
                </div>
              </a-collapse-panel>
            </a-collapse>
          </div>
          <!-- User -->
          <div v-else-if="msg.role === 'user'" class="user-msg">
            <div class="bubble user">{{ msg.content }}</div>
          </div>
          <!-- Assistant -->
          <div v-else class="assistant-msg">
            <div class="avatar">AI</div>
            <div class="bubble assistant" v-html="renderMarkdown(msg.content)"></div>
          </div>
        </div>

        <!-- Streaming -->
        <div v-if="store.currentStreaming" class="assistant-msg">
          <div class="avatar">AI</div>
          <div class="bubble assistant streaming" v-html="renderMarkdown(store.currentStreaming)"></div>
        </div>

        <!-- Question -->
        <div v-if="store.currentQuestion" class="question-card">
          <div class="question-text">{{ store.currentQuestion.question }}</div>
          <div v-if="store.currentQuestion.choices?.length" class="question-choices">
            <a-button
              v-for="choice in store.currentQuestion.choices"
              :key="choice"
              size="small"
              @click="store.answerQuestion(choice)"
            >{{ choice }}</a-button>
          </div>
          <a-input-search
            v-else
            placeholder="输入回答..."
            enter-button="发送"
            style="margin-top: 10px;"
            @search="store.answerQuestion"
          />
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area">
        <div v-if="store.selectedTemplate" class="input-context">
          <a-tag color="blue" class="context-tag">
            <component :is="iconMap[store.selectedTemplate.icon] || RocketOutlined" />
            {{ store.selectedTemplate.name }}
          </a-tag>
          <a-tag v-for="f in store.files" :key="f" class="context-tag file">{{ basename(f) }}</a-tag>
        </div>
        <div class="input-row">
          <a-textarea
            v-model:value="inputText"
            :placeholder="inputPlaceholder"
            :auto-size="{ minRows: 1, maxRows: 6 }"
            :disabled="chatStore.isLoading"
            class="msg-input"
            @keydown.enter.exact.prevent="send"
          />
          <a-button
            type="primary"
            :loading="chatStore.isLoading"
            class="send-btn"
            @click="send"
          >
            <template #icon><SendOutlined /></template>
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import {
  RocketOutlined, SendOutlined, ThunderboltOutlined, FolderOpenOutlined,
  FileTextOutlined, PlayCircleOutlined, BarChartOutlined, SearchOutlined,
  PictureOutlined, CodeOutlined, DesktopOutlined, GlobalOutlined, ReadOutlined,
} from '@ant-design/icons-vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { useCoworkStore, TASK_TEMPLATES } from '../stores/cowork.js'
import { useChatStore } from '../stores/chat.js'

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
    return hljs.highlightAuto(code).value
  },
  breaks: true,
})

const store = useCoworkStore()
const chatStore = useChatStore()

const inputText = ref('')
const messagesEl = ref(null)
const isDragging = ref(false)
const manualFilePath = ref('')
const hasInteracted = ref(false)

const iconMap = {
  FileTextOutlined, PlayCircleOutlined, BarChartOutlined, SearchOutlined,
  PictureOutlined, CodeOutlined, DesktopOutlined, FolderOpenOutlined,
  GlobalOutlined, ReadOutlined,
}

const quickExamples = [
  '把 report.docx 转成 PDF',
  '压缩视频到 50MB',
  '分析 CSV 生成图表',
  '查询今天的汇率',
  '批量压缩图片',
  '写一个自动化脚本',
]

const inputPlaceholder = computed(() => {
  if (chatStore.isLoading) return '等待响应中...'
  if (store.selectedTemplate) {
    return store.selectedTemplate.examples?.[0] || '描述你的需求...'
  }
  return '描述你想完成的任务，Agent 会帮你搞定'
})

const agentMessages = computed(() => store.currentAgentMessages)

function renderMarkdown(text) {
  try { return DOMPurify.sanitize(marked(text || '')) } catch { return DOMPurify.sanitize(text || '') }
}

function basename(filepath) {
  return filepath.split(/[\\/]/).pop() || filepath
}

function onDrop(e) {
  isDragging.value = false
  const items = e.dataTransfer?.files
  if (items) {
    for (const file of items) {
      store.addFile(file.path || file.name)
    }
  }
}

function addManualFile() {
  const p = manualFilePath.value.trim()
  if (p) {
    store.addFile(p)
    manualFilePath.value = ''
  }
}

async function send() {
  const text = inputText.value.trim()
  if (!text || chatStore.isLoading) return
  inputText.value = ''

  if (!store.agentSessionId) {
    await store.execute(text)
  } else {
    await store.sendFollowUp(text)
  }
}

function quickStart(example) {
  inputText.value = example
  nextTick(() => send())
}

// Auto-scroll
watch([agentMessages, () => store.currentStreaming], () => {
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
.cowork-root {
  display: flex;
  height: calc(100vh - 56px - 48px);
  gap: 16px;
}

/* ── Left Panel ─────────────────────────────────────────── */
.template-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.template-header {
  padding: 16px 16px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.header-icon { font-size: 18px; color: #1677ff; }
.template-hint {
  padding: 0 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-color);
}

.template-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.template-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 4px;
  border: 1px solid transparent;
}
.template-card:hover { background: var(--bg-card-hover); }
.template-card.active {
  background: rgba(22, 119, 255, 0.08);
  border-color: rgba(22, 119, 255, 0.3);
}
.template-card.free .card-icon { color: #faad14; }

.card-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #1677ff;
  background: rgba(22, 119, 255, 0.08);
  border-radius: 8px;
  flex-shrink: 0;
  margin-top: 2px;
}
.card-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.card-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }

/* File zone */
.file-zone {
  padding: 12px;
  border-top: 1px solid var(--border-color);
  text-align: center;
  transition: background 0.2s;
}
.file-zone.dragging {
  background: rgba(22, 119, 255, 0.08);
}
.drop-icon { font-size: 20px; color: var(--text-muted); }
.drop-text { font-size: 11px; color: var(--text-muted); margin: 4px 0 8px; }
.file-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; justify-content: center; }
.file-tag { max-width: 140px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.path-input { font-size: 11px; }

/* ── Right Panel ────────────────────────────────────────── */
.exec-panel {
  flex: 1;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Empty state */
.empty-state, .ready-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}
.empty-icon { font-size: 48px; color: #1677ff40; margin-bottom: 16px; }
.empty-title { font-size: 16px; color: var(--text-primary); margin-bottom: 6px; }
.empty-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 24px; }

.ready-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.ready-icon { font-size: 28px; color: #1677ff; }
.ready-name { font-size: 18px; font-weight: 600; color: var(--text-primary); }

.ready-examples { text-align: center; }
.example-label { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }

.example-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-width: 500px;
}
.example-chip {
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-card-hover);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.15s;
}
.example-chip:hover {
  border-color: #1677ff;
  background: rgba(22, 119, 255, 0.08);
  color: #1677ff;
}

/* Messages */
.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.message-row { margin-bottom: 16px; }
.user-msg { display: flex; justify-content: flex-end; }
.assistant-msg { display: flex; gap: 10px; align-items: flex-start; }
.avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: #1677ff;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; color: var(--text-primary);
  flex-shrink: 0;
}
.bubble {
  padding: 10px 14px; border-radius: 12px;
  max-width: 80%; line-height: 1.6; font-size: 14px;
}
.bubble.user {
  background: #1677ff; color: var(--text-primary);
  border-bottom-right-radius: 4px;
}
.bubble.assistant {
  background: var(--bg-card-hover); color: var(--text-primary);
  border-bottom-left-radius: 4px;
}
.bubble.streaming::after {
  content: '\25CB'; animation: blink 0.7s step-start infinite; color: #1677ff;
}
@keyframes blink { 50% { opacity: 0; } }

.tool-msg { margin: 8px 0; }
.tool-collapse { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-card); }
.tool-input { margin: 0; font-size: 11px; color: #aaa; white-space: pre-wrap; }
.tool-result-box { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
.tool-result { margin: 0; font-size: 11px; color: #52c41a; white-space: pre-wrap; }

.question-card {
  background: var(--bg-card-hover);
  border: 1px solid #1677ff40;
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 8px;
}
.question-text { color: #aaa; font-size: 13px; }
.question-choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

/* Input area */
.input-area {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border-color);
}
.input-context {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-bottom: 8px;
}
.context-tag { font-size: 11px; }
.context-tag.file { background: var(--bg-card-hover); }

.input-row {
  display: flex; gap: 8px; align-items: flex-end;
}
.msg-input {
  flex: 1;
  background: var(--bg-card-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
  resize: none;
}
.send-btn { height: 40px; }

/* Markdown in assistant bubbles */
:deep(.bubble.assistant pre) {
  background: var(--bg-base); border-radius: 6px;
  padding: 12px; overflow-x: auto; font-size: 12px;
}
:deep(.bubble.assistant code:not(pre code)) {
  background: var(--bg-card-hover); padding: 1px 5px;
  border-radius: 3px; font-size: 12px; color: #f0a500;
}
:deep(.bubble.assistant p) { margin: 0 0 8px; }
:deep(.bubble.assistant p:last-child) { margin: 0; }
</style>
