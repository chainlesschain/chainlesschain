<template>
  <div class="conversation-stream">
    <div v-if="messages.length === 0" class="empty-state">
      <div class="empty-inner">
        <h2>ChainlessChain 桌面版</h2>
        <p class="subtitle">对话优先 · 硬件级安全 · 去中心化</p>
        <p class="hint">
          输入 <kbd>/</kbd> 查看可用命令，<kbd>@</kbd>
          引用对象，<kbd>Ctrl</kbd>+<kbd>K</kbd> 打开命令面板。
        </p>

        <div v-if="sampleArtifacts.length" class="sample-artifacts">
          <div class="sample-title">样例 Artifact</div>
          <div class="sample-chips">
            <a-button
              v-for="a in sampleArtifacts"
              :key="a.id"
              size="small"
              @click="openArtifact(a.id)"
            >
              {{ typeLabel(a.type) }}
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="messages">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['message', `message-${msg.role}`]"
      >
        <div class="message-avatar">
          <a-avatar>{{ msg.role === "user" ? "U" : "AI" }}</a-avatar>
        </div>
        <div class="message-body">
          <div class="message-meta">
            <span class="role-label">{{
              msg.role === "user" ? "你" : "助手"
            }}</span>
          </div>
          <div class="message-content">
            {{ msg.content }}
          </div>
        </div>
      </div>
      <div
        v-if="showTypingIndicator"
        class="message message-assistant"
        data-testid="cc-shell-typing"
      >
        <div class="message-avatar">
          <a-avatar>AI</a-avatar>
        </div>
        <div class="message-body">
          <div class="message-meta">
            <span class="role-label">助手</span>
          </div>
          <div class="message-content message-content--typing">
            <span class="typing-dot" />
            <span class="typing-dot" />
            <span class="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useArtifactStore } from "../stores/artifacts";
import { useConversationPreviewStore } from "../stores/conversation-preview";

const artifactStore = useArtifactStore();
const sampleArtifacts = computed(() => artifactStore.all);

const conversationStore = useConversationPreviewStore();
const messages = computed(() => conversationStore.active?.messages ?? []);
const showTypingIndicator = computed(() => {
  if (!conversationStore.isGenerating) {
    return false;
  }
  const last = messages.value.at(-1);
  return !(last && last.role === "assistant" && last.content.length > 0);
});

onMounted(() => {
  if (!conversationStore.restored) {
    conversationStore.restore();
  }
});

const emit = defineEmits<{ (e: "openArtifact"): void }>();

function openArtifact(id: string) {
  artifactStore.open(id);
  emit("openArtifact");
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    note: "笔记",
    sign: "签名",
    tx: "交易",
    p2p: "P2P 消息",
    vc: "可验证凭证",
    message: "消息",
    "cowork-session": "协作会话",
  };
  return map[type] || type;
}
</script>

<style scoped>
.conversation-stream {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  min-height: 0;
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-inner {
  text-align: center;
  max-width: 480px;
}

.empty-inner h2 {
  margin: 0 0 8px;
  font-weight: 500;
}

.subtitle {
  color: var(--shell-muted, #888);
  margin-bottom: 24px;
}

.hint {
  color: var(--shell-muted, #888);
  font-size: 13px;
  line-height: 1.7;
}

.hint kbd {
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  padding: 1px 6px;
  font-family: monospace;
  font-size: 12px;
}

.sample-artifacts {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px dashed #eee;
}

.sample-title {
  font-size: 11px;
  color: #aaa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.sample-chips {
  display: flex;
  gap: 6px;
  justify-content: center;
  flex-wrap: wrap;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  display: flex;
  gap: 12px;
}

.message-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--shell-muted, #888);
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.6;
}

.message-content--typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--shell-muted, #888);
  opacity: 0.35;
  animation: shell-typing 1.2s infinite ease-in-out;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes shell-typing {
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
</style>
