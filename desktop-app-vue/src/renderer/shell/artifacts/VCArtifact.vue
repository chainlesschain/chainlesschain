<template>
  <div class="vc-artifact">
    <div class="vc-header">
      <SafetyCertificateOutlined class="vc-icon" />
      <div class="vc-types">
        <a-tag v-for="t in payload.vcType" :key="t" color="geekblue">
          {{ t }}
        </a-tag>
      </div>
      <a-tag :color="statusColor">
        {{ statusLabel }}
      </a-tag>
    </div>

    <a-descriptions :column="1" size="small" bordered>
      <a-descriptions-item label="签发方">
        <code>{{ payload.issuer }}</code>
      </a-descriptions-item>
      <a-descriptions-item label="持有者">
        <code>{{ payload.subject }}</code>
      </a-descriptions-item>
      <a-descriptions-item label="签发时间">
        {{ payload.issuanceDate }}
      </a-descriptions-item>
      <a-descriptions-item v-if="payload.expirationDate" label="到期时间">
        {{ payload.expirationDate }}
      </a-descriptions-item>
    </a-descriptions>

    <div class="claims">
      <div class="claims-title">声明（Claims）</div>
      <pre class="claims-body">{{
        JSON.stringify(payload.claims, null, 2)
      }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SafetyCertificateOutlined } from "@ant-design/icons-vue";
import type { VCArtifact } from "@/types/artifact";

const props = defineProps<{ data: VCArtifact }>();
const payload = computed(() => props.data.payload);

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    active: "有效",
    revoked: "已吊销",
    expired: "已过期",
  };
  return map[payload.value.status] || payload.value.status;
});

const statusColor = computed(() => {
  const map: Record<string, string> = {
    active: "success",
    revoked: "error",
    expired: "default",
  };
  return map[payload.value.status] || "default";
});
</script>

<style scoped>
.vc-artifact {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vc-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vc-icon {
  color: #722ed1;
  font-size: 18px;
}
.vc-types {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.claims {
  background: #fafafa;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eee;
}
.claims-title {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.claims-body {
  margin: 0;
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
}
</style>
