<template>
  <div class="cc-preview-shell" :data-active-theme="theme.active">
    <aside class="cc-preview-shell__sider">
      <header class="cc-preview-shell__brand">
        <span class="cc-preview-shell__logo">⛶</span>
        <span class="cc-preview-shell__name">ChainlessChain</span>
      </header>

      <ConversationList
        :conversations="conversations"
        :active-id="activeConversationId"
        @select="selectConversation"
        @new-conversation="newConversation"
      />

      <DecentralEntries @activate="onEntryActivate" />

      <footer class="cc-preview-shell__footer">
        <div class="cc-preview-shell__theme-switch">
          <button
            v-for="t in themeList"
            :key="t.key"
            type="button"
            class="cc-preview-shell__theme-btn"
            :class="{
              'cc-preview-shell__theme-btn--active': theme.active === t.key,
            }"
            :title="t.label"
            :aria-pressed="theme.active === t.key"
            @click="theme.apply(t.key)"
          >
            {{ t.icon }}
          </button>
        </div>
      </footer>
    </aside>

    <main class="cc-preview-shell__main">
      <header class="cc-preview-shell__topbar">
        <span class="cc-preview-shell__topbar-title">
          {{ activeConversation?.title || "新会话" }}
        </span>
        <div class="cc-preview-shell__topbar-actions">
          <a-button type="text" size="small" @click="toggleArtifact">
            {{ artifactOpen ? "隐藏 Artifact" : "查看 Artifact" }}
          </a-button>
        </div>
      </header>

      <section class="cc-preview-shell__stream">
        <div v-if="!activeConversation" class="cc-preview-shell__welcome">
          <h2>个人办公 · 去中心化 AI</h2>
          <p>隐私数据留在本机，P2P / 交易 / 社交 / U-Key 一键进入。</p>
        </div>
        <div v-else class="cc-preview-shell__bubbles">
          <div
            v-for="msg in activeConversation.messages"
            :key="msg.id"
            class="cc-preview-bubble"
            :class="`cc-preview-bubble--${msg.role}`"
          >
            <div class="cc-preview-bubble__body">
              {{ msg.content }}
            </div>
          </div>
          <div
            v-if="showTypingIndicator"
            class="cc-preview-bubble cc-preview-bubble--assistant"
            data-testid="cc-preview-typing"
          >
            <div
              class="cc-preview-bubble__body cc-preview-bubble__body--typing"
            >
              <span class="cc-preview-typing-dot" />
              <span class="cc-preview-typing-dot" />
              <span class="cc-preview-typing-dot" />
            </div>
          </div>
        </div>
      </section>

      <footer class="cc-preview-shell__composer">
        <textarea
          v-model="draft"
          class="cc-preview-shell__input"
          placeholder="询问或发起一个任务… (Ctrl/Cmd+Enter 发送)"
          rows="2"
          @keydown="onComposerKeydown"
        />
        <a-button
          type="primary"
          :loading="isGenerating"
          :disabled="!draft.trim() || isGenerating"
          @click="sendDraft"
        >
          发送
        </a-button>
      </footer>

      <ArtifactDrawer
        :open="artifactOpen"
        :title="drawerTitle"
        :content="activeEntryId ? undefined : activeArtifact?.content"
        @close="closeDrawer"
      >
        <component :is="activeWidget.component" v-if="activeWidget" />
      </ArtifactDrawer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useThemePreviewStore, PREVIEW_THEMES } from "../stores/theme-preview";
import { useConversationPreviewStore } from "../stores/conversation-preview";
import { registerSlashHandler } from "../shell/slash-dispatch";
import ConversationList from "./ConversationList.vue";
import DecentralEntries from "./DecentralEntries.vue";
import ArtifactDrawer from "./ArtifactDrawer.vue";
import { getPreviewWidget, type DecentralEntryId } from "./widgets";
import {
  isAvailable as isLlmAvailable,
  sendChat as sendLlmChat,
  sendChatStream as sendLlmChatStream,
  streamAvailable as isStreamAvailable,
  toBridgeMessages,
} from "./services/llm-preview-bridge";
import "./themes.css";

const theme = useThemePreviewStore();
const themeList = PREVIEW_THEMES;

const conversationStore = useConversationPreviewStore();
const conversations = computed(() => conversationStore.conversations);
const activeConversationId = computed(
  () => conversationStore.activeId ?? undefined,
);
const activeConversation = computed(() => conversationStore.active);
const activeArtifact = computed(() => activeConversation.value?.artifact);

const artifactOpen = ref(false);
const activeEntryId = ref<DecentralEntryId | null>(null);
const activeWidget = computed(() =>
  activeEntryId.value ? getPreviewWidget(activeEntryId.value) : undefined,
);
const drawerTitle = computed(() =>
  activeEntryId.value
    ? activeWidget.value?.title
    : activeArtifact.value?.title || "Artifact",
);
const draft = ref("");
const isGenerating = computed(() => conversationStore.isGenerating);
const showTypingIndicator = computed(() => {
  if (!isGenerating.value) {
    return false;
  }
  const last = activeConversation.value?.messages.at(-1);
  return !(last && last.role === "assistant" && last.content.length > 0);
});

function selectConversation(id: string) {
  conversationStore.select(id);
}

function newConversation() {
  conversationStore.createBlank();
  artifactOpen.value = false;
  activeEntryId.value = null;
}

async function sendDraft() {
  const text = draft.value.trim();
  if (!text) {
    return;
  }
  if (conversationStore.isGenerating) {
    return;
  }

  const history = conversationStore.active?.messages ?? [];
  const payload = toBridgeMessages(history, text);

  conversationStore.appendMessage("user", text);
  draft.value = "";

  conversationStore.setGenerating(true);
  try {
    const available = await isLlmAvailable();
    if (!available) {
      conversationStore.appendAssistantMessage(
        "LLM 服务不可用，请检查火山引擎/Ollama 配置。",
      );
      return;
    }

    if (isStreamAvailable()) {
      const streamId = conversationStore.beginStreamingAssistant();
      if (streamId) {
        const result = await sendLlmChatStream(text, (liveText) => {
          conversationStore.updateAssistantContent(streamId, liveText);
        });
        if (result.ok === true) {
          conversationStore.finalizeStreamingAssistant(streamId, result.reply);
          return;
        }
        conversationStore.removeMessage(streamId);
      }
    }

    const result = await sendLlmChat(payload);
    if (result.ok === true) {
      conversationStore.appendAssistantMessage(result.reply);
    } else {
      conversationStore.appendAssistantMessage(
        `LLM 调用失败：${result.reason}`,
      );
    }
  } finally {
    conversationStore.setGenerating(false);
  }
}

function onComposerKeydown(e: KeyboardEvent) {
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod && e.key === "Enter") {
    e.preventDefault();
    sendDraft();
  }
}

function toggleArtifact() {
  if (activeEntryId.value) {
    activeEntryId.value = null;
  }
  artifactOpen.value = !artifactOpen.value;
}

function closeDrawer() {
  artifactOpen.value = false;
  activeEntryId.value = null;
}

function openEntryWidget(id: DecentralEntryId) {
  activeEntryId.value = id;
  artifactOpen.value = true;
}

function onEntryActivate(id: string) {
  if (getPreviewWidget(id)) {
    openEntryWidget(id as DecentralEntryId);
  }
}

const unregisters: Array<() => void> = [];

onMounted(() => {
  theme.restore();
  conversationStore.restore();
  const handlers: Array<[string, DecentralEntryId]> = [
    ["builtin:openP2P", "p2p"],
    ["builtin:openTrade", "trade"],
    ["builtin:openSocial", "social"],
    ["builtin:openUKey", "ukey"],
  ];
  for (const [handlerId, entryId] of handlers) {
    unregisters.push(
      registerSlashHandler(handlerId, () => {
        openEntryWidget(entryId);
      }),
    );
  }
});

onBeforeUnmount(() => {
  for (const off of unregisters) {
    off();
  }
  unregisters.length = 0;
});
</script>

<style scoped>
.cc-preview-shell {
  display: flex;
  height: 100vh;
  background: var(--cc-preview-bg-base);
  color: var(--cc-preview-text-primary);
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  overflow: hidden;
}

.cc-preview-shell__sider {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--cc-preview-bg-sidebar);
  border-right: 1px solid var(--cc-preview-border-subtle);
}

.cc-preview-shell__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
}

.cc-preview-shell__logo {
  font-size: 18px;
  color: var(--cc-preview-accent);
}

.cc-preview-shell__name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-shell__footer {
  padding: 8px 10px;
  border-top: 1px solid var(--cc-preview-border-subtle);
}

.cc-preview-shell__theme-switch {
  display: flex;
  gap: 6px;
}

.cc-preview-shell__theme-btn {
  flex: 1;
  padding: 6px 0;
  border-radius: 6px;
  border: 1px solid var(--cc-preview-border-subtle);
  background: transparent;
  color: var(--cc-preview-text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition:
    background 0.12s,
    border-color 0.12s;
}

.cc-preview-shell__theme-btn:hover {
  background: var(--cc-preview-bg-hover);
}

.cc-preview-shell__theme-btn--active {
  border-color: var(--cc-preview-accent);
  color: var(--cc-preview-accent);
}

.cc-preview-shell__main {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cc-preview-shell__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
  background: var(--cc-preview-bg-base);
}

.cc-preview-shell__topbar-title {
  font-size: 13px;
  font-weight: 600;
}

.cc-preview-shell__stream {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20% 16px;
}

.cc-preview-shell__welcome {
  max-width: 520px;
  margin: 10vh auto 0;
  text-align: center;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-shell__welcome h2 {
  color: var(--cc-preview-text-primary);
  font-size: 20px;
  margin-bottom: 8px;
}

.cc-preview-shell__bubbles {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cc-preview-bubble {
  display: flex;
  max-width: 80%;
}

.cc-preview-bubble--user {
  align-self: flex-end;
  justify-content: flex-end;
}

.cc-preview-bubble--assistant {
  align-self: flex-start;
}

.cc-preview-bubble__body {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.cc-preview-bubble--user .cc-preview-bubble__body {
  background: var(--cc-preview-bubble-user-bg);
  color: var(--cc-preview-bubble-user-text);
}

.cc-preview-bubble--assistant .cc-preview-bubble__body {
  background: var(--cc-preview-bubble-assistant-bg);
  color: var(--cc-preview-bubble-assistant-text);
  border: 1px solid var(--cc-preview-border-subtle);
}

.cc-preview-bubble__body--typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 12px 14px;
}

.cc-preview-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cc-preview-text-secondary);
  opacity: 0.35;
  animation: cc-preview-typing 1.2s infinite ease-in-out;
}

.cc-preview-typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.cc-preview-typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes cc-preview-typing {
  0%,
  80%,
  100% {
    opacity: 0.2;
    transform: translateY(0);
  }
  40% {
    opacity: 0.9;
    transform: translateY(-2px);
  }
}

.cc-preview-shell__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--cc-preview-border-subtle);
  background: var(--cc-preview-bg-base);
}

.cc-preview-shell__input {
  flex: 1;
  resize: none;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--cc-preview-border-color);
  background: var(--cc-preview-bg-elevated);
  color: var(--cc-preview-text-primary);
  font: inherit;
}

.cc-preview-shell__input:focus {
  outline: none;
  border-color: var(--cc-preview-accent);
}
</style>
