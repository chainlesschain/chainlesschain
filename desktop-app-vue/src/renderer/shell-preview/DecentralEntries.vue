<template>
  <div class="cc-preview-decentral" role="toolbar" aria-label="去中心化入口">
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      class="cc-preview-decentral__btn"
      :title="entry.label"
      @click="trigger(entry)"
    >
      <component :is="entry.icon" class="cc-preview-decentral__icon" />
      <span class="cc-preview-decentral__label">{{ entry.label }}</span>
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
    label: "去中心化交易",
    icon: SwapOutlined,
    handler: "builtin:openTrade",
  },
  {
    id: "social",
    label: "去中心化社交",
    icon: GlobalOutlined,
    handler: "builtin:openSocial",
  },
  {
    id: "ukey",
    label: "U-Key 安全",
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
.cc-preview-decentral {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 10px 8px;
  border-top: 1px solid var(--cc-preview-border-subtle);
  background: var(--cc-preview-bg-sidebar);
}

.cc-preview-decentral__btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 2px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--cc-preview-text-secondary);
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}

.cc-preview-decentral__btn:hover {
  background: var(--cc-preview-bg-hover);
  color: var(--cc-preview-text-primary);
  border-color: var(--cc-preview-border-color);
}

.cc-preview-decentral__btn:focus-visible {
  outline: 2px solid var(--cc-preview-accent);
  outline-offset: 1px;
}

.cc-preview-decentral__icon {
  font-size: 18px;
  color: var(--cc-preview-accent);
}

.cc-preview-decentral__label {
  font-size: 10px;
  line-height: 1.1;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
