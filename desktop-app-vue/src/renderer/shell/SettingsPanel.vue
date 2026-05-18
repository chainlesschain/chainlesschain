<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="系统设置"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SettingOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      系统级配置入口。完整 SystemSettings 包含 17 个分区；下方按高频度列出 7
      类，点击任一分区直接跳转 V5 完整设置页面。
    </p>

    <!-- Status summary -->
    <div class="status-summary">
      <a-spin :spinning="statusLoading">
        <div class="status-row">
          <span class="status-label">LLM Provider</span>
          <a-tag v-if="aiChatStore.isAvailable" color="success">
            {{ aiChatStore.providerLabel }}
          </a-tag>
          <a-tag v-else color="error"> 未配置 </a-tag>
        </div>
        <div class="status-row">
          <span class="status-label">V6 Shell</span>
          <a-tag :color="v6ShellTagColor">
            {{ v6ShellLabel(uiUseV6) }}
          </a-tag>
        </div>
        <div class="status-row">
          <span class="status-label">主题</span>
          <a-tag color="default">
            {{ themeLabel(generalTheme) }}
          </a-tag>
        </div>
        <div class="status-row">
          <span class="status-label">语言</span>
          <a-tag color="default">
            {{ languageLabel(generalLanguage) }}
          </a-tag>
        </div>
      </a-spin>
    </div>

    <a-divider />

    <div class="categories-summary">
      <div class="summary-header">
        <span class="summary-label">设置分区</span>
        <a-tag color="blue">
          {{ categories.length }}
        </a-tag>
      </div>
      <ul class="category-list">
        <li
          v-for="cat in categories"
          :key="cat.id"
          class="category-row"
          @click="onCategoryClick(cat)"
        >
          <component :is="cat.icon" class="category-icon" />
          <div class="category-meta">
            <span class="category-name">{{ cat.label }}</span>
            <span class="category-desc">{{ cat.desc }}</span>
          </div>
          <a-tag v-if="cat.tag" :color="cat.tagColor">
            {{ cat.tag }}
          </a-tag>
          <RightOutlined class="category-arrow" />
        </li>
      </ul>
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
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { message as antMessage } from "ant-design-vue";
import {
  SettingOutlined,
  ApiOutlined,
  DatabaseOutlined,
  FolderOutlined,
  WifiOutlined,
  AudioOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  RightOutlined,
} from "@ant-design/icons-vue";
import type { Component } from "vue";
import { useAIChatStore } from "../stores/aiChat";
import {
  buildSettingsRoute,
  languageLabel,
  themeLabel,
  v6ShellLabel,
} from "./helpers/settingsHelpers";

interface SettingsCategory {
  id: string;
  label: string;
  desc: string;
  icon: Component;
  tag?: string;
  tagColor?: string;
}

interface SettingsAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
  tab?: string;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const router = useRouter();
const aiChatStore = useAIChatStore();

const statusLoading = ref(false);
const generalTheme = ref<unknown>(undefined);
const generalLanguage = ref<unknown>(undefined);
const uiUseV6 = ref<unknown>(undefined);

const v6ShellTagColor = computed(() => {
  if (uiUseV6.value === true) {
    return "blue";
  }
  if (uiUseV6.value === false) {
    return "default";
  }
  return "default";
});

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return;
    }
    // Lazily refresh the LLM status + read 3 config flags every time
    // the panel opens — config can change between opens (user edited
    // SystemSettings then came back).
    if (!aiChatStore.hasLoaded) {
      aiChatStore.loadAll();
    }
    statusLoading.value = true;
    try {
      const all = (await api()?.invoke("config:get-all")) as
        | Record<string, unknown>
        | null
        | undefined;
      const general = (all?.general ?? {}) as Record<string, unknown>;
      const ui = (all?.ui ?? {}) as Record<string, unknown>;
      generalTheme.value = general.theme;
      generalLanguage.value = general.language;
      uiUseV6.value = ui.useV6ShellByDefault;
    } catch {
      // Falls through; tags render as 未设置
    } finally {
      statusLoading.value = false;
    }
  },
);

const categories: SettingsCategory[] = [
  {
    id: "general",
    label: "通用偏好",
    desc: "语言 / 主题 / V6 shell 默认开关 / 启动行为",
    icon: AppstoreOutlined,
  },
  {
    id: "llm",
    label: "LLM 配置",
    desc: "Ollama / OpenAI / Anthropic / Volcengine / DeepSeek / Zhipu / Dashscope 七 provider",
    icon: ApiOutlined,
    tag: "高频",
    tagColor: "blue",
  },
  {
    id: "database",
    label: "数据库与备份",
    desc: "SQLCipher 加密库迁移、自动备份、备份恢复",
    icon: DatabaseOutlined,
    tag: "桌面",
    tagColor: "purple",
  },
  {
    id: "project",
    label: "项目存储",
    desc: "项目根目录、配额、自动同步频率",
    icon: FolderOutlined,
  },
  {
    id: "p2p",
    label: "P2P 网络",
    desc: "传输层 / WebRTC / NAT / Circuit Relay / TURN / 网络诊断",
    icon: WifiOutlined,
  },
  {
    id: "speech",
    label: "语音识别",
    desc: "Web Speech / Whisper API / Whisper Local / 音频处理",
    icon: AudioOutlined,
  },
  {
    id: "performance",
    label: "性能参数",
    desc: "硬件加速 / GPU 光栅化 / 最大内存 / 缓存大小",
    icon: ThunderboltOutlined,
  },
];

const actions: SettingsAction[] = [
  {
    id: "open-full",
    label: "打开完整 SystemSettings",
    desc: "进入 /settings/system 浏览全部 17 个分区。",
    cta: "前往",
    primary: true,
  },
  {
    id: "v6-shell",
    label: "切换 V6 Shell 默认",
    desc: "设置 ui.useV6ShellByDefault 控制启动后默认是否进入 V6 shell。",
    cta: "前往",
    tab: "general",
  },
  {
    id: "advanced",
    label: "高级配置",
    desc: "导出 / 导入 config.json、重置默认配置、诊断（在 V5 advanced tab）。",
    cta: "前往",
    tab: "advanced",
  },
  {
    id: "reset",
    label: "恢复默认配置",
    desc: "把所有配置项恢复为出厂默认值（不影响数据库与项目文件）。",
    cta: "前往",
    tab: "advanced",
  },
];

function navigateToTab(tab?: string): void {
  emit("update:open", false);
  router.push(buildSettingsRoute(tab));
}

function onCategoryClick(cat: SettingsCategory): void {
  navigateToTab(cat.id);
}

function run(action: SettingsAction): void {
  if (action.id === "open-full") {
    navigateToTab();
    return;
  }
  if (action.tab) {
    navigateToTab(action.tab);
    return;
  }
  antMessage.info(`${action.label}：请在 /settings/system 完成该操作`);
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

.status-summary {
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  gap: 8px;
}

.status-label {
  color: var(--cc-shell-muted, #595959);
}

.categories-summary {
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

.category-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.category-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-top: 1px dashed var(--cc-shell-border, #eee);
  cursor: pointer;
  transition: background 0.15s;
}

.category-row:hover {
  background: var(--cc-shell-hover, #f5f5f5);
}

.category-row:first-child {
  border-top: none;
  padding-top: 4px;
}

.category-icon {
  font-size: 16px;
  color: var(--cc-primary, #1677ff);
  flex-shrink: 0;
}

.category-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.category-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.category-desc {
  font-size: 11px;
  color: var(--cc-shell-muted, #595959);
  line-height: 1.5;
}

.category-arrow {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
  flex-shrink: 0;
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
</style>
