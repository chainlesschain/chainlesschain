<template>
  <div class="cb-shell" :data-active-theme="theme.active">
    <aside class="cb-shell__sidebar">
      <div v-if="isMacPlatform" class="cb-shell__traffic">
        <span class="cb-shell__traffic-dot cb-shell__traffic-dot--red" />
        <span class="cb-shell__traffic-dot cb-shell__traffic-dot--yellow" />
        <span class="cb-shell__traffic-dot cb-shell__traffic-dot--green" />
      </div>

      <div class="cb-shell__brand-row">
        <div class="cb-shell__brand">
          <img
            :src="brandLogo"
            class="cb-shell__brand-logo"
            alt="ChainlessChain logo"
          />
          <span class="cb-shell__brand-name">ChainlessChain</span>
        </div>
        <button
          type="button"
          class="cb-shell__brand-action"
          title="新建会话"
          @click="newConversation"
        >
          <PlusOutlined />
        </button>
      </div>

      <ConversationList
        :conversations="conversationItems"
        :active-id="activeConversationId"
        @select="selectConversation"
        @new-conversation="newConversation"
      />

      <div class="cb-shell__sidebar-footer">
        <div class="cb-shell__theme-switch">
          <button
            v-for="item in themeList"
            :key="item.key"
            type="button"
            class="cb-shell__theme-btn"
            :class="{
              'cb-shell__theme-btn--active': theme.active === item.key,
            }"
            :title="item.label"
            @click="theme.apply(item.key)"
          >
            {{ item.icon }}
          </button>
          <button
            type="button"
            class="cb-shell__theme-btn"
            title="设置（LLM / 数据库 / P2P 等）"
            @click="openSettings"
          >
            <SettingOutlined />
          </button>
        </div>
        <DecentralEntries @activate="onEntryActivate" />
      </div>
    </aside>

    <main class="cb-shell__main">
      <header class="cb-shell__topbar">
        <div class="cb-shell__topbar-title">
          <FolderOpenOutlined />
          <span>{{ activeConversation?.projectName || "workspace" }}</span>
        </div>
        <button
          type="button"
          class="cb-shell__topbar-action"
          @click="toggleArtifact"
        >
          <ReloadOutlined />
        </button>
      </header>

      <div class="cb-shell__body">
        <section class="cb-shell__center">
          <div
            v-if="activeConversation?.promptLabel"
            class="cb-shell__prompt-pill"
          >
            {{ activeConversation.promptLabel }}
          </div>

          <div class="cb-shell__thread">
            <div v-if="!activeConversation" class="cb-shell__welcome">
              <h2>桌面工作台预览</h2>
              <p>左侧切换项目，中间查看执行流，右侧浏览文件树。</p>
            </div>

            <template v-else>
              <article
                v-for="(message, index) in activeConversation.messages"
                :key="message.id"
                class="cb-message"
                :class="`cb-message--${message.role}`"
              >
                <div
                  v-if="message.role === 'assistant'"
                  class="cb-message__meta"
                >
                  <span class="cb-message__agent">
                    <RobotOutlined />
                    {{ activeConversation.runtimeStatus.agentLabel }} 已启动
                  </span>
                  <span class="cb-message__pid">PID 28244</span>
                  <span class="cb-message__badge">会话已恢复</span>
                </div>
                <div class="cb-message__body">
                  {{ message.content }}
                </div>
                <div
                  v-if="
                    message.role === 'assistant' &&
                    index === 0 &&
                    activeConversation.actionItems.length
                  "
                  class="cb-message__actions"
                >
                  <ToolInvocationCard
                    v-for="item in activeConversation.actionItems"
                    :key="item.id"
                    :item="item"
                  />
                </div>
              </article>

              <article
                v-if="showTypingIndicator"
                class="cb-message cb-message--assistant"
                data-testid="cc-preview-typing"
              >
                <div class="cb-message__meta">
                  <span class="cb-message__agent">
                    <RobotOutlined />
                    {{ activeConversation.runtimeStatus.agentLabel }}
                  </span>
                </div>
                <div class="cb-message__body cb-message__body--typing">
                  <span class="cb-typing-dot" />
                  <span class="cb-typing-dot" />
                  <span class="cb-typing-dot" />
                </div>
              </article>

              <TaskProgressPanel :steps="activeConversation.taskSteps" />
            </template>
          </div>

          <footer class="cb-shell__composer">
            <div class="cb-shell__composer-label">
              {{
                activeConversation?.runtimeStatus.agentLabel || "ChainlessChain"
              }}
            </div>
            <div class="cb-shell__composer-input">
              <textarea
                v-model="draft"
                class="cb-shell__textarea"
                placeholder="询问或发起一个任务（Ctrl/Cmd + Enter 发送）"
                rows="3"
                @keydown="onComposerKeydown"
              />
              <a-button
                type="primary"
                :loading="isGenerating"
                :disabled="!draft.trim() || isGenerating"
                @click="sendDraft"
              >
                发送
              </a-button>
            </div>
            <div class="cb-shell__runtime">
              <button
                type="button"
                class="cb-shell__runtime-new"
                @click="newConversation"
              >
                + 新会话
              </button>
              <a-dropdown :trigger="['click']" placement="topLeft">
                <button
                  type="button"
                  class="cb-shell__runtime-chip cb-shell__runtime-chip--button"
                  title="切换模型"
                  @click.prevent
                >
                  {{
                    activeConversation?.runtimeStatus.modelLabel || "未配置模型"
                  }}
                  <DownOutlined class="cb-shell__runtime-caret" />
                </button>
                <template #overlay>
                  <a-menu @click="onModelMenuClick">
                    <a-menu-item
                      v-for="option in MODEL_OPTIONS"
                      :key="option.label"
                    >
                      {{ option.label }}
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="__settings"> 前往 LLM 设置… </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <button
                v-if="isGenerating"
                type="button"
                class="cb-shell__stop"
                title="停止生成（请求仍会在后台完成）"
                @click="stopGenerating"
              >
                <CloseCircleOutlined />
              </button>
            </div>
          </footer>
        </section>

        <aside class="cb-shell__files">
          <div class="cb-shell__files-header">
            <span>文件</span>
            <button
              type="button"
              class="cb-shell__files-action"
              title="刷新"
              @click="toggleArtifact"
            >
              <ReloadOutlined />
            </button>
          </div>

          <div class="cb-shell__files-list">
            <div v-if="flatFiles.length === 0" class="cb-shell__files-empty">
              当前会话还没有文件
            </div>
            <button
              v-for="file in flatFiles"
              :key="file.id"
              type="button"
              class="cb-file"
              :class="{ 'cb-file--active': selectedFileId === file.id }"
              :style="{ paddingLeft: `${16 + file.depth * 18}px` }"
              @click="onFileClick(file)"
            >
              <span class="cb-file__caret">
                {{ file.kind === "folder" ? "›" : "" }}
              </span>
              <component
                :is="
                  file.kind === 'folder' ? FolderOpenOutlined : FileTextOutlined
                "
                class="cb-file__icon"
              />
              <span class="cb-file__name">{{ file.name }}</span>
            </button>
          </div>
        </aside>
      </div>

      <ArtifactDrawer
        :open="artifactOpen"
        :title="drawerTitle"
        :content="drawerContent"
        @close="closeDrawer"
      >
        <component :is="activeWidget.component" v-if="activeWidget" />
      </ArtifactDrawer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  CloseCircleOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { useRouter } from "vue-router";
import brandLogo from "../assets/logo.png";
import { useThemePreviewStore, PREVIEW_THEMES } from "../stores/theme-preview";
import {
  useConversationPreviewStore,
  type PreviewFileNode,
  type PreviewStepStatus,
} from "../stores/conversation-preview";
import { registerSlashHandler } from "../shell/slash-dispatch";
import ConversationList from "./ConversationList.vue";
import DecentralEntries from "./DecentralEntries.vue";
import ArtifactDrawer from "./ArtifactDrawer.vue";
import ToolInvocationCard from "./components/ToolInvocationCard.vue";
import TaskProgressPanel from "./components/TaskProgressPanel.vue";
import { getPreviewWidget, type DecentralEntryId } from "./widgets";
import {
  isAvailable as isLlmAvailable,
  sendChat as sendLlmChat,
  sendChatStream as sendLlmChatStream,
  streamAvailable as isStreamAvailable,
  toBridgeMessages,
} from "./services/llm-preview-bridge";
import "./themes.css";

interface FlatFileNode {
  id: string;
  name: string;
  kind: PreviewFileNode["kind"];
  depth: number;
}

interface ModelOption {
  label: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { label: "opus-4.7 / Max" },
  { label: "sonnet-4.6" },
  { label: "haiku-4.5" },
  { label: "gpt-4o" },
  { label: "gpt-4o-mini" },
  { label: "deepseek-chat" },
  { label: "ollama (本地)" },
];

const theme = useThemePreviewStore();
const themeList = PREVIEW_THEMES;
const router = useRouter();
const isMacPlatform = ref(false);

function openSettings() {
  router.push({ path: "/settings/system", query: { tab: "llm" } });
}

const conversationStore = useConversationPreviewStore();
const conversations = computed(() => conversationStore.conversations);
const activeConversationId = computed(
  () => conversationStore.activeId ?? undefined,
);
const activeConversation = computed(() => conversationStore.active);
const activeArtifact = computed(() => activeConversation.value?.artifact);

const artifactOpen = ref(false);
const activeEntryId = ref<DecentralEntryId | null>(null);
const selectedFileId = ref<string | null>(null);
const fileArtifact = ref<{ title: string; content: string } | null>(null);
const activeWidget = computed(() =>
  activeEntryId.value ? getPreviewWidget(activeEntryId.value) : undefined,
);
const drawerTitle = computed(() => {
  if (activeEntryId.value) {
    return activeWidget.value?.title;
  }
  if (fileArtifact.value) {
    return fileArtifact.value.title;
  }
  return activeArtifact.value?.title || "Artifact";
});

const drawerContent = computed(() => {
  if (activeEntryId.value) {
    return undefined;
  }
  if (fileArtifact.value) {
    return fileArtifact.value.content;
  }
  return activeArtifact.value?.content;
});
const draft = ref("");
const isGenerating = computed(() => conversationStore.isGenerating);

const conversationItems = computed(() =>
  conversations.value.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    relativeTime: conversation.relativeTime,
    workspaceLabel: conversation.workspaceLabel,
    status: deriveConversationStatus(
      conversation.taskSteps.map((step) => step.status),
    ),
  })),
);

const showTypingIndicator = computed(() => {
  if (!isGenerating.value) {
    return false;
  }
  const lastMessage = activeConversation.value?.messages.at(-1);
  return !(
    lastMessage &&
    lastMessage.role === "assistant" &&
    lastMessage.content.length > 0
  );
});

const flatFiles = computed(() =>
  flattenFiles(activeConversation.value?.files ?? createFallbackFiles()),
);

function deriveConversationStatus(statuses: PreviewStepStatus[]) {
  if (statuses.includes("running")) {
    return "running" as const;
  }
  if (statuses.length > 0 && statuses.every((status) => status === "done")) {
    return "done" as const;
  }
  return "idle" as const;
}

function flattenFiles(nodes: PreviewFileNode[], depth = 0): FlatFileNode[] {
  return nodes.flatMap((node) => {
    const current: FlatFileNode = {
      id: node.id,
      name: node.name,
      kind: node.kind,
      depth,
    };
    const children = node.children
      ? flattenFiles(node.children, depth + 1)
      : [];
    return [current, ...children];
  });
}

function createFallbackFiles(): PreviewFileNode[] {
  return [
    {
      id: "fallback-root",
      name: "workspace",
      kind: "folder",
      children: [{ id: "fallback-readme", name: "README.md", kind: "file" }],
    },
  ];
}

function selectConversation(id: string) {
  conversationStore.select(id);
}

function onFileClick(file: FlatFileNode) {
  selectedFileId.value = file.id;
  if (file.kind === "folder") {
    return;
  }
  fileArtifact.value = {
    title: file.name,
    content: `(暂无 "${file.name}" 的内容预览)`,
  };
  activeEntryId.value = null;
  artifactOpen.value = true;
}

function onModelMenuClick(info: { key: string | number }) {
  if (info.key === "__settings") {
    openSettings();
    return;
  }
  if (typeof info.key === "string") {
    if (!conversationStore.active) {
      conversationStore.createBlank();
    }
    conversationStore.setModelLabel(info.key);
  }
}

function stopGenerating() {
  conversationStore.setGenerating(false);
}

function newConversation() {
  conversationStore.createBlank();
  artifactOpen.value = false;
  activeEntryId.value = null;
  fileArtifact.value = null;
  selectedFileId.value = null;
}

async function sendDraft() {
  const text = draft.value.trim();
  if (!text || conversationStore.isGenerating) {
    return;
  }

  const history = conversationStore.active?.messages ?? [];
  const payload = toBridgeMessages(history, text);

  conversationStore.appendMessage("user", text);
  draft.value = "";

  conversationStore.setGenerating(true);
  try {
    const available = await isLlmAvailable();
    if (!available) {
      conversationStore.appendAssistantMessage(
        "LLM 服务不可用，请检查本地模型或设置里的 LLM 配置。",
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

function onComposerKeydown(event: KeyboardEvent) {
  const isMod = event.ctrlKey || event.metaKey;
  if (isMod && event.key === "Enter") {
    event.preventDefault();
    sendDraft();
  }
}

function toggleArtifact() {
  if (activeEntryId.value) {
    activeEntryId.value = null;
  }
  artifactOpen.value = !artifactOpen.value;
}

function closeDrawer() {
  artifactOpen.value = false;
  activeEntryId.value = null;
  fileArtifact.value = null;
}

function openEntryWidget(id: DecentralEntryId) {
  activeEntryId.value = id;
  artifactOpen.value = true;
}

function onEntryActivate(id: string) {
  if (getPreviewWidget(id)) {
    openEntryWidget(id as DecentralEntryId);
  }
}

const unregisters: Array<() => void> = [];

onMounted(async () => {
  theme.restore();
  conversationStore.restore();
  try {
    const platform = await window.electronAPI?.system?.getPlatform?.();
    isMacPlatform.value = platform === "darwin";
  } catch {
    /* leave false in non-Electron contexts (tests/SSR) */
  }
  const handlers: Array<[string, DecentralEntryId]> = [
    ["builtin:openP2P", "p2p"],
    ["builtin:openTrade", "trade"],
    ["builtin:openSocial", "social"],
    ["builtin:openUKey", "ukey"],
  ];
  for (const [handlerId, entryId] of handlers) {
    unregisters.push(
      registerSlashHandler(handlerId, () => {
        openEntryWidget(entryId);
      }),
    );
  }
});

onBeforeUnmount(() => {
  for (const off of unregisters) {
    off();
  }
  unregisters.length = 0;
});
</script>

<style scoped>
.cb-shell {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  height: 100vh;
  background:
    radial-gradient(
      circle at top left,
      var(--cc-preview-bg-glow),
      transparent 38%
    ),
    var(--cc-preview-bg-base);
  color: var(--cc-preview-text-primary);
  overflow: hidden;
}

.cb-shell__sidebar {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 18px 14px;
  background: linear-gradient(
    180deg,
    var(--cc-preview-bg-sidebar),
    var(--cc-preview-bg-sidebar-soft)
  );
  border-right: 1px solid var(--cc-preview-border-subtle);
}

.cb-shell__traffic {
  display: flex;
  gap: 8px;
}

.cb-shell__traffic-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.cb-shell__traffic-dot--red {
  background: #ff5f57;
}

.cb-shell__traffic-dot--yellow {
  background: #febc2e;
}

.cb-shell__traffic-dot--green {
  background: #28c840;
}

.cb-shell__brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cb-shell__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cb-shell__brand-logo {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: contain;
}

.cb-shell__brand-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cb-shell__brand-action {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--cc-preview-border-strong);
  background: var(--cc-preview-bg-elevated);
  color: var(--cc-preview-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.cb-shell__sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--cc-preview-border-subtle);
}

.cb-shell__theme-switch {
  display: flex;
  gap: 8px;
}

.cb-shell__theme-btn {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--cc-preview-border-subtle);
  background: var(--cc-preview-bg-elevated);
  color: var(--cc-preview-text-secondary);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.cb-shell__theme-btn:hover,
.cb-shell__theme-btn--active {
  transform: translateY(-1px);
  border-color: var(--cc-preview-accent-soft);
  color: var(--cc-preview-accent);
}

.cb-shell__main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cb-shell__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
  background: color-mix(in srgb, var(--cc-preview-bg-base) 84%, white 16%);
  backdrop-filter: blur(12px);
}

.cb-shell__topbar-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 24px;
  font-weight: 600;
}

.cb-shell__topbar-action,
.cb-shell__files-action {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--cc-preview-border-subtle);
  background: var(--cc-preview-bg-elevated);
  color: var(--cc-preview-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.cb-shell__body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  min-height: 0;
}

.cb-shell__center {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 14px 18px 18px;
}

.cb-shell__prompt-pill {
  align-self: center;
  max-width: min(760px, calc(100% - 40px));
  padding: 14px 24px;
  border-radius: 20px;
  background: linear-gradient(
    135deg,
    var(--cc-preview-user-pill-start),
    var(--cc-preview-user-pill-end)
  );
  color: var(--cc-preview-text-primary);
  font-size: 26px;
  line-height: 1.35;
  box-shadow: var(--cc-preview-soft-shadow);
}

.cb-shell__thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 12px 10px 22px;
}

.cb-shell__welcome {
  margin: 12vh auto 0;
  text-align: center;
  color: var(--cc-preview-text-secondary);
}

.cb-shell__welcome h2 {
  margin-bottom: 10px;
  color: var(--cc-preview-text-primary);
}

.cb-message {
  max-width: 760px;
  margin-bottom: 18px;
}

.cb-message--user {
  margin-left: auto;
}

.cb-message__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.cb-message__agent,
.cb-message__pid,
.cb-message__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--cc-preview-chip-bg);
  color: var(--cc-preview-text-secondary);
  font-size: 12px;
}

.cb-message__badge {
  color: var(--cc-preview-status-done);
}

.cb-message__body {
  padding: 18px 20px;
  border-radius: 22px;
  background: var(--cc-preview-bg-elevated);
  border: 1px solid var(--cc-preview-border-strong);
  box-shadow: var(--cc-preview-soft-shadow);
  line-height: 1.75;
  font-size: 16px;
  white-space: pre-wrap;
}

.cb-message--user .cb-message__body {
  background: linear-gradient(
    135deg,
    var(--cc-preview-user-pill-start),
    var(--cc-preview-user-pill-end)
  );
}

.cb-message__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.cb-message__body--typing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cb-typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cc-preview-text-secondary);
  opacity: 0.35;
  animation: cb-typing 1.2s infinite ease-in-out;
}

.cb-typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.cb-typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes cb-typing {
  0%,
  80%,
  100% {
    opacity: 0.2;
    transform: translateY(0);
  }
  40% {
    opacity: 0.95;
    transform: translateY(-2px);
  }
}

.cb-shell__composer {
  margin-top: 12px;
  border: 1px solid var(--cc-preview-border-strong);
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    var(--cc-preview-composer-top),
    var(--cc-preview-composer-bottom)
  );
  box-shadow: var(--cc-preview-shadow);
  padding: 16px 18px 14px;
}

.cb-shell__composer-label {
  font-size: 24px;
  color: var(--cc-preview-text-secondary);
}

.cb-shell__composer-input {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-top: 12px;
}

.cb-shell__textarea {
  flex: 1;
  resize: none;
  border: none;
  background: transparent;
  color: var(--cc-preview-text-primary);
  font: inherit;
  line-height: 1.6;
}

.cb-shell__textarea:focus {
  outline: none;
}

.cb-shell__runtime {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 13px;
}

.cb-shell__runtime-new,
.cb-shell__runtime-chip,
.cb-shell__stop {
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--cc-preview-text-secondary);
  min-height: 30px;
}

.cb-shell__runtime-new {
  padding: 0 4px;
  cursor: pointer;
}

.cb-shell__runtime-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  background: var(--cc-preview-chip-bg);
}

.cb-shell__stop {
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  color: #db6f73;
}

.cb-shell__files {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--cc-preview-border-subtle);
  background: color-mix(in srgb, var(--cc-preview-bg-base) 76%, white 24%);
}

.cb-shell__files-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 14px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
  font-size: 17px;
  font-weight: 600;
}

.cb-shell__files-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0 18px;
}

.cb-file {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding-right: 12px;
  color: var(--cc-preview-text-secondary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 0.16s ease;
}

.cb-file:hover {
  background: var(--cc-preview-bg-hover);
}

.cb-file--active {
  background: var(--cc-preview-bg-hover);
  color: var(--cc-preview-text-primary);
}

.cb-shell__files-empty {
  padding: 24px 16px;
  font-size: 12px;
  color: var(--cc-preview-text-muted);
  text-align: center;
}

.cb-shell__runtime-caret {
  margin-left: 6px;
  font-size: 10px;
  opacity: 0.6;
}

.cb-file__caret {
  width: 10px;
  color: var(--cc-preview-text-muted);
}

.cb-file__icon {
  font-size: 14px;
}

.cb-file__name {
  color: var(--cc-preview-text-primary);
  font-size: 14px;
}

@media (max-width: 1100px) {
  .cb-shell {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .cb-shell__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .cb-shell__files {
    display: none;
  }

  .cb-shell__prompt-pill {
    font-size: 22px;
  }
}

@media (max-width: 800px) {
  .cb-shell {
    grid-template-columns: 1fr;
  }

  .cb-shell__sidebar {
    display: none;
  }

  .cb-shell__center {
    padding: 12px;
  }

  .cb-shell__topbar {
    padding: 14px 16px 12px;
  }

  .cb-shell__prompt-pill {
    width: 100%;
    max-width: none;
    font-size: 18px;
  }

  .cb-shell__composer-label {
    font-size: 18px;
  }

  .cb-shell__runtime {
    gap: 8px;
  }

  .cb-shell__stop {
    margin-left: 0;
  }
}
</style>
