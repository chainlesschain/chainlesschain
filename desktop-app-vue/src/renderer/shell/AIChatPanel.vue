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
        <a-radio-group
          :value="contextMode"
          size="small"
          button-style="solid"
          @update:value="setContextMode"
        >
          <a-radio-button value="project">
            <FolderOutlined />
            项目
          </a-radio-button>
          <a-radio-button value="file" disabled>
            <FileTextOutlined />
            文件
          </a-radio-button>
          <a-radio-button value="global">
            <GlobalOutlined />
            全局
          </a-radio-button>
        </a-radio-group>
        <a-tooltip title="新对话">
          <a-button type="text" size="small" @click="onNewConversation">
            <PlusOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="对话历史">
          <a-button type="text" size="small" @click="showHistory = true">
            <HistoryOutlined />
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
        <VirtualMessageList
          ref="virtualListRef"
          :messages="currentMessages"
          :estimate-size="120"
          class="messages-virtual"
        >
          <template #default="{ message }">
            <!-- v-for-with-singleton trick: rebinds `message` (typed unknown
                 by VirtualMessageList's untyped slot) to `msg` (typed
                 ConversationMessage via asMsg) without introducing a
                 sub-component. -->
            <template v-for="msg in [asMsg(message)]" :key="msg.id">
              <div class="message-row" :class="msg.role">
                <a-avatar
                  :size="32"
                  :style="{
                    backgroundColor:
                      msg.role === 'user' ? '#1890ff' : '#52c41a',
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
                  <div
                    v-if="
                      Array.isArray(msg.references) && msg.references.length > 0
                    "
                    class="message-references"
                  >
                    <span class="references-label">📚 参考:</span>
                    <a-tag
                      v-for="r in msg.references"
                      :key="r.id"
                      color="blue"
                      size="small"
                    >
                      {{ r.title ?? r.id }}
                      <span
                        v-if="typeof r.score === 'number'"
                        class="reference-score"
                      >
                        · {{ Math.round(r.score * 100) }}%
                      </span>
                    </a-tag>
                  </div>
                </div>
              </div>
            </template>
          </template>
        </VirtualMessageList>

        <!-- Intent confirmation card (V5 parity) -->
        <IntentConfirmationMessage
          v-if="pendingIntentCard"
          :message="pendingIntentCard"
          @confirm="handleIntentConfirm"
          @correct="handleIntentCorrect"
        />

        <!-- Streaming bubble -->
        <div v-if="isStreaming" class="message-row assistant streaming">
          <a-avatar :size="32" :style="{ backgroundColor: '#52c41a' }">
            <template #icon>
              <RobotOutlined />
            </template>
          </a-avatar>
          <div class="message-bubble">
            <div class="message-meta-row">
              <span class="message-role">AI</span>
              <span class="message-time">正在输入…</span>
            </div>
            <!-- eslint-disable vue/no-v-html -- sanitized: MarkdownIt(html:false) -->
            <div
              class="message-text"
              v-html="
                renderMarkdown(streamingText) +
                '<span class=\'typing-cursor\'>▊</span>'
              "
            />
            <!-- eslint-enable vue/no-v-html -->
          </div>
        </div>

        <!-- Thinking indicator (non-streaming path) -->
        <div v-if="isProcessing && !isStreaming" class="message-row assistant">
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
        <a-dropdown :trigger="['click']">
          <a-button :disabled="isProcessing">
            <MoreOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="(e) => onMoreMenuClick(String(e.key))">
              <a-menu-item key="clear">
                <DeleteOutlined /> 清除上下文
              </a-menu-item>
              <a-menu-item key="export" :disabled="!canExport">
                <ExportOutlined /> 导出对话
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <a-button v-if="isStreaming" danger @click="onStop">
          <StopOutlined /> 停止
        </a-button>
        <a-button
          type="primary"
          :loading="isProcessing && !isStreaming"
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

  <!-- History drawer -->
  <a-drawer
    v-model:open="showHistory"
    title="对话历史"
    placement="left"
    :width="320"
  >
    <ConversationHistory @select="onSelectConversation" />
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Empty, message as antMessage } from "ant-design-vue";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FileTextOutlined,
  FolderOutlined,
  GlobalOutlined,
  HistoryOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  UserOutlined,
} from "@ant-design/icons-vue";
import MarkdownIt from "markdown-it";
import { useLLMStore } from "../stores/llm";
import { useConversationStore } from "../stores/conversation";
import { useProjectStore } from "../stores/project";
import type { ConversationMessage } from "../stores/conversation";
import ConversationHistory from "../components/ConversationHistory.vue";
import VirtualMessageList from "../components/projects/VirtualMessageList.vue";
import IntentConfirmationMessage from "../components/messages/IntentConfirmationMessage.vue";
import {
  MessageType,
  createIntentConfirmationMessage,
} from "../utils/messageTypes";
import {
  buildActiveFileContext,
  buildExportMarkdown,
  chatErrorMessage,
  extractRagContext,
  formatChatTime,
} from "./helpers/chatPanelHelpers";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
  /** When true and prefillText is set, dispatch on first open. */
  autoSend?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const router = useRouter();
const llmStore = useLLMStore();
const conversationStore = useConversationStore();
const projectStore = useProjectStore();

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
const isStreaming = ref(false);
const streamingText = ref("");
const showHistory = ref(false);
const errorMessage = ref<string | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);
const virtualListRef = ref<{
  scrollToBottom?: () => void;
  scrollToMessage?: (id: string) => void;
} | null>(null);

// ── Phase E.B: context mode (project / file / global) ───────────────────
type ContextMode = "project" | "file" | "global";
const VALID_CONTEXT_MODES: ContextMode[] = ["project", "file", "global"];
const CONTEXT_MODE_KEY = "cc.desktop.aichat.contextMode";

function readPersistedContextMode(): ContextMode | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(CONTEXT_MODE_KEY);
    return VALID_CONTEXT_MODES.includes(raw as ContextMode)
      ? (raw as ContextMode)
      : null;
  } catch {
    return null;
  }
}

const contextMode = ref<ContextMode>(readPersistedContextMode() ?? "project");
function setContextMode(mode: ContextMode): void {
  if (!VALID_CONTEXT_MODES.includes(mode)) {
    return;
  }
  contextMode.value = mode;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CONTEXT_MODE_KEY, mode);
    }
  } catch {
    // localStorage unavailable — degrade silently
  }
}

// ── Phase E.C: intent confirmation card (transient, not in conversation) ─
// Held outside conversationStore so the card never gets persisted to the
// database — it's a UX-only confirmation step before the actual user
// message hits the LLM.
const pendingIntentCard = ref<ReturnType<
  typeof createIntentConfirmationMessage
> | null>(null);

// ── Phase E.D: autoSend tracking ──────────────────────────────────────
const consumedAutoSendTokens = new Set<string>();

const currentMessages = computed(() => conversationStore.currentMessages);

/**
 * VirtualMessageList is JS — its slot exposes `message: unknown`. Pin the
 * type back to ConversationMessage at the slot consumer so the template
 * can `.role` / `.content` / `.references` without TS noise. Doesn't
 * change runtime behaviour.
 */
function asMsg(value: unknown): ConversationMessage {
  return value as ConversationMessage;
}

const canSend = computed(
  () => !!inputText.value.trim() && llmStore.isAvailable && !isProcessing.value,
);

const canExport = computed(
  () =>
    !!conversationStore.currentConversation && currentMessages.value.length > 0,
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
      } catch (_e) {
        // ignore — empty conversation list is also valid
      }
      if (!conversationStore.currentConversation) {
        conversationStore.createNewConversation();
      }
    }
    await scrollToBottom();
    await maybeAutoSend();
  },
);

watch(
  () => currentMessages.value.length,
  () => {
    scrollToBottom();
  },
);

// React to prefillText/autoSend prop changes mid-session — same behaviour
// as the initial-open path.
watch(
  () => [props.prefillText, props.autoSend],
  () => {
    if (props.open) {
      maybeAutoSend();
    }
  },
);

/**
 * Phase E.D — autoSendMessage protocol. When the panel opens with
 * prefillText + autoSend=true, dispatch the prefill via the same intent
 * pipeline the manual composer uses (so a deep-link still benefits from
 * intent recognition + context mode). Tokens dedupe identical pushes so
 * a re-render or a watch firing twice can't double-send.
 */
async function maybeAutoSend(): Promise<void> {
  const prefill = (props.prefillText || "").trim();
  if (!prefill) {
    return;
  }
  const token = `${prefill}::${props.autoSend === true ? "1" : "0"}::${contextMode.value}`;
  if (consumedAutoSendTokens.has(token)) {
    return;
  }
  consumedAutoSendTokens.add(token);
  if (props.autoSend !== true) {
    // autoSend off → just prefill the composer.
    inputText.value = prefill;
    return;
  }
  if (!canSend.value) {
    // LLM unavailable — fall back to prefill so user can click 发送 manually.
    inputText.value = prefill;
    return;
  }
  await submitUserInput(prefill);
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  // Prefer the VirtualMessageList exposed scroll handle when present, fall
  // back to the raw container element (covers the empty-state path).
  if (virtualListRef.value?.scrollToBottom) {
    virtualListRef.value.scrollToBottom();
    return;
  }
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
  } catch (_e) {
    return String(text);
  }
}

// formatTime delegates to chatPanelHelpers (unit-tested)
const formatTime = formatChatTime;

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

/**
 * Phase E.C — submit a user input. In project/file mode, run the V5
 * project:understandIntent IPC first to surface a confirmation card; in
 * global mode (or when LLM doesn't yield useful understanding), fall
 * through to the LLM dispatch directly.
 */
async function submitUserInput(text: string): Promise<void> {
  if (!text.trim() || !canSend.value) {
    return;
  }
  errorMessage.value = null;
  if (contextMode.value === "global") {
    await dispatchToLLM(text);
    return;
  }

  // Try intent understanding via the V5 desktop IPC. If anything goes wrong
  // (LLM misconfigured / parser failure / IPC missing), degrade silently
  // to direct send so the user is never stuck.
  const understanding = await tryUnderstandIntent(text);
  const hasUseful =
    !!understanding &&
    ((understanding.correctedInput && understanding.correctedInput !== text) ||
      (Array.isArray(understanding.keyPoints) &&
        understanding.keyPoints.length > 0));
  if (!hasUseful) {
    await dispatchToLLM(text);
    return;
  }

  pendingIntentCard.value = createIntentConfirmationMessage(text, {
    correctedInput: understanding!.correctedInput,
    intent: understanding!.intent,
    keyPoints: understanding!.keyPoints,
  });
  await scrollToBottom();
}

/**
 * Wrap `electronAPI.project.understandIntent` so the call site stays clean.
 * Returns null when LLM is unavailable or anything throws.
 */
async function tryUnderstandIntent(text: string): Promise<{
  correctedInput: string;
  intent: string;
  keyPoints: string[];
} | null> {
  const api = (
    window as unknown as {
      electronAPI?: {
        project?: {
          understandIntent?: (data: {
            userInput: string;
            projectId?: string | null;
            contextMode?: string;
          }) => Promise<{
            success?: boolean;
            correctedInput?: string;
            intent?: string;
            keyPoints?: string[];
          }>;
        };
      };
    }
  ).electronAPI?.project?.understandIntent;
  if (typeof api !== "function") {
    return null;
  }
  try {
    const resp = await api({
      userInput: text,
      projectId: null,
      contextMode: contextMode.value,
    });
    if (!resp?.success) {
      return null;
    }
    return {
      correctedInput: resp.correctedInput || text,
      intent: resp.intent || "",
      keyPoints: Array.isArray(resp.keyPoints) ? resp.keyPoints : [],
    };
  } catch {
    return null;
  }
}

function handleIntentConfirm(payload: { messageId: string }): void {
  const card = pendingIntentCard.value;
  if (!card || card.id !== payload.messageId) {
    return;
  }
  if (card.metadata) {
    card.metadata.status = "confirmed";
  }
  const original = card.metadata?.originalInput || "";
  pendingIntentCard.value = null;
  if (original.trim()) {
    dispatchToLLM(original);
  }
}

function handleIntentCorrect(payload: {
  messageId: string;
  correction: string;
}): void {
  const card = pendingIntentCard.value;
  if (!card || card.id !== payload.messageId) {
    return;
  }
  if (card.metadata) {
    card.metadata.status = "corrected";
    card.metadata.correction = payload.correction;
  }
  pendingIntentCard.value = null;
  const text = (payload.correction || "").trim();
  if (text) {
    dispatchToLLM(text);
  }
}

async function onSend(): Promise<void> {
  if (!canSend.value) {
    return;
  }
  const text = inputText.value.trim();
  inputText.value = "";
  await submitUserInput(text);
}

/**
 * Original LLM dispatch path (was the body of onSend before Phase E added
 * the intent gate). Pushes the user message into conversationStore, runs
 * RAG enhancement, streams or falls back to non-streaming, persists the
 * assistant reply.
 */
async function dispatchToLLM(text: string): Promise<void> {
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
  const streamEnabled = llmStore.config?.streamEnabled !== false;

  // Optional RAG enhancement — failure is silent (caller used original prompt)
  let prompt = text;
  let retrievedDocs: Array<{ id: string; title?: string; score?: number }> = [];
  try {
    const ragApi = (
      window as unknown as {
        electronAPI?: {
          rag?: { enhanceQuery?: (q: string) => Promise<unknown> };
        };
      }
    ).electronAPI?.rag?.enhanceQuery;
    if (typeof ragApi === "function") {
      const ragResult = (await ragApi(text)) as Parameters<
        typeof extractRagContext
      >[0];
      const enhanced = extractRagContext(ragResult, text);
      prompt = enhanced.prompt;
      retrievedDocs = enhanced.retrievedDocs;
    }
  } catch {
    // RAG failure does not break the send path
  }

  // Active-file context (Claude-Code-style "the agent sees what you're looking
  // at"): when the user picks "file" context mode and a project file is open,
  // inline its content into the LLM prompt only — ephemeral, the stored user
  // message stays the original text. Surfaced as a reference so the inclusion
  // is visible. No-op when no file is open; never breaks the send path.
  if (contextMode.value === "file") {
    try {
      const file = projectStore.currentFile;
      const block = file ? buildActiveFileContext(file) : null;
      if (block && file) {
        prompt = `${block}\n\n${prompt}`;
        retrievedDocs = [
          {
            id: file.file_path || file.file_name || "active-file",
            title: `📄 ${file.file_name || file.file_path || "current file"}`,
          },
          ...retrievedDocs,
        ];
      }
    } catch {
      // active-file context is best-effort
    }
  }

  try {
    if (streamEnabled) {
      isStreaming.value = true;
      streamingText.value = "";
      await llmStore.queryStream(prompt, (data: { fullText?: string }) => {
        streamingText.value = data?.fullText ?? "";
        scrollToBottom();
      });
      conversationStore.addMessage({
        role: "assistant",
        content: streamingText.value,
        timestamp: Date.now(),
        model: llmStore.currentModel,
        references: retrievedDocs.length ? retrievedDocs : undefined,
      });
      isStreaming.value = false;
      streamingText.value = "";
    } else {
      const response = await llmStore.query(prompt);
      const aiContent =
        typeof response === "string"
          ? response
          : ((response as { text?: string; content?: string })?.text ??
            (response as { text?: string; content?: string })?.content ??
            "");
      const aiTokens = (response as { tokens?: number })?.tokens;
      const aiModel =
        (response as { model?: string })?.model ?? llmStore.currentModel;
      conversationStore.addMessage({
        role: "assistant",
        content: aiContent,
        timestamp: Date.now(),
        tokens: aiTokens,
        model: aiModel,
        references: retrievedDocs.length ? retrievedDocs : undefined,
      });
    }

    if (llmStore.config?.autoSaveConversations) {
      try {
        await conversationStore.saveCurrentConversation();
      } catch {
        // best-effort save; not user-visible
      }
    }
  } catch (e) {
    errorMessage.value = chatErrorMessage(e);
    isStreaming.value = false;
    streamingText.value = "";
  } finally {
    isProcessing.value = false;
    await scrollToBottom();
  }
}

async function onStop(): Promise<void> {
  try {
    await llmStore.cancelStream("用户手动停止");
  } catch {
    // ignore — backend may have already finished
  }
  // Persist any partial output as an incomplete assistant message so
  // the user can still see what arrived before they hit stop.
  if (streamingText.value && streamingText.value.trim()) {
    conversationStore.addMessage({
      role: "assistant",
      content: `${streamingText.value}\n\n[已停止生成]`,
      timestamp: Date.now(),
      model: llmStore.currentModel,
      incomplete: true,
    });
  }
  isStreaming.value = false;
  streamingText.value = "";
  isProcessing.value = false;
}

function onSelectConversation(
  conversation: { id: string } | null | undefined,
): void {
  if (!conversation?.id) {
    return;
  }
  conversationStore.loadConversation(conversation.id);
  pendingIntentCard.value = null;
  showHistory.value = false;
}

function onMoreMenuClick(key: string): void {
  if (key === "clear") {
    onClearContext();
  } else if (key === "export") {
    onExport();
  }
}

async function onClearContext(): Promise<void> {
  try {
    const clearFn = (
      llmStore as unknown as { clearContext?: () => Promise<unknown> }
    ).clearContext;
    if (typeof clearFn === "function") {
      await clearFn.call(llmStore);
    }
    conversationStore.createNewConversation();
    inputText.value = "";
    errorMessage.value = null;
    pendingIntentCard.value = null;
    antMessage.success("已清除上下文");
  } catch (e) {
    errorMessage.value = chatErrorMessage(e);
  }
}

function onExport(): void {
  const conv = conversationStore.currentConversation;
  if (!conv || !canExport.value) {
    antMessage.warning("没有可导出的对话");
    return;
  }
  const md = buildExportMarkdown(currentMessages.value, {
    title: conv.title,
    model: conv.metadata?.model,
    provider: conv.metadata?.provider,
    totalTokens: conv.metadata?.totalTokens,
    exportedAt: new Date().toISOString(),
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeTitle = (conv.title ?? "对话").replace(/[\\/:*?"<>|]/g, "_");
  a.download = `对话_${safeTitle}_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  antMessage.success("对话已导出");
}

function onNewConversation(): void {
  conversationStore.createNewConversation();
  inputText.value = "";
  errorMessage.value = null;
  pendingIntentCard.value = null;
  antMessage.success("已创建新对话");
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

.message-references {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
}

.references-label {
  color: var(--cc-shell-muted, #999);
  margin-right: 4px;
}

.reference-score {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: 10px;
}

.message-text :deep(.typing-cursor) {
  display: inline-block;
  margin-left: 2px;
  color: var(--cc-primary, #1677ff);
  animation: typing-blink 1s infinite;
  font-weight: 600;
}

@keyframes typing-blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}
</style>
