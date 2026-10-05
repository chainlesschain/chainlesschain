<template>
  <a-drawer
    :open="open"
    title="项目任务"
    :width="760"
    @close="emit('update:open', false)"
  >
    <div
      v-if="open"
      class="project-task-review"
      data-testid="controlled-task-drawer"
    >
      <p class="muted">查看已保存的项目任务。描述修改需本人确认。</p>
      <p v-if="error" role="alert" class="notice error">{{ error }}</p>
      <div class="actions">
        <button
          :disabled="loadingList"
          data-testid="refresh-tasks"
          @click="loadTasks()"
        >
          刷新任务
        </button>
        <button
          :disabled="loadingRisk || !riskAvailable"
          data-testid="evaluate-risk"
          @click="evaluateRisk()"
        >
          {{ loadingRisk ? "正在检查…" : "检查交付风险" }}
        </button>
      </div>
      <p v-if="!riskAvailable" class="muted">当前版本未提供项目风险检查。</p>
      <p v-if="loadingList" role="status">正在读取任务…</p>
      <p v-else-if="!error && tasks.length === 0" data-testid="empty-tasks">
        暂无已保存任务。
      </p>
      <ul v-if="tasks.length" class="task-list">
        <li v-for="item in tasks" :key="item.id">
          <button
            :aria-pressed="selectedId === item.id"
            :data-task-id="item.id"
            @click="selectTask(item.id)"
          >
            <span class="task-text">{{
              item.descriptionPreview || "空描述"
            }}</span>
            <span class="muted">{{ taskStatus(item.status) }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="taskCursor"
        :disabled="loadingList"
        data-testid="more-tasks"
        @click="loadTasks(true)"
      >
        加载更多任务
      </button>

      <section v-if="risk" class="section" data-testid="risk-result">
        <h3>交付风险检查</h3>
        <p v-if="risk.evaluation.status !== 'evaluated'" class="notice">
          数据不足，暂不能完成风险检查。
        </p>
        <p v-else-if="risk.evaluation.summary?.riskTaskCount === 0">
          未发现所选规则信号。
        </p>
        <template v-else>
          <p>
            发现
            {{ risk.evaluation.summary?.riskTaskCount }} 个任务有待检查信号。
          </p>
          <ul>
            <li v-for="item in risk.evaluation.tasks" :key="item.taskRef.id">
              {{ item.taskRef.id }}：{{
                item.reasonCodes.map(riskReason).join("；")
              }}
            </li>
          </ul>
        </template>
        <p class="muted">仅检查逾期与未完成的直接依赖，不预测交付结果。</p>
        <p class="muted">补充任务描述不会消除这些风险信号。</p>
        <p class="muted">来源时间：{{ risk.evaluation.asOf || "未提供" }}</p>
        <p class="muted">检查记录：{{ risk.review.id }}</p>
      </section>

      <p v-if="loadingTask" role="status">正在读取任务详情…</p>
      <section v-if="task" class="section" data-testid="task-editor">
        <h3>
          任务描述 <span class="muted">{{ taskStatus(task.status) }}</span>
        </h3>
        <p v-if="!task.editable" class="notice" data-testid="task-restriction">
          {{ taskRestriction(task.reason) }}
        </p>
        <label for="controlled-task-description">描述内容</label>
        <textarea
          id="controlled-task-description"
          v-model="draft"
          rows="5"
          :disabled="!canEdit || previewing"
          data-testid="task-description"
        />
        <p class="muted">{{ descriptionBytes }} / 8192 字节</p>
        <button
          :disabled="!canPreview"
          data-testid="preview-description"
          @click="previewDescription"
        >
          {{ previewing ? "正在准备…" : "预览修改" }}
        </button>
        <div v-if="prepared" class="preview" data-testid="description-preview">
          <h4>修改前</h4>
          <pre>{{ prepared.before.description || "（空）" }}</pre>
          <h4>修改后</h4>
          <pre>{{ prepared.after.description || "（空）" }}</pre>
          <button
            :disabled="!canExecute"
            data-testid="execute-description"
            @click="executeDescription"
          >
            {{ executing ? "等待系统确认…" : "确认此修改" }}
          </button>
        </div>
        <p
          v-if="uncertain"
          role="status"
          class="notice"
          data-testid="unresolved-action"
        >
          结果待核实。请刷新修改记录，系统不会自动重试。
        </p>
        <p v-if="receipt" role="status" data-testid="current-receipt">
          {{ runLabel(receipt.run.status) }}
        </p>
        <button
          v-if="receipt && !unresolved(receipt) && !uncertain"
          data-testid="new-description-intent"
          @click="startNewIntent"
        >
          开始新的修改
        </button>
      </section>

      <section v-if="task" class="section" data-testid="action-history">
        <div class="actions">
          <h3>修改记录</h3>
          <button
            :disabled="loadingHistory || executing"
            data-testid="refresh-history"
            @click="refreshHistory()"
          >
            刷新修改记录
          </button>
        </div>
        <p v-if="loadingHistory">正在读取记录…</p>
        <p v-else-if="runs.length === 0">暂无修改记录。</p>
        <ol>
          <li v-for="item in runs" :key="item.run.id">
            <strong>{{ runLabel(item.run.status) }}</strong
            ><span class="muted">
              {{ item.run.completedAt || item.run.startedAt }}</span
            >
            <div class="muted">{{ item.run.id }}</div>
          </li>
        </ol>
        <button
          v-if="runCursor"
          :disabled="loadingHistory"
          data-testid="more-history"
          @click="refreshHistory(true)"
        >
          更早记录
        </button>
      </section>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  actionCode,
  isAuthorityError,
  isDefiniteActionRejection,
  riskReason,
  runLabel,
  taskRestriction,
  taskStatus,
  unresolved,
  type ActionReceipt,
  type ControlledTask,
  type ControlledTaskSummary,
  type DescriptionPreview,
  type RiskReview,
  type TaskDescriptionApi,
} from "./task-description-ui";

const props = defineProps<{
  open: boolean;
  projectId: string;
  identityKey?: string;
}>();
const emit = defineEmits<{ (event: "update:open", value: boolean): void }>();
type RiskApi = {
  evaluateRisk(input: { projectId: string }): Promise<RiskReview>;
};
function apis() {
  return (
    window as unknown as {
      electronAPI?: { task?: TaskDescriptionApi; project?: RiskApi };
    }
  ).electronAPI;
}
function taskApi(): TaskDescriptionApi {
  const api = apis()?.task;
  if (
    !api ||
    [
      "listControlledTasks",
      "readControlledTask",
      "listDescriptionActionRuns",
      "previewDescriptionUpdate",
      "executeDescriptionUpdate",
    ].some(
      (name) => typeof api[name as keyof TaskDescriptionApi] !== "function",
    )
  )
    throw new Error("API_UNAVAILABLE");
  return api;
}

const tasks = ref<ControlledTaskSummary[]>([]);
const task = ref<ControlledTask | null>(null);
const selectedId = ref("");
const draft = ref("");
// Electron returns plain cloned data. Keep the bound request out of Vue's deep
// proxies, which cannot be structured-cloned by ipcRenderer.invoke.
const prepared = shallowRef<DescriptionPreview | null>(null);
const receipt = ref<ActionReceipt | null>(null);
const runs = ref<ActionReceipt[]>([]);
const risk = ref<RiskReview | null>(null);
const taskCursor = ref<string | null>(null);
const runCursor = ref<string | null>(null);
const error = ref("");
const uncertain = ref(false);
const loadingList = ref(false),
  loadingTask = ref(false),
  loadingHistory = ref(false);
const loadingRisk = ref(false),
  previewing = ref(false),
  executing = ref(false);
let epoch = 0,
  selection = 0;
let intent: { key: string; description: string; attempted: boolean } | null =
  null;
// Only binding metadata survives selection changes; no descriptions or requests.
const attempts = new Map<string, string>();
const attemptKey = () =>
  JSON.stringify([props.identityKey || "", props.projectId, selectedId.value]);
const riskAvailable = computed(
  () => typeof apis()?.project?.evaluateRisk === "function",
);
const descriptionBytes = computed(
  () => new TextEncoder().encode(draft.value).length,
);
const canEdit = computed(
  () =>
    task.value?.editable === true &&
    !executing.value &&
    !uncertain.value &&
    !receipt.value,
);
const canPreview = computed(
  () =>
    canEdit.value &&
    !previewing.value &&
    descriptionBytes.value <= 8192 &&
    draft.value !== task.value?.description,
);
const canExecute = computed(
  () =>
    !!prepared.value &&
    canEdit.value &&
    !previewing.value &&
    prepared.value.after.description === draft.value &&
    !intent?.attempted,
);

function token() {
  return { epoch, selection };
}
function current(stamp: ReturnType<typeof token>, requireSelection = true) {
  return (
    props.open &&
    stamp.epoch === epoch &&
    (!requireSelection || stamp.selection === selection)
  );
}
function clearSelection() {
  selection++;
  selectedId.value = "";
  task.value = null;
  draft.value = "";
  prepared.value = null;
  receipt.value = null;
  runs.value = [];
  runCursor.value = null;
  uncertain.value = false;
  intent = null;
  loadingTask.value = false;
  loadingHistory.value = false;
  previewing.value = false;
  executing.value = false;
}
function clearAll() {
  epoch++;
  clearSelection();
  tasks.value = [];
  risk.value = null;
  taskCursor.value = null;
  loadingList.value = false;
  loadingRisk.value = false;
}
function failure(value: unknown, fallback: string) {
  if (isAuthorityError(value)) {
    clearAll();
    error.value = "当前身份无访问权限，或登录状态已变化。请重新打开项目任务。";
  } else
    error.value =
      value instanceof Error && value.message === "API_UNAVAILABLE"
        ? "当前版本未提供受控项目任务功能。"
        : fallback;
}

async function loadTasks(more = false) {
  if (!props.open || loadingList.value) return;
  if (!more) {
    epoch++;
    clearSelection();
    tasks.value = [];
    taskCursor.value = null;
    risk.value = null;
    loadingRisk.value = false;
  }
  const stamp = token();
  loadingList.value = true;
  error.value = "";
  try {
    const result = await taskApi().listControlledTasks({
      projectId: props.projectId,
      ...(more && taskCursor.value ? { afterId: taskCursor.value } : {}),
      limit: 50,
    });
    if (!current(stamp, false)) return;
    if (result.project.id !== props.projectId)
      throw new Error("ACTION_NOT_FOUND_OR_DENIED");
    tasks.value = more ? [...tasks.value, ...result.tasks] : result.tasks;
    taskCursor.value = result.nextCursor;
  } catch (value) {
    if (current(stamp, false)) failure(value, "任务读取失败，请刷新任务。");
  } finally {
    if (current(stamp, false)) loadingList.value = false;
  }
}

function applyHistory(items: ActionReceipt[]) {
  const digest = attempts.get(attemptKey());
  const matching = digest
    ? items.find((item) => item.run.invocationDigest === digest)
    : undefined;
  if (matching) {
    receipt.value = matching;
    if (!unresolved(matching)) attempts.delete(attemptKey());
  }
  uncertain.value =
    attempts.has(attemptKey()) ||
    items.some(unresolved) ||
    task.value?.reason === "ACTION_UNRESOLVED_ACTION";
}

async function selectTask(taskId: string) {
  clearSelection();
  selectedId.value = taskId;
  const stamp = token();
  loadingTask.value = true;
  error.value = "";
  try {
    const api = taskApi();
    const [detail, history] = await Promise.all([
      api.readControlledTask({ taskId }),
      api.listDescriptionActionRuns({ taskId, limit: 20 }),
    ]);
    if (!current(stamp)) return;
    if (detail.taskId !== taskId || detail.projectId !== props.projectId)
      throw new Error("ACTION_NOT_FOUND_OR_DENIED");
    task.value = detail;
    draft.value = detail.description;
    runs.value = history.runs;
    runCursor.value = history.nextCursor;
    applyHistory(runs.value);
  } catch (value) {
    if (current(stamp)) {
      clearSelection();
      failure(value, "任务详情读取失败，请重新选择任务。");
    }
  } finally {
    if (current(stamp)) loadingTask.value = false;
  }
}

async function previewDescription() {
  if (!canPreview.value || !task.value) return;
  const stamp = token();
  previewing.value = true;
  error.value = "";
  prepared.value = null;
  try {
    if (!intent || intent.description !== draft.value)
      intent = {
        key: crypto.randomUUID(),
        description: draft.value,
        attempted: false,
      };
    const result = await taskApi().previewDescriptionUpdate({
      taskId: task.value.taskId,
      description: draft.value,
      idempotencyKey: intent.key,
    });
    if (current(stamp)) prepared.value = result;
  } catch (value) {
    if (current(stamp)) {
      if (actionCode(value) === "ACTION_UNRESOLVED_ACTION")
        uncertain.value = true;
      failure(
        value,
        actionCode(value) === "ACTION_VERSION_CONFLICT"
          ? "任务已发生变化，请刷新任务后重新预览。"
          : "暂不能预览此修改，请刷新任务详情。",
      );
    }
  } finally {
    if (current(stamp)) previewing.value = false;
  }
}

async function executeDescription() {
  if (!canExecute.value || !prepared.value || !intent) return;
  const stamp = token(),
    key = attemptKey(),
    request = prepared.value.request;
  intent.attempted = true;
  executing.value = true;
  error.value = "";
  attempts.set(key, request.invocationDigest);
  try {
    const result = await taskApi().executeDescriptionUpdate({ request });
    if (!unresolved(result) && attempts.get(key) === request.invocationDigest)
      attempts.delete(key);
    if (!current(stamp)) return;
    receipt.value = result;
    runs.value = [
      result,
      ...runs.value.filter((item) => item.run.id !== result.run.id),
    ];
    uncertain.value = unresolved(result);
    if (result.run.status === "succeeded") {
      const detail = await taskApi().readControlledTask({
        taskId: selectedId.value,
      });
      if (!current(stamp)) return;
      if (
        detail.taskId !== selectedId.value ||
        detail.projectId !== props.projectId
      )
        throw new Error("ACTION_NOT_FOUND_OR_DENIED");
      task.value = detail;
      const summary = tasks.value.find((item) => item.id === detail.taskId);
      if (summary)
        summary.descriptionPreview = detail.description.slice(0, 256);
    }
  } catch (value) {
    const blockedByEarlierAction =
      actionCode(value) === "ACTION_UNRESOLVED_ACTION";
    const definiteRejection =
      isDefiniteActionRejection(value) || blockedByEarlierAction;
    // A settled old request may clear only its own non-content binding marker.
    // It must never overwrite a newer intent or restore old UI after navigation.
    if (definiteRejection && attempts.get(key) === request.invocationDigest)
      attempts.delete(key);
    if (current(stamp)) {
      if (definiteRejection) {
        intent = null;
        prepared.value = null;
        if (task.value)
          task.value = {
            ...task.value,
            editable: false,
            reason: blockedByEarlierAction
              ? "ACTION_UNRESOLVED_ACTION"
              : "ACTION_SOURCE_CHANGED",
          };
      }
      uncertain.value = attempts.has(key) || blockedByEarlierAction;
      failure(
        value,
        uncertain.value
          ? "修改结果待核实，请刷新修改记录。"
          : receipt.value?.run.status === "succeeded"
            ? "修改已有记录，但最新任务内容未能刷新。"
            : "本次修改未执行，请刷新修改记录和任务内容后重新预览。",
      );
    }
  } finally {
    if (current(stamp)) executing.value = false;
  }
}

async function refreshHistory(more = false) {
  if (!task.value || loadingHistory.value || executing.value) return;
  const stamp = token(),
    taskId = task.value.taskId;
  loadingHistory.value = true;
  error.value = "";
  try {
    const api = taskApi();
    const [history, detail] = await Promise.all([
      api.listDescriptionActionRuns({
        taskId,
        ...(more && runCursor.value ? { beforeId: runCursor.value } : {}),
        limit: 20,
      }),
      api.readControlledTask({ taskId }),
    ]);
    if (!current(stamp)) return;
    if (detail.taskId !== taskId || detail.projectId !== props.projectId)
      throw new Error("ACTION_NOT_FOUND_OR_DENIED");
    task.value = detail;
    runs.value = more ? [...runs.value, ...history.runs] : history.runs;
    runCursor.value = history.nextCursor;
    applyHistory(runs.value);
  } catch (value) {
    if (current(stamp)) failure(value, "修改记录暂不可读取；不会重试执行。");
  } finally {
    if (current(stamp)) loadingHistory.value = false;
  }
}

function startNewIntent() {
  if (
    !receipt.value ||
    unresolved(receipt.value) ||
    uncertain.value ||
    !task.value
  )
    return;
  intent = null;
  prepared.value = null;
  receipt.value = null;
  draft.value = task.value.description;
}

async function evaluateRisk() {
  if (!riskAvailable.value || loadingRisk.value) return;
  const stamp = token();
  loadingRisk.value = true;
  error.value = "";
  risk.value = null;
  try {
    const result = await apis()!.project!.evaluateRisk({
      projectId: props.projectId,
    });
    if (!current(stamp, false)) return;
    if (result.review.projectId !== props.projectId)
      throw new Error("ACTION_NOT_FOUND_OR_DENIED");
    // The raw canonical source snapshot is not retained in renderer state.
    risk.value = { review: result.review, evaluation: result.evaluation };
  } catch (value) {
    if (current(stamp, false)) failure(value, "风险检查暂不可用，请稍后再试。");
  } finally {
    if (current(stamp, false)) loadingRisk.value = false;
  }
}

watch(draft, () => {
  if (
    prepared.value &&
    prepared.value.after.description !== draft.value &&
    !intent?.attempted
  )
    prepared.value = null;
});
watch(
  () => [props.open, props.projectId, props.identityKey],
  (next, previous) => {
    clearAll();
    error.value = "";
    if (previous && next[2] !== previous[2]) {
      emit("update:open", false);
      return;
    }
    if (props.open) void loadTasks();
  },
  { immediate: true, flush: "sync" },
);
onBeforeUnmount(clearAll);
</script>

<style scoped>
.project-task-review {
  color: #1f2937;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 12px;
  background: white;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: #1677ff;
  color: #1677ff;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
button:focus-visible,
textarea:focus-visible {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
}
.muted {
  color: #64748b;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.notice {
  background: #fff7e6;
  padding: 12px;
  border-radius: 6px;
}
.error {
  color: #9f1239;
  background: #fff1f2;
}
.task-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
}
.task-list button {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  text-align: left;
}
.task-list button[aria-pressed="true"] {
  border-color: #1677ff;
  background: #f0f7ff;
}
.task-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  flex: 1;
}
.section {
  border-top: 1px solid #e2e8f0;
  margin-top: 20px;
  padding-top: 16px;
}
h3 {
  font-size: 15px;
  margin: 0 0 12px;
}
.actions h3 {
  margin: 0;
  flex: 1;
}
label {
  display: block;
  margin: 12px 0 6px;
}
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  resize: vertical;
}
.preview {
  margin-top: 16px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 6px;
}
.preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
ol {
  padding-left: 20px;
}
li {
  margin-bottom: 10px;
}
</style>
