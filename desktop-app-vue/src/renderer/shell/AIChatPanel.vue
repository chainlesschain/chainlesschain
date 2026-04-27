<template>
  <a-modal
    :open="open"
    :width="780"
    :footer="null"
    :mask-closable="true"
    :body-style="{
      height: '70vh',
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
    }"
    title="AI 对话"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <MessageOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <!-- Header: status + actions -->
    <div class="chat-header">
      <a-space>
        <a-tag v-if="llmStore.isAvailable" color="success" size="small">
          <CheckCircleOutlined />
          {{ llmStore.providerDisplayName }}
        </a-tag>
        <a-tag v-else color="error" size="small">
          <ExclamationCircleOutlined />
          未配置
        </a-tag>
        <span v-if="conversationStore.currentConversation" class="conv-title">
          {{ conversationStore.currentConversationTitle }}
        </span>
      </a-space>
      <a-space>
        <a-tooltip title="新对话">
          <a-button type="text" size="small" @click="onNewConversation">
            <PlusOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="LLM 设置">
          <a-button type="text" size="small" @click="onGoSettings">
            <SettingOutlined />
          </a-button>
        </a-tooltip>
      </a-space>
    </div>

    <!-- Messages list / empty state -->
    <div ref="messagesContainer" class="chat-messages">
      <a-empty
        v-if="!llmStore.isAvailable"
        description="LLM 服务未配置或不可用"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      >
        <a-button type="primary" @click="onGoSettings"> 前往配置 </a-button>
      </a-empty>

      <a-empty
        v-else-if="currentMessages.length === 0"
        description="开始新的对话"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      >
        <div class="quick-prompts">
          <a-button
            v-for="prompt in QUICK_PROMPTS"
            :key="prompt"
            size="small"
            class="quick-prompt-btn"
            @click="onQuickPrompt(prompt)"
          >
            {{ prompt }}
          </a-button>
        </div>
      </a-empty>

      <div v-else class="messages-list">
        <div
          v-for="(msg, index) in currentMessages"
          :key="msg.id ?? index"
          class="message-row"
          :class="msg.role"
        >
          <a-avatar
            :size="32"
            :style="{
              backgroundColor: msg.role === 'user' ? '#1890ff' : '#52c41a',
            }"
          >
            <template #icon>
              <UserOutlined v-if="msg.role === 'user'" />
              <RobotOutlined v-else />
            </template>
          </a-avatar>
          <div class="message-bubble">
            <div class="message-meta-row">
              <span class="message-role">
                {{ msg.role === "user" ? "我" : "AI" }}
              </span>
              <span class="message-time">
                {{ formatTime(msg.timestamp) }}
              </span>
              <span v-if="msg.tokens" class="message-tokens">
                · {{ msg.tokens }} tokens
              </span>
            </div>
            <!-- eslint-disable vue/no-v-html -- sanitized: MarkdownIt configured with html:false; user content is plain text -->
            <div
              v-if="msg.role === 'assistant'"
              class="message-text"
              v-html="renderMarkdown(msg.content)"
            />
            <!-- eslint-enable vue/no-v-html -->
            <div v-else class="message-text user-text">
              {{ msg.content }}
            </div>
          </div>
        </div>

        <!-- Thinking indicator -->
        <div v-if="isProcessing" class="message-row assistant">
          <a-avatar :size="32" :style="{ backgroundColor: '#52c41a' }">
            <template #icon>
              <RobotOutlined />
            </template>
          </a-avatar>
          <div class="message-bubble">
            <div class="message-text"><a-spin size="small" /> 正在思考…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Composer -->
    <div class="chat-composer">
      <a-textarea
        v-model:value="inputText"
        :placeholder="
          llmStore.isAvailable
            ? '输入消息（Shift+Enter 换行，Enter 发送）'
            : '请先配置 LLM'
        "
        :auto-size="{ minRows: 1, maxRows: 4 }"
        :disabled="!llmStore.isAvailable || isProcessing"
        @keydown="onComposerKeyDown"
      />
      <div class="composer-actions">
        <a-button
          type="primary"
          :loading="isProcessing"
          :disabled="!canSend"
          @click="onSend"
        >
          <SendOutlined /> 发送
        </a-button>
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      class="chat-error"
      :message="errorMessage"
      type="error"
      show-icon
      closable
      @close="errorMessage = null"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Empty } from "ant-design-vue";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons-vue";
import MarkdownIt from "markdown-it";
import { useLLMStore } from "../stores/llm";
import { useConversationStore } from "../stores/conversation";

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const router = useRouter();
const llmStore = useLLMStore();
const conversationStore = useConversationStore();

// MarkdownIt configured with html:false → auto-escapes HTML to prevent XSS
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  xhtmlOut: true,
});

const QUICK_PROMPTS = [
  "帮我总结一下这段内容",
  "写一段 TypeScript 示例",
  "解释一下这个概念",
  "列出几个改进建议",
];

const inputText = ref("");
const isProcessing = ref(false);
const errorMessage = ref<string | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);

const currentMessages = computed(() => conversationStore.currentMessages);

const canSend = computed(
  () => !!inputText.value.trim() && llmStore.isAvailable && !isProcessing.value,
);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return;
    }
    if (!conversationStore.currentConversation) {
      try {
        await conversationStore.loadConversations();
      } catch (e) {
        // ignore — empty conversation list is also valid
      }
      if (!conversationStore.currentConversation) {
        conversationStore.createNewConversation();
      }
    }
    await scrollToBottom();
  },
);

watch(
  () => currentMessages.value.length,
  () => {
    scrollToBottom();
  },
);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = messagesContainer.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

function renderMarkdown(text: string): string {
  if (!text) {
    return "";
  }
  try {
    return md.render(text);
  } catch (e) {
    return String(text);
  }
}

function formatTime(timestamp: number | string | undefined): string {
  if (!timestamp) {
    return "";
  }
  const ms =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function onComposerKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Enter") {
    return;
  }
  if (e.shiftKey) {
    return;
  }
  e.preventDefault();
  if (canSend.value) {
    onSend();
  }
}

async function onSend(): Promise<void> {
  if (!canSend.value) {
    return;
  }
  const text = inputText.value.trim();
  inputText.value = "";
  errorMessage.value = null;

  if (!conversationStore.currentConversation) {
    conversationStore.createNewConversation();
  }

  conversationStore.addMessage({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
  await scrollToBottom();

  isProcessing.value = true;
  try {
    const response = await llmStore.query(text);
    const aiContent =
      typeof response === "string"
        ? response
        : ((response as { content?: string })?.content ?? "");
    const aiTokens =
      response && typeof response === "object" && "tokens" in response
        ? (response as { tokens?: number }).tokens
        : undefined;
    const aiModel =
      response && typeof response === "object" && "model" in response
        ? (response as { model?: string }).model
        : undefined;

    conversationStore.addMessage({
      role: "assistant",
      content: aiContent,
      timestamp: Date.now(),
      tokens: aiTokens,
      model: aiModel,
    });

    if (llmStore.config?.autoSaveConversations) {
      try {
        await conversationStore.saveCurrentConversation();
      } catch {
        // best-effort save; not user-visible
      }
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    isProcessing.value = false;
    await scrollToBottom();
  }
}

function onNewConversation(): void {
  conversationStore.createNewConversation();
  inputText.value = "";
  errorMessage.value = null;
}

function onQuickPrompt(prompt: string): void {
  inputText.value = prompt;
}

function onGoSettings(): void {
  emit("update:open", false);
  router.push("/settings?tab=llm");
}

onMounted(() => {
  // Trigger initial conversation listing in the background; first open
  // also runs this via the watch.
  conversationStore.loadConversations().catch(() => {});
});
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin: 12px 12px 0 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--cc-shell-border, #eee);
  flex-shrink: 0;
}

.conv-title {
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  background: var(--cc-shell-sider-bg, #fafafa);
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 12px;
}

.quick-prompt-btn {
  font-size: 12px;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.message-row.user {
  flex-direction: row-reverse;
}

.message-bubble {
  flex: 1;
  min-width: 0;
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-row.user .message-bubble {
  align-items: flex-end;
}

.message-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--cc-shell-muted, #999);
}

.message-role {
  font-weight: 500;
  color: var(--cc-shell-text, #1f1f1f);
}

.message-tokens {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
}

.message-text {
  font-size: 13px;
  line-height: 1.6;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #e8e8e8);
  border-radius: 8px;
  padding: 8px 12px;
  word-break: break-word;
}

.message-row.user .user-text {
  background: var(--cc-primary, #1677ff);
  color: #fff;
  border-color: transparent;
}

.message-text :deep(p) {
  margin: 0 0 6px 0;
}

.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text :deep(pre),
.message-text :deep(code) {
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 4px;
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
}

.message-text :deep(pre) {
  padding: 8px 12px;
  overflow-x: auto;
  font-size: 12px;
}

.message-text :deep(code) {
  padding: 1px 6px;
  font-size: 12px;
}

.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--cc-shell-border, #eee);
  flex-shrink: 0;
}

.composer-actions {
  display: flex;
  justify-content: flex-end;
}

.chat-error {
  margin: 0 16px 12px 16px;
}
</style>
