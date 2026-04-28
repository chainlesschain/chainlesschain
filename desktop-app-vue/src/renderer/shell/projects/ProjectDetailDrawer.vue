<template>
  <a-drawer
    :open="store.viewingProjectId !== null"
    :width="720"
    :mask-closable="true"
    :body-style="{ paddingBottom: '64px' }"
    :title="drawerTitle"
    placement="right"
    @close="store.closeDetails()"
  >
    <a-spin :spinning="store.detailsLoading">
      <div v-if="project" class="details-body">
        <!-- Header actions -->
        <div class="header-actions">
          <a-button type="primary" @click="onOpenWorkspace">
            <FolderOpenOutlined /> 打开完整工作区
          </a-button>
          <span class="muted hint-text">
            完整文件树 / AI 对话 / 编辑预览仍在
            <code>/projects/{{ shortId(project.id) }}</code>
          </span>
        </div>

        <a-descriptions bordered :column="1" size="small">
          <a-descriptions-item label="项目名称">
            {{ project.name ?? "(未命名)" }}
          </a-descriptions-item>

          <a-descriptions-item label="项目 ID">
            <a-typography-paragraph
              :copyable="{ text: String(project.id) }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ project.id }}</code>
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="类型">
            <a-tag
              v-if="project.project_type"
              :color="typeColor(project.project_type)"
            >
              {{ typeLabel(project.project_type) }}
            </a-tag>
            <span v-else class="muted">—</span>
          </a-descriptions-item>

          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(project.status)">
              {{ statusLabel(project.status) }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item label="描述">
            {{ project.description || "—" }}
          </a-descriptions-item>

          <a-descriptions-item label="文件数">
            {{ store.viewingFiles.length }}
            <span v-if="store.detailsFilesLoading" class="muted"
              >(加载中…)</span
            >
          </a-descriptions-item>

          <a-descriptions-item label="创建时间">
            {{ formatTime(project.created_at) }}
          </a-descriptions-item>

          <a-descriptions-item label="最近更新">
            {{ formatTime(project.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="store.detailsError"
          class="details-error"
          :message="store.detailsError"
          type="error"
          show-icon
          closable
          @close="store.clearDetailsError()"
        />

        <a-divider>项目文件</a-divider>

        <a-spin :spinning="store.detailsFilesLoading">
          <div
            v-if="!store.detailsFilesLoading && store.viewingFiles.length === 0"
            class="muted empty-files"
          >
            暂无文件，前往完整工作区添加。
          </div>
          <ul v-else class="file-list">
            <li
              v-for="(group, type) in groupedFiles"
              :key="type"
              class="file-group"
            >
              <div class="file-group-header">
                <FileOutlined />
                <span class="file-group-name">{{ type || "其它" }}</span>
                <a-tag color="default">
                  {{ group.length }}
                </a-tag>
              </div>
              <ul class="file-group-items">
                <li v-for="f in group" :key="f.id" class="file-item">
                  <span class="file-name" :title="f.file_name">
                    {{ f.file_name ?? "(未命名)" }}
                  </span>
                  <span v-if="f.size" class="muted file-size">
                    {{ formatFileSize(f.size) }}
                  </span>
                  <span v-if="f.updated_at" class="muted file-time">
                    {{ formatRelativeTime(f.updated_at) }}
                  </span>
                </li>
              </ul>
            </li>
          </ul>
        </a-spin>

        <a-divider>操作</a-divider>

        <a-space wrap>
          <a-button @click="onRename"> <EditOutlined /> 重命名 </a-button>
          <a-button danger @click="onDelete">
            <DeleteOutlined /> 删除项目
          </a-button>
        </a-space>
      </div>
    </a-spin>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons-vue";
import {
  useProjectsQuickStore,
  type ProjectFile,
  type ProjectSummary,
} from "../../stores/projectsQuick";

const store = useProjectsQuickStore();
const router = useRouter();

const project = computed<ProjectSummary | null>(() => store.viewingProject);

const drawerTitle = computed(() => {
  const name = project.value?.name;
  return typeof name === "string" && name ? `${name} · 项目详情` : "项目详情";
});

const groupedFiles = computed<Record<string, ProjectFile[]>>(() => {
  const groups: Record<string, ProjectFile[]> = {};
  for (const f of store.viewingFiles) {
    const key =
      typeof f.file_type === "string" && f.file_type ? f.file_type : "其它";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(f);
  }
  // sort files within each group by updated_at desc
  for (const key of Object.keys(groups)) {
    groups[key].sort(
      (a, b) =>
        (typeof b.updated_at === "number" ? b.updated_at : 0) -
        (typeof a.updated_at === "number" ? a.updated_at : 0),
    );
  }
  return groups;
});

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

function shortId(id?: string): string {
  if (!id) {
    return "—";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatTime(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleString("zh-CN");
}

function formatRelativeTime(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const ms =
    typeof value === "number" ? value : new Date(value as string).getTime();
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

function formatFileSize(bytes: number): string {
  if (!bytes) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function onOpenWorkspace(): void {
  if (!project.value?.id) {
    return;
  }
  store.closeDetails();
  router.push(`/projects/${project.value.id}`);
}

function onRename(): void {
  if (!project.value) {
    return;
  }
  store.openRenameForm(project.value);
}

function onDelete(): void {
  if (!project.value) {
    return;
  }
  const p = project.value;
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
        store.closeDetails();
      }
    },
  });
}
</script>

<style scoped>
.details-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px 0;
}

.hint-text {
  font-size: 12px;
}

.hint-text code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 11px;
}

.muted {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
}

.details-error {
  margin: 0;
}

.empty-files {
  text-align: center;
  padding: 16px 0;
}

.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-group {
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 6px;
  padding: 8px 12px;
}

.file-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.file-group-name {
  font-weight: 500;
}

.file-group-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  border-top: 1px dashed var(--cc-shell-border, #f0f0f0);
}

.file-item:first-child {
  border-top: none;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cc-shell-text, #1f1f1f);
}

.file-size,
.file-time {
  flex-shrink: 0;
  font-size: 11px;
}
</style>
