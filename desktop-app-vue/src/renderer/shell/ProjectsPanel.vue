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
    </p>

    <div class="projects-summary">
      <div class="summary-header">
        <span class="summary-label">项目列表</span>
        <a-tag v-if="store.hasLoaded" color="cyan">
          {{ store.filteredProjects.length }} / {{ store.total }}
        </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          刷新
        </a-button>
      </div>

      <a-input
        v-model:value="store.searchQuery"
        placeholder="按名称或描述搜索…"
        size="small"
        allow-clear
        class="project-search"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>

      <ul v-if="store.filteredProjects.length" class="project-list">
        <li v-for="p in store.filteredProjects" :key="p.id" class="project-row">
          <div class="project-icon">
            <component :is="iconForType(p.project_type)" />
          </div>
          <div class="project-meta">
            <div class="project-line-1">
              <span class="project-name" :title="p.name">
                {{ p.name ?? "(未命名)" }}
              </span>
              <a-tag v-if="p.project_type" :color="typeColor(p.project_type)">
                {{ typeLabel(p.project_type) }}
              </a-tag>
              <a-tag
                v-if="p.status && p.status !== 'active'"
                :color="statusColor(p.status)"
              >
                {{ statusLabel(p.status) }}
              </a-tag>
            </div>
            <div class="project-line-2">
              <span v-if="p.updated_at" class="muted">
                {{ formatRelative(p.updated_at) }}
              </span>
              <span v-if="p.description" class="project-desc">
                · {{ p.description }}
              </span>
            </div>
          </div>
          <div class="project-actions">
            <a-button size="small" type="link" @click="onOpenProject(p)">
              打开
            </a-button>
            <a-dropdown :trigger="['click']">
              <a-button
                size="small"
                type="link"
                :loading="
                  store.deletingId === p.id ||
                  store.renamingProject?.id === p.id
                "
              >
                <MoreOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="(e) => onMenuClick(e.key, p)">
                  <a-menu-item key="details">
                    <InfoCircleOutlined /> 详情
                  </a-menu-item>
                  <a-menu-item key="rename">
                    <EditOutlined /> 重命名
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="delete" danger>
                    <DeleteOutlined /> 删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded && store.searchQuery" class="empty-hint">
        没有匹配 "{{ store.searchQuery }}" 的项目。
      </div>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无项目，点击下方"创建项目"开始。
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

  <CreateProjectWizard />
  <RenameProjectModal />
  <ProjectDetailDrawer />
</template>

<script setup lang="ts">
import { watch } from "vue";
import { useRouter } from "vue-router";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  AppstoreOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  ProjectOutlined,
  SearchOutlined,
} from "@ant-design/icons-vue";
import {
  useProjectsQuickStore,
  type ProjectSummary,
} from "../stores/projectsQuick";
import CreateProjectWizard from "./projects/CreateProjectWizard.vue";
import RenameProjectModal from "./projects/RenameProjectModal.vue";
import ProjectDetailDrawer from "./projects/ProjectDetailDrawer.vue";

interface ProjectAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const store = useProjectsQuickStore();
const router = useRouter();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadAll();
    }
  },
);

const actions: ProjectAction[] = [
  {
    id: "create",
    label: "快速新建项目",
    desc: "通过名称 + 描述快速创建一个项目，自动落到默认用户。",
    cta: "开始",
    primary: true,
  },
  {
    id: "ai-create",
    label: "AI 自定义新建",
    desc: "通过对话方式创建项目（V5 主入口，留待后续 AI 对话主页 port）。",
    cta: "前往",
  },
];

const TYPE_ICONS: Record<string, typeof FileTextOutlined> = {
  web: GlobalOutlined,
  document: FileTextOutlined,
  data: DatabaseOutlined,
  app: AppstoreOutlined,
};
function iconForType(type?: string) {
  return type && TYPE_ICONS[type] ? TYPE_ICONS[type] : FileTextOutlined;
}

const TYPE_COLORS: Record<string, string> = {
  web: "blue",
  document: "gold",
  data: "purple",
  app: "geekblue",
};
const TYPE_LABELS: Record<string, string> = {
  web: "Web",
  document: "文档",
  data: "数据",
  app: "应用",
};
function typeColor(type?: string): string {
  if (!type) {
    return "default";
  }
  return TYPE_COLORS[type] || "default";
}
function typeLabel(type?: string): string {
  if (!type) {
    return "—";
  }
  return TYPE_LABELS[type] || type;
}

const STATUS_COLORS: Record<string, string> = {
  active: "green",
  completed: "blue",
  archived: "default",
};
const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  completed: "已完成",
  archived: "已归档",
};
function statusColor(status?: string): string {
  if (!status) {
    return "default";
  }
  return STATUS_COLORS[status] || "default";
}
function statusLabel(status?: string): string {
  if (!status) {
    return "—";
  }
  return STATUS_LABELS[status] || status;
}

function formatRelative(timestamp: number | string | undefined): string {
  if (!timestamp) {
    return "";
  }
  const ms =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  if (diff < 604_800_000) {
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }
  return new Date(ms).toLocaleDateString("zh-CN");
}

function onOpenProject(p: ProjectSummary): void {
  emit("update:open", false);
  router.push(`/projects/${p.id}`);
}

function confirmDelete(p: ProjectSummary): void {
  Modal.confirm({
    title: "删除项目",
    content: `确定删除项目 "${p.name ?? p.id}"？此操作不可撤销，项目内的文件和对话历史会一并清除。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.deleteProject(p.id);
      if (ok) {
        antMessage.success(`已删除 "${p.name ?? "项目"}"`);
      }
    },
  });
}

function onMenuClick(key: string, p: ProjectSummary): void {
  if (key === "details") {
    store.openDetails(p.id);
  } else if (key === "rename") {
    store.openRenameForm(p);
  } else if (key === "delete") {
    confirmDelete(p);
  }
}

function run(action: ProjectAction): void {
  if (action.id === "create") {
    store.openCreateForm();
    return;
  }
  if (action.id === "ai-create") {
    emit("update:open", false);
    router.push("/projects");
    return;
  }
  antMessage.info(
    `${action.label}：当前在 /projects 完成，下一阶段将内嵌到此面板`,
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

.project-search {
  margin-bottom: 8px;
}

.project-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.project-row:first-child {
  border-top: none;
  padding-top: 0;
}

.project-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 6px;
  color: var(--cc-shell-muted, #595959);
  font-size: 16px;
}

.project-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.project-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.project-line-2 {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 12px;
  overflow: hidden;
}

.project-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.project-desc {
  color: var(--cc-shell-muted, #8c8c8c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}

.muted {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
}

.project-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
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
