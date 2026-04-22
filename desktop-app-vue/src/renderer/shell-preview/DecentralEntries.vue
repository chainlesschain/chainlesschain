<template>
  <div class="cb-shortcuts" role="toolbar" aria-label="快捷入口">
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      class="cb-shortcuts__item"
      :title="entry.label"
      @click="trigger(entry)"
    >
      <component :is="entry.icon" class="cb-shortcuts__icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  TeamOutlined,
  SwapOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons-vue";
import { dispatchSlash } from "../shell/slash-dispatch";

export interface DecentralEntry {
  id: string;
  label: string;
  icon: unknown;
  handler: string;
}

const entries: DecentralEntry[] = [
  {
    id: "p2p",
    label: "P2P 协作",
    icon: TeamOutlined,
    handler: "builtin:openP2P",
  },
  {
    id: "trade",
    label: "交易",
    icon: SwapOutlined,
    handler: "builtin:openTrade",
  },
  {
    id: "social",
    label: "社交",
    icon: GlobalOutlined,
    handler: "builtin:openSocial",
  },
  {
    id: "ukey",
    label: "安全",
    icon: SafetyCertificateOutlined,
    handler: "builtin:openUKey",
  },
];

const emit = defineEmits<{
  (e: "activate", id: string): void;
}>();

function trigger(entry: DecentralEntry) {
  emit("activate", entry.id);
  dispatchSlash(entry.handler, { trigger: entry.id, args: "" });
}

defineExpose({ entries });
</script>

<style scoped>
.cb-shortcuts {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cb-shortcuts__item {
  width: 38px;
  height: 38px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--cc-preview-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.cb-shortcuts__item:hover {
  background: var(--cc-preview-bg-hover);
  border-color: var(--cc-preview-border-strong);
  color: var(--cc-preview-text-primary);
  transform: translateY(-1px);
}

.cb-shortcuts__item:focus-visible {
  outline: 2px solid var(--cc-preview-accent-soft);
  outline-offset: 2px;
}

.cb-shortcuts__icon {
  font-size: 16px;
}
</style>
