<template>
  <div class="tx-artifact">
    <div class="tx-header">
      <a-tag :color="statusColor">
        {{ statusLabel }}
      </a-tag>
      <span class="chain-label">{{ payload.chain }}</span>
    </div>

    <a-descriptions :column="1" size="small" bordered>
      <a-descriptions-item label="From">
        <code>{{ payload.from }}</code>
      </a-descriptions-item>
      <a-descriptions-item label="To">
        <code>{{ payload.to }}</code>
      </a-descriptions-item>
      <a-descriptions-item label="金额">
        <strong>{{ payload.amount }} {{ payload.token }}</strong>
      </a-descriptions-item>
      <a-descriptions-item v-if="payload.memo" label="备注">
        {{ payload.memo }}
      </a-descriptions-item>
      <a-descriptions-item v-if="payload.txHash" label="Tx Hash">
        <code class="mono-break">{{ payload.txHash }}</code>
      </a-descriptions-item>
    </a-descriptions>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { TxArtifact } from "@/types/artifact";

const props = defineProps<{ data: TxArtifact }>();
const payload = computed(() => props.data.payload);

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    draft: "草稿",
    signed: "已签名",
    broadcast: "已广播",
    confirmed: "已确认",
    failed: "失败",
  };
  return map[payload.value.status] || payload.value.status;
});

const statusColor = computed(() => {
  const map: Record<string, string> = {
    draft: "default",
    signed: "processing",
    broadcast: "warning",
    confirmed: "success",
    failed: "error",
  };
  return map[payload.value.status] || "default";
});
</script>

<style scoped>
.tx-artifact {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tx-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chain-label {
  color: #555;
  font-size: 12px;
  font-family: monospace;
}
.mono-break {
  font-family: monospace;
  word-break: break-all;
  font-size: 11px;
}
</style>
