<template>
  <section v-if="available" data-testid="goal-memory-panel">
    <h5>目标记忆</h5>
    <p>只保存你明确提交的内容，仅供当前个人项目的本目标使用。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <form v-if="goal.status !== 'done'" @submit.prevent="save">
      <label
        >内容分类
        <select
          v-model="category"
          :disabled="busy || !!pending"
          data-testid="memory-category"
        >
          <option value="user-fact">用户明确事实</option>
          <option value="agent-inference">Agent 推断</option>
          <option value="execution-note">执行备注</option>
        </select>
      </label>
      <label
        >记忆内容<textarea
          v-model="content"
          :disabled="busy || !!pending"
          maxlength="8192"
          data-testid="memory-content"
        />
      </label>
      <label
        >到期时间（可选，本机时区）<input
          v-model="expiry"
          type="datetime-local"
          :disabled="busy || !!pending"
      /></label>
      <button
        :disabled="busy || (!pending && !content.trim())"
        data-testid="save-memory"
      >
        {{
          pending?.method === "recoverGoalMemoryOperation"
            ? "核对本次修正结果"
            : pending
              ? "核对或重试本次保存"
              : editing
                ? "保存修正版本"
                : "保存新记忆"
        }}
      </button>
      <button
        v-if="editing && !pending"
        type="button"
        :disabled="busy"
        @click="clearDraft"
      >
        取消修正
      </button>
    </form>
    <p>推断与执行备注会保留分类；它们不证明任务或目标已完成。</p>
    <button :disabled="busy" data-testid="refresh-memories" @click="load()">
      刷新授权与记忆
    </button>
    <ul>
      <li
        v-for="item in items"
        :key="item.memoryId"
        :data-memory-id="item.memoryId"
      >
        <p>{{ grantLabel(item.grantState) }} · {{ stateLabel(item.state) }}</p>
        <template v-if="item.record">
          <p>
            {{ categoryLabel(item.record.category) }} · 版本
            {{ item.record.revision }}
          </p>
          <p>
            来源：{{ categoryLabel(item.record.category) }}；记录于
            {{ item.record.provenance.observedAt }}；更新于
            {{ item.record.updatedAt }}
          </p>
          <p v-if="item.record.retentionPolicy.expiresAt">
            到期：{{ item.record.retentionPolicy.expiresAt }}
          </p>
          <pre data-testid="memory-body">{{ item.record.content }}</pre>
          <button
            v-if="goal.status !== 'done'"
            :disabled="busy || !!pending"
            @click="edit(item)"
          >
            修正
          </button>
        </template>
        <p v-else>当前不能使用此版本的正文。</p>
        <button
          v-if="item.grantState === 'active'"
          :disabled="busy"
          data-testid="revoke-memory"
          @click="mutate('revokeGoalMemory', item)"
        >
          撤销本目标使用权
        </button>
        <button
          v-if="canDelete(item)"
          :disabled="busy"
          data-testid="delete-memory"
          @click="confirmDelete = item.memoryId"
        >
          删除记忆
        </button>
        <div v-if="confirmDelete === item.memoryId">
          <p>删除后不能继续使用这条记忆，删除记录会保留。</p>
          <button
            :disabled="busy"
            data-testid="confirm-memory-delete"
            @click="mutate('deleteGoalMemory', item)"
          >
            确认删除
          </button>
          <button :disabled="busy" @click="confirmDelete = null">取消</button>
        </div>
      </li>
    </ul>
    <button v-if="cursor" :disabled="busy" @click="load(cursor)">
      下一页记忆（替换当前显示）
    </button>
    <h6 v-if="operations.length">操作记录与恢复</h6>
    <ul>
      <li
        v-for="operation in operations"
        :key="operation.requestId"
        :data-operation-id="operation.requestId"
      >
        <span
          >{{ operationLabel(operation.type) }}：{{
            operationState(operation.status)
          }}</span
        >
        <p v-if="operation.result?.receipt">
          删除回执：{{
            operation.result.receipt.status === "purged"
              ? "清理已完成"
              : "清理仍待恢复"
          }}
        </p>
        <template v-if="!['complete', 'discarded'].includes(operation.status)">
          <button
            :disabled="busy"
            data-testid="recover-memory"
            @click="recover(operation)"
          >
            核对并恢复此操作
          </button>
          <button
            v-if="['create', 'correct'].includes(operation.type)"
            :disabled="busy"
            data-testid="discard-memory-operation"
            @click="discard(operation)"
          >
            放弃保存并清理未关联记忆
          </button>
        </template>
      </li>
    </ul>
    <button
      v-if="operationCursor"
      :disabled="busy"
      @click="loadOperations(operationCursor)"
    >
      下一页操作记录
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = { id: string; revision: number; status: string };
type MemoryRef = { kind: string; id: string; version: string };
type Memory = {
  category: string;
  revision: number;
  content: string;
  updatedAt: string;
  provenance: { source: string; observedAt: string };
  retentionPolicy: { expiresAt?: string };
};
type Item = {
  memoryId: string;
  reference: MemoryRef;
  currentVersion: string | null;
  grantState: string;
  state: string;
  record: Memory | null;
};
type Operation = {
  requestId: string;
  type: string;
  status: string;
  result: { receipt: null | { status: string } } | null;
};
type Input = {
  goalId: string;
  expectedRevision: number;
  requestId: string;
  [key: string]: unknown;
};
type Result = {
  goal: Goal;
  operation: Operation;
  blockedReason?: string;
  receipt?: { status: string };
};
type Api = {
  listGoalMemories(input: {
    goalId: string;
    limit: number;
    afterId?: string;
  }): Promise<{
    goalId: string;
    goalRevision: number;
    items: Item[];
    nextCursor: string | null;
  }>;
  listGoalMemoryOperations(input: {
    goalId: string;
    limit: number;
    afterId?: string;
  }): Promise<{
    goalId: string;
    items: Operation[];
    nextCursor: string | null;
  }>;
  createGoalMemory(input: Input): Promise<Result>;
  correctGoalMemory(input: Input): Promise<Result>;
  deleteGoalMemory(input: Input): Promise<Result>;
  revokeGoalMemory(input: Input): Promise<Result>;
  recoverGoalMemoryOperation(input: {
    goalId: string;
    requestId: string;
  }): Promise<Result>;
  discardGoalMemoryOperation(input: Input): Promise<Result>;
  onGoalMemoryInvalidated(listener: () => void): () => void;
};
const props = defineProps<{ goal: Goal; identityKey?: string }>();
const emit = defineEmits<{
  (event: "goal-changed"): void;
  (event: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: Api } }).electronAPI
    ?.project;
const available = computed(() =>
  [
    "listGoalMemories",
    "listGoalMemoryOperations",
    "createGoalMemory",
    "correctGoalMemory",
    "deleteGoalMemory",
    "revokeGoalMemory",
    "recoverGoalMemoryOperation",
    "discardGoalMemoryOperation",
    "onGoalMemoryInvalidated",
  ].every((name) => typeof api()?.[name as keyof Api] === "function"),
);
const content = ref(""),
  category = ref("user-fact"),
  expiry = ref("");
const items = ref<Item[]>([]),
  operations = ref<Operation[]>([]),
  cursor = ref<string | null>(null),
  operationCursor = ref<string | null>(null);
const busy = ref(false),
  error = ref(""),
  message = ref(""),
  confirmDelete = ref<string | null>(null),
  editing = ref<Item | null>(null);
const pending = ref<
  | null
  | { method: "createGoalMemory" | "correctGoalMemory"; request: Input }
  | {
      method: "recoverGoalMemoryOperation";
      request: { goalId: string; requestId: string };
    }
>(null);
const mutation = ref<null | {
  method: "deleteGoalMemory" | "revokeGoalMemory";
  request: Input;
}>(null);
const discardRequests = new Map<string, Input>();
let epoch = 0,
  readEpoch = 0,
  writing = false,
  refreshAfterWrite = false,
  mounted = true,
  stopListener: (() => void) | undefined,
  expiryTimer: number | undefined;
const current = (stamp: number) => mounted && stamp === epoch;
function finishWrite(stamp: number) {
  if (!current(stamp)) return;
  writing = false;
  busy.value = false;
  if (refreshAfterWrite) {
    refreshAfterWrite = false;
    void load();
  }
}
const newId = () => `goal-memory-${crypto.randomUUID()}`;
function clearBodies() {
  if (pending.value?.method === "correctGoalMemory")
    pending.value = {
      method: "recoverGoalMemoryOperation",
      request: {
        goalId: pending.value.request.goalId,
        requestId: pending.value.request.requestId,
      },
    };
  if (editing.value) clearDraft();
  items.value = [];
  cursor.value = null;
  confirmDelete.value = null;
  if (expiryTimer) window.clearTimeout(expiryTimer);
}
function clearDraft() {
  content.value = "";
  category.value = "user-fact";
  expiry.value = "";
  editing.value = null;
}
function reset() {
  epoch++;
  readEpoch++;
  writing = false;
  refreshAfterWrite = false;
  clearBodies();
  clearDraft();
  operations.value = [];
  operationCursor.value = null;
  pending.value = null;
  mutation.value = null;
  discardRequests.clear();
  busy.value = false;
  error.value = "";
  message.value = "";
}
function failure(value: unknown, fallback: string) {
  clearBodies();
  if (isAuthorityError(value)) {
    reset();
    error.value = "当前身份已无法读取目标记忆。";
    emit("authority-error");
  } else {
    const code = actionCode(value);
    if (
      code === "GOAL_MEMORY_OPERATION_NOT_FOUND" &&
      pending.value?.method === "recoverGoalMemoryOperation"
    ) {
      pending.value = null;
      clearDraft();
      error.value = "宿主尚未记录这次修正，请重新输入内容。";
      return;
    }
    if (/REVISION_CONFLICT|VERSION_CONFLICT|NOT_FOUND_OR_DENIED/.test(code)) {
      pending.value = null;
      mutation.value = null;
      clearDraft();
      emit("goal-changed");
    }
    error.value = code ? `${fallback}（${code}）` : fallback;
  }
}
function scheduleExpiry() {
  if (expiryTimer) window.clearTimeout(expiryTimer);
  const times = items.value
    .flatMap((item) =>
      item.record?.retentionPolicy.expiresAt
        ? [Date.parse(item.record.retentionPolicy.expiresAt)]
        : [],
    )
    .filter(Number.isFinite);
  if (times.length)
    expiryTimer = window.setTimeout(
      () => {
        clearBodies();
        void load();
      },
      Math.min(2147483647, Math.max(0, Math.min(...times) - Date.now())),
    );
}
async function load(afterId?: string) {
  if (!available.value) return;
  const stamp = epoch;
  const readStamp = ++readEpoch;
  busy.value = true;
  error.value = "";
  clearBodies();
  try {
    const [memories, history] = await Promise.all([
      api()!.listGoalMemories({
        goalId: props.goal.id,
        limit: 20,
        ...(afterId ? { afterId } : {}),
      }),
      api()!.listGoalMemoryOperations({ goalId: props.goal.id, limit: 20 }),
    ]);
    if (!current(stamp) || readStamp !== readEpoch) return;
    if (memories.goalId !== props.goal.id || history.goalId !== props.goal.id)
      throw new Error("GOAL_MEMORY_OUTPUT_STALE");
    if (memories.goalRevision !== props.goal.revision) {
      clearBodies();
      emit("goal-changed");
      return;
    }
    // Do not append cached bodies from a previously authorized page.
    items.value = memories.items.map((item) => {
      const expiresAt = item.record?.retentionPolicy.expiresAt;
      if (
        expiresAt &&
        (!Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Date.now())
      )
        return { ...item, record: null, state: "expired" };
      return item;
    });
    cursor.value = memories.nextCursor;
    operations.value = history.items;
    operationCursor.value = history.nextCursor;
    scheduleExpiry();
  } catch (value) {
    if (current(stamp) && readStamp === readEpoch) {
      operations.value = [];
      operationCursor.value = null;
      failure(value, "记忆读取失败，旧正文已清除。");
    }
  } finally {
    if (current(stamp) && readStamp === readEpoch) busy.value = false;
  }
}
async function loadOperations(afterId: string) {
  const stamp = epoch;
  const readStamp = readEpoch;
  busy.value = true;
  try {
    const result = await api()!.listGoalMemoryOperations({
      goalId: props.goal.id,
      limit: 20,
      afterId,
    });
    if (!current(stamp) || readStamp !== readEpoch) return;
    if (result.goalId !== props.goal.id)
      throw new Error("GOAL_MEMORY_OUTPUT_STALE");
    operations.value = result.items;
    operationCursor.value = result.nextCursor;
  } catch (value) {
    if (current(stamp) && readStamp === readEpoch)
      failure(value, "操作记录读取失败。");
  } finally {
    if (current(stamp) && readStamp === readEpoch) busy.value = false;
  }
}
function edit(item: Item) {
  if (!item.record) return;
  editing.value = item;
  content.value = item.record.content;
  category.value = item.record.category;
  const at = item.record.retentionPolicy.expiresAt;
  if (at) {
    const date = new Date(at);
    expiry.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  } else expiry.value = "";
}
function receipt(result: Result) {
  if (result.goal.id !== props.goal.id)
    throw new Error("GOAL_MEMORY_OUTPUT_STALE");
  if (result.blockedReason === "GOAL_MEMORY_ORIGINAL_INPUT_REQUIRED")
    message.value = "尚未保存正文；请放弃旧操作，再重新提交内容。";
  else if (result.blockedReason)
    message.value = "目标已改变，原操作尚未完成；可放弃并清理未关联记忆。";
  else if (
    result.receipt?.status !== undefined &&
    result.receipt.status !== "purged"
  )
    message.value = "读取已阻断；清理尚未完成，可从操作记录继续恢复。";
  else
    message.value =
      result.operation.status === "discarded"
        ? "未完成的保存已放弃。"
        : "操作结果已记录。";
  clearBodies();
  if (result.goal.revision !== props.goal.revision) emit("goal-changed");
}
async function save() {
  if (!pending.value) {
    const request: Input = {
      goalId: props.goal.id,
      expectedRevision: props.goal.revision,
      requestId: newId(),
      content: content.value,
      category: category.value,
    };
    if (expiry.value) {
      const epoch = Date.parse(expiry.value);
      if (!Number.isFinite(epoch)) {
        error.value = "请选择有效的到期时间。";
        return;
      }
      request.expiresAt = new Date(epoch).toISOString();
    }
    if (editing.value) {
      request.memoryId = editing.value.memoryId;
      request.memoryVersion = editing.value.currentVersion;
    }
    pending.value = {
      method: editing.value ? "correctGoalMemory" : "createGoalMemory",
      request,
    };
  }
  const stamp = epoch;
  writing = true;
  busy.value = true;
  error.value = "";
  try {
    const result =
      pending.value.method === "recoverGoalMemoryOperation"
        ? await api()!.recoverGoalMemoryOperation(pending.value.request)
        : await api()![pending.value.method](pending.value.request);
    if (!current(stamp)) return;
    receipt(result);
    pending.value = null;
    clearDraft();
    await load();
  } catch (value) {
    if (current(stamp))
      failure(value, "保存结果待核对，请沿本次请求重试或查看操作记录。");
  } finally {
    finishWrite(stamp);
  }
}
async function mutate(
  method: "deleteGoalMemory" | "revokeGoalMemory",
  item: Item,
) {
  if (
    !mutation.value ||
    mutation.value.method !== method ||
    mutation.value.request.memoryId !== item.memoryId
  )
    mutation.value = {
      method,
      request: {
        goalId: props.goal.id,
        expectedRevision: props.goal.revision,
        requestId: newId(),
        memoryId: item.memoryId,
        memoryVersion:
          method === "revokeGoalMemory"
            ? item.reference.version
            : item.currentVersion,
      },
    };
  const stamp = epoch;
  writing = true;
  busy.value = true;
  error.value = "";
  clearBodies();
  try {
    const result = await api()![method](mutation.value.request);
    if (!current(stamp)) return;
    receipt(result);
    mutation.value = null;
    await load();
  } catch (value) {
    if (current(stamp))
      failure(value, "操作结果待核对，请刷新后从原操作记录恢复。");
  } finally {
    finishWrite(stamp);
  }
}
async function recover(operation: Operation) {
  const stamp = epoch;
  writing = true;
  busy.value = true;
  error.value = "";
  clearBodies();
  try {
    const result = await api()!.recoverGoalMemoryOperation({
      goalId: props.goal.id,
      requestId: operation.requestId,
    });
    if (!current(stamp)) return;
    receipt(result);
    await load();
  } catch (value) {
    if (current(stamp))
      failure(value, "恢复结果待核对，请继续读取原操作记录。");
  } finally {
    finishWrite(stamp);
  }
}
async function discard(operation: Operation) {
  if (!discardRequests.has(operation.requestId))
    discardRequests.set(operation.requestId, {
      goalId: props.goal.id,
      expectedRevision: props.goal.revision,
      operationRequestId: operation.requestId,
      requestId: newId(),
    });
  const stamp = epoch;
  writing = true;
  busy.value = true;
  error.value = "";
  clearBodies();
  try {
    const result = await api()!.discardGoalMemoryOperation(
      discardRequests.get(operation.requestId)!,
    );
    if (!current(stamp)) return;
    receipt(result);
    discardRequests.delete(operation.requestId);
    pending.value = null;
    clearDraft();
    await load();
  } catch (value) {
    if (current(stamp)) failure(value, "放弃操作仍待核对，请沿原记录恢复。");
  } finally {
    finishWrite(stamp);
  }
}
const canDelete = (item: Item) =>
  item.currentVersion &&
  item.grantState !== "deleted" &&
  !["deleted", "purged"].includes(item.state);
const categoryLabel = (value: string) =>
  ({
    "user-fact": "用户明确事实",
    "agent-inference": "Agent 推断",
    "execution-note": "执行备注",
  })[value] || "来源分类待核对";
const grantLabel = (value: string) =>
  ({
    active: "已关联",
    revoked: "使用权已撤销",
    corrected: "已被修正",
    deleted: "读取已阻断",
  })[value] || "授权待核对";
const stateLabel = (value: string) =>
  ({
    active: "有效",
    reinforced: "有效",
    superseded: "旧版本",
    deleted: "清理待恢复",
    purged: "清理已完成",
    missing: "记录不可用",
  })[value] || "当前不可用";
const operationLabel = (value: string) =>
  ({ create: "保存", correct: "修正", revoke: "撤权", delete: "删除" })[
    value
  ] || "记忆操作";
const operationState = (value: string) =>
  ({
    prepared: "尚未完成",
    denied: "读取已阻断，清理待核对",
    complete: "已完成",
    "discard-requested": "放弃清理中",
    discarded: "已放弃",
  })[value] || "待核对";
watch(
  () => [props.goal.id, props.goal.revision, props.identityKey],
  () => {
    reset();
    void load();
  },
  { immediate: true },
);
onMounted(() => {
  stopListener = api()?.onGoalMemoryInvalidated?.(() => {
    readEpoch++;
    clearBodies();
    clearDraft();
    if (writing) {
      refreshAfterWrite = true;
      return;
    }
    busy.value = false;
    void load();
  });
});
onBeforeUnmount(() => {
  mounted = false;
  reset();
  stopListener?.();
});
</script>

<style scoped>
section {
  margin-top: 1rem;
}
form,
label {
  display: block;
  margin: 0.5rem 0;
}
textarea {
  display: block;
  width: 100%;
  min-height: 5rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
button {
  margin: 0.25rem;
}
</style>
