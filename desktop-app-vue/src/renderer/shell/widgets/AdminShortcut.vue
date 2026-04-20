<template>
  <a-tooltip :title="tooltip">
    <span
      class="admin-shortcut"
      role="button"
      tabindex="0"
      @click="open"
      @keydown.enter="open"
      @keydown.space.prevent="open"
    >
      <SettingOutlined />
    </span>
  </a-tooltip>
</template>

<script setup lang="ts">
import { SettingOutlined } from "@ant-design/icons-vue";
import { dispatchSlash } from "../slash-dispatch";

withDefaults(defineProps<{ tooltip?: string }>(), {
  tooltip: "管理控制台 (Ctrl+Shift+A)",
});

function open() {
  dispatchSlash("builtin:openAdminConsole", { trigger: "admin", args: "" });
}
</script>

<style scoped>
.admin-shortcut {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--cc-shell-muted, #666);
  transition:
    background 120ms ease,
    color 120ms ease;
}

.admin-shortcut:hover,
.admin-shortcut:focus-visible {
  background: var(--cc-shell-hover, #eee);
  color: var(--cc-primary, #1677ff);
  outline: none;
}
</style>
