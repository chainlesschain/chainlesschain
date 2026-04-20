<template>
  <div class="msg-artifact">
    <div class="msg-meta">
      <a-tag :color="roleColor">
        {{ roleLabel }}
      </a-tag>
      <span v-if="payload.model" class="model-label">
        {{ payload.model }}
      </span>
      <span v-if="payload.tokensIn || payload.tokensOut" class="token-label">
        {{ payload.tokensIn ?? 0 }} in / {{ payload.tokensOut ?? 0 }} out
      </span>
    </div>
    <div class="msg-body">
      {{ payload.content }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MessageArtifact } from "@/types/artifact";

const props = defineProps<{ data: MessageArtifact }>();
const payload = computed(() => props.data.payload);

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    user: "用户",
    assistant: "助手",
    system: "系统",
  };
  return map[payload.value.role] || payload.value.role;
});

const roleColor = computed(() => {
  const map: Record<string, string> = {
    user: "blue",
    assistant: "green",
    system: "default",
  };
  return map[payload.value.role] || "default";
});
</script>

<style scoped>
.msg-artifact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: #888;
}
.model-label {
  font-family: monospace;
}
.token-label {
  margin-left: auto;
}
.msg-body {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 13px;
  background: #fafafa;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eee;
}
</style>
