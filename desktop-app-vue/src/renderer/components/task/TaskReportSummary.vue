<template>
  <section aria-label="报告 AI 摘要" class="report-summary">
    <p>仅使用本机 Ollama；发送前会显示系统确认窗口。</p>
    <div class="summary-actions">
      <a-button
        data-action="generate"
        :disabled="
          busy ||
          cancelling ||
          !app.isAuthenticated ||
          run?.status === 'prepared' ||
          run?.status === 'dispatched'
        "
        @click="generate"
      >
        {{ run?.status === "unknown" ? "重新确认并生成" : "生成本机 AI 摘要" }}
      </a-button>
      <a-button
        data-action="status"
        :disabled="busy || cancelling || !app.isAuthenticated"
        @click="load"
        >查询状态</a-button
      >
      <a-button
        v-if="cancellable"
        data-action="cancel"
        :disabled="cancelling"
        @click="cancel"
        >{{
          run?.status === "unknown" ? "结束本次等待" : "取消本次请求"
        }}</a-button
      >
    </div>
    <p v-if="busy" role="status">正在等待确认或处理结果…</p>
    <p v-if="run" data-summary-status>{{ statusText[run.status] }}</p>
    <p v-if="run?.status === 'unknown'">
      本次结果未知，系统不会自动重试。重新生成需要再次确认。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <pre v-if="summary !== null" data-summary-text>{{ summary }}</pre>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAppStore } from "../../stores/app";
import { useIdentityStore } from "../../stores/identity";

const props = defineProps<{ reportId: string }>();
const emit = defineEmits<{ updated: [] }>();
const app = useAppStore();
const identity = useIdentityStore();
const statusText = {
  prepared: "已准备，等待发送",
  dispatched: "已发送，等待结果",
  succeeded: "摘要已生成",
  cancelled: "请求已取消",
  stale: "报告或当前身份已变化，请刷新报告",
  failed: "生成失败",
  unknown: "结果未知",
} as const;
type Status = keyof typeof statusText;
interface SummaryRun {
  requestId: string;
  status: Status;
}
const run = ref<SummaryRun | null>(null);
const summary = ref<string | null>(null);
const error = ref("");
const busy = ref(false);
const cancelling = ref(false);
let epoch = 0;
const pendingId = ref<string | null>(null);
let unsubscribe: (() => void) | undefined;
const api = () => (window as any).electronAPI?.task;
const cancellable = computed(
  () =>
    app.isAuthenticated &&
    (pendingId.value !== null ||
      run.value?.status === "prepared" ||
      run.value?.status === "dispatched" ||
      run.value?.status === "unknown"),
);

function invalidate() {
  epoch++;
  run.value = null;
  summary.value = null;
  error.value = "";
  busy.value = false;
  cancelling.value = false;
  pendingId.value = null;
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
  () => props.reportId,
  () => {
    invalidate();
    void load();
  },
  { flush: "sync" },
);
const current = (stamp: number, reportId: string) =>
  stamp === epoch && app.isAuthenticated && props.reportId === reportId;

function failure(value: any) {
  const code =
    typeof value?.error === "string"
      ? value.error
      : value?.code ||
        (typeof value?.message === "string"
          ? value.message.match(/\bBOARD_SUMMARY_[A-Z_]+\b/u)?.[0]
          : undefined);
  if (
    typeof code === "string" &&
    /(?:LOCAL|PROVIDER|MODEL|UNSUPPORTED)/u.test(code)
  )
    return "当前模型配置不支持本机报告摘要，请检查 Ollama 设置。";
  if (typeof code === "string" && /(?:DURABLE|SQLITE|STORAGE)/u.test(code))
    return "当前存储模式不支持报告摘要。";
  return "报告摘要暂不可用，请刷新并检查当前权限。";
}
function accept(result: any, expectedRequestId?: string) {
  if (!result || typeof result.success !== "boolean")
    throw new Error("INVALID_RESPONSE");
  const item = result.run;
  if (
    item != null &&
    (typeof item.requestId !== "string" ||
      !item.requestId ||
      item.requestId.length > 128 ||
      !Object.hasOwn(statusText, item.status) ||
      item.provider !== "ollama" ||
      (expectedRequestId && item.requestId !== expectedRequestId))
  )
    throw new Error("INVALID_RUN");
  if (
    result.summary != null &&
    (!result.success ||
      typeof result.summary !== "string" ||
      new TextEncoder().encode(result.summary).byteLength > 16 * 1024)
  )
    throw new Error("INVALID_SUMMARY");
  run.value = item ? { requestId: item.requestId, status: item.status } : null;
  summary.value = result.summary ?? null;
  error.value = result.success ? "" : failure(result);
}
async function load() {
  if (!app.isAuthenticated || !props.reportId || busy.value || cancelling.value)
    return;
  const reportId = props.reportId,
    stamp = ++epoch;
  busy.value = true;
  run.value = null;
  summary.value = null;
  error.value = "";
  try {
    const result = await api()?.getSummaryStatus({ reportId });
    if (current(stamp, reportId)) accept(result);
  } catch (cause) {
    if (current(stamp, reportId)) {
      run.value = null;
      summary.value = null;
      error.value = failure(cause);
    }
  } finally {
    if (current(stamp, reportId)) busy.value = false;
  }
}
async function generate() {
  if (!app.isAuthenticated || busy.value || cancelling.value) return;
  const reportId = props.reportId,
    stamp = ++epoch;
  const requestId = crypto.randomUUID();
  pendingId.value = requestId;
  busy.value = true;
  error.value = "";
  summary.value = null;
  run.value = null;
  try {
    const result = await api()?.generateAISummary({ reportId, requestId });
    if (!current(stamp, reportId)) return;
    accept(result, requestId);
    if (result.success && result.run?.status === "succeeded") emit("updated");
  } catch (cause) {
    if (current(stamp, reportId)) {
      // A lost IPC response cannot prove whether the provider received input.
      run.value = { requestId, status: "unknown" };
      error.value = failure(cause);
    }
  } finally {
    if (current(stamp, reportId)) {
      busy.value = false;
      pendingId.value = null;
    }
  }
}
async function cancel() {
  const requestId = pendingId.value || run.value?.requestId;
  if (!app.isAuthenticated || !requestId || cancelling.value) return;
  const reportId = props.reportId,
    stamp = ++epoch;
  cancelling.value = true;
  busy.value = false;
  summary.value = null;
  error.value = "";
  try {
    const result = await api()?.cancelSummary({ reportId, requestId });
    if (current(stamp, reportId)) accept(result, requestId);
  } catch (cause) {
    if (current(stamp, reportId)) {
      run.value = { requestId, status: "unknown" };
      error.value = failure(cause);
    }
  } finally {
    if (current(stamp, reportId)) {
      cancelling.value = false;
      pendingId.value = null;
    }
  }
}
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
.summary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}
</style>
