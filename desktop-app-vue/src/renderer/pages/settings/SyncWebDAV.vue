<template>
  <div class="webdav-settings">
    <a-page-header
      title="WebDAV 网盘同步"
      sub-title="Nextcloud / 坚果云 / 群晖 等支持 WebDAV 协议的网盘"
    >
      <template #extra>
        <a-button @click="$router.push('/settings/sync')">
          <template #icon>
            <ArrowLeftOutlined />
          </template>
          返回同步设置
        </a-button>
      </template>
    </a-page-header>

    <a-alert
      type="info"
      show-icon
      class="hint-alert"
      message="当前为 push-only 模式：仅把本地知识库推送到 WebDAV，不读取远端编辑。
      远端被手动改动的文件会被检测到（ETag 不匹配）并跳过，不覆盖。
      附件 / 图片不上传 — 计划在后续版本支持。"
    />

    <!-- 配置表单 -->
    <a-card class="config-card" title="连接配置" size="small">
      <a-form
        :model="form"
        layout="vertical"
        :disabled="saving || running || testing"
        autocomplete="off"
      >
        <a-form-item
          label="服务器 URL"
          required
          :validate-status="urlError ? 'error' : ''"
          :help="urlError"
        >
          <a-input
            v-model:value="form.url"
            placeholder="https://nas.example.com/dav 或 https://dav.jianguoyun.com/dav"
            allow-clear
          />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="用户名">
              <a-input
                v-model:value="form.username"
                placeholder="user@example.com"
                allow-clear
              />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item
              label="密码"
              :help="passwordPlaceholderHint || undefined"
            >
              <a-input-password
                v-model:value="form.password"
                :placeholder="passwordPlaceholder"
                autocomplete="new-password"
              />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="远端路径">
          <a-input
            v-model:value="form.remotePath"
            placeholder="/chainlesschain"
            allow-clear
          />
        </a-form-item>
        <a-space>
          <a-button
            type="primary"
            :loading="saving"
            :disabled="!canSave"
            @click="onSave"
          >
            保存
          </a-button>
          <a-button :loading="testing" :disabled="!canTest" @click="onTest">
            测试连接
          </a-button>
          <a-popconfirm
            v-if="configured"
            title="确定要清除 WebDAV 凭证吗？已推送到远端的文件不会被删除。"
            ok-text="清除"
            cancel-text="取消"
            @confirm="onClear"
          >
            <a-button danger> 断开连接 </a-button>
          </a-popconfirm>
        </a-space>
      </a-form>
    </a-card>

    <!-- 状态卡 -->
    <a-card class="status-card" title="同步状态" size="small">
      <a-descriptions v-if="status" :column="2" size="small" bordered>
        <a-descriptions-item label="上次同步">
          <span v-if="status.lastSyncAt">
            {{ formatTime(status.lastSyncAt) }}
          </span>
          <span v-else class="muted">未同步过</span>
        </a-descriptions-item>
        <a-descriptions-item label="耗时">
          <span v-if="status.lastRunDurationMs != null">
            {{ status.lastRunDurationMs }} ms
          </span>
          <span v-else class="muted">—</span>
        </a-descriptions-item>
        <a-descriptions-item label="最近状态">
          <a-tag
            v-if="status.lastRunStatus"
            :color="statusColor(status.lastRunStatus)"
          >
            {{ statusLabel(status.lastRunStatus) }}
          </a-tag>
          <span v-else class="muted">—</span>
        </a-descriptions-item>
        <a-descriptions-item label="待办 tombstones">
          <a-tag v-if="status.pendingTombstones" color="orange">
            有未完成删除
          </a-tag>
          <span v-else class="muted">无</span>
        </a-descriptions-item>
        <a-descriptions-item label="累积推送" :span="2">
          <a-space size="middle">
            <span
              >已推送 <b>{{ status.itemsPushed }}</b></span
            >
            <span
              >已跳过 <b>{{ status.itemsSkipped }}</b></span
            >
            <span
              >已删除 <b>{{ status.itemsDeleted }}</b></span
            >
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item v-if="status.lastRunError" label="错误" :span="2">
          <span class="error-text">{{ status.lastRunError }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <a-empty v-else description="尚未配置或尚未同步" />

      <!-- 实时进度 -->
      <a-alert
        v-if="liveProgress"
        class="progress-alert"
        type="info"
        show-icon
        :message="`同步中：已推送 ${liveProgress.pushed}/${liveProgress.totalPending} · 跳过 ${liveProgress.skipped} · 删除 ${liveProgress.deleted}`"
      />

      <a-divider />

      <a-space>
        <a-button
          type="primary"
          :loading="running"
          :disabled="!configured"
          @click="onRunNow"
        >
          <template #icon>
            <SyncOutlined />
          </template>
          立即同步
        </a-button>
      </a-space>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { message } from "ant-design-vue";
import { ArrowLeftOutlined, SyncOutlined } from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";

interface ConfigForm {
  url: string;
  username: string;
  password: string;
  remotePath: string;
}

interface Status {
  lastSyncAt: number | null;
  lastRunStatus: "success" | "conflict" | "failed" | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  itemsPushed: number;
  itemsSkipped: number;
  itemsDeleted: number;
  pendingTombstones: boolean;
}

interface ProgressEvent {
  phase: string;
  pushed: number;
  skipped: number;
  deleted: number;
  totalPending: number;
}

const form = reactive<ConfigForm>({
  url: "",
  username: "",
  password: "",
  remotePath: "/chainlesschain",
});
const configured = ref(false);
const maskedPasswordPlaceholder = ref(""); // sanitized 视图给的 mask 字符串
const status = ref<Status | null>(null);
const saving = ref(false);
const testing = ref(false);
const running = ref(false);
const liveProgress = ref<ProgressEvent | null>(null);

let unsubscribeProgress: (() => void) | null = null;

const api = computed(
  () => (window as any).electronAPI?.sync?.webdav as any | undefined,
);

const urlError = computed(() => {
  if (!form.url) {
    return "";
  }
  if (!/^https?:\/\//.test(form.url)) {
    return "URL 必须以 http:// 或 https:// 开头";
  }
  return "";
});

const passwordPlaceholder = computed(() =>
  configured.value
    ? maskedPasswordPlaceholder.value || "（已保存，留空保持不变）"
    : "请输入密码",
);

const passwordPlaceholderHint = computed(() =>
  configured.value && !form.password ? "留空则沿用已保存的密码" : "",
);

const canSave = computed(() => {
  if (!form.url || urlError.value) {
    return false;
  }
  if (!configured.value && !form.password) {
    return false;
  }
  return true;
});

const canTest = computed(() => canSave.value || configured.value);

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function statusColor(s: string): string {
  return s === "success" ? "green" : s === "conflict" ? "orange" : "red";
}

function statusLabel(s: string): string {
  if (s === "success") {
    return "成功";
  }
  if (s === "conflict") {
    return "有冲突跳过";
  }
  if (s === "failed") {
    return "失败";
  }
  return s;
}

async function loadConfig() {
  if (!api.value) {
    return;
  }
  try {
    const res = await api.value.configGet();
    if (!res?.success) {
      message.error(`读取配置失败：${res?.error || "未知错误"}`);
      return;
    }
    const d = res.data;
    form.url = d.url || "";
    form.username = d.username || "";
    form.remotePath = d.remotePath || "/chainlesschain";
    form.password = ""; // 不回填 mask 后的值
    configured.value = !!d.configured;
    maskedPasswordPlaceholder.value = d.password || "";
    status.value = d.status || null;
  } catch (err: any) {
    logger.error("[SyncWebDAV] loadConfig:", err);
    message.error(err?.message || String(err));
  }
}

async function onSave() {
  if (!api.value) {
    return;
  }
  saving.value = true;
  try {
    const res = await api.value.configSet({
      url: form.url.trim(),
      username: form.username,
      password: form.password, // 留空 → 主进程保留旧值
      remotePath: form.remotePath || "/",
    });
    if (res?.success) {
      message.success("WebDAV 配置已保存");
      form.password = "";
      await loadConfig();
    } else {
      message.error(`保存失败：${res?.error || "未知错误"}`);
    }
  } finally {
    saving.value = false;
  }
}

async function onTest() {
  if (!api.value) {
    return;
  }
  testing.value = true;
  try {
    // 如果用户改了表单还没保存，先存再测（用户友好）
    if (form.url && form.password && !configured.value) {
      await onSave();
    }
    const res = await api.value.test();
    if (res?.success) {
      message.success("WebDAV 连接成功");
    } else {
      message.error(`连接失败：${res?.error || "未知错误"}`);
    }
  } finally {
    testing.value = false;
  }
}

async function onClear() {
  if (!api.value) {
    return;
  }
  try {
    const res = await api.value.configClear();
    if (res?.success) {
      message.success("已清除 WebDAV 凭证");
      form.url = "";
      form.username = "";
      form.password = "";
      form.remotePath = "/chainlesschain";
      configured.value = false;
      maskedPasswordPlaceholder.value = "";
    } else {
      message.error(`清除失败：${res?.error || "未知错误"}`);
    }
  } catch (err: any) {
    message.error(err?.message || String(err));
  }
}

async function onRunNow() {
  if (!api.value) {
    return;
  }
  running.value = true;
  liveProgress.value = null;
  try {
    const res = await api.value.run();
    if (res?.success) {
      const detail = `推送 ${res.pushed} / 跳过 ${res.skipped} / 删除 ${res.deleted}`;
      if (res.status === "conflict") {
        message.warning(`同步完成（有跳过）：${detail}`);
      } else {
        message.success(`同步完成：${detail}`);
      }
    } else {
      message.error(`同步失败：${res?.error || "未知错误"}`);
    }
    await loadConfig();
  } finally {
    running.value = false;
    liveProgress.value = null;
  }
}

onMounted(() => {
  loadConfig();
  if (api.value?.onProgress) {
    unsubscribeProgress = api.value.onProgress((e: ProgressEvent) => {
      liveProgress.value = e;
    });
  }
});

onBeforeUnmount(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
});
</script>

<style scoped>
.webdav-settings {
  padding: 16px 24px;
  max-width: 1080px;
  margin: 0 auto;
}
.hint-alert,
.config-card,
.status-card {
  margin-top: 16px;
}
.muted {
  color: var(--cc-text-secondary, #999);
}
.error-text {
  color: var(--ant-error-color, #ff4d4f);
  word-break: break-all;
}
.progress-alert {
  margin-top: 12px;
}
</style>
