<template>
  <a-modal
    :open="open"
    :width="720"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="AI 提示模板"
    class="prompts-panel-modal"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BulbOutlined />
      <span class="prefill-text">{{ prefillText }}</span>
      <a-button size="small" type="link" @click="copy(prefillText)">
        复制
      </a-button>
    </div>

    <a-tabs v-model:active-key="activeCategory">
      <a-tab-pane
        v-for="category in categories"
        :key="category.id"
        :tab="category.label"
      >
        <ul class="prompt-list">
          <li
            v-for="prompt in category.prompts"
            :key="prompt.id"
            class="prompt-card"
          >
            <div class="prompt-header">
              <span class="prompt-title">{{ prompt.label }}</span>
              <a-button size="small" @click="copy(prompt.text)">
                <template #icon>
                  <CopyOutlined />
                </template>
                复制
              </a-button>
            </div>
            <pre class="prompt-text">{{ prompt.text }}</pre>
          </li>
        </ul>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { message as antMessage } from "ant-design-vue";
import { BulbOutlined, CopyOutlined } from "@ant-design/icons-vue";

interface PromptEntry {
  id: string;
  label: string;
  text: string;
}

interface Category {
  id: string;
  label: string;
  prompts: PromptEntry[];
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const activeCategory = ref("general");

const categories: Category[] = [
  {
    id: "general",
    label: "通用",
    prompts: [
      {
        id: "summary-3d",
        label: "总结最近 3 天的笔记",
        text: "请总结我最近 3 天的笔记，按主题分组。",
      },
      {
        id: "translate",
        label: "中英互译一段文字",
        text: "请把这段文字翻译为英文，并解释难点：",
      },
      {
        id: "outline",
        label: "生成大纲",
        text: "请为下面这篇内容生成三级大纲：",
      },
    ],
  },
  {
    id: "code",
    label: "代码",
    prompts: [
      {
        id: "code-review",
        label: "代码 review 清单",
        text: "请按安全、可读、性能三维给这段代码做 review：",
      },
      {
        id: "refactor",
        label: "重构建议",
        text: "请识别下面代码中的坏味道并给出重构建议：",
      },
      {
        id: "explain",
        label: "逐行解释",
        text: "请逐行解释这段代码的意图和实现细节：",
      },
    ],
  },
  {
    id: "writing",
    label: "写作",
    prompts: [
      {
        id: "polish",
        label: "润色文字",
        text: "请润色以下文字，使其更自然、更准确：",
      },
      {
        id: "expand",
        label: "扩写一段",
        text: "请基于以下要点扩写为 300 字左右的段落：",
      },
    ],
  },
];

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    antMessage.success("已复制到剪贴板");
  } catch {
    antMessage.error("复制失败，请手动选中");
  }
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prompt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prompt-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.prompt-title {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.prompt-text {
  margin: 0;
  padding: 8px 10px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 4px;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
  white-space: pre-wrap;
  font-family: inherit;
}
</style>
