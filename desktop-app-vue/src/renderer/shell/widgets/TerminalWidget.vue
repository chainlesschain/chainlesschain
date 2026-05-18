<template>
  <div class="terminal-widget">
    <div class="widget-header">
      <DesktopOutlined class="widget-icon" />
      <span class="widget-title">远程终端</span>
    </div>
    <p class="widget-blurb">
      桌面端托管 PTY，Android 设备可远程查看输出 + 发送命令（Plan A）。
    </p>
    <ul class="action-list">
      <li
        v-for="action in actions"
        :key="action.id"
        class="action-item"
        role="button"
        tabindex="0"
        @click="pick(action)"
        @keydown.enter="pick(action)"
        @keydown.space.prevent="pick(action)"
      >
        <span class="action-label">{{ action.label }}</span>
        <span class="action-kind">{{ action.kind }}</span>
      </li>
    </ul>
    <button class="widget-more" type="button" @click="openPanel">
      打开远程终端 →
    </button>
  </div>
</template>

<script setup lang="ts">
import { DesktopOutlined } from "@ant-design/icons-vue";
import { dispatchSlash } from "../slash-dispatch";

interface TerminalAction {
  id: string;
  label: string;
  kind: string;
  args: string;
}

// Quick-action shortcuts inside the home widget. Args are forwarded to the
// slash handler so it can hint the new-session dialog (shell preselect).
const actions: TerminalAction[] = [
  {
    id: "pwsh",
    label: "新 PowerShell 会话",
    kind: "shell",
    args: "shell=pwsh",
  },
  { id: "cmd", label: "新 CMD 会话", kind: "shell", args: "shell=cmd" },
  { id: "list", label: "查看会话列表", kind: "管理", args: "list" },
];

function pick(action: TerminalAction): void {
  dispatchSlash("builtin:openTerminalPanel", {
    trigger: "/terminal",
    args: action.args,
  });
}

function openPanel(): void {
  dispatchSlash("builtin:openTerminalPanel", {
    trigger: "/terminal",
    args: "",
  });
}
</script>

<style scoped>
.terminal-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  color: var(--cc-shell-accent, #722ed1);
  font-size: 16px;
}
.widget-title {
  font-size: 14px;
}
.widget-blurb {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
  line-height: 1.5;
}
.action-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-item {
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
.action-item:hover,
.action-item:focus-visible {
  background: var(--cc-shell-hover, #f5f5f5);
  color: var(--cc-primary, #1677ff);
  outline: none;
}
.action-kind {
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
