<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="AI 对话"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <MessageOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      多 LLM 智能对话与流式生成。当前使用配置的 provider 与 model 处理消息，可在
      /ai/chat 查看完整历史会话与流控（取消/暂停/继续）。 下方显示 LLM
      服务状态（完整对话请访问 <code>/ai/chat</code>）。
    </p>

    <div class="llm-summary">
      <div class="summary-header">
        <span class="summary-label">LLM 状态</span>
        <a-tag v-if="store.hasLoaded && store.isAvailable" color="green">
          就绪
        </a-tag>
        <a-tag v-else-if="store.hasLoaded" color="red"> 不可用 </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          刷新
        </a-button>
      </div>
      <div v-if="store.hasLoaded" class="llm-meta">
        <div class="meta-row">
          <span class="meta-label">当前模型</span>
          <span class="meta-value">{{ store.providerLabel }}</span>
        </div>
        <div v-if="store.config?.baseUrl" class="meta-row">
          <span class="meta-label">Base URL</span>
          <span class="meta-value mono">{{ store.config.baseUrl }}</span>
        </div>
        <div v-if="store.config?.temperature !== undefined" class="meta-row">
          <span class="meta-label">Temperature</span>
          <span class="meta-value mono">{{ store.config.temperature }}</span>
        </div>
        <div v-if="store.config?.maxTokens !== undefined" class="meta-row">
          <span class="meta-label">Max Tokens</span>
          <span class="meta-value mono">{{ store.config.maxTokens }}</span>
        </div>
        <div v-if="store.status?.error" class="meta-row">
          <span class="meta-label">错误</span>
          <span class="meta-value error-text">{{ store.status.error }}</span>
        </div>
      </div>
    </div>

    <a-divider />

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button
            size="small"
            :type="action.primary ? 'primary' : 'default'"
            :disabled="action.disabled"
            @click="run(action)"
          >
            {{ action.cta }}
          </a-button>
        </div>
        <p class="action-desc">
          {{ action.desc }}
        </p>
      </li>
    </ul>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.clearError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { MessageOutlined } from "@ant-design/icons-vue";
import { useAIChatStore } from "../stores/aiChat";

interface ChatAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useAIChatStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadAll();
    }
  },
);

const actions: ChatAction[] = [
  {
    id: "new",
    label: "新对话",
    desc: "开启新会话（清空当前上下文，开始全新对话流）。",
    cta: "前往",
    primary: true,
  },
  {
    id: "switch",
    label: "切换模型",
    desc: "在 Ollama / OpenAI / Anthropic / Volcengine / DeepSeek / Zhipu / Dashscope 间切换 provider 与 model。",
    cta: "前往",
  },
  {
    id: "history",
    label: "查看历史",
    desc: "查看历史会话列表，可恢复任一会话继续对话。",
    cta: "前往",
  },
  {
    id: "prompts",
    label: "提示词模板",
    desc: "从内置或自定义模板快速插入常用提示词（与 /prompts 联动）。",
    cta: "前往",
  },
];

function run(action: ChatAction): void {
  antMessage.info(
    `${action.label}：请在 /ai/chat 完成该操作（快速面板仅展示概览）`,
  );
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
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.llm-summary {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.summary-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.summary-header > .ant-btn-link {
  margin-left: auto;
}

.llm-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
  font-size: 12px;
}

.meta-row:first-child {
  border-top: none;
}

.meta-label {
  width: 96px;
  color: var(--cc-shell-muted, #595959);
}

.meta-value {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
  word-break: break-all;
}

.mono {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
}

.error-text {
  color: #ff4d4f;
}

.action-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.action-title {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.action-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}

.error-alert {
  margin-top: 12px;
}
</style>
