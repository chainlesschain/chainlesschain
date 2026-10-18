<template>
  <section aria-label="任务附件" class="board-attachments">
    <div class="attachment-actions">
      <h4>附件</h4>
      <a-button data-action="refresh" :disabled="busy" @click="load"
        >刷新</a-button
      >
      <a-button
        data-action="upload"
        :loading="busy"
        :disabled="!authenticated"
        @click="upload"
        >选择文件上传</a-button
      >
    </div>
    <small>每个文件不超过 8 MiB；文本可预览，其他文件需下载。</small>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!attachments.length && !busy">暂无附件</p>
    <ul>
      <li
        v-for="item in attachments"
        :key="item.id"
        :data-attachment-id="item.id"
      >
        <span>{{ item.fileName }}（{{ item.fileSize }} 字节）</span>
        <a-button
          data-action="preview"
          :disabled="busy"
          @click="preview(item.id)"
          >预览</a-button
        >
        <a-button
          data-action="download"
          :disabled="busy"
          @click="download(item.id)"
          >下载</a-button
        >
        <a-button
          data-action="delete"
          danger
          :disabled="busy"
          @click="remove(item.id)"
          >删除</a-button
        >
      </li>
    </ul>
    <pre v-if="previewText !== null" data-preview="text">{{ previewText }}</pre>
    <p v-if="downloadOnly">此文件不提供内嵌预览，请使用下载按钮。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAppStore } from "../../stores/app";
import { useIdentityStore } from "../../stores/identity";

interface AttachmentSummary {
  id: string;
  taskId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderDid: string;
  createdAt: number;
}
const props = defineProps<{ taskId: string }>();
const app = useAppStore();
const identity = useIdentityStore();
const authenticated = computed(() => app.isAuthenticated);
const attachments = ref<AttachmentSummary[]>([]);
const busy = ref(false);
const error = ref("");
const previewText = ref<string | null>(null);
const downloadOnly = ref(false);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const api = () => (window as any).electronAPI?.task;
let epoch = 0;
let downloadUrl: string | null = null;
let revokeTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;

function clearPreview() {
  previewText.value = null;
  downloadOnly.value = false;
  if (revokeTimer) clearTimeout(revokeTimer);
  revokeTimer = undefined;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
}
function invalidate() {
  epoch++;
  attachments.value = [];
  busy.value = false;
  error.value = "";
  clearPreview();
}
let authentication = app.isAuthenticated,
  deviceId = app.deviceId;
app.$subscribe(
  (_mutation, state) => {
    if (
      state.isAuthenticated !== authentication ||
      state.deviceId !== deviceId
    ) {
      authentication = state.isAuthenticated;
      deviceId = state.deviceId;
      invalidate();
    }
  },
  { flush: "sync" },
);
watch(
  () => [
    identity.primaryDID,
    identity.currentContext,
    identity.currentIdentity.localDB,
  ],
  invalidate,
  { flush: "sync" },
);
watch(
  () => props.taskId,
  () => {
    invalidate();
    void load();
  },
  { flush: "sync" },
);

const current = (stamp: number, taskId: string) =>
  stamp === epoch && app.isAuthenticated && props.taskId === taskId;
function begin() {
  clearPreview();
  error.value = "";
  busy.value = true;
  return ++epoch;
}
function failed(stamp: number, taskId: string, failure?: any) {
  if (!current(stamp, taskId)) return;
  invalidate();
  error.value =
    failure?.code === "BOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED" ||
    (typeof failure?.message === "string" &&
      /\bBOARD_ATTACHMENT_DURABLE_SQLITE_REQUIRED\b/u.test(failure.message))
      ? "当前存储模式不支持附件操作"
      : "附件暂不可访问，请刷新并检查当前权限。";
}
function summary(row: any, taskId: string): AttachmentSummary {
  if (
    !row ||
    typeof row.id !== "string" ||
    !row.id ||
    row.taskId !== taskId ||
    typeof row.fileName !== "string" ||
    !row.fileName ||
    row.fileName.length > 1024 ||
    !Number.isSafeInteger(row.fileSize) ||
    row.fileSize < 0 ||
    row.fileSize > MAX_FILE_BYTES ||
    typeof row.mimeType !== "string" ||
    typeof row.uploaderDid !== "string" ||
    !Number.isSafeInteger(row.createdAt)
  )
    throw new Error("ATTACHMENT_INVALID_RESPONSE");
  return {
    id: row.id,
    taskId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploaderDid: row.uploaderDid,
    createdAt: row.createdAt,
  };
}
async function load() {
  if (!app.isAuthenticated || !props.taskId) {
    invalidate();
    return;
  }
  const taskId = props.taskId,
    stamp = begin();
  attachments.value = [];
  try {
    const result = await api()?.getAttachments({ taskId });
    if (!current(stamp, taskId)) return;
    if (result?.success === false) throw result;
    if (
      result?.success !== true ||
      !Array.isArray(result.attachments) ||
      result.attachments.length > 64
    )
      throw new Error("ATTACHMENT_READ_FAILED");
    attachments.value = result.attachments.map((row: any) =>
      summary(row, taskId),
    );
  } catch (failure) {
    failed(stamp, taskId, failure);
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
async function upload() {
  if (!app.isAuthenticated || busy.value) return;
  const taskId = props.taskId,
    stamp = begin();
  try {
    const result = await api()?.uploadAttachment({ taskId });
    if (!current(stamp, taskId)) return;
    if (result?.success === false && result.cancelled === true) return;
    if (result?.success !== true) throw result;
    await load();
  } catch (failure) {
    failed(stamp, taskId, failure);
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
async function remove(attachmentId: string) {
  if (!app.isAuthenticated || busy.value) return;
  const taskId = props.taskId,
    stamp = begin();
  try {
    const result = await api()?.deleteAttachment({ attachmentId });
    if (!current(stamp, taskId)) return;
    if (result?.success !== true) throw result;
    await load();
  } catch (failure) {
    failed(stamp, taskId, failure);
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
function downloadName(name: string) {
  return (
    name
      .replace(
        /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
        "_",
      )
      .replace(/^\.+/, "")
      .slice(0, 200) || "attachment.bin"
  );
}
async function read(attachmentId: string, shouldDownload: boolean) {
  if (!app.isAuthenticated || busy.value) return;
  const taskId = props.taskId,
    stamp = begin();
  try {
    // Every preview/download requests a new source-authorized snapshot.
    const result = await api()?.previewAttachment({ attachmentId });
    if (!current(stamp, taskId)) return;
    if (result?.success !== true) throw result;
    const item = summary(result.attachment, taskId);
    if (
      item.id !== attachmentId ||
      !["text", "download"].includes(result.preview?.kind)
    )
      throw new Error("ATTACHMENT_INVALID_PREVIEW");
    if (!shouldDownload) {
      if (result.preview.kind === "text") {
        if (
          typeof result.preview.text !== "string" ||
          new TextEncoder().encode(result.preview.text).byteLength >
            MAX_TEXT_BYTES
        )
          throw new Error("ATTACHMENT_INVALID_TEXT");
        previewText.value = result.preview.text;
      } else downloadOnly.value = true;
      return;
    }
    const encoded = result.preview.base64;
    if (
      typeof encoded !== "string" ||
      encoded.length > 4 * Math.ceil(MAX_FILE_BYTES / 3)
    )
      throw new Error("ATTACHMENT_INVALID_BYTES");
    const decoded = atob(encoded);
    if (decoded.length !== item.fileSize || decoded.length > MAX_FILE_BYTES)
      throw new Error("ATTACHMENT_INVALID_SIZE");
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = downloadName(item.fileName);
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
    revokeTimer = setTimeout(clearPreview, 1000);
  } catch (failure) {
    failed(stamp, taskId, failure);
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
const preview = (id: string) => read(id, false);
const download = (id: string) => read(id, true);
onMounted(() => {
  unsubscribe = (window as any).electronAPI?.notification?.onInvalidated?.(
    invalidate,
  );
  void load();
});
onBeforeUnmount(() => {
  unsubscribe?.();
  invalidate();
});
</script>

<style scoped>
.attachment-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.attachment-actions h4 {
  margin: 0;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}
</style>
