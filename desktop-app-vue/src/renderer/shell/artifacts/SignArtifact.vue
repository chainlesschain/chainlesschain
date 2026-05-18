<template>
  <div class="sign-artifact">
    <a-descriptions :column="1" size="small" bordered>
      <a-descriptions-item label="签名目的">
        {{ payload.purpose }}
      </a-descriptions-item>
      <a-descriptions-item label="目标 Artifact">
        <code>{{ payload.targetArtifactId }}</code>
      </a-descriptions-item>
      <a-descriptions-item label="目标哈希">
        <code class="mono-break">{{ payload.targetHash }}</code>
      </a-descriptions-item>
      <a-descriptions-item v-if="payload.statement" label="声明">
        {{ payload.statement }}
      </a-descriptions-item>
    </a-descriptions>

    <div v-if="data.signatures.length" class="sign-list">
      <div class="list-title">签名记录（{{ data.signatures.length }}）</div>
      <div v-for="(sig, i) in data.signatures" :key="i" class="sig-row">
        <span class="alg-chip">{{ sig.alg }}</span>
        <code class="signer">{{ shortDid(sig.signer) }}</code>
        <span class="sig-time">{{ fmtTime(sig.signedAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SignArtifact } from "@/types/artifact";

const props = defineProps<{ data: SignArtifact }>();
const payload = computed(() => props.data.payload);

function shortDid(did: string): string {
  if (!did) {
    return "";
  }
  const parts = did.split(":");
  const tail = parts[parts.length - 1] || did;
  return `${tail.slice(0, 8)}…${tail.slice(-6)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<style scoped>
.sign-artifact {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mono-break {
  font-family: monospace;
  word-break: break-all;
  font-size: 11px;
}
.sign-list {
  background: #fafafa;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eee;
}
.list-title {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sig-row {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 4px 0;
}
.alg-chip {
  background: #e6f4ff;
  color: #1677ff;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
}
.signer {
  font-family: monospace;
  color: #333;
}
.sig-time {
  color: #999;
  font-size: 11px;
  margin-left: auto;
}
</style>
