<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item" :title="ukeyStatus.title">
        <span :class="['status-dot', ukeyStatus.dotClass]" />
        U-Key
      </span>
      <span class="status-item" title="当前 DID">
        DID
        <code class="status-code">{{ shortDid || "—" }}</code>
      </span>
      <span class="status-item" title="P2P 节点数">
        P2P
        <span class="status-value">{{ p2pNodes }}</span>
      </span>

      <component :is="resolveWidget(w)" v-for="w in leftWidgets" :key="w.id" />
    </div>

    <div class="status-center">
      <component
        :is="resolveWidget(w)"
        v-for="w in centerWidgets"
        :key="w.id"
      />
    </div>

    <div class="status-right">
      <component :is="resolveWidget(w)" v-for="w in rightWidgets" :key="w.id" />
      <span class="status-item" title="LLM Provider">
        LLM
        <span class="status-value">{{ llmProvider }}</span>
      </span>
      <span class="status-item" title="累计成本"> ${{ cost.toFixed(2) }} </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { resolveWidgetComponent } from "./widget-registry";

const registry = useExtensionRegistryStore();
const { statusBarWidgets } = storeToRefs(registry);

// P0 占位：后续对接 app.ts / did / p2p / llm / cost 各 store
const ukeyStatus = computed(() => ({
  title: "U-Key 硬件离线（P0 占位）",
  dotClass: "status-dot-gray",
}));

const shortDid = computed(() => "");
const p2pNodes = computed(() => 0);
const llmProvider = computed(() => "ollama");
const cost = computed(() => 0);

const leftWidgets = computed(() =>
  statusBarWidgets.value.filter((w) => w.position === "left"),
);
const centerWidgets = computed(() =>
  statusBarWidgets.value.filter((w) => w.position === "center"),
);
const rightWidgets = computed(() =>
  statusBarWidgets.value.filter((w) => w.position === "right"),
);

function resolveWidget(w: { component: string | null; tooltip: string }) {
  const resolved = resolveWidgetComponent(w.component);
  if (resolved) {
    return resolved;
  }
  return {
    template: `<span class="status-item" title="${w.tooltip || ""}">${w.component || "◌"}</span>`,
  };
}
</script>

<style scoped>
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
  font-size: 12px;
  color: #666;
}

.status-left,
.status-center,
.status-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot-green {
  background: #52c41a;
}
.status-dot-gray {
  background: #bbb;
}
.status-dot-red {
  background: #f5222d;
}

.status-code {
  font-family: monospace;
  color: #1677ff;
  font-size: 11px;
}

.status-value {
  color: #333;
}
</style>
