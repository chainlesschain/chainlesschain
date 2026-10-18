<template>
  <section aria-label="受控任务编辑" class="board-task-editor">
    <h4>编辑任务</h4>
    <p>修改会先生成预览，再由系统窗口确认。只有当前获准的字段可以编辑。</p>
    <a-button data-action="refresh-editor" :disabled="busy" @click="load"
      >刷新来源与记录</a-button
    >
    <form v-if="source" @submit.prevent="preview()">
      <label
        >标题<input
          v-model="draft.title"
          data-field="title"
          :disabled="!canEditField('title')"
          maxlength="1024"
      /></label>
      <label
        >描述<textarea
          v-model="draft.description"
          data-field="description"
          :disabled="!canEditField('description')"
          rows="4"
        />
      </label>
      <label
        >状态<select
          v-model="draft.status"
          data-field="status"
          :disabled="!canEditField('status')"
        >
          <option
            v-for="(label, value) in statuses"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select></label
      >
      <label
        >优先级<select
          v-model="draft.priority"
          data-field="priority"
          :disabled="!canEditField('priority')"
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
        >主要负责人 DID（留空清除）<input
          v-model="draft.assigneeDid"
          data-field="assigneeDid"
          :disabled="!canEditField('assigneeDid')"
          placeholder="did:…"
      /></label>
      <p>负责人须为本组织活跃成员；此处修改主要负责人。</p>
      <label
        >截止时间（UTC Unix 毫秒，留空清除）<input
          v-model="draft.dueDate"
          data-field="dueDate"
          :disabled="!canEditField('dueDate')"
          inputmode="numeric"
          placeholder="例如 1792281600123"
      /></label>
      <p>请输入从 1970-01-01 00:00:00 UTC 起的整数毫秒；0 表示该时刻。</p>
      <label
        >预计工时（小时，留空清除）<input
          v-model="draft.estimatedHours"
          data-field="estimatedHours"
          :disabled="!canEditField('estimatedHours')"
          inputmode="decimal"
      /></label>
      <label
        >实际工时（小时，留空清除）<input
          v-model="draft.actualHours"
          data-field="actualHours"
          :disabled="!canEditField('actualHours')"
          inputmode="decimal"
      /></label>
      <a-button
        data-action="preview-update"
        :disabled="!canEdit"
        @click="preview()"
        >预览修改</a-button
      >
    </form>
    <section v-if="source && movement" aria-label="移动任务">
      <h4>移动任务</h4>
      <p>只调整所在列和位置；任务状态及其他任务的顺序保持原值。</p>
      <label
        >目标列<select
          v-model="moveDraft.columnId"
          data-move-field="columnId"
          :disabled="!canMove"
        >
          <option
            v-for="column in movement.columns"
            :key="column.id"
            :value="column.id"
          >
            {{ column.name }}（{{ column.id }}）
          </option>
        </select></label
      >
      <label
        >位置（0 至 1000000 的整数）<input
          v-model="moveDraft.position"
          data-move-field="position"
          inputmode="numeric"
          :disabled="!canMove"
      /></label>
      <a-button
        data-action="preview-move"
        :disabled="!canMove"
        @click="previewMove"
        >预览移动</a-button
      >
      <p v-if="!movement.editable">当前没有移动此任务的权限。</p>
    </section>
    <p v-if="source && !editable">
      当前任务暂不支持编辑，请刷新并检查权限或存储模式。
    </p>
    <p v-if="hasUnresolved">已有预览或未确认结果的修改，请先取消或结束等待。</p>
    <div v-if="previewRequest" data-update-preview>
      <p>请核对修改前后的内容：</p>
      <template v-if="previewRequest.actionType === 'board-task.move'">
        <dl data-move-preview>
          <dt>所在列及位置</dt>
          <dd>
            移动前：
            <pre
              >{{ columnLabel(moveBefore.columnId) }}（{{
                moveBefore.columnId
              }}），位置 {{ moveBefore.position }}</pre
            >
          </dd>
          <dd>
            移动后：
            <pre
              >{{ columnLabel(moveAfter.columnId) }}（{{
                moveAfter.columnId
              }}），位置 {{ moveAfter.position }}</pre
            >
          </dd>
        </dl>
      </template>
      <dl
        v-for="field in previewRequest.actionType === 'board-task.move'
          ? []
          : fields"
        :key="field"
      >
        <dt>{{ labels[field] }}</dt>
        <dd>
          修改前：
          <pre>{{ displayField(field, before[field]) }}</pre>
        </dd>
        <dd>
          修改后：
          <pre>{{ displayField(field, after[field]) }}</pre>
        </dd>
      </dl>
      <a-button
        data-action="execute-update"
        :disabled="busy || !app.isAuthenticated"
        @click="execute"
        >打开系统确认</a-button
      >
    </div>
    <a-button
      v-if="pendingRequest"
      data-action="cancel-update"
      :disabled="cancelling"
      @click="cancelPending"
      >取消本次修改</a-button
    >
    <p v-if="busy" role="status">正在读取或等待确认…</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul aria-label="任务修改记录">
      <li v-for="run in runs" :key="run.id">
        {{ runLabels[run.status] }}
        <a-button
          v-if="['running', 'queued', 'unknown'].includes(run.status)"
          data-action="cancel-recorded-update"
          :disabled="busy || cancelling"
          @click="cancelRecorded(run.id)"
          >结束等待</a-button
        >
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
const props = defineProps<{ taskId: string }>();
const emit = defineEmits<{ updated: [] }>();
const app = useAppStore(),
  identity = useIdentityStore();
const statuses = {
  open: "待处理",
  in_progress: "进行中",
  review: "待审核",
  done: "已完成",
  cancelled: "已取消",
};
const priorities = { low: "低", medium: "中", high: "高", critical: "紧急" };
const fields = [
  "title",
  "description",
  "status",
  "priority",
  "assigneeDid",
  "dueDate",
  "estimatedHours",
  "actualHours",
] as const;
type Field = (typeof fields)[number];
type Fields = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeDid: string | null;
  dueDate: number | null;
  estimatedHours: number | null;
  actualHours: number | null;
};
type Draft = Record<Field, string>;
type Move = { columnId: string; position: number };
type Movement = Move & {
  editable: boolean;
  columns: { id: string; name: string }[];
};
const labels = {
  title: "标题",
  description: "描述",
  status: "状态",
  priority: "优先级",
  assigneeDid: "主要负责人 DID",
  dueDate: "截止时间（UTC Unix 毫秒）",
  estimatedHours: "预计工时（小时）",
  actualHours: "实际工时（小时）",
};
const displayField = (field: Field, value: Fields[Field]) =>
  value === null
    ? "未设置"
    : field === "status"
      ? statuses[value as keyof typeof statuses]
      : field === "priority"
        ? priorities[value as keyof typeof priorities]
        : value;
const runLabels = {
  queued: "等待确认",
  running: "处理中，尚未确认结果",
  succeeded: "修改已保存",
  failed: "修改失败",
  cancelled: "修改已取消",
  denied: "修改未获批准",
  unknown: "结果未知，不会自动重试",
};
type Run = {
  id: string;
  status: keyof typeof runLabels;
  invocationDigest: string;
};
const blank = (): Fields => ({
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  assigneeDid: null,
  dueDate: null,
  estimatedHours: null,
  actualHours: null,
});
const toDraft = (value: Fields): Draft =>
  Object.fromEntries(
    fields.map((field) => [
      field,
      value[field] === null ? "" : String(value[field]),
    ]),
  ) as Draft;
const source = ref<
  (Fields & { id: string; orgId: string; boardId: string }) | null
>(null);
const draft = ref<Draft>(toDraft(blank()));
const movement = ref<Movement | null>(null);
const moveDraft = ref({ columnId: "", position: "0" });
const moveBefore = ref<Move>({ columnId: "", position: 0 }),
  moveAfter = ref<Move>({ columnId: "", position: 0 });
const columnLabel = (id: string) =>
  movement.value?.columns.find((column) => column.id === id)?.name ?? id;
const before = ref<Fields>(blank()),
  after = ref<Fields>(blank());
const previewRequest = shallowRef<any>(null),
  pendingRequest = shallowRef<any>(null);
const pendingRunId = ref<string | null>(null);
const runs = ref<Run[]>([]),
  editable = ref(false),
  busy = ref(false),
  cancelling = ref(false);
const editableFields = ref<Field[]>([]);
const error = ref(""),
  notice = ref("");
const hasUnresolved = computed(
  () =>
    pendingRequest.value !== null ||
    runs.value.some((run) => ["running", "unknown"].includes(run.status)),
);
const canEdit = computed(
  () =>
    app.isAuthenticated &&
    editable.value &&
    editableFields.value.length > 0 &&
    !busy.value &&
    !cancelling.value &&
    !hasUnresolved.value,
);
const canEditField = (field: Field) =>
  canEdit.value && editableFields.value.includes(field);
const canMove = computed(
  () =>
    app.isAuthenticated &&
    editable.value &&
    source.value !== null &&
    movement.value?.editable === true &&
    !busy.value &&
    !cancelling.value &&
    !hasUnresolved.value,
);
const api = () => (window as any).electronAPI?.task;
let epoch = 0,
  draftVersion = 0;
let unsubscribe: (() => void) | undefined;
function invalidate() {
  epoch++;
  source.value = null;
  movement.value = null;
  moveDraft.value = { columnId: "", position: "0" };
  moveBefore.value = { columnId: "", position: 0 };
  moveAfter.value = { columnId: "", position: 0 };
  draft.value = toDraft(blank());
  before.value = blank();
  after.value = blank();
  previewRequest.value = null;
  pendingRequest.value = null;
  pendingRunId.value = null;
  runs.value = [];
  editable.value = false;
  editableFields.value = [];
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
  () => props.taskId,
  () => {
    invalidate();
    void load();
  },
  { flush: "sync" },
);
watch(
  [draft, moveDraft],
  () => {
    draftVersion++;
    previewRequest.value = null;
  },
  { deep: true, flush: "sync" },
);
const current = (stamp: number, taskId: string) =>
  stamp === epoch && app.isAuthenticated && props.taskId === taskId;
function textFields(value: any): Fields {
  if (
    !value ||
    ["title", "description", "status", "priority"].some(
      (key) => typeof value[key] !== "string",
    ) ||
    !value.title.trim() ||
    new TextEncoder().encode(value.title).byteLength > 1024 ||
    new TextEncoder().encode(value.description).byteLength > 8192 ||
    !Object.hasOwn(statuses, value.status) ||
    !Object.hasOwn(priorities, value.priority) ||
    !(
      value.assigneeDid === null ||
      (typeof value.assigneeDid === "string" &&
        /^did:[^\s\u0000-\u001f\u007f]+$/u.test(value.assigneeDid) &&
        new TextEncoder().encode(value.assigneeDid).byteLength <= 256)
    ) ||
    !(
      value.dueDate === null ||
      (Number.isSafeInteger(value.dueDate) &&
        value.dueDate >= 0 &&
        value.dueDate <= 8640000000000000)
    ) ||
    ["estimatedHours", "actualHours"].some(
      (key) =>
        !(
          value[key] === null ||
          (typeof value[key] === "number" &&
            Number.isFinite(value[key]) &&
            value[key] >= 0 &&
            value[key] <= 1000000)
        ),
    )
  )
    throw new Error("INVALID_TASK_FIELDS");
  return {
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    assigneeDid: value.assigneeDid,
    dueDate: value.dueDate,
    estimatedHours: value.estimatedHours,
    actualHours: value.actualHours,
  };
}
function draftFields(): Fields {
  const number = (key: "dueDate" | "estimatedHours" | "actualHours") => {
    const raw = draft.value[key];
    if (raw === "") return null;
    if (
      !(
        key === "dueDate"
          ? /^\d+$/u
          : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u
      ).test(raw)
    )
      throw new Error("INVALID_TASK_FIELDS");
    return Number(raw);
  };
  return textFields({
    ...draft.value,
    assigneeDid:
      draft.value.assigneeDid === "" ? null : draft.value.assigneeDid,
    dueDate: number("dueDate"),
    estimatedHours: number("estimatedHours"),
    actualHours: number("actualHours"),
  });
}
function projectRun(value: any): Run {
  const run = value?.run;
  if (
    !run ||
    ![
      "board-task.update",
      "board-task.update-fields",
      "board-task.move",
      "board-task.create",
    ].includes(run.actionType) ||
    run.actionVersion !== 1 ||
    run.target?.sourceKind !== "desktop.board-task" ||
    run.target.id !== props.taskId ||
    run.target.scope?.kind !== "organization" ||
    (source.value && run.target.scope.id !== source.value.orgId) ||
    typeof run.id !== "string" ||
    !run.id ||
    !Object.hasOwn(runLabels, run.status) ||
    typeof run.invocationDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(run.invocationDigest)
  )
    throw new Error("INVALID_ACTION_RUN");
  return {
    id: run.id,
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
  const rows = result.runs.map(projectRun);
  if (new Set(rows.map((run: Run) => run.id)).size !== rows.length)
    throw new Error("INVALID_RUNS");
  if (result.unresolvedRun == null) return rows;
  const unresolved = projectRun(result.unresolvedRun);
  if (!["running", "unknown"].includes(unresolved.status))
    throw new Error("INVALID_UNRESOLVED_RUN");
  return [unresolved, ...rows.filter((run: Run) => run.id !== unresolved.id)];
}
function failure() {
  error.value = "修改暂不可用，请刷新来源并检查当前权限。";
}
function moveFields(value: any): Move {
  if (
    !value ||
    typeof value.columnId !== "string" ||
    !movement.value?.columns.some((column) => column.id === value.columnId) ||
    !Number.isSafeInteger(value.position) ||
    value.position < 0 ||
    value.position > 1000000 ||
    Object.keys(value).some((key) => !["columnId", "position"].includes(key))
  )
    throw new Error("INVALID_MOVE");
  return { columnId: value.columnId, position: value.position };
}
function projectMovement(value: any): Movement | null {
  if (value == null) return null;
  if (
    typeof value.editable !== "boolean" ||
    !Array.isArray(value.columns) ||
    value.columns.length < 1 ||
    value.columns.length > 200
  )
    throw new Error("INVALID_MOVEMENT");
  const columns = value.columns.map((column: any) => {
    if (
      !column ||
      typeof column.id !== "string" ||
      !column.id ||
      typeof column.name !== "string" ||
      !column.name.trim() ||
      new TextEncoder().encode(column.name).byteLength > 4096 ||
      Object.keys(column).some((key) => !["id", "name"].includes(key))
    )
      throw new Error("INVALID_MOVEMENT");
    return { id: column.id, name: column.name };
  });
  if (
    columns.reduce(
      (bytes: number, column: { id: string; name: string }) =>
        bytes +
        new TextEncoder().encode(column.id).byteLength +
        new TextEncoder().encode(column.name).byteLength,
      0,
    ) > 65536 ||
    new Set(columns.map((column: any) => column.id)).size !== columns.length ||
    !columns.some((column: any) => column.id === value.columnId) ||
    !Number.isSafeInteger(value.position) ||
    value.position < 0 ||
    value.position > 1000000
  )
    throw new Error("INVALID_MOVEMENT");
  return {
    editable: value.editable,
    columnId: value.columnId,
    position: value.position,
    columns,
  };
}
async function load() {
  if (!app.isAuthenticated || !props.taskId) {
    invalidate();
    return;
  }
  const taskId = props.taskId,
    stamp = ++epoch;
  pendingRequest.value = null;
  pendingRunId.value = null;
  cancelling.value = false;
  busy.value = true;
  error.value = "";
  previewRequest.value = null;
  source.value = null;
  movement.value = null;
  editable.value = false;
  editableFields.value = [];
  runs.value = [];
  try {
    const result = await api()?.getBoardEditSource({ taskId });
    if (!current(stamp, taskId)) return;
    const task = result?.task;
    if (
      result?.success !== true ||
      task?.id !== taskId ||
      typeof task.orgId !== "string" ||
      !task.orgId ||
      typeof task.boardId !== "string" ||
      !task.boardId ||
      typeof result.editable !== "boolean" ||
      !Array.isArray(result.editableFields) ||
      result.editableFields.some((field: any) => !fields.includes(field)) ||
      new Set(result.editableFields).size !== result.editableFields.length
    )
      throw new Error("INVALID_SOURCE");
    const projected = textFields(task);
    source.value = {
      ...projected,
      id: taskId,
      orgId: task.orgId,
      boardId: task.boardId,
    };
    draft.value = toDraft(projected);
    editable.value = result.editable;
    editableFields.value = [...result.editableFields];
    movement.value = projectMovement(result.movement);
    if (movement.value)
      moveDraft.value = {
        columnId: movement.value.columnId,
        position: String(movement.value.position),
      };
    const history = await api()?.getBoardUpdateRuns({ taskId, limit: 20 });
    if (current(stamp, taskId)) runs.value = projectRuns(history);
  } catch {
    if (current(stamp, taskId)) {
      source.value = null;
      movement.value = null;
      editable.value = false;
      runs.value = [];
      failure();
    }
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
async function preview(isMove = false) {
  if (!(isMove ? canMove.value : canEdit.value) || !source.value) return;
  const taskId = props.taskId,
    stamp = epoch,
    editing = draftVersion;
  previewRequest.value = null;
  error.value = "";
  notice.value = "";
  try {
    const values = isMove ? null : draftFields();
    if (isMove && !/^\d+$/u.test(moveDraft.value.position))
      throw new Error("INVALID_MOVE");
    const updates = isMove
      ? moveFields({
          columnId: moveDraft.value.columnId,
          position: Number(moveDraft.value.position),
        })
      : Object.fromEntries(
          fields
            .filter((field) => values![field] !== source.value![field])
            .map((field) => [field, values![field]]),
        );
    if (
      !isMove &&
      Object.keys(updates).some(
        (field) => !editableFields.value.includes(field as Field),
      )
    )
      throw new Error("FIELD_NOT_EDITABLE");
    if (
      !Object.keys(updates).length ||
      (isMove &&
        updates.columnId === movement.value?.columnId &&
        updates.position === movement.value?.position)
    ) {
      notice.value = "没有需要保存的修改。";
      return;
    }
    busy.value = true;
    const idempotencyKey = crypto.randomUUID();
    const result = await api()?.previewBoardUpdate({
      taskId,
      updates,
      idempotencyKey,
    });
    if (!current(stamp, taskId) || editing !== draftVersion) return;
    const request = result?.request;
    if (
      result?.success !== true ||
      typeof result.runId !== "string" ||
      !result.runId ||
      request?.actionType !==
        (isMove ? "board-task.move" : "board-task.update-fields") ||
      request.actionVersion !== 1 ||
      request.target?.sourceKind !== "desktop.board-task" ||
      request.target.type !== "Task" ||
      request.target.id !== taskId ||
      request.target.scope?.kind !== "organization" ||
      request.target.scope.id !== source.value.orgId ||
      request.idempotencyKey !== idempotencyKey ||
      request.expectedVersion !== request.target.version ||
      typeof request.expectedVersion !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(request.expectedVersion) ||
      typeof request.invocationDigest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(request.invocationDigest)
    )
      throw new Error("INVALID_PREVIEW");
    if (isMove) {
      const previous = moveFields(result.before),
        next = moveFields(result.after);
      const proposed = moveFields(request.input?.updates);
      if (
        next.columnId !== updates.columnId ||
        next.position !== updates.position ||
        proposed.columnId !== updates.columnId ||
        proposed.position !== updates.position
      )
        throw new Error("MISMATCHED_MOVE");
      moveBefore.value = previous;
      moveAfter.value = next;
    } else {
      const previous = textFields(result.before),
        next = textFields(result.after);
      if (
        fields.some(
          (field) =>
            next[field] !==
            (Object.hasOwn(updates, field) ? values![field] : previous[field]),
        )
      )
        throw new Error("MISMATCHED_PREVIEW");
      before.value = previous;
      after.value = next;
    }
    previewRequest.value = request;
    pendingRequest.value = request;
    pendingRunId.value = result.runId;
    runs.value = [
      {
        id: result.runId,
        status: "queued",
        invocationDigest: request.invocationDigest,
      },
      ...runs.value,
    ].slice(0, 20);
  } catch {
    if (current(stamp, taskId)) failure();
  } finally {
    if (current(stamp, taskId)) busy.value = false;
  }
}
const previewMove = () => preview(true);
function record(result: any) {
  if (result?.success !== true) throw new Error("ACTION_UNAVAILABLE");
  const run = projectRun(result);
  // Updating a recent receipt must not evict the separately recovered older run.
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
    !previewRequest.value
  )
    return;
  const taskId = props.taskId,
    stamp = epoch,
    request = previewRequest.value;
  pendingRequest.value = request;
  previewRequest.value = null;
  busy.value = true;
  notice.value = "";
  error.value = "";
  try {
    const result = await api()?.executeBoardUpdate({ request });
    if (!current(stamp, taskId)) return;
    if (result?.run?.invocationDigest !== request.invocationDigest)
      throw new Error("MISMATCHED_RUN");
    const run = record(result);
    if (run.status === "succeeded") {
      emit("updated");
      await load();
    }
  } catch {
    if (current(stamp, taskId)) {
      runs.value = runs.value.map((run) =>
        run.id === pendingRunId.value ? { ...run, status: "unknown" } : run,
      );
      failure();
      notice.value = "执行结果尚未确认，请查询记录。系统不会自动重试。";
    }
  } finally {
    if (current(stamp, taskId)) {
      busy.value = false;
      pendingRequest.value = null;
      pendingRunId.value = null;
    }
  }
}
async function cancelRecorded(runId: string) {
  if (!app.isAuthenticated || cancelling.value) return;
  const taskId = props.taskId,
    stamp = ++epoch;
  cancelling.value = true;
  busy.value = false;
  previewRequest.value = null;
  error.value = "";
  try {
    const result = await api()?.cancelBoardUpdate({ taskId, runId });
    if (!current(stamp, taskId)) return;
    if (result?.run?.id !== runId) throw new Error("MISMATCHED_RUN");
    const run = record(result);
    if (run.status === "succeeded") {
      emit("updated");
      await load();
    }
  } catch {
    if (current(stamp, taskId)) {
      failure();
      notice.value = "取消结果尚未确认，请查询记录。";
    }
  } finally {
    if (current(stamp, taskId)) {
      cancelling.value = false;
      pendingRequest.value = null;
      pendingRunId.value = null;
    }
  }
}
async function cancelPending() {
  if (!pendingRequest.value || !pendingRunId.value || cancelling.value) return;
  await cancelRecorded(pendingRunId.value);
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
.board-task-editor {
  margin: 16px 0;
}
label {
  display: block;
  margin: 8px 0;
}
input,
textarea,
select {
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
