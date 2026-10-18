<template>
  <section aria-label="看板报告" class="task-reports">
    <div class="report-heading">
      <h3>看板报告</h3>
      <a-button
        data-action="refresh-reports"
        :disabled="busy || !app.isAuthenticated"
        @click="load"
        >刷新报告</a-button
      >
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="busy" role="status">正在加载报告…</p>
    <p v-else-if="!reports.length">暂无报告</p>
    <article
      v-for="report in reports"
      :key="`${report.id}:${report.updatedAt}`"
      :data-report-id="report.id"
    >
      <h4>{{ report.reportType === "weekly" ? "周报" : "团队报告" }}</h4>
      <p v-if="report.yesterdayWork">已完成：{{ report.yesterdayWork }}</p>
      <p v-if="report.todayPlan">计划：{{ report.todayPlan }}</p>
      <p v-if="report.blockers">阻塞：{{ report.blockers }}</p>
      <p v-if="report.notes">备注：{{ report.notes }}</p>
      <TaskReportSummary :report-id="report.id" @updated="load" />
    </article>
    <small v-if="reports.length === 20">显示最近 20 条报告。</small>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAppStore } from "../../stores/app";
import { useIdentityStore } from "../../stores/identity";
import TaskReportSummary from "./TaskReportSummary.vue";

const props = defineProps<{ orgId: string; boardId: string }>();
const app = useAppStore();
const identity = useIdentityStore();
interface Report {
  id: string;
  updatedAt: number;
  reportType: string;
  yesterdayWork: string;
  todayPlan: string;
  blockers: string;
  notes: string;
}
const reports = ref<Report[]>([]);
const busy = ref(false);
const error = ref("");
let epoch = 0;
let unsubscribe: (() => void) | undefined;
function invalidate() {
  epoch++;
  reports.value = [];
  busy.value = false;
  error.value = "";
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
  () => [props.orgId, props.boardId],
  () => {
    invalidate();
    void load();
  },
  { flush: "sync" },
);
function project(row: any): Report {
  if (
    !row ||
    typeof row.id !== "string" ||
    !row.id ||
    row.id.length > 128 ||
    row.orgId !== props.orgId ||
    row.boardId !== props.boardId ||
    !Number.isSafeInteger(row.updatedAt)
  )
    throw new Error("INVALID_REPORT");
  const text = (value: any) => {
    if (value == null) return "";
    if (typeof value !== "string" || value.length > 65536)
      throw new Error("INVALID_REPORT_TEXT");
    return value;
  };
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    reportType: text(row.reportType),
    yesterdayWork: text(row.yesterdayWork),
    todayPlan: text(row.todayPlan),
    blockers: text(row.blockers),
    notes: text(row.notes),
  };
}
async function load() {
  if (!app.isAuthenticated || !props.orgId || !props.boardId) {
    invalidate();
    return;
  }
  const stamp = ++epoch,
    orgId = props.orgId,
    boardId = props.boardId;
  const current = () =>
    stamp === epoch &&
    app.isAuthenticated &&
    props.orgId === orgId &&
    props.boardId === boardId;
  busy.value = true;
  reports.value = [];
  error.value = "";
  try {
    const result = await (window as any).electronAPI?.task?.getReports({
      orgId,
      options: { boardId, limit: 20 },
    });
    if (!current()) return;
    if (
      result?.success !== true ||
      !Array.isArray(result.reports) ||
      result.reports.length > 20
    )
      throw new Error("REPORTS_UNAVAILABLE");
    const rows = result.reports.map(project);
    if (new Set(rows.map((row: Report) => row.id)).size !== rows.length)
      throw new Error("DUPLICATE_REPORTS");
    reports.value = rows;
  } catch {
    if (current()) {
      reports.value = [];
      error.value = "报告暂不可访问，请刷新并检查当前权限。";
    }
  } finally {
    if (current()) busy.value = false;
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
.task-reports {
  margin-top: 24px;
  padding: 16px;
}
.report-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
article {
  border-top: 1px solid #ddd;
  margin-top: 16px;
  overflow-wrap: anywhere;
}
</style>
