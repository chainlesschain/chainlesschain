<template>
  <div class="cwk-artifact">
    <div class="cwk-header">
      <h3 class="cwk-topic">
        {{ payload.topic }}
      </h3>
      <a-tag :color="statusColor">
        {{ statusLabel }}
      </a-tag>
    </div>

    <div class="agents">
      <span class="group-title">智能体</span>
      <a-tag v-for="a in payload.agents" :key="a.id" color="cyan">
        {{ a.role }}: {{ a.id }}
      </a-tag>
    </div>

    <div class="steps">
      <div class="group-title">计划步骤（{{ payload.steps.length }}）</div>
      <div
        v-for="s in payload.steps"
        :key="s.id"
        :class="['step-row', `step-${s.status}`]"
      >
        <span class="step-status">{{ stepIcon(s.status) }}</span>
        <span class="step-agent">{{ s.agent }}</span>
        <span class="step-desc">{{ s.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { CoworkSessionArtifact } from "@/types/artifact";

const props = defineProps<{ data: CoworkSessionArtifact }>();
const payload = computed(() => props.data.payload);

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    planning: "规划中",
    running: "运行中",
    paused: "已暂停",
    done: "已完成",
    aborted: "已中止",
  };
  return map[payload.value.status] || payload.value.status;
});

const statusColor = computed(() => {
  const map: Record<string, string> = {
    planning: "processing",
    running: "blue",
    paused: "warning",
    done: "success",
    aborted: "error",
  };
  return map[payload.value.status] || "default";
});

function stepIcon(status: string): string {
  const map: Record<string, string> = {
    pending: "○",
    running: "●",
    done: "✓",
    failed: "✗",
  };
  return map[status] || "·";
}
</script>

<style scoped>
.cwk-artifact {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cwk-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cwk-topic {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.agents {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.group-title {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 6px;
}
.steps {
  background: #fafafa;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eee;
}
.step-row {
  display: grid;
  grid-template-columns: 20px 80px 1fr;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
.step-status {
  text-align: center;
}
.step-agent {
  color: #666;
  font-family: monospace;
}
.step-desc {
  color: #333;
}
.step-done .step-status {
  color: #52c41a;
}
.step-running .step-status {
  color: #1677ff;
}
.step-failed .step-status {
  color: #f5222d;
}
</style>
