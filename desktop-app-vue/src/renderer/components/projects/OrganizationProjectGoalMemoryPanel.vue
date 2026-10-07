<template>
  <section
    v-if="available && canRead"
    data-testid="organization-goal-memory-panel"
  >
    <h5>组织目标共享记忆</h5>
    <p>
      只保存明确提交的内容，供本目标的授权成员共享。事实、推断和执行备注保留分类，不代表目标通过验收。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <form v-if="canWrite && goal.status !== 'done'" @submit.prevent="submit">
      <label
        >内容分类<select
          v-model="category"
          :disabled="locked || !!pending"
          data-testid="organization-memory-category"
        >
          <option value="user-fact">成员明确事实</option>
          <option value="agent-inference">Agent 推断</option>
          <option value="execution-note">执行备注</option>
        </select></label
      >
      <label
        >记忆内容<textarea
          v-model="content"
          :disabled="locked || !!pending"
          data-testid="organization-memory-content"
        />
      </label>
      <label
        >到期时间（可选，本机时区）<input
          v-model="expiry"
          type="datetime-local"
          :disabled="locked || !!pending"
          data-testid="organization-memory-expiry"
      /></label>
      <button
        :disabled="locked || !!pending || !validContent"
        data-testid="organization-memory-save"
      >
        {{ editing ? "确认保存修正版本" : "确认保存共享记忆" }}
      </button>
      <button
        v-if="editing && !pending"
        type="button"
        :disabled="locked"
        @click="clearDraft"
      >
        取消修正
      </button>
    </form>
    <p v-if="pending" role="status">
      原操作结果待核对，保留同一请求，不自动重复保存。
    </p>
    <button
      v-if="pending && canRecover(pending.type)"
      :disabled="locked"
      data-testid="organization-memory-retry"
      @click="retry"
    >
      核对原操作结果
    </button>
    <button
      v-if="pending && canWrite && ['create', 'correct'].includes(pending.type)"
      :disabled="locked"
      data-testid="organization-memory-discard-pending"
      @click="discard(pending.input.requestId)"
    >
      放弃原保存并清理未关联记忆
    </button>
    <button
      :disabled="locked"
      data-testid="organization-memory-refresh"
      @click="load()"
    >
      刷新授权与记忆
    </button>
    <ul>
      <li
        v-for="item in items"
        :key="item.memoryId"
        :data-organization-memory-id="item.memoryId"
      >
        <p>{{ grantLabel(item.grantState) }} · {{ stateLabel(item.state) }}</p>
        <template v-if="item.record">
          <p>
            {{ categoryLabel(item.record.category) }} · 版本
            {{ item.record.revision }}
          </p>
          <p>
            来源：{{ item.record.provenance.source }} ·
            {{ item.record.provenance.observedAt }}
          </p>
          <p v-if="item.record.retentionPolicy.expiresAt">
            到期：{{ item.record.retentionPolicy.expiresAt }}
          </p>
          <pre data-testid="organization-memory-body">{{
            item.record.content
          }}</pre>
          <button
            v-if="canWrite && goal.status !== 'done'"
            :disabled="locked || !!pending"
            data-testid="organization-memory-edit"
            @click="edit(item)"
          >
            修正
          </button>
        </template>
        <p v-else>当前不能使用此版本的正文。</p>
        <button
          v-if="canWrite && item.grantState === 'active'"
          :disabled="locked || !!pending"
          data-testid="organization-memory-revoke"
          @click="mutate('revokeGoalMemory', item)"
        >
          撤销本目标使用权
        </button>
        <button
          v-if="
            canDelete &&
            item.currentVersion &&
            item.grantState !== 'deleted' &&
            !['deleted', 'purged'].includes(item.state)
          "
          :disabled="locked || !!pending"
          data-testid="organization-memory-delete"
          @click="mutate('deleteGoalMemory', item)"
        >
          确认删除共享记忆
        </button>
      </li>
    </ul>
    <button
      v-if="cursor"
      :disabled="locked"
      data-testid="organization-memory-more"
      @click="load(cursor)"
    >
      下一页记忆（替换当前显示）
    </button>
    <h6 v-if="operations.length">我的操作记录与恢复</h6>
    <ul>
      <li
        v-for="operation in operations"
        :key="operation.requestId"
        :data-organization-memory-operation="operation.requestId"
      >
        <p>
          {{ operationLabel(operation.type) }}：{{
            operationState(operation.status)
          }}
        </p>
        <p v-if="operation.result?.receipt">
          删除回执：{{
            operation.result.receipt.status === "purged"
              ? "清理已完成"
              : "清理仍待恢复"
          }}
        </p>
        <template v-if="!['complete', 'discarded'].includes(operation.status)">
          <button
            v-if="canRecover(operation.type)"
            :disabled="locked || !!pending"
            data-testid="organization-memory-recover"
            @click="recover(operation)"
          >
            核对并恢复此操作
          </button>
          <button
            v-if="canWrite && ['create', 'correct'].includes(operation.type)"
            :disabled="locked || !!pending"
            data-testid="organization-memory-discard"
            @click="discard(operation.requestId)"
          >
            放弃保存并清理未关联记忆
          </button>
        </template>
      </li>
    </ul>
    <button
      v-if="operationCursor"
      :disabled="locked"
      data-testid="organization-memory-operations-more"
      @click="loadOperations(operationCursor)"
    >
      下一页操作记录
    </button>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationError,
} from "./organization-project-ui";
import { actionCode } from "./task-description-ui";
type Goal = {
  id: string;
  revision: number;
  status: string;
  projectRef: {
    id: string;
    sourceKind: string;
    scope: { kind: string; id: string };
  };
};
type Item = {
  memoryId: string;
  reference: { kind: string; id: string; version: string };
  currentVersion: string | null;
  grantState: string;
  state: string;
  record: null | {
    content: string;
    category: string;
    revision: number;
    provenance: { source: string; observedAt: string };
    retentionPolicy: { expiresAt?: string };
  };
};
type Operation = {
  requestId: string;
  type: string;
  status: string;
  actorDid?: string;
  result: null | { receipt: null | { status: string } };
};
type Pending = {
  method: "recoverGoalMemory" | "discardGoalMemory";
  type: string;
  input: {
    goalId: string;
    requestId: string;
    expectedRevision?: number;
    operationRequestId?: string;
  };
};
const props = defineProps<{
  goal: Goal;
  projectId: string;
  orgId: string;
  identityKey?: string;
  actorDid?: string;
  permissions: string[];
  parentBusy?: boolean;
  recovery?: Pending | null;
}>();
const emit = defineEmits<{
  (event: "changed"): void;
  (event: "authority-error", value: unknown): void;
  (event: "recovery", value: Pending | null): void;
}>();
const available = computed(() => {
  try {
    return [
      "listGoalMemories",
      "listGoalMemoryOperations",
      "createGoalMemory",
      "correctGoalMemory",
      "revokeGoalMemory",
      "deleteGoalMemory",
      "recoverGoalMemory",
      "discardGoalMemory",
      "onGoalMemoryInvalidated",
    ].every((name) => typeof organizationApi()[name] === "function");
  } catch {
    return false;
  }
});
const canRead = computed(() =>
  ["goal.read", "goal.memory.read"].every((p) => props.permissions.includes(p)),
);
const canWrite = computed(() =>
  props.permissions.includes("goal.memory.write"),
);
const canDelete = computed(() =>
  props.permissions.includes("goal.memory.delete"),
);
const actualActor = computed(() => props.actorDid || props.identityKey);
const canRecover = (type: string) =>
  type === "delete" ? canDelete.value : canWrite.value;
const items = ref<Item[]>([]),
  operations = ref<Operation[]>([]),
  cursor = ref<string | null>(null),
  operationCursor = ref<string | null>(null);
const busy = ref(false),
  error = ref(""),
  message = ref(""),
  content = ref(""),
  category = ref("user-fact"),
  expiry = ref(""),
  editing = ref<Item | null>(null),
  pending = ref<Pending | null>(null);
const locked = computed(() => busy.value || !!props.parentBusy);
const validContent = computed(
  () =>
    !!content.value.trim() &&
    new TextEncoder().encode(content.value).length <= 8192,
);
let epoch = 0,
  readEpoch = 0,
  mounted = true,
  writing = false,
  refreshAfterWrite = false,
  loaded = false;
let stopListener: (() => void) | undefined,
  expiryTimer: ReturnType<typeof window.setTimeout> | undefined;
const current = (token: number) => mounted && token === epoch;
const newId = () => `organization-memory-${globalThis.crypto.randomUUID()}`;
function clearDraft() {
  content.value = "";
  category.value = "user-fact";
  expiry.value = "";
  editing.value = null;
}
function clearBodies() {
  items.value = [];
  cursor.value = null;
  if (expiryTimer) window.clearTimeout(expiryTimer);
  if (editing.value) clearDraft();
}
function savePending(value: Pending | null) {
  pending.value = value;
  emit("recovery", value ? structuredClone(toRaw(value)) : null);
}
function reset(clearRecovery = true) {
  epoch++;
  readEpoch++;
  writing = false;
  refreshAfterWrite = false;
  loaded = false;
  busy.value = false;
  clearBodies();
  clearDraft();
  operations.value = [];
  operationCursor.value = null;
  error.value = "";
  message.value = "";
  if (clearRecovery) savePending(null);
}
function validateScope(value: any) {
  if (
    value?.goalId !== props.goal.id ||
    value.projectId !== props.projectId ||
    value.orgId !== props.orgId ||
    value.actorDid !== actualActor.value
  )
    throw new Error("GOAL_MEMORY_OUTPUT_STALE");
}
function validateGoal(goal: Goal) {
  if (
    goal?.id !== props.goal.id ||
    goal.projectRef?.id !== props.projectId ||
    goal.projectRef.scope?.kind !== "organization" ||
    goal.projectRef.scope.id !== props.orgId ||
    goal.projectRef.sourceKind !== "desktop.organization-project-goals"
  )
    throw new Error("GOAL_MEMORY_SCOPE_CHANGED");
}
function failure(value: unknown) {
  clearBodies();
  if (
    organizationAuthorityError(value) ||
    /GOAL_MEMORY_(SCOPE_CHANGED|OUTPUT_STALE)/u.test(actionCode(value))
  ) {
    reset();
    error.value = "当前身份已无法读取组织目标记忆。";
    emit("authority-error", value);
    return;
  }
  error.value =
    actionCode(value) === "GOAL_MEMORY_OPERATION_NOT_FOUND"
      ? "宿主尚未记录原操作。请继续核对原请求；不会自动重复保存。"
      : organizationError(value);
}
function scheduleExpiry(authorityExpiresAt: number) {
  const deadlines = [
    authorityExpiresAt,
    ...items.value.flatMap((item) =>
      item.record?.retentionPolicy.expiresAt
        ? [Date.parse(item.record.retentionPolicy.expiresAt)]
        : [],
    ),
  ].filter(Number.isFinite);
  if (!deadlines.length) throw new Error("GOAL_MEMORY_OUTPUT_STALE");
  const delay = Math.min(
    30_000,
    Math.max(0, Math.min(...deadlines) - Date.now()),
  );
  expiryTimer = window.setTimeout(() => {
    readEpoch++;
    clearBodies();
    clearDraft();
    loaded = false;
    if (writing) refreshAfterWrite = true;
    else void load();
  }, delay);
}
async function load(afterId?: string) {
  if (!available.value || !canRead.value || props.parentBusy || writing) return;
  const token = epoch,
    readToken = ++readEpoch;
  busy.value = true;
  clearBodies();
  error.value = "";
  try {
    const [memories, history] = await Promise.all([
      organizationApi().listGoalMemories({
        goalId: props.goal.id,
        limit: 20,
        ...(afterId ? { afterId } : {}),
      }),
      organizationApi().listGoalMemoryOperations({
        goalId: props.goal.id,
        limit: 20,
      }),
    ]);
    if (!current(token) || readToken !== readEpoch) return;
    validateScope(memories);
    validateScope(history);
    if (
      !Number.isSafeInteger(memories.authorityExpiresAt) ||
      memories.authorityExpiresAt <= Date.now()
    )
      throw new Error("ORG_AUTH_NOT_FOUND_OR_DENIED");
    if (memories.goalRevision !== props.goal.revision) {
      loaded = false;
      emit("changed");
      return;
    }
    items.value = memories.items.map((item: Item) => {
      const at = item.record?.retentionPolicy.expiresAt;
      return at &&
        (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now())
        ? { ...item, record: null, state: "expired" }
        : item;
    });
    for (const operation of history.items)
      if (operation.actorDid !== actualActor.value)
        throw new Error("GOAL_MEMORY_OUTPUT_STALE");
    operations.value = history.items;
    cursor.value = memories.nextCursor;
    operationCursor.value = history.nextCursor;
    loaded = true;
    scheduleExpiry(memories.authorityExpiresAt);
  } catch (value) {
    if (current(token) && readToken === readEpoch) {
      operations.value = [];
      operationCursor.value = null;
      failure(value);
    }
  } finally {
    if (current(token) && readToken === readEpoch) busy.value = false;
  }
}
async function loadOperations(afterId: string) {
  if (locked.value || !canRead.value) return;
  const token = epoch,
    readToken = readEpoch;
  busy.value = true;
  try {
    const value = await organizationApi().listGoalMemoryOperations({
      goalId: props.goal.id,
      limit: 20,
      afterId,
    });
    if (!current(token) || readToken !== readEpoch) return;
    validateScope(value);
    for (const operation of value.items)
      if (operation.actorDid !== actualActor.value)
        throw new Error("GOAL_MEMORY_OUTPUT_STALE");
    operations.value = value.items;
    operationCursor.value = value.nextCursor;
  } catch (value) {
    if (current(token) && readToken === readEpoch) failure(value);
  } finally {
    if (current(token) && readToken === readEpoch) busy.value = false;
  }
}
function edit(item: Item) {
  if (locked.value || pending.value || !canWrite.value || !item.record) return;
  editing.value = item;
  content.value = item.record.content;
  category.value = item.record.category;
  const at = item.record.retentionPolicy.expiresAt;
  expiry.value = at
    ? new Date(Date.parse(at) - new Date(at).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : "";
}
function result(value: any) {
  if (value.cancelled === true) {
    if (
      value.goalId !== props.goal.id ||
      value.requestId !== pending.value?.input.requestId
    )
      throw new Error("GOAL_MEMORY_OUTPUT_STALE");
    savePending(null);
    message.value = "已取消本次操作。";
    return;
  }
  validateGoal(value.goal);
  const requestId =
    pending.value?.method === "discardGoalMemory"
      ? pending.value.input.operationRequestId
      : pending.value?.input.requestId;
  if (
    value.operation?.requestId !== requestId ||
    value.operation.actorDid !== actualActor.value
  )
    throw new Error("GOAL_MEMORY_OUTPUT_STALE");
  if (value.blockedReason)
    message.value =
      value.blockedReason === "GOAL_MEMORY_ORIGINAL_INPUT_REQUIRED"
        ? "正文尚未保存；可放弃原操作，再重新输入内容。"
        : "目标已变化，原操作未完成；可放弃并清理未关联记忆。";
  else {
    message.value =
      value.receipt && value.receipt.status !== "purged"
        ? "读取已阻断；清理仍待恢复。"
        : "操作结果已记录。";
    if (["complete", "discarded"].includes(value.operation.status))
      savePending(null);
  }
  clearBodies();
  clearDraft();
  if (value.goal.revision !== props.goal.revision) emit("changed");
}
async function perform(method: string, input: any, type: string) {
  if (locked.value || !canRead.value || !canRecover(type)) return;
  const token = epoch;
  savePending(
    method === "discardGoalMemory"
      ? { method, type, input: structuredClone(toRaw(input)) }
      : {
          method: "recoverGoalMemory",
          type,
          input: { goalId: props.goal.id, requestId: input.requestId },
        },
  );
  writing = true;
  busy.value = true;
  error.value = "";
  clearBodies();
  clearDraft();
  try {
    const value = await organizationApi()[method](
      structuredClone(toRaw(input)),
    );
    if (!current(token)) return;
    result(value);
  } catch (value) {
    if (!current(token)) return;
    if (
      /^GOAL_MEMORY_INVALID_|^GOAL_MEMORY_REOPEN_REQUIRED$/u.test(
        actionCode(value),
      )
    )
      savePending(null);
    failure(value);
  } finally {
    if (current(token)) {
      writing = false;
      busy.value = false;
      refreshAfterWrite = false;
      void load();
    }
  }
}
async function submit() {
  if (
    locked.value ||
    pending.value ||
    !canWrite.value ||
    !validContent.value ||
    props.goal.status === "done"
  )
    return;
  const input: any = {
    goalId: props.goal.id,
    expectedRevision: props.goal.revision,
    requestId: newId(),
    content: content.value,
    category: category.value,
  };
  if (expiry.value) {
    const at = Date.parse(expiry.value);
    if (!Number.isFinite(at) || at <= Date.now()) {
      error.value = "请选择将来的有效到期时间。";
      return;
    }
    input.expiresAt = new Date(at).toISOString();
  }
  if (editing.value) {
    input.memoryId = editing.value.memoryId;
    input.memoryVersion = editing.value.currentVersion;
  }
  const type = editing.value ? "correct" : "create";
  await perform(
    editing.value ? "correctGoalMemory" : "createGoalMemory",
    input,
    type,
  );
}
async function mutate(
  method: "revokeGoalMemory" | "deleteGoalMemory",
  item: Item,
) {
  if (pending.value) return;
  await perform(
    method,
    {
      goalId: props.goal.id,
      expectedRevision: props.goal.revision,
      requestId: newId(),
      memoryId: item.memoryId,
      memoryVersion:
        method === "revokeGoalMemory"
          ? item.reference.version
          : item.currentVersion,
    },
    method === "revokeGoalMemory" ? "revoke" : "delete",
  );
}
async function recover(operation: Operation) {
  if (pending.value) return;
  await perform(
    "recoverGoalMemory",
    { goalId: props.goal.id, requestId: operation.requestId },
    operation.type,
  );
}
async function retry() {
  if (pending.value) {
    const value = toRaw(pending.value);
    await perform(value.method, value.input, value.type);
  }
}
async function discard(requestId: string) {
  if (pending.value?.method === "discardGoalMemory") {
    await retry();
    return;
  }
  await perform(
    "discardGoalMemory",
    {
      goalId: props.goal.id,
      expectedRevision: props.goal.revision,
      operationRequestId: requestId,
      requestId: newId(),
    },
    "discard",
  );
}
const categoryLabel = (value: string) =>
  (
    ({
      "user-fact": "成员明确事实",
      "agent-inference": "Agent 推断",
      "execution-note": "执行备注",
    }) as Record<string, string>
  )[value] || "分类待核对";
const grantLabel = (value: string) =>
  (
    ({
      active: "已关联",
      revoked: "使用权已撤销",
      corrected: "已被修正",
      deleted: "读取已阻断",
    }) as Record<string, string>
  )[value] || "授权待核对";
const stateLabel = (value: string) =>
  (
    ({
      active: "有效",
      reinforced: "有效",
      superseded: "旧版本",
      expired: "已到期",
      deleted: "清理待恢复",
      purged: "清理已完成",
      missing: "记录不可用",
    }) as Record<string, string>
  )[value] || "当前不可用";
const operationLabel = (value: string) =>
  (
    ({
      create: "保存",
      correct: "修正",
      revoke: "撤权",
      delete: "删除",
    }) as Record<string, string>
  )[value] || "记忆操作";
const operationState = (value: string) =>
  (
    ({
      prepared: "尚未完成",
      denied: "读取已阻断，清理待核对",
      complete: "已完成",
      "discard-requested": "放弃清理中",
      discarded: "已放弃",
    }) as Record<string, string>
  )[value] || "待核对";
watch(
  [
    () => props.goal.id,
    () => props.projectId,
    () => props.orgId,
    () => props.identityKey,
    () => props.actorDid,
    () => props.permissions.join(","),
  ],
  (_value, previous) => {
    reset(!!previous?.length);
    if (!previous?.length && props.recovery)
      pending.value = structuredClone(toRaw(props.recovery));
    void load();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => [props.goal.revision, props.goal.status],
  () => {
    reset(false);
    void load();
  },
  { flush: "sync" },
);
watch(
  () => props.parentBusy,
  (value, previous) => {
    if (value) {
      readEpoch++;
      clearBodies();
      clearDraft();
      loaded = false;
    }
    if (previous && !value && !loaded && !writing) void load();
  },
  { flush: "sync" },
);
onMounted(() => {
  if (available.value)
    stopListener = organizationApi().onGoalMemoryInvalidated(() => {
      readEpoch++;
      clearBodies();
      clearDraft();
      loaded = false;
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
  reset(false);
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
  box-sizing: border-box;
}
pre,
p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
button {
  margin: 0.25rem;
}
</style>
