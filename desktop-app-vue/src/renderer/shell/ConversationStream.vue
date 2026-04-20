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
            <span v-if="msg.did" class="did-chip" :title="msg.did">
              {{ shortDid(msg.did) }}
            </span>
          </div>
          <div class="message-content">
            {{ msg.content }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useArtifactStore } from "../stores/artifacts";

interface ShellMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  did?: string;
  timestamp: number;
}

const messages = ref<ShellMessage[]>([]);

const artifactStore = useArtifactStore();
const sampleArtifacts = computed(() => artifactStore.all);

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

function shortDid(did: string): string {
  if (!did) {
    return "";
  }
  const parts = did.split(":");
  const tail = parts[parts.length - 1] || did;
  return `${tail.slice(0, 6)}…${tail.slice(-4)}`;
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

.did-chip {
  background: #f0f5ff;
  color: #1677ff;
  padding: 1px 6px;
  border-radius: 10px;
  font-family: monospace;
  font-size: 11px;
  cursor: help;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.6;
}
</style>
