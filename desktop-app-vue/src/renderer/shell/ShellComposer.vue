<template>
  <div class="shell-composer">
    <div class="composer-slots composer-slots-left">
      <component
        :is="resolveSlotComponent(slot)"
        v-for="slot in leftSlots"
        :key="slot.id"
      />
      <div
        v-if="leftSlots.length === 0"
        class="ukey-placeholder"
        :title="'U-Key 指示灯（等待 ukey-crypto 插件）'"
      >
        <LockOutlined />
      </div>
    </div>

    <div class="composer-main">
      <a-textarea
        v-model:value="input"
        placeholder="与助手对话…  /  命令   @  引用"
        :auto-size="{ minRows: 1, maxRows: 6 }"
        :bordered="false"
        class="composer-input"
        @keydown="handleKeydown"
        @input="handleInput"
      />

      <a-popover
        :open="slashOpen"
        trigger="click"
        placement="topLeft"
        :overlay-class-name="'composer-popover'"
      >
        <template #content>
          <div class="slash-panel">
            <div class="panel-title">命令</div>
            <div v-if="filteredSlash.length === 0" class="panel-empty">
              暂无可用命令（等待插件注册 ui.slash 贡献）
            </div>
            <div
              v-for="cmd in filteredSlash"
              :key="cmd.id"
              class="slash-item"
              @click="onPickSlash(cmd)"
            >
              <span class="slash-trigger">/{{ cmd.trigger }}</span>
              <span class="slash-desc">{{ cmd.description }}</span>
            </div>
          </div>
        </template>
        <span class="invisible-anchor" />
      </a-popover>

      <a-popover
        :open="mentionOpen"
        trigger="click"
        placement="topLeft"
        :overlay-class-name="'composer-popover'"
      >
        <template #content>
          <div class="mention-panel">
            <div class="panel-title">引用</div>
            <div v-if="mentionSources.length === 0" class="panel-empty">
              暂无可引用对象（等待插件注册 ui.mention 贡献）
            </div>
            <div
              v-for="src in mentionSources"
              :key="src.id"
              class="mention-item"
            >
              <span class="mention-prefix">@{{ src.prefix }}</span>
              <span class="mention-label">{{ src.label }}</span>
            </div>
          </div>
        </template>
        <span class="invisible-anchor" />
      </a-popover>
    </div>

    <div class="composer-slots composer-slots-right">
      <component
        :is="resolveSlotComponent(slot)"
        v-for="slot in rightSlots"
        :key="slot.id"
      />
      <a-button
        type="primary"
        shape="circle"
        :loading="isGenerating"
        :disabled="!input.trim() || isGenerating"
        @click="handleSend"
      >
        <SendOutlined v-if="!isGenerating" />
      </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LockOutlined, SendOutlined } from "@ant-design/icons-vue";
import { storeToRefs } from "pinia";
import {
  useExtensionRegistryStore,
  type SlashCommandContribution,
} from "../stores/extensionRegistry";
import { useConversationPreviewStore } from "../stores/conversation-preview";
import {
  isAvailable as isLlmAvailable,
  sendChat as sendLlmChat,
  sendChatStream as sendLlmChatStream,
  streamAvailable as isStreamAvailable,
  toBridgeMessages,
} from "../shell-preview/services/llm-preview-bridge";
import { dispatchSlash } from "./slash-dispatch";
import { resolveWidgetComponent } from "./widget-registry";

const registry = useExtensionRegistryStore();
const { composerSlots, slashCommands, mentionSources } = storeToRefs(registry);
const conversationStore = useConversationPreviewStore();
const isGenerating = computed(() => conversationStore.isGenerating);

const input = ref("");
const slashOpen = ref(false);
const mentionOpen = ref(false);
const slashQuery = ref("");

const leftSlots = computed(() =>
  composerSlots.value.filter((s) => s.position === "left"),
);
const rightSlots = computed(() =>
  composerSlots.value.filter((s) => s.position === "right"),
);

const filteredSlash = computed(() => {
  const q = slashQuery.value.toLowerCase();
  if (!q) {
    return slashCommands.value;
  }
  return slashCommands.value.filter((c) =>
    c.trigger.toLowerCase().startsWith(q),
  );
});

function handleInput() {
  const val = input.value;
  const lastWordMatch = val.match(/(^|\s)([/@])([\w-]*)$/);
  if (!lastWordMatch) {
    slashOpen.value = false;
    mentionOpen.value = false;
    return;
  }
  const symbol = lastWordMatch[2];
  const query = lastWordMatch[3] || "";
  if (symbol === "/") {
    slashOpen.value = true;
    mentionOpen.value = false;
    slashQuery.value = query;
  } else if (symbol === "@") {
    mentionOpen.value = true;
    slashOpen.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    slashOpen.value = false;
    mentionOpen.value = false;
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    const fired = tryDispatchFromInput();
    if (fired) {
      e.preventDefault();
      return;
    }
    if (input.value.trim() && !isGenerating.value) {
      e.preventDefault();
      handleSend();
    }
  }
}

async function handleSend() {
  const text = input.value.trim();
  if (!text || conversationStore.isGenerating) {
    return;
  }

  const history = conversationStore.active?.messages ?? [];
  const payload = toBridgeMessages(history, text);

  conversationStore.appendMessage("user", text);
  input.value = "";
  slashOpen.value = false;
  mentionOpen.value = false;

  conversationStore.setGenerating(true);
  try {
    const available = await isLlmAvailable();
    if (!available) {
      conversationStore.appendAssistantMessage(
        "LLM 服务不可用，请检查 LLM 配置（设置 → LLM）。",
      );
      return;
    }

    if (isStreamAvailable()) {
      const streamId = conversationStore.beginStreamingAssistant();
      if (streamId) {
        const result = await sendLlmChatStream(text, (liveText) => {
          conversationStore.updateAssistantContent(streamId, liveText);
        });
        if (result.ok === true) {
          conversationStore.finalizeStreamingAssistant(streamId, result.reply);
          return;
        }
        conversationStore.removeMessage(streamId);
      }
    }

    const result = await sendLlmChat(payload);
    if (result.ok === true) {
      conversationStore.appendAssistantMessage(result.reply);
    } else {
      conversationStore.appendAssistantMessage(
        `LLM 调用失败：${result.reason}`,
      );
    }
  } finally {
    conversationStore.setGenerating(false);
  }
}

function tryDispatchFromInput(): boolean {
  const raw = input.value.trim();
  if (!raw.startsWith("/")) {
    return false;
  }
  const [head, ...rest] = raw.slice(1).split(/\s+/);
  const cmd = slashCommands.value.find(
    (c) => c.trigger.replace(/^\//, "").toLowerCase() === head.toLowerCase(),
  );
  if (!cmd) {
    return false;
  }
  const ok = dispatchSlash(cmd.handler, {
    trigger: cmd.trigger,
    args: rest.join(" "),
  });
  if (ok) {
    input.value = "";
    slashOpen.value = false;
  }
  return ok;
}

function onPickSlash(cmd: SlashCommandContribution) {
  slashOpen.value = false;
  const ok = dispatchSlash(cmd.handler, { trigger: cmd.trigger, args: "" });
  if (ok) {
    input.value = "";
  } else {
    input.value = `/${cmd.trigger.replace(/^\//, "")} `;
  }
}

function resolveSlotComponent(slot: { component: string | null }) {
  const resolved = resolveWidgetComponent(slot.component);
  if (resolved) {
    return resolved;
  }
  return {
    template: `<span class="slot-placeholder" title="${slot.component || ""}">◌</span>`,
  };
}
</script>

<style scoped>
.shell-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--shell-border, #e8e8e8);
  background: var(--shell-bg, #ffffff);
}

.composer-slots {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
}

.composer-main {
  flex: 1;
  position: relative;
  background: #fafafa;
  border: 1px solid var(--shell-border, #e8e8e8);
  border-radius: 8px;
  padding: 6px 10px;
}

.composer-input {
  width: 100%;
  resize: none;
  font-size: 14px;
  background: transparent !important;
}

.invisible-anchor {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  visibility: hidden;
}

.ukey-placeholder {
  color: #bbb;
  font-size: 16px;
  padding: 4px;
  cursor: help;
}

.slash-panel,
.mention-panel {
  width: 280px;
  max-height: 360px;
  overflow-y: auto;
}

.panel-title {
  font-size: 11px;
  color: #888;
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.panel-empty {
  padding: 16px;
  color: #aaa;
  font-size: 12px;
  text-align: center;
}

.slash-item,
.mention-item {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.slash-item:hover,
.mention-item:hover {
  background: #f5f5f5;
}

.slash-trigger,
.mention-prefix {
  font-family: monospace;
  color: #1677ff;
  font-size: 13px;
  flex-shrink: 0;
}

.slash-desc,
.mention-label {
  color: #555;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
