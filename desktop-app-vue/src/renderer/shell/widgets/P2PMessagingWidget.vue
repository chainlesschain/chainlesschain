<template>
  <div class="p2p-widget">
    <div class="widget-header">
      <WifiOutlined class="widget-icon" />
      <span class="widget-title">P2P 消息</span>
    </div>
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
    <button class="widget-more" type="button" @click="openAll">
      打开 P2P →
    </button>
  </div>
</template>

<script setup lang="ts">
import { WifiOutlined } from "@ant-design/icons-vue";
import { dispatchSlash } from "../slash-dispatch";

interface P2PAction {
  id: string;
  label: string;
  kind: string;
  args: string;
}

const actions: P2PAction[] = [
  { id: "peers", label: "已连接节点", kind: "查看", args: "peers" },
  { id: "node", label: "本地节点信息", kind: "查看", args: "node" },
  { id: "nat", label: "NAT 与穿透状态", kind: "诊断", args: "nat" },
];

function pick(action: P2PAction): void {
  dispatchSlash("builtin:openP2PMessagingPanel", {
    trigger: "/p2p",
    args: action.args,
  });
}

function openAll(): void {
  dispatchSlash("builtin:openP2PMessagingPanel", {
    trigger: "/p2p",
    args: "",
  });
}
</script>

<style scoped>
.p2p-widget {
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
