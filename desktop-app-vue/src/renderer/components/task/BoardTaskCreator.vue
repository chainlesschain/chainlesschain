<template>
  <section aria-label="受控任务创建">
    <p>填写任务后先预览，再通过系统窗口确认创建。</p>
    <button
      data-create-action="refresh"
      :disabled="busy || cancelling"
      @click="load"
    >
      刷新来源与创建记录
    </button>
    <form v-if="source" @submit.prevent="preview">
      <label
        >标题<input
          v-model="draft.title"
          data-create-field="title"
          :disabled="!canCreate"
          maxlength="1024"
      /></label>
      <label
        >描述<textarea
          v-model="draft.description"
          data-create-field="description"
          :disabled="!canCreate"
          rows="4"
        />
      </label>
      <label
        >所属列<select
          v-model="draft.columnId"
          data-create-field="columnId"
          :disabled="!canCreate"
        >
          <option
            v-for="column in source.columns"
            :key="column.id"
            :value="column.id"
          >
            {{ column.name }}（{{ column.id }}）
          </option>
        </select></label
      >
      <label
        >优先级<select
          v-model="draft.priority"
          data-create-field="priority"
          :disabled="!canCreate"
        >
          <option
            v-for="(label, value) in priorities"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select></label
      >
      <label
        >父任务 ID（可选，同一看板）<input
          v-model="draft.parentTaskId"
          data-create-field="parentTaskId"
          :disabled="!canCreate"
      /></label>
      <label
        >主要负责人 DID（可选）<input
          v-model="draft.assigneeDid"
          data-create-field="assigneeDid"
          :disabled="!canCreate || !source.optionalFields.assigneeDid"
          placeholder="did:…"
      /></label>
      <label
        >截止时间（UTC Unix 整数毫秒，可选）<input
          v-model="draft.dueDate"
          data-create-field="dueDate"
          :disabled="!canCreate"
          inputmode="numeric"
      /></label>
      <label
        >预计工时（小时，可选）<input
          v-model="draft.estimatedHours"
          data-create-field="estimatedHours"
          :disabled="!canCreate"
          inputmode="decimal"
      /></label>
      <label
        >实际工时（小时，可选）<input
          v-model="draft.actualHours"
          data-create-field="actualHours"
          :disabled="!canCreate"
          inputmode="decimal"
      /></label>
      <label
        >位置（0 至 1000000 的整数）<input
          v-model="draft.position"
          data-create-field="position"
          :disabled="!canCreate"
          inputmode="numeric"
      /></label>
      <p>
        新任务状态为待处理；填写父任务后创建子任务。留空的可选字段记为未设置，0
        会保留。
      </p>
      <button
        type="button"
        data-create-action="preview"
        :disabled="!canCreate"
        @click="preview"
      >
        预览创建
      </button>
    </form>
    <p v-if="source && !source.creatable">当前没有创建此任务的权限。</p>
    <p v-if="hasUnresolved">
      已有预览或结果尚未确认的创建，请先取消或结束等待。
    </p>
    <div v-if="previewRequest && after" data-create-preview>
      <p>创建后的任务：</p>
      <dl v-for="field in afterFields" :key="field">
        <dt>{{ labels[field] }}</dt>
        <dd>
          <pre>{{ display(field, after[field]) }}</pre>
        </dd>
      </dl>
      <button
        data-create-action="execute"
        :disabled="busy || cancelling || !app.isAuthenticated"
        @click="execute"
      >
        打开系统确认
      </button>
    </div>
    <button
      v-if="pending"
      data-create-action="cancel"
      :disabled="cancelling"
      @click="cancel(pending.runId)"
    >
      取消本次创建
    </button>
    <p v-if="busy" role="status">正在读取或等待确认…</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul aria-label="看板创建记录">
      <li v-for="run in runs" :key="run.id">
        {{ runLabels[run.status] }}
        <button
          v-if="['queued', 'running', 'unknown'].includes(run.status)"
          data-create-action="cancel-recorded"
          :disabled="busy || cancelling"
          @click="cancel(run.id)"
        >
          结束等待
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useAppStore } from "../../stores/app";
import { useIdentityStore } from "../../stores/identity";
const props = defineProps<{
  boardId: string;
  initialColumnId?: string | null;
  parentTaskId?: string | null;
}>();
const emit = defineEmits<{ created: [taskId: string] }>();
const app = useAppStore(),
  identity = useIdentityStore();
const priorities = { low: "低", medium: "中", high: "高", critical: "紧急" };
const dataFields = [
  "columnId",
  "title",
  "description",
  "priority",
  "assigneeDid",
  "dueDate",
  "estimatedHours",
  "actualHours",
  "position",
  "parentTaskId",
] as const;
const afterFields = [
  "id",
  "boardId",
  ...dataFields,
  "status",
  "taskType",
] as const;
const labels = {
  id: "任务 ID",
  boardId: "看板 ID",
  columnId: "所属列",
  title: "标题",
  description: "描述",
  priority: "优先级",
  assigneeDid: "主要负责人 DID",
  dueDate: "截止时间（UTC Unix 毫秒）",
  estimatedHours: "预计工时（小时）",
  actualHours: "实际工时（小时）",
  position: "位置",
  parentTaskId: "父任务 ID",
  status: "状态",
  taskType: "任务类型",
};
type Data = {
  columnId: string;
  title: string;
  description: string;
  priority: string;
  assigneeDid: string | null;
  dueDate: number | null;
  estimatedHours: number | null;
  actualHours: number | null;
  position: number;
  parentTaskId: string | null;
};
type Created = Data & {
  id: string;
  boardId: string;
  status: string;
  taskType: string;
};
type Source = {
  board: { id: string; orgId: string };
  columns: { id: string; name: string }[];
  creatable: boolean;
  optionalFields: { assigneeDid: boolean };
};
const runLabels = {
  queued: "等待确认",
  running: "处理中，尚未确认结果",
  unknown: "结果未知，不会自动重试",
  succeeded: "任务已创建",
  cancelled: "创建已取消",
  denied: "创建未获批准",
  failed: "创建失败",
};
type Run = {
  id: string;
  taskId: string;
  status: keyof typeof runLabels;
  invocationDigest: string;
};
const blank = () => ({
  columnId: props.initialColumnId ?? "",
  title: "",
  description: "",
  priority: "medium",
  assigneeDid: "",
  dueDate: "",
  estimatedHours: "",
  actualHours: "",
  position: "0",
  parentTaskId: props.parentTaskId ?? "",
});
const source = ref<Source | null>(null),
  draft = ref(blank()),
  after = ref<Created | null>(null),
  runs = ref<Run[]>([]);
const previewRequest = shallowRef<any>(null),
  pending = shallowRef<{ request: any; runId: string; taskId: string } | null>(
    null,
  );
const busy = ref(false),
  cancelling = ref(false),
  error = ref(""),
  notice = ref("");
const hasUnresolved = computed(
  () =>
    pending.value !== null ||
    runs.value.some((run) => ["running", "unknown"].includes(run.status)),
);
const canCreate = computed(
  () =>
    app.isAuthenticated &&
    source.value?.creatable === true &&
    !busy.value &&
    !cancelling.value &&
    !hasUnresolved.value,
);
const api = () => (window as any).electronAPI?.task;
let epoch = 0,
  draftVersion = 0;
let unsubscribe: (() => void) | undefined;
const current = (stamp: number, boardId: string) =>
  stamp === epoch && app.isAuthenticated && props.boardId === boardId;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const validId = (value: any) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value);
const digest = (value: any) =>
  typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
function invalidate() {
  epoch++;
  source.value = null;
  draft.value = blank();
  after.value = null;
  runs.value = [];
  previewRequest.value = null;
  pending.value = null;
  busy.value = false;
  cancelling.value = false;
  error.value = "";
  notice.value = "";
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
  () => [props.boardId, props.initialColumnId, props.parentTaskId],
  () => {
    invalidate();
    void load();
  },
  { flush: "sync" },
);
watch(
  draft,
  () => {
    draftVersion++;
    previewRequest.value = null;
    after.value = null;
  },
  { deep: true, flush: "sync" },
);
function projectSource(result: any): Source {
  if (
    result?.success !== true ||
    result.board?.id !== props.boardId ||
    !validId(result.board.orgId) ||
    typeof result.creatable !== "boolean" ||
    typeof result.optionalFields?.assigneeDid !== "boolean" ||
    !Array.isArray(result.columns) ||
    result.columns.length > 200
  )
    throw new Error("INVALID_SOURCE");
  const columns = result.columns.map((column: any) => {
    if (
      !column ||
      !validId(column.id) ||
      typeof column.name !== "string" ||
      !column.name.trim() ||
      bytes(column.name) > 4096
    )
      throw new Error("INVALID_COLUMNS");
    return { id: column.id, name: column.name };
  });
  if (
    new Set(columns.map((column: any) => column.id)).size !== columns.length ||
    columns.reduce(
      (size: number, column: any) =>
        size + bytes(column.id) + bytes(column.name),
      0,
    ) > 65536
  )
    throw new Error("INVALID_COLUMNS");
  return {
    board: { id: result.board.id, orgId: result.board.orgId },
    columns,
    creatable: result.creatable && columns.length > 0,
    optionalFields: { assigneeDid: result.optionalFields.assigneeDid },
  };
}
function projectRun(value: any): Run {
  const run = value?.run;
  if (
    !run ||
    run.actionType !== "board-task.create" ||
    run.actionVersion !== 1 ||
    run.target?.type !== "Task" ||
    run.target.sourceKind !== "desktop.board-task" ||
    run.target.scope?.kind !== "organization" ||
    run.target.scope.id !== source.value?.board.orgId ||
    !validId(run.target.id) ||
    !validId(run.id) ||
    !Object.hasOwn(runLabels, run.status) ||
    !digest(run.invocationDigest)
  )
    throw new Error("INVALID_RUN");
  return {
    id: run.id,
    taskId: run.target.id,
    status: run.status,
    invocationDigest: run.invocationDigest,
  };
}
function projectRuns(result: any) {
  if (
    result?.success !== true ||
    !Array.isArray(result.runs) ||
    result.runs.length > 20
  )
    throw new Error("INVALID_RUNS");
  const rows: Run[] = result.runs.map(projectRun);
  if (new Set(rows.map((run) => run.id)).size !== rows.length)
    throw new Error("INVALID_RUNS");
  if (result.unresolvedRun == null) return rows;
  const unresolved = projectRun(result.unresolvedRun);
  if (!["running", "unknown"].includes(unresolved.status))
    throw new Error("INVALID_RUNS");
  return [unresolved, ...rows.filter((run) => run.id !== unresolved.id)];
}
const sourceParams = (parent: string | null) => ({
  boardId: props.boardId,
  ...(parent ? { parentTaskId: parent } : {}),
});
function failure() {
  error.value = "创建暂不可用，请刷新来源并检查当前权限。";
}
async function load() {
  if (!app.isAuthenticated || !props.boardId) {
    invalidate();
    return;
  }
  const boardId = props.boardId,
    stamp = ++epoch;
  busy.value = true;
  cancelling.value = false;
  source.value = null;
  runs.value = [];
  previewRequest.value = null;
  pending.value = null;
  after.value = null;
  error.value = "";
  try {
    const result = await api()?.getBoardCreateSource(
      sourceParams(draft.value.parentTaskId || null),
    );
    if (!current(stamp, boardId)) return;
    source.value = projectSource(result);
    if (
      !source.value.columns.some((column) => column.id === draft.value.columnId)
    )
      draft.value.columnId = source.value.columns[0]?.id ?? "";
    const history = await api()?.getBoardCreateRuns({ boardId, limit: 20 });
    if (current(stamp, boardId)) runs.value = projectRuns(history);
  } catch {
    if (current(stamp, boardId)) {
      source.value = null;
      runs.value = [];
      failure();
    }
  } finally {
    if (current(stamp, boardId)) busy.value = false;
  }
}
function taskData(): Data {
  const number = (
    key: "dueDate" | "position" | "estimatedHours" | "actualHours",
  ) => {
    const raw = draft.value[key];
    if (raw === "" && key !== "position") return null;
    if (
      !(
        key === "dueDate" || key === "position"
          ? /^\d+$/u
          : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u
      ).test(raw)
    )
      throw new Error("INVALID_NUMBER");
    const value = Number(raw),
      max = key === "dueDate" ? 8640000000000000 : 1000000;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > max ||
      ((key === "dueDate" || key === "position") &&
        !Number.isSafeInteger(value))
    )
      throw new Error("INVALID_NUMBER");
    return value;
  };
  const value = draft.value;
  if (
    !value.title.trim() ||
    bytes(value.title) > 1024 ||
    bytes(value.description) > 8192 ||
    !Object.hasOwn(priorities, value.priority) ||
    !source.value?.columns.some((column) => column.id === value.columnId) ||
    (value.parentTaskId !== "" && !validId(value.parentTaskId)) ||
    (value.assigneeDid !== "" &&
      (!source.value.optionalFields.assigneeDid ||
        !/^did:[^\s\u0000-\u001f\u007f]+$/u.test(value.assigneeDid) ||
        bytes(value.assigneeDid) > 256))
  )
    throw new Error("INVALID_TASK_DATA");
  return {
    columnId: value.columnId,
    title: value.title,
    description: value.description,
    priority: value.priority,
    parentTaskId: value.parentTaskId || null,
    assigneeDid: value.assigneeDid || null,
    dueDate: number("dueDate"),
    estimatedHours: number("estimatedHours"),
    actualHours: number("actualHours"),
    position: number("position")!,
  };
}
function equalData(value: any, expected: Data) {
  return (
    value &&
    Object.keys(value).length === dataFields.length &&
    dataFields.every(
      (key) => Object.hasOwn(value, key) && value[key] === expected[key],
    )
  );
}
async function preview() {
  if (!canCreate.value || !source.value) return;
  const boardId = props.boardId,
    stamp = epoch,
    editing = draftVersion;
  error.value = "";
  notice.value = "";
  try {
    const data = taskData();
    busy.value = true;
    const refreshed = await api()?.getBoardCreateSource(
      sourceParams(data.parentTaskId),
    );
    if (!current(stamp, boardId) || editing !== draftVersion) return;
    const latest = projectSource(refreshed);
    if (
      latest.board.orgId !== source.value.board.orgId ||
      !latest.creatable ||
      !latest.columns.some((column) => column.id === data.columnId) ||
      (data.assigneeDid !== null && !latest.optionalFields.assigneeDid)
    )
      throw new Error("CREATE_NOT_ALLOWED");
    source.value = latest;
    const idempotencyKey = crypto.randomUUID();
    const result = await api()?.previewBoardCreate({
      boardId,
      taskData: data,
      idempotencyKey,
    });
    if (!current(stamp, boardId) || editing !== draftVersion) return;
    const request = result?.request;
    if (
      result?.success !== true ||
      result.before !== null ||
      !validId(result.runId) ||
      !validId(result.taskId) ||
      request?.actionType !== "board-task.create" ||
      request.actionVersion !== 1 ||
      request.target?.type !== "Task" ||
      request.target.id !== result.taskId ||
      request.target.sourceKind !== "desktop.board-task" ||
      request.target.scope?.kind !== "organization" ||
      request.target.scope.id !== source.value.board.orgId ||
      request.idempotencyKey !== idempotencyKey ||
      !digest(request.expectedVersion) ||
      request.target.version !== request.expectedVersion ||
      !digest(request.invocationDigest) ||
      request.input?.boardId !== boardId ||
      !equalData(request.input?.taskData, data)
    )
      throw new Error("INVALID_PREVIEW");
    const expected = {
      id: result.taskId,
      boardId,
      ...data,
      status: "open",
      taskType: data.parentTaskId ? "subtask" : "task",
    };
    if (
      !result.after ||
      Object.keys(result.after).length !== afterFields.length ||
      afterFields.some((key) => result.after[key] !== expected[key])
    )
      throw new Error("INVALID_PREVIEW");
    after.value = expected;
    previewRequest.value = request;
    pending.value = { request, runId: result.runId, taskId: result.taskId };
    runs.value = [
      {
        id: result.runId,
        taskId: result.taskId,
        status: "queued",
        invocationDigest: request.invocationDigest,
      },
      ...runs.value,
    ].slice(0, 20);
  } catch {
    if (current(stamp, boardId)) failure();
  } finally {
    if (current(stamp, boardId)) busy.value = false;
  }
}
function record(result: any) {
  if (result?.success !== true) throw new Error("CREATE_FAILED");
  const run = projectRun(result);
  runs.value = runs.value.some((item) => item.id === run.id)
    ? runs.value.map((item) => (item.id === run.id ? run : item))
    : [run, ...runs.value].slice(0, 21);
  notice.value = runLabels[run.status];
  return run;
}
async function execute() {
  if (
    !app.isAuthenticated ||
    busy.value ||
    cancelling.value ||
    !previewRequest.value ||
    !pending.value
  )
    return;
  const boardId = props.boardId,
    stamp = epoch,
    proposed = pending.value;
  previewRequest.value = null;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await api()?.executeBoardCreate({
      request: proposed.request,
    });
    if (!current(stamp, boardId)) return;
    if (
      result?.run?.id !== proposed.runId ||
      result?.run?.target?.id !== proposed.taskId ||
      result?.run?.invocationDigest !== proposed.request.invocationDigest
    )
      throw new Error("MISMATCHED_RUN");
    const run = record(result);
    if (run.status === "succeeded") {
      emit("created", run.taskId);
      draft.value = blank();
      await load();
    }
  } catch {
    if (current(stamp, boardId)) {
      runs.value = runs.value.map((run) =>
        run.id === proposed.runId ? { ...run, status: "unknown" } : run,
      );
      failure();
      notice.value = "创建结果尚未确认，请查询记录。系统不会自动重试。";
    }
  } finally {
    if (current(stamp, boardId)) {
      busy.value = false;
      pending.value = null;
    }
  }
}
async function cancel(runId: string) {
  if (!app.isAuthenticated || cancelling.value) return;
  const boardId = props.boardId,
    stamp = ++epoch;
  cancelling.value = true;
  busy.value = false;
  previewRequest.value = null;
  after.value = null;
  error.value = "";
  try {
    const result = await api()?.cancelBoardCreate({ boardId, runId });
    if (!current(stamp, boardId)) return;
    if (result?.run?.id !== runId) throw new Error("MISMATCHED_RUN");
    const run = record(result);
    if (run.status === "succeeded") {
      emit("created", run.taskId);
      draft.value = blank();
      await load();
    }
  } catch {
    if (current(stamp, boardId)) {
      failure();
      notice.value = "取消结果尚未确认，请查询记录。";
    }
  } finally {
    if (current(stamp, boardId)) {
      cancelling.value = false;
      pending.value = null;
    }
  }
}
function display(field: (typeof afterFields)[number], value: any) {
  if (value === null) return "未设置";
  if (field === "priority") return priorities[value as keyof typeof priorities];
  if (field === "columnId")
    return `${source.value?.columns.find((column) => column.id === value)?.name ?? ""}（${value}）`;
  if (field === "status") return "待处理";
  if (field === "taskType") return value === "subtask" ? "子任务" : "任务";
  return value;
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
label {
  display: block;
  margin: 10px 0;
}
input,
select,
textarea {
  display: block;
  width: 100%;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
}
dd {
  margin-left: 12px;
}
</style>
