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
      系统级配置入口。SystemSettings 包含 7 个分区，分别管理 LLM
      提供商、本地数据库与备份、项目存储、P2P
      网络、语音识别、性能参数与通用偏好。 下方按高频度列出，完整设置请访问
      <code>/settings</code>。
    </p>

    <div class="categories-summary">
      <div class="summary-header">
        <span class="summary-label">设置分区</span>
        <a-tag color="blue"> 7 </a-tag>
      </div>
      <ul class="category-list">
        <li v-for="cat in categories" :key="cat.id" class="category-row">
          <component :is="cat.icon" class="category-icon" />
          <div class="category-meta">
            <span class="category-name">{{ cat.label }}</span>
            <span class="category-desc">{{ cat.desc }}</span>
          </div>
          <a-tag v-if="cat.tag" :color="cat.tagColor">
            {{ cat.tag }}
          </a-tag>
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
} from "@ant-design/icons-vue";
import type { Component } from "vue";

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
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

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
    desc: "Ollama / OpenAI / Anthropic / Volcengine / DeepSeek / Zhipu / Dashscope 七 provider 切换与参数",
    icon: ApiOutlined,
    tag: "高频",
    tagColor: "blue",
  },
  {
    id: "database",
    label: "数据库与备份",
    desc: "SQLCipher 加密库迁移、自动备份、备份恢复（桌面端文件 I/O）",
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
    desc: "Web Speech / Whisper API / Whisper Local / 音频处理 / 知识联动",
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
    desc: "进入 /settings 浏览全部 7 个分区，编辑任意配置项。",
    cta: "前往",
    primary: true,
  },
  {
    id: "v6-shell",
    label: "切换 V6 Shell 默认",
    desc: "设置 ui.useV6ShellByDefault 控制启动后默认是否进入 V6 shell。",
    cta: "前往",
  },
  {
    id: "config-edit",
    label: "编辑 config.json",
    desc: "在默认编辑器中直接打开 .chainlesschain/config.json（高级用户）。",
    cta: "前往",
  },
  {
    id: "reset",
    label: "恢复默认配置",
    desc: "把所有配置项恢复为出厂默认值（不影响数据库与项目文件）。",
    cta: "前往",
  },
];

function run(action: SettingsAction): void {
  antMessage.info(
    `${action.label}：请在 /settings 完成该操作（快速面板仅展示概览）`,
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
  padding: 8px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.category-row:first-child {
  border-top: none;
  padding-top: 0;
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
