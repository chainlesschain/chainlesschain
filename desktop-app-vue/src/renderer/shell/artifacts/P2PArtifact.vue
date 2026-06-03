<template>
  <div class="p2p-artifact">
    <div class="p2p-header">
      <span class="channel-label"># {{ payload.channel }}</span>
      <code class="peer-did">{{ shortDid(payload.peerDid) }}</code>
    </div>

    <div class="msg-list">
      <div
        v-for="(m, idx) in payload.messages"
        :key="idx"
        :class="['msg-row', isMe(m.from) ? 'from-me' : 'from-peer']"
      >
        <div class="msg-bubble">
          <div class="msg-meta">
            <code>{{ shortDid(m.from) }}</code>
            <span v-if="m.encrypted" class="enc-chip" title="端到端加密"
              >E2EE</span
            >
            <span class="msg-time">{{ fmtTime(m.at) }}</span>
          </div>
          <div class="msg-body">
            {{ m.content }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { P2PArtifact } from "@/types/artifact";

const props = defineProps<{ data: P2PArtifact }>();
const payload = computed(() => props.data.payload);

function shortDid(did: string): string {
  if (!did) {
    return "";
  }
  const parts = did.split(":");
  const tail = parts[parts.length - 1] || did;
  return `${tail.slice(0, 6)}…${tail.slice(-4)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
function isMe(did: string): boolean {
  return did === props.data.createdBy;
}
</script>

<style scoped>
.p2p-artifact {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.p2p-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #fafafa;
  border-radius: 4px;
  border: 1px solid #eee;
}
.channel-label {
  font-weight: 500;
  color: #1677ff;
}
.peer-did {
  font-family: monospace;
  font-size: 11px;
  color: #666;
}
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg-row {
  display: flex;
}
.msg-row.from-me {
  justify-content: flex-end;
}
.msg-bubble {
  max-width: 70%;
  padding: 6px 10px;
  border-radius: 8px;
  background: #f0f5ff;
}
.from-peer .msg-bubble {
  background: #f5f5f5;
}
.msg-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: #888;
  margin-bottom: 2px;
}
.enc-chip {
  background: #d9f7be;
  color: #389e0d;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
}
.msg-time {
  margin-left: auto;
}
.msg-body {
  font-size: 13px;
  white-space: pre-wrap;
}
</style>
