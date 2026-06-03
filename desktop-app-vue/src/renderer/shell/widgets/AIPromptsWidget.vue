<template>
  <div class="ai-prompts-widget">
    <div class="widget-header">
      <BulbOutlined class="widget-icon" />
      <span class="widget-title">常用提示</span>
    </div>
    <ul class="prompt-list">
      <li
        v-for="prompt in quickPrompts"
        :key="prompt.id"
        class="prompt-item"
        role="button"
        tabindex="0"
        @click="pick(prompt)"
        @keydown.enter="pick(prompt)"
        @keydown.space.prevent="pick(prompt)"
      >
        <span class="prompt-label">{{ prompt.label }}</span>
        <RightOutlined class="prompt-arrow" />
      </li>
    </ul>
    <button class="widget-more" type="button" @click="openAll">
      查看全部 →
    </button>
  </div>
</template>

<script setup lang="ts">
import { BulbOutlined, RightOutlined } from "@ant-design/icons-vue";
import { dispatchSlash } from "../slash-dispatch";

interface QuickPrompt {
  id: string;
  label: string;
  text: string;
}

const quickPrompts: QuickPrompt[] = [
  {
    id: "summary",
    label: "总结最近 3 天的笔记",
    text: "请总结我最近 3 天的笔记，按主题分组。",
  },
  {
    id: "translate",
    label: "中英互译一段文字",
    text: "请把这段文字翻译为英文，并解释难点：",
  },
  {
    id: "code-review",
    label: "代码 review 清单",
    text: "请按安全、可读、性能三维给这段代码做 review：",
  },
];

function pick(prompt: QuickPrompt): void {
  dispatchSlash("builtin:openPromptsPanel", {
    trigger: "/prompts",
    args: prompt.text,
  });
}

function openAll(): void {
  dispatchSlash("builtin:openPromptsPanel", {
    trigger: "/prompts",
    args: "",
  });
}
</script>

<style scoped>
.ai-prompts-widget {
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
  color: var(--cc-shell-accent, #faad14);
  font-size: 16px;
}

.widget-title {
  font-size: 14px;
}

.prompt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prompt-item {
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

.prompt-item:hover,
.prompt-item:focus-visible {
  background: var(--cc-shell-hover, #f5f5f5);
  color: var(--cc-primary, #1677ff);
  outline: none;
}

.prompt-arrow {
  font-size: 11px;
  opacity: 0.6;
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
