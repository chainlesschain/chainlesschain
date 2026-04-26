<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="项目"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ProjectOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      个人项目工作区。每个项目包含独立的文件结构、AI 对话历史、笔记与协作配置。
      下方显示最近 5 个项目（完整列表与详情请访问 <code>/projects</code>）。
    </p>

    <div class="projects-summary">
      <div class="summary-header">
        <span class="summary-label">最近项目</span>
        <a-tag v-if="store.hasLoaded" color="cyan">
          {{ store.recent.length }} / {{ store.total }}
        </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadRecent()"
        >
          刷新
        </a-button>
      </div>
      <ul v-if="store.recent.length" class="project-list">
        <li v-for="p in store.recent" :key="p.id" class="project-row">
          <div class="project-meta">
            <span class="project-name">{{ p.name ?? "(未命名)" }}</span>
            <span class="project-id">{{ shortId(p.id) }}</span>
          </div>
          <a-tag v-if="p.type" :color="typeColor(p.type)">
            {{ p.type }}
          </a-tag>
          <a-tag v-if="p.status" :color="statusColor(p.status)">
            {{ p.status }}
          </a-tag>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无项目，前往 <code>/projects</code> 创建第一个项目。
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
import { ProjectOutlined } from "@ant-design/icons-vue";
import { useProjectsQuickStore } from "../stores/projectsQuick";

interface ProjectAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useProjectsQuickStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadRecent();
    }
  },
);

const actions: ProjectAction[] = [
  {
    id: "create",
    label: "创建项目",
    desc: "新建项目（支持 web / document / data / app 多种类型）。",
    cta: "前往",
    primary: true,
  },
  {
    id: "import",
    label: "导入现有目录",
    desc: "把本地目录导入为项目（保留原始文件结构与 git 历史）。",
    cta: "前往",
  },
  {
    id: "templates",
    label: "项目模板",
    desc: "从模板快速生成项目（含示例文件、AI 提示词、协作配置）。",
    cta: "前往",
  },
  {
    id: "archived",
    label: "归档项目",
    desc: "查看已归档的项目并可选择恢复或永久删除。",
    cta: "前往",
  },
];

function shortId(id?: string): string {
  if (!id) {
    return "—";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const TYPE_COLORS: Record<string, string> = {
  web: "blue",
  document: "gold",
  data: "purple",
  app: "geekblue",
};
function typeColor(type?: string): string {
  if (!type) {
    return "default";
  }
  return TYPE_COLORS[type] || "default";
}

const STATUS_COLORS: Record<string, string> = {
  active: "green",
  completed: "blue",
  archived: "default",
};
function statusColor(status?: string): string {
  if (!status) {
    return "default";
  }
  return STATUS_COLORS[status] || "default";
}

function run(action: ProjectAction): void {
  antMessage.info(
    `${action.label}：请在 /projects 完成该操作（快速面板仅展示概览）`,
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

.projects-summary {
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

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.project-row:first-child {
  border-top: none;
  padding-top: 0;
}

.project-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.project-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.project-id {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.empty-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.empty-hint code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
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
