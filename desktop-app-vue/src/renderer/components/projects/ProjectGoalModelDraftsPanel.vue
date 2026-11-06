<template>
  <section v-if="available" data-testid="goal-model-drafts">
    <h5>模型起草（逐次原生授权）</h5>
    <p>
      支持受治理的本机 Ollama、火山引擎，以及自定义 OpenAI
      兼容本机或局域网平台（如力数）。发送前请核对原生窗口中的提供方、地址和完整资料。
    </p>
    <p>
      使用当前配置的模型，仅生成待审建议。选择火山引擎会将资料发送到云端并可能产生费用。保存后仍须预览和逐次确认。费用未知会保留为未知。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <label
      >建议类型
      <select v-model="type" :disabled="busy" data-testid="model-draft-type">
        <option value="task.description.update">任务说明</option>
        <option value="task.create">创建任务</option>
      </select>
    </label>
    <label v-if="type === 'task.create'"
      >新任务类型
      <select
        v-model="taskType"
        :disabled="busy"
        data-testid="model-draft-task-type"
      >
        <option v-for="value in taskTypes" :key="value" :value="value">
          {{ value }}
        </option>
      </select>
    </label>
    <label
      >当前风险来源
      <select
        v-model="sourceRef"
        :disabled="busy"
        data-testid="model-draft-source"
      >
        <option value="">选择当前来源</option>
        <option
          v-for="source in candidates"
          :key="source.id"
          :value="source.id"
        >
          {{ source.sourceTaskId }} · {{ source.id }}
        </option>
      </select>
    </label>
    <label
      ><input
        v-model="useMemory"
        type="checkbox"
        :disabled="busy"
        data-testid="model-draft-use-memory"
      />本次使用目标记忆（原生核对正文）</label
    >
    <button
      :disabled="busy || !sourceRef || goal.status !== 'active' || unresolved"
      data-testid="generate-model-draft"
      @click="generate"
    >
      原生核对并起草
    </button>
    <p v-if="requestId" data-testid="model-draft-reference">
      本次请求 ID：{{ requestId }}；中断后保留此 ID，只查询原结果，不自动重发。
    </p>
    <label
      >查询原请求 ID<input
        v-model="lookupId"
        :disabled="busy"
        data-testid="model-draft-lookup-id"
    /></label>
    <button
      :disabled="busy || !lookupId.trim()"
      data-testid="lookup-model-draft"
      @click="lookup"
    >
      只查询原结果
    </button>
    <button
      :disabled="busy"
      data-testid="refresh-model-requests"
      @click="loadRequests(false)"
    >
      读取起草请求记录（重启恢复）
    </button>
    <article v-for="entry in requestHistory" :key="entry.id">
      <p>{{ entry.requestId }} · {{ stateText(entry.state) }}</p>
      <button
        :disabled="busy"
        data-testid="recover-model-request"
        @click="recover(entry.requestId)"
      >
        选择此请求查原回执
      </button>
    </article>
    <button
      v-if="requestCursor"
      :disabled="busy"
      data-testid="more-model-requests"
      @click="loadRequests(true)"
    >
      更多请求记录
    </button>
    <p v-if="receipt" data-testid="model-draft-receipt">
      {{ stateText(receipt.state) }}
    </p>
    <button
      v-if="requestId && unresolved"
      :disabled="busy"
      data-testid="revoke-model-request"
      @click="revoke(requestId)"
    >
      撤销原请求（不撤回已发送资料）
    </button>
    <button
      :disabled="busy"
      data-testid="refresh-model-drafts"
      @click="load(false)"
    >
      刷新待审模型草稿
    </button>
    <article v-for="draft in drafts" :key="draft.id">
      <strong>{{ draft.proposal.title }}</strong>
      <p>模型建议 · 待确认 · 来源：{{ draft.proposal.sourceRef }}</p>
      <button
        :disabled="busy"
        data-testid="read-model-draft"
        @click="read(draft.id)"
      >
        重新核对授权并读取
      </button>
      <button
        :disabled="busy"
        data-testid="revoke-model-draft"
        @click="revoke(draft.proposal.requestId)"
      >
        撤销此份草稿
      </button>
    </article>
    <p v-if="unavailableCount">
      {{ unavailableCount }} 份的来源或授权已变化，不能继续使用。
    </p>
    <button
      v-if="cursor"
      :disabled="busy"
      data-testid="more-model-drafts"
      @click="load(true)"
    >
      更多
    </button>
    <div v-if="selected" data-testid="model-draft-body">
      <p v-if="selected.proposal.taskType">
        待创建类型：{{ selected.proposal.taskType }}
      </p>
      <pre>{{ selected.proposal.description }}</pre>
      <button
        :disabled="busy || goal.status !== 'active'"
        data-testid="prepare-model-draft"
        @click="prepare"
      >
        建立或继续本次原生预览
      </button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = {
  id: string;
  storeId?: string;
  revision: number;
  controlGeneration?: number;
  status: string;
};
const props = defineProps<{
  goal: Goal;
  identityKey?: string;
  sources: { id: string; sourceTaskId: string; actionType: string }[];
}>();
const emit = defineEmits<{
  (event: "authority-error"): void;
  (event: "extension-invalidated"): void;
  (event: "intent-prepared"): void;
}>();
const api = () => (window as any).electronAPI?.project;
const available = computed(
  () =>
    !!props.goal.storeId &&
    Number.isSafeInteger(props.goal.controlGeneration) &&
    [
      "generateGoalModelDraft",
      "getGoalModelDraftStatus",
      "listGoalModelDraftRequests",
      "listGoalModelDrafts",
      "readGoalModelDraft",
      "prepareGoalModelDraft",
      "revokeGoalModelDraft",
    ].every((key) => typeof api()?.[key] === "function"),
);
const type = ref("task.description.update"),
  taskType = ref("query_info"),
  sourceRef = ref(""),
  useMemory = ref(false);
const taskTypes = [
  "create_file",
  "edit_file",
  "query_info",
  "analyze_data",
  "export_file",
  "deploy_project",
];
const candidates = computed(() =>
  props.sources.filter(
    (s) =>
      s.actionType ===
      (type.value === "task.create"
        ? "task.create"
        : "task.update-description"),
  ),
);
const requestId = ref(""),
  lookupId = ref(""),
  receipt = ref<any>(null),
  drafts = ref<any[]>([]),
  selected = ref<any>(null),
  cursor = ref<string | null>(null),
  unavailableCount = ref(0),
  busy = ref(false),
  error = ref("");
const requestHistory = ref<any[]>([]),
  requestCursor = ref<string | null>(null);
const unresolved = computed(
  () =>
    !!receipt.value && ["unknown", "not-found"].includes(receipt.value.state),
);
const goalRef = () => ({
  id: props.goal.id,
  storeId: props.goal.storeId,
  revision: props.goal.revision,
  controlGeneration: props.goal.controlGeneration,
});
let generation = 0,
  mounted = true,
  detach: (() => void) | undefined;
let outputTimer: ReturnType<typeof setTimeout> | undefined;
let outputDeadline: number | null = null;
const current = (stamp: number) => mounted && stamp === generation;
function invalidate() {
  clearTimeout(outputTimer);
  outputDeadline = null;
  generation++;
  selected.value = null;
  drafts.value = [];
  cursor.value = null;
  busy.value = false;
  error.value = "";
  unavailableCount.value = 0;
  requestHistory.value = [];
  requestCursor.value = null;
}
function expireAt(value: string | null) {
  if (!value) return;
  const deadline = Date.parse(value);
  if (!Number.isFinite(deadline) || deadline <= Date.now())
    throw new Error("GOAL_MODEL_OUTPUT_STALE");
  if (outputDeadline !== null && outputDeadline <= deadline) return;
  clearTimeout(outputTimer);
  outputDeadline = deadline;
  const tick = () => {
    if (!mounted || outputDeadline === null) return;
    const remaining = outputDeadline - Date.now();
    if (remaining > 0) {
      outputTimer = setTimeout(tick, Math.min(remaining, 2147483647));
      return;
    }
    invalidate();
    emit("extension-invalidated");
    error.value = "输出授权已到期，正文和预览已清除。请重新核对当前来源。";
  };
  tick();
}
function fail(value: unknown) {
  clearTimeout(outputTimer);
  outputDeadline = null;
  selected.value = null;
  drafts.value = [];
  cursor.value = null;
  emit("extension-invalidated");
  if (isAuthorityError(value)) emit("authority-error");
  error.value = /^GOAL_USAGE_/.test(actionCode(value))
    ? "模型预算无法可靠预留或已用尽，请核对目标预算。未知 token 和费用不能按零处理。"
    : "来源或授权待重新核对。若起草结果不确定，保留原请求 ID，只查询原结果。";
}
function stateText(state: string) {
  return (
    (
      {
        saved: "已保存待审建议，尚未修改或创建任务",
        unknown: "结果未知，请保留原 ID 查询；不自动重发",
        notFound: "查询时未找到，不自动重发",
        denied: "本次未授权发送",
        failed: "起草未完成，未自动重发",
        revoked: "此份草稿已撤销",
      } as Record<string, string>
    )[state] ??
    (state === "not-found" ? "查询时未找到，不自动重发" : "状态待核查")
  );
}
function validate(draft: any) {
  const p = draft?.proposal,
    r = goalRef();
  if (
    !p ||
    !/^goal-extension-[a-f0-9]{64}$/.test(draft.id) ||
    draft.plugin?.name !== "project-delivery-model-drafts" ||
    draft.plugin.scope !== "desktop-builtin" ||
    draft.plugin.version !== "0.1.0" ||
    draft.origin !== "builtin-rule" ||
    p.type !== type.value ||
    Object.keys(r).some(
      (key) => p.goalRef?.[key] !== r[key as keyof typeof r],
    ) ||
    typeof p.description !== "string" ||
    p.description.length > 8192 ||
    typeof p.requestId !== "string"
  )
    throw new Error("GOAL_MODEL_OUTPUT_STALE");
  return draft;
}
async function page(stamp: number, more = false) {
  const result = await api().listGoalModelDrafts({
    goalRef: goalRef(),
    type: type.value,
    limit: 20,
    ...(more && cursor.value ? { afterId: cursor.value } : {}),
  });
  if (!current(stamp)) return;
  if (!Array.isArray(result.entries) || result.entries.length > 20)
    throw new Error();
  const entries = result.entries.map(validate);
  for (const entry of entries) expireAt(entry.modelOutputExpiresAt ?? null);
  drafts.value = more ? [...drafts.value, ...entries] : entries;
  cursor.value = result.nextCursor;
  unavailableCount.value = result.unavailableCount;
}
async function load(more = false) {
  if (!available.value || busy.value) return;
  const stamp = generation;
  busy.value = true;
  error.value = "";
  selected.value = null;
  try {
    await page(stamp, more);
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
function acceptReceipt(value: any, expected: string) {
  if (
    value?.requestId !== expected ||
    value.goalId !== props.goal.id ||
    !["saved", "unknown", "not-found", "denied", "failed", "revoked"].includes(
      value.state,
    )
  )
    throw new Error();
  receipt.value = value;
}
async function generate() {
  if (busy.value || !sourceRef.value || unresolved.value) return;
  const stamp = generation;
  busy.value = true;
  error.value = "";
  selected.value = null;
  emit("extension-invalidated");
  const id = crypto.randomUUID();
  requestId.value = id;
  lookupId.value = id;
  receipt.value = { state: "unknown" };
  const input = {
    goalRef: goalRef(),
    sourceRef: sourceRef.value,
    requestId: id,
    type: type.value,
    useMemory: useMemory.value,
    ...(type.value === "task.create" ? { taskType: taskType.value } : {}),
  };
  try {
    const result = await api().generateGoalModelDraft(input);
    if (!current(stamp)) return;
    acceptReceipt(result, id);
    if (result.state === "saved") await page(stamp);
  } catch (value) {
    if (current(stamp)) {
      if (
        [
          "GOAL_USAGE_UNKNOWN",
          "GOAL_USAGE_BUDGET_EXHAUSTED",
          "GOAL_MODEL_INPUT_LIMIT",
          "GOAL_MODEL_MEMORY_LIMIT",
          "GOAL_MODEL_REQUEST_LIMIT",
        ].includes(actionCode(value))
      )
        receipt.value = {
          goalId: props.goal.id,
          requestId: id,
          state: "failed",
          proposalId: null,
        };
      fail(value);
    }
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function lookup() {
  if (busy.value || !lookupId.value.trim()) return;
  const stamp = generation,
    id = lookupId.value.trim();
  busy.value = true;
  error.value = "";
  selected.value = null;
  try {
    const result = await api().getGoalModelDraftStatus({
      goalId: props.goal.id,
      requestId: id,
    });
    if (!current(stamp)) return;
    requestId.value = id;
    acceptReceipt(result, id);
    if (result.state === "saved") await page(stamp);
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function loadRequests(more = false) {
  if (busy.value || !available.value) return;
  const stamp = generation;
  busy.value = true;
  error.value = "";
  try {
    const result = await api().listGoalModelDraftRequests({
      goalId: props.goal.id,
      limit: 20,
      ...(more && requestCursor.value ? { afterId: requestCursor.value } : {}),
    });
    if (!current(stamp)) return;
    if (
      !Array.isArray(result.entries) ||
      result.entries.length > 20 ||
      result.entries.some(
        (r: any) =>
          r.goalId !== props.goal.id ||
          typeof r.requestId !== "string" ||
          !/^goal-model-[a-f0-9]{64}$/.test(r.id),
      )
    )
      throw new Error();
    requestHistory.value = more
      ? [...requestHistory.value, ...result.entries]
      : result.entries;
    requestCursor.value = result.nextCursor;
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function recover(id: string) {
  if (busy.value) return;
  lookupId.value = id;
  await lookup();
}
async function read(id: string) {
  if (busy.value) return;
  const stamp = generation;
  busy.value = true;
  selected.value = null;
  try {
    const result = await api().readGoalModelDraft({ id });
    if (current(stamp)) {
      const draft = validate(result);
      expireAt(draft.modelOutputExpiresAt ?? null);
      selected.value = draft;
    }
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function prepare() {
  if (busy.value || !selected.value) return;
  const stamp = generation,
    id = selected.value.id;
  busy.value = true;
  emit("extension-invalidated");
  try {
    const result = await api().prepareGoalModelDraft({ id });
    if (!current(stamp)) return;
    if (
      result?.intent?.extensionRef?.draftId !== id ||
      result.intent.goalId !== props.goal.id
    )
      throw new Error();
    selected.value = null;
    emit("intent-prepared");
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function revoke(id: string) {
  if (busy.value) return;
  const stamp = generation;
  busy.value = true;
  selected.value = null;
  emit("extension-invalidated");
  try {
    const result = await api().revokeGoalModelDraft({
      goalId: props.goal.id,
      requestId: id,
    });
    if (!current(stamp)) return;
    if (requestId.value === id) acceptReceipt(result, id);
    await page(stamp);
  } catch (value) {
    if (current(stamp)) fail(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  () => [props.goal.id, props.goal.storeId, props.identityKey],
  () => {
    invalidate();
    requestId.value = "";
    lookupId.value = "";
    receipt.value = null;
    useMemory.value = false;
  },
  { immediate: true },
);
watch(
  () => [
    props.goal.revision,
    props.goal.controlGeneration,
    props.goal.status,
    JSON.stringify(props.sources),
    type.value,
    taskType.value,
  ],
  () => {
    invalidate();
    sourceRef.value = "";
    void load();
  },
  { immediate: true },
);
onMounted(() => {
  detach = api()?.onGoalMemoryInvalidated?.(() => {
    invalidate();
    emit("extension-invalidated");
    error.value = "记忆授权已变化，旧正文已清除；可用原请求 ID 查询历史状态。";
  });
});
onBeforeUnmount(() => {
  mounted = false;
  invalidate();
  detach?.();
});
</script>
