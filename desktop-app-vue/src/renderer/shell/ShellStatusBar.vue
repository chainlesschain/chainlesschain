<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item" :title="ukeyStatus.title">
        <span :class="['status-dot', ukeyStatus.dotClass]" />
        U-Key
      </span>
      <span class="status-item" title="当前 DID">
        DID
        <code class="status-code">{{ shortDid || "未绑定" }}</code>
      </span>
      <span class="status-item" title="已连接 P2P 对端数">
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
        <span class="status-value">{{ llmProvider || "未配置" }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { resolveWidgetComponent } from "./widget-registry";

interface UKeyApi {
  detect?: () => Promise<unknown>;
}
interface DidApi {
  getCurrentIdentity?: () => Promise<unknown>;
}
interface P2pApi {
  getPeers?: () => Promise<unknown>;
}
interface LlmApi {
  getConfig?: () => Promise<unknown>;
}

const registry = useExtensionRegistryStore();
const { statusBarWidgets } = storeToRefs(registry);

const ukeyConnected = ref<boolean | null>(null);
const currentDid = ref<string>("");
const p2pNodes = ref(0);
const llmProvider = ref<string>("");

const platformIsWindows = computed(() => {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
});

const ukeyStatus = computed(() => {
  if (ukeyConnected.value === true) {
    return {
      title: platformIsWindows.value
        ? "U-Key 硬件已连接"
        : "U-Key 模拟模式（macOS / Linux）",
      dotClass: "status-dot-green",
    };
  }
  if (ukeyConnected.value === false) {
    return {
      title: platformIsWindows.value
        ? "U-Key 硬件未检测"
        : "U-Key 检测失败（非 Windows 通常为模拟模式）",
      dotClass: "status-dot-gray",
    };
  }
  return {
    title: "U-Key 状态加载中",
    dotClass: "status-dot-gray",
  };
});

const shortDid = computed(() => {
  if (!currentDid.value) {
    return "";
  }
  return currentDid.value.length > 16
    ? `${currentDid.value.slice(0, 12)}…`
    : currentDid.value;
});

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

function pickDid(value: unknown): string {
  if (typeof value === "string" && value) {
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.did === "string" && obj.did) {
      return obj.did;
    }
    if (typeof obj.id === "string" && obj.id) {
      return obj.id;
    }
  }
  return "";
}

async function loadUKey(api: UKeyApi) {
  if (!api.detect) {
    return;
  }
  try {
    const result = (await api.detect()) as
      | { connected?: boolean; success?: boolean }
      | boolean
      | null
      | undefined;
    if (typeof result === "boolean") {
      ukeyConnected.value = result;
    } else if (result && typeof result === "object") {
      ukeyConnected.value = Boolean(result.connected ?? result.success);
    } else {
      ukeyConnected.value = false;
    }
  } catch {
    ukeyConnected.value = false;
  }
}

async function loadDid(api: DidApi) {
  if (!api.getCurrentIdentity) {
    return;
  }
  try {
    const identity = await api.getCurrentIdentity();
    currentDid.value = pickDid(identity);
  } catch {
    /* leave currentDid="" on lookup failure */
  }
}

async function loadPeers(api: P2pApi) {
  if (!api.getPeers) {
    return;
  }
  try {
    const result = (await api.getPeers()) as
      | unknown[]
      | { peers?: unknown[] }
      | null
      | undefined;
    if (Array.isArray(result)) {
      p2pNodes.value = result.length;
    } else if (Array.isArray((result as { peers?: unknown[] })?.peers)) {
      p2pNodes.value = (result as { peers: unknown[] }).peers.length;
    }
  } catch {
    /* leave p2pNodes=0 on failure */
  }
}

async function loadLlm(api: LlmApi) {
  if (!api.getConfig) {
    return;
  }
  try {
    const config = (await api.getConfig()) as
      | { provider?: unknown }
      | null
      | undefined;
    if (
      config &&
      typeof config === "object" &&
      typeof config.provider === "string"
    ) {
      llmProvider.value = config.provider;
    }
  } catch {
    /* leave llmProvider="" on failure */
  }
}

onMounted(() => {
  if (typeof window === "undefined") {
    return;
  }
  const electronAPI = (
    window as unknown as {
      electronAPI?: {
        ukey?: UKeyApi;
        did?: DidApi;
        p2p?: P2pApi;
        llm?: LlmApi;
      };
    }
  ).electronAPI;
  if (!electronAPI) {
    return;
  }
  if (electronAPI.ukey) {
    loadUKey(electronAPI.ukey);
  }
  if (electronAPI.did) {
    loadDid(electronAPI.did);
  }
  if (electronAPI.p2p) {
    loadPeers(electronAPI.p2p);
  }
  if (electronAPI.llm) {
    loadLlm(electronAPI.llm);
  }
});
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
