<template>
  <div class="git-hooks-widget">
    <div class="widget-header">
      <BranchesOutlined class="widget-icon" />
      <span class="widget-title">Git Hooks</span>
    </div>
    <ul class="hook-list">
      <li
        v-for="hook in hooks"
        :key="hook.id"
        class="hook-item"
        role="button"
        tabindex="0"
        @click="pick(hook)"
        @keydown.enter="pick(hook)"
        @keydown.space.prevent="pick(hook)"
      >
        <span class="hook-label">{{ hook.label }}</span>
        <span class="hook-action">{{ hook.action }}</span>
      </li>
    </ul>
    <button class="widget-more" type="button" @click="openAll">
      管理全部 →
    </button>
  </div>
</template>

<script setup lang="ts">
import { BranchesOutlined } from "@ant-design/icons-vue";
import { dispatchSlash } from "../slash-dispatch";

interface HookEntry {
  id: string;
  label: string;
  action: string;
  args: string;
}

const hooks: HookEntry[] = [
  {
    id: "pre-commit",
    label: "Pre-commit 检查",
    action: "运行",
    args: "run pre-commit",
  },
  {
    id: "impact",
    label: "影响分析",
    action: "运行",
    args: "run impact",
  },
  {
    id: "auto-fix",
    label: "自动修复",
    action: "运行",
    args: "run auto-fix",
  },
];

function pick(hook: HookEntry): void {
  dispatchSlash("builtin:openGitHooksPanel", {
    trigger: "/git-hooks",
    args: hook.args,
  });
}

function openAll(): void {
  dispatchSlash("builtin:openGitHooksPanel", {
    trigger: "/git-hooks",
    args: "",
  });
}
</script>

<style scoped>
.git-hooks-widget {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 10px;
  min-width: 240px;
}

.widget-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
}

.widget-icon {
  color: var(--cc-shell-accent, #52c41a);
  font-size: 16px;
}

.widget-title {
  font-size: 14px;
}

.hook-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hook-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.hook-item:hover,
.hook-item:focus-visible {
  background: var(--cc-shell-hover, #f5f5f5);
  color: var(--cc-primary, #1677ff);
  outline: none;
}

.hook-action {
  font-size: 11px;
  opacity: 0.7;
}

.widget-more {
  align-self: flex-end;
  background: none;
  border: none;
  padding: 4px 2px;
  color: var(--cc-primary, #1677ff);
  font-size: 12px;
  cursor: pointer;
}

.widget-more:hover {
  text-decoration: underline;
}
</style>
