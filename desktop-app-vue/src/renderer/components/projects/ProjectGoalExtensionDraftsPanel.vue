<template>
  <section v-if="available" data-testid="goal-extension-drafts">
    <h5>内置交付助手草稿</h5>
    <p>
      按当前风险来源生成待确认的任务说明草稿。草稿不会自动创建执行意图或修改任务。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="preparedHint" data-testid="delivery-native-preview-hint">
      {{ preparedHint }}
    </p>
    <template v-if="status">
      <button
        :disabled="
          busy || (!status.enabled && (!canSuggest || goal.status !== 'active'))
        "
        data-testid="toggle-delivery-drafts"
        @click="configure()"
      >
        {{ status.enabled ? "禁用草稿助手" : "启用草稿助手（原生确认）" }}
      </button>
      <p v-if="!status.enabled && !canSuggest">
        先允许目标的任务说明建议，再运行一次风险检查以生成当前来源。
      </p>
      <p v-if="!status.enabled">
        助手已禁用；保留
        {{ status.savedCount }} 份历史草稿，重新启用不会自动恢复旧授权。
      </p>
      <template v-if="status.enabled && goal.status === 'active'">
        <label
          >风险来源
          <select
            v-model="sourceRef"
            :disabled="busy"
            data-testid="delivery-draft-source"
          >
            <option value="">选择一条当前风险建议</option>
            <option
              v-for="source in sources"
              :key="source.id"
              :value="source.id"
            >
              {{ source.sourceTaskId }} · {{ source.id }}
            </option>
          </select>
        </label>
        <button
          :disabled="busy || !sourceRef"
          data-testid="save-delivery-draft"
          @click="propose()"
        >
          保存规则草稿
        </button>
        <p v-if="unavailableCount">
          本页
          {{ unavailableCount }} 份历史草稿的授权或来源已变化，不能继续读取。
        </p>
        <article v-for="draft in drafts" :key="draft.id">
          <strong>{{ draft.proposal.title }}</strong>
          <p>内置规则生成 · 待确认 · 来源：{{ draft.proposal.sourceRef }}</p>
          <button
            :disabled="busy"
            data-testid="read-delivery-draft"
            @click="read(draft.id)"
          >
            重新核对并读取草稿
          </button>
        </article>
        <template v-if="selected">
          <p data-testid="delivery-draft-body">
            {{ selected.proposal.description }}
          </p>
          <button
            :disabled="busy"
            data-testid="prepare-delivery-draft"
            @click="prepare(selected)"
          >
            {{
              selected.conversion
                ? "继续读取本次原生预览"
                : "读取当前版本并建立原生预览"
            }}
          </button>
        </template>
        <button
          v-if="afterId"
          :disabled="busy"
          data-testid="more-delivery-drafts"
          @click="load(true)"
        >
          更多草稿
        </button>
      </template>
    </template>
    <button
      :disabled="busy"
      data-testid="refresh-delivery-drafts"
      @click="load()"
    >
      刷新草稿状态
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = {
  id: string;
  storeId?: string;
  revision: number;
  controlGeneration?: number;
  status: string;
  allowedActionTypes?: string[];
};
type GoalRef = {
  id: string;
  storeId: string;
  revision: number;
  controlGeneration: number;
};
type Draft = {
  id: string;
  state: string;
  origin: string;
  conversion?: null | { intentId: string; status: string };
  plugin: { name: string; scope: string; version: string };
  proposal: {
    type: string;
    goalRef: GoalRef;
    sourceRef: string;
    title: string;
    description: string;
  };
};
type Status = { enabled: boolean; epoch: number; savedCount: number };
type Api = {
  getGoalDeliveryDraftStatus(input: { goalRef: GoalRef }): Promise<Status>;
  configureGoalDeliveryDrafts(input: {
    goalRef: GoalRef;
    expectedEpoch: number;
    enabled: boolean;
  }): Promise<Status>;
  proposeGoalDeliveryDraft(input: {
    goalRef: GoalRef;
    sourceRef: string;
    requestId: string;
  }): Promise<{ proposalId: string; state: string }>;
  listGoalDeliveryDrafts(input: {
    goalRef: GoalRef;
    limit: number;
    afterId?: string;
  }): Promise<{
    entries: Draft[];
    unavailableCount: number;
    nextCursor: string | null;
  }>;
  readGoalDeliveryDraft(input: { id: string }): Promise<Draft>;
  prepareGoalDeliveryDraft(input: { id: string }): Promise<{
    intent: {
      id: string;
      goalId: string;
      storeId: string;
      goalRevision: number;
      controlGeneration: number;
      proposalId: string;
      description: string;
      status: string;
      extensionRef: { draftId: string };
    };
  }>;
};
const props = defineProps<{
  goal: Goal;
  sources: {
    id: string;
    sourceTaskId: string;
    reviewId?: string;
    reviewDigest?: string;
  }[];
  identityKey?: string;
}>();
const emit = defineEmits<{
  (event: "authority-error"): void;
  (event: "intent-prepared"): void;
  (event: "extension-invalidated"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: Api } }).electronAPI
    ?.project;
const available = computed(
  () =>
    !!props.goal.storeId &&
    Number.isSafeInteger(props.goal.controlGeneration) &&
    [
      "getGoalDeliveryDraftStatus",
      "configureGoalDeliveryDrafts",
      "proposeGoalDeliveryDraft",
      "listGoalDeliveryDrafts",
      "readGoalDeliveryDraft",
      "prepareGoalDeliveryDraft",
    ].every((key) => typeof api()?.[key as keyof Api] === "function"),
);
const canSuggest = computed(
  () =>
    props.goal.allowedActionTypes?.includes("task.update-description") === true,
);
const goalRef = (): GoalRef => ({
  id: props.goal.id,
  storeId: props.goal.storeId!,
  revision: props.goal.revision,
  controlGeneration: props.goal.controlGeneration!,
});
const status = ref<Status | null>(null),
  drafts = ref<Draft[]>([]),
  selected = ref<Draft | null>(null),
  sourceRef = ref("");
const busy = ref(false),
  error = ref(""),
  unavailableCount = ref(0),
  afterId = ref<string | null>(null);
const requests = new Map<string, string>();
const preparedHint = ref("");
let generation = 0,
  mounted = true;
const current = (stamp: number) => mounted && generation === stamp;
function reset() {
  generation++;
  status.value = null;
  drafts.value = [];
  selected.value = null;
  sourceRef.value = "";
  busy.value = false;
  error.value = "";
  afterId.value = null;
  unavailableCount.value = 0;
  requests.clear();
  preparedHint.value = "";
}
function acceptStatus(value: Status) {
  if (
    typeof value?.enabled !== "boolean" ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !Number.isSafeInteger(value.savedCount) ||
    value.savedCount < 0 ||
    value.savedCount > 100
  )
    throw new Error("GOAL_EXTENSION_INVALID_REQUEST");
  const changed = !!status.value && status.value.epoch !== value.epoch;
  if (changed) {
    emit("extension-invalidated");
    requests.clear();
    drafts.value = [];
    selected.value = null;
    afterId.value = null;
    unavailableCount.value = 0;
    preparedHint.value = "";
  }
  status.value = value;
  return changed;
}
function validate(draft: Draft) {
  const ref = draft?.proposal?.goalRef,
    expected = goalRef();
  if (
    !ref ||
    Object.keys(expected).some(
      (key) => ref[key as keyof GoalRef] !== expected[key as keyof GoalRef],
    ) ||
    draft.state !== "pending-confirmation" ||
    draft.origin !== "builtin-rule" ||
    draft.plugin?.scope !== "desktop-builtin" ||
    draft.plugin?.name !== "project-delivery-drafts" ||
    draft.plugin?.version !== "0.1.0" ||
    draft.proposal.type !== "task.description.update" ||
    typeof draft.id !== "string" ||
    !/^goal-extension-[a-f0-9]{64}$/.test(draft.id) ||
    typeof draft.proposal.title !== "string" ||
    draft.proposal.title.length > 256 ||
    typeof draft.proposal.description !== "string" ||
    draft.proposal.description.length > 8192
  )
    throw new Error("GOAL_EXTENSION_SOURCE_CHANGED");
  return draft;
}
function failure(value: unknown) {
  drafts.value = [];
  selected.value = null;
  afterId.value = null;
  preparedHint.value = "";
  if (
    isAuthorityError(value) ||
    /^(GOAL_EXTENSION_|ACTION_GOAL_EXTENSION_|PROJECT_RISK_REVIEW_STALE$|ACTION_GOAL_SOURCE_CONFLICT$)/.test(
      actionCode(value),
    )
  )
    emit("extension-invalidated");
  if (isAuthorityError(value)) {
    reset();
    emit("authority-error");
  }
  error.value =
    "草稿的授权或来源待重新核对，请刷新；保存结果不确定时重试沿用本次请求。";
}
async function page(stamp: number, more = false) {
  const result = await api()!.listGoalDeliveryDrafts({
    goalRef: goalRef(),
    limit: 20,
    ...(more && afterId.value ? { afterId: afterId.value } : {}),
  });
  if (!current(stamp)) return;
  if (!Array.isArray(result.entries) || result.entries.length > 20)
    throw new Error("GOAL_EXTENSION_INVALID_REQUEST");
  const entries = result.entries.map(validate);
  drafts.value = more ? [...drafts.value, ...entries] : entries;
  unavailableCount.value = result.unavailableCount;
  afterId.value = result.nextCursor;
}
async function load(more = false) {
  if (!available.value || busy.value) return;
  const stamp = generation;
  busy.value = true;
  selected.value = null;
  error.value = "";
  if (!more) drafts.value = [];
  try {
    const value = await api()!.getGoalDeliveryDraftStatus({
      goalRef: goalRef(),
    });
    if (!current(stamp)) return;
    const changed = acceptStatus(value);
    if (value.enabled && props.goal.status === "active")
      await page(stamp, more && !changed);
    else {
      drafts.value = [];
      afterId.value = null;
    }
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function configure() {
  if (busy.value || !status.value) return;
  const stamp = generation;
  busy.value = true;
  drafts.value = [];
  selected.value = null;
  error.value = "";
  try {
    const result = await api()!.configureGoalDeliveryDrafts({
      goalRef: goalRef(),
      expectedEpoch: status.value.epoch,
      enabled: !status.value.enabled,
    });
    if (!current(stamp)) return;
    acceptStatus(result);
    if (result.enabled && props.goal.status === "active") await page(stamp);
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function propose() {
  if (
    busy.value ||
    !sourceRef.value ||
    !props.sources.some((source) => source.id === sourceRef.value)
  )
    return;
  const stamp = generation,
    source = sourceRef.value,
    requestId = requests.get(source) ?? crypto.randomUUID();
  requests.set(source, requestId);
  busy.value = true;
  selected.value = null;
  error.value = "";
  try {
    const result = await api()!.proposeGoalDeliveryDraft({
      goalRef: goalRef(),
      sourceRef: source,
      requestId,
    });
    if (!current(stamp)) return;
    if (result.state !== "pending-confirmation")
      throw new Error("GOAL_EXTENSION_INVALID_RECEIPT");
    await page(stamp);
    if (current(stamp)) requests.delete(source);
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function read(id: string) {
  if (busy.value) return;
  const stamp = generation;
  busy.value = true;
  selected.value = null;
  error.value = "";
  try {
    const result = await api()!.readGoalDeliveryDraft({ id });
    if (current(stamp)) {
      if (result.id !== id) throw new Error("GOAL_EXTENSION_SOURCE_CHANGED");
      selected.value = validate(result);
    }
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function prepare(draft: Draft) {
  if (busy.value) return;
  const stamp = generation;
  busy.value = true;
  error.value = "";
  selected.value = null;
  preparedHint.value = "";
  try {
    const result = await api()!.prepareGoalDeliveryDraft({ id: draft.id });
    if (!current(stamp)) return;
    validate(draft);
    const intent = result?.intent;
    if (
      !intent ||
      intent.extensionRef?.draftId !== draft.id ||
      intent.goalId !== props.goal.id ||
      intent.storeId !== props.goal.storeId ||
      intent.goalRevision !== props.goal.revision ||
      intent.controlGeneration !== props.goal.controlGeneration ||
      intent.proposalId !== draft.proposal.sourceRef ||
      intent.description !== draft.proposal.description ||
      ![
        "draft",
        "prepared",
        "running",
        "succeeded",
        "denied",
        "cancelled",
      ].includes(intent.status)
    )
      throw new Error("GOAL_EXTENSION_SOURCE_CHANGED");
    preparedHint.value =
      "原生意图已关联，请在目标建议区核对预览或读取原回执；修改任务仍需原生确认。";
    emit("intent-prepared");
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  [
    () => props.goal.id,
    () => props.goal.storeId,
    () => props.goal.revision,
    () => props.goal.controlGeneration,
    () => props.goal.status,
    () => props.identityKey,
    () =>
      JSON.stringify(
        props.sources
          .map((source) => [
            source.id,
            source.sourceTaskId,
            source.reviewId ?? "",
            source.reviewDigest ?? "",
          ])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
  ],
  () => {
    reset();
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  mounted = false;
  reset();
});
</script>
