<template>
  <section v-if="available" data-testid="goal-actions-panel">
    <h5>目标建议与回执</h5>
    <p>
      建议需要核对当前来源，并逐次确认。保存任务或说明后，仍需复查风险和验收条件。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="omittedCount">
      本次检查仍保留全部风险证据；{{ omittedCount }} 条建议因显示容量暂未保存。
    </p>
    <button
      v-if="goal.status === 'active' && !inScope"
      :disabled="busy"
      data-testid="enable-goal-actions"
      @click="enableActions"
    >
      允许建议任务操作
    </button>
    <button :disabled="busy" data-testid="refresh-goal-actions" @click="load()">
      刷新建议与回执
    </button>
    <p v-if="!items.length && !busy">检查发现风险后，会显示待核对的建议。</p>
    <ProjectGoalExtensionDraftsPanel
      :goal="goal"
      :identity-key="identityKey"
      :sources="
        items
          .filter(
            (item) =>
              item.current &&
              !item.intent &&
              !item.intentUnavailable &&
              item.proposal.actionType === 'task.update-description',
          )
          .map((item) => ({
            id: item.proposal.id,
            sourceTaskId: item.proposal.sourceTaskId,
            reviewId: item.proposal.reviewId,
            reviewDigest: item.proposal.reviewDigest,
          }))
      "
      @authority-error="emit('authority-error')"
      @extension-invalidated="invalidateExtensions"
      @intent-prepared="reloadPreparedIntent"
    />
    <ProjectGoalDraftImportsPanel
      :goal="goal"
      :identity-key="identityKey"
      :source-refs="
        items
          .filter(
            (item) =>
              item.current &&
              !item.intent &&
              !item.intentUnavailable &&
              item.proposal.actionType === 'task.update-description',
          )
          .map((item) => item.proposal.id)
      "
      :source-key="
        JSON.stringify(
          items.map((item) => [
            item.proposal.id,
            item.proposal.reviewId,
            item.proposal.reviewDigest,
            item.proposal.signalDigest,
          ]),
        )
      "
      @authority-error="emit('authority-error')"
      @extension-invalidated="invalidateExtensions"
      @intent-prepared="reloadPreparedIntent"
    />
    <ProjectGoalExternalDraftsPanel
      :goal="goal"
      :identity-key="identityKey"
      :source-key="
        JSON.stringify(
          items.map((item) => [
            item.proposal.id,
            item.proposal.reviewId,
            item.proposal.reviewDigest,
          ]),
        )
      "
      @authority-error="emit('authority-error')"
      @extension-invalidated="invalidateExtensions"
      @intent-prepared="reloadPreparedIntent"
    />
    <article
      v-for="item in items"
      :key="item.proposal.id"
      :data-proposal-id="item.proposal.id"
    >
      <strong>{{
        item.proposal.actionType === "task.create"
          ? "创建风险处理任务"
          : "更新风险任务说明"
      }}</strong>
      <p>来源任务：{{ item.proposal.sourceTaskId }}</p>
      <button
        :disabled="busy"
        @click="emit('review-id', item.proposal.reviewId)"
      >
        查看风险证据
      </button>
      <template v-if="item.intent">
        <p data-testid="goal-intent-state">
          {{ stateLabel(item.intent.executionState) }}
        </p>
        <button
          v-if="item.intent.intent.status === 'draft' && item.current"
          :disabled="busy"
          data-testid="recover-goal-draft"
          @click="prepare(item)"
        >
          继续读取本次预览
        </button>
        <p v-if="item.intent.receipt">
          操作回执：{{ item.intent.receipt.run.id }}
        </p>
        <template
          v-if="
            item.intent.intent.preview &&
            item.intent.intent.status === 'prepared'
          "
        >
          <p>
            当前说明：{{
              item.intent.intent.preview.before.description || "（空）"
            }}
          </p>
          <p>拟保存说明：{{ item.intent.intent.preview.after.description }}</p>
          <button
            :disabled="busy || !item.current || goal.status !== 'active'"
            data-testid="execute-goal-intent"
            @click="execute(item)"
          >
            核对并打开原生确认
          </button>
        </template>
        <p v-if="item.intent.executionState === 'unresolved'">
          结果尚未确认，保留本次操作；刷新回执核查。
        </p>
      </template>
      <p
        v-else-if="item.intentUnavailable"
        data-testid="goal-extension-intent-unavailable"
      >
        扩展授权或来源已变化，当前无法读取该预览。
      </p>
      <form
        v-else-if="
          item.current &&
          !item.intentUnavailable &&
          goal.status === 'active' &&
          inScope
        "
        @submit.prevent="prepare(item)"
      >
        <label
          >待保存说明<textarea
            v-model="texts[item.proposal.id]"
            :disabled="busy"
            maxlength="4000"
            data-testid="goal-action-description"
          />
        </label>
        <button
          type="submit"
          :disabled="busy || !texts[item.proposal.id]?.trim()"
          data-testid="prepare-goal-intent"
        >
          读取当前版本并预览
        </button>
      </form>
      <p v-else-if="!item.current">
        该建议属于先前的目标版本，可查看历史证据。
      </p>
    </article>
    <button v-if="afterId" :disabled="busy" @click="load(true)">
      更多建议
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ProjectGoalExtensionDraftsPanel from "./ProjectGoalExtensionDraftsPanel.vue";
import ProjectGoalDraftImportsPanel from "./ProjectGoalDraftImportsPanel.vue";
import ProjectGoalExternalDraftsPanel from "./ProjectGoalExternalDraftsPanel.vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = {
  id: string;
  storeId?: string;
  controlGeneration?: number;
  revision: number;
  status: string;
  allowedActionTypes?: string[];
};
type Intent = {
  intent: {
    id: string;
    status: string;
    requestId?: string;
    description?: string;
    taskType?: string | null;
    extensionRef?: { draftId: string };
    preview: null | {
      before: { description: string };
      after: { description: string };
    };
  };
  executionState: string;
  receipt: null | { run: { id: string; status: string } };
};
type Item = {
  proposal: {
    id: string;
    goalId: string;
    goalRevision: number;
    actionType: string;
    reviewId: string;
    reviewDigest: string;
    signalDigest: string;
    sourceTaskId: string;
  };
  current: boolean;
  intent: Intent | null;
  intentUnavailable?: boolean;
};
type Api = {
  listGoalProposals(input: {
    goalId: string;
    limit: number;
    afterId?: string;
  }): Promise<{
    proposals: Item[];
    nextCursor: string | null;
    summary?: { omittedCount: number } | null;
  }>;
  prepareGoalIntent(input: {
    goalId: string;
    proposalId: string;
    expectedRevision: number;
    requestId: string;
    description: string;
    taskType?: string;
  }): Promise<Intent>;
  executeGoalIntent(input: {
    intentId: string;
  }): Promise<{ run: { status: string } }>;
  readGoalIntent(input: { intentId: string }): Promise<Intent>;
  prepareGoalDeliveryDraft?(input: { id: string }): Promise<Intent>;
  reviseGoal(input: {
    id: string;
    expectedRevision: number;
    patch: { allowedActionTypes: string[] };
  }): Promise<Goal>;
};
const props = defineProps<{ goal: Goal; identityKey?: string }>();
const emit = defineEmits<{
  (event: "goal-changed"): void;
  (event: "review-id", id: string): void;
  (event: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: Api } }).electronAPI
    ?.project;
const available = computed(() =>
  [
    "listGoalProposals",
    "prepareGoalIntent",
    "executeGoalIntent",
    "readGoalIntent",
    "reviseGoal",
  ].every((key) => typeof api()?.[key as keyof Api] === "function"),
);
const inScope = computed(() =>
  ["task.create", "task.update-description"].every((type) =>
    props.goal.allowedActionTypes?.includes(type),
  ),
);
const items = ref<Item[]>([]),
  texts = ref<Record<string, string>>({}),
  requests = ref<Record<string, string>>({});
const busy = ref(false),
  error = ref(""),
  afterId = ref<string | null>(null);
const omittedCount = ref(0);
let epoch = 0,
  mounted = true;
const current = (stamp: number) => mounted && epoch === stamp;
function reset() {
  epoch++;
  items.value = [];
  texts.value = {};
  requests.value = {};
  afterId.value = null;
  busy.value = false;
  error.value = "";
  omittedCount.value = 0;
}
function invalidateExtensions() {
  epoch++;
  busy.value = false;
  items.value = items.value.map((item) => {
    if (
      !item.intent?.intent.extensionRef ||
      !["draft", "prepared"].includes(item.intent.intent.status)
    )
      return item;
    delete texts.value[item.proposal.id];
    delete requests.value[item.proposal.id];
    return { ...item, intent: null, intentUnavailable: true };
  });
}
function reloadPreparedIntent() {
  epoch++;
  busy.value = false;
  void load();
}
function failure(value: unknown, message: string) {
  if (isAuthorityError(value)) {
    reset();
    emit("authority-error");
    error.value = "当前身份已无法读取这些建议。";
  } else if (
    /^(ACTION_GOAL_EXTENSION_|GOAL_EXTENSION_|GOAL_EXTERNAL_)/.test(
      actionCode(value),
    ) ||
    (items.value.some((item) => item.intent?.intent.extensionRef) &&
      [
        "PROJECT_RISK_REVIEW_STALE",
        "ACTION_GOAL_SOURCE_CONFLICT",
        "ACTION_GOAL_REVISION_CONFLICT",
      ].includes(actionCode(value)))
  ) {
    invalidateExtensions();
    error.value = "扩展授权或来源已变化，请刷新后核对原意图。";
  } else
    error.value =
      actionCode(value) === "ACTION_GOAL_REVISION_CONFLICT"
        ? "目标已更新，请刷新并重新检查。"
        : message;
}
function stateLabel(state: string) {
  return (
    (
      {
        draft: "待读取当前预览",
        prepared: "待核对与确认",
        succeeded: "操作已保存，仍需复查风险",
        cancelled: "已取消",
        denied: "未获准写入",
        unresolved: "结果待核查",
      } as Record<string, string>
    )[state] ?? "状态待核查"
  );
}
async function load(more = false) {
  if (!available.value || busy.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const page = await api()!.listGoalProposals({
      goalId: props.goal.id,
      limit: 20,
      ...(more && afterId.value ? { afterId: afterId.value } : {}),
    });
    if (!current(stamp)) return;
    if (page.proposals.some((item) => item.proposal.goalId !== props.goal.id))
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
    items.value = more ? [...items.value, ...page.proposals] : page.proposals;
    afterId.value = page.nextCursor;
    omittedCount.value = page.summary?.omittedCount ?? 0;
  } catch (value) {
    if (current(stamp)) failure(value, "建议与回执暂不可读取。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function enableActions() {
  if (busy.value) return;
  const stamp = epoch;
  busy.value = true;
  try {
    await api()!.reviseGoal({
      id: props.goal.id,
      expectedRevision: props.goal.revision,
      patch: {
        allowedActionTypes: [
          ...new Set([
            ...(props.goal.allowedActionTypes ?? []),
            "task.create",
            "task.update-description",
          ]),
        ],
      },
    });
    if (current(stamp)) {
      error.value = "操作范围已更新，请立即检查以生成当前版本的建议。";
      emit("goal-changed");
    }
  } catch (value) {
    if (current(stamp)) failure(value, "设置结果待核对，请刷新目标。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function prepare(item: Item) {
  const draft =
    item.intent?.intent.status === "draft" ? item.intent.intent : null;
  const description =
    draft?.description ?? texts.value[item.proposal.id]?.trim();
  if (busy.value || !item.current || !description?.trim()) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  const requestId =
    draft?.requestId ?? requests.value[item.proposal.id] ?? crypto.randomUUID();
  requests.value[item.proposal.id] = requestId;
  try {
    const intent = draft?.extensionRef
      ? await (() => {
          if (typeof api()?.prepareGoalDeliveryDraft !== "function")
            throw new Error("GOAL_EXTENSION_HOST_UNAVAILABLE");
          return api()!.prepareGoalDeliveryDraft!({
            id: draft.extensionRef!.draftId,
          });
        })()
      : await api()!.prepareGoalIntent({
          goalId: props.goal.id,
          proposalId: item.proposal.id,
          expectedRevision: props.goal.revision,
          requestId,
          description,
          ...(item.proposal.actionType === "task.create"
            ? { taskType: draft?.taskType ?? "query_info" }
            : {}),
        });
    if (!current(stamp)) return;
    items.value = items.value.map((old) =>
      old.proposal.id === item.proposal.id ? { ...old, intent } : old,
    );
  } catch (value) {
    if (current(stamp))
      failure(
        value,
        "预览结果待核对，请保留输入并刷新建议；重试沿用本次请求。",
      );
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function execute(item: Item) {
  if (busy.value || !item.intent) return;
  const stamp = epoch,
    intentId = item.intent.intent.id;
  busy.value = true;
  error.value = "";
  try {
    await api()!.executeGoalIntent({ intentId });
    if (!current(stamp)) return;
    const intent = await api()!.readGoalIntent({ intentId });
    if (current(stamp)) {
      items.value = items.value.map((old) =>
        old.proposal.id === item.proposal.id ? { ...old, intent } : old,
      );
      emit("goal-changed");
    }
  } catch (value) {
    if (current(stamp))
      failure(value, "操作结果待核查，请刷新回执；保留原意图，避免重复操作。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  () => [
    props.goal.id,
    props.goal.storeId,
    props.goal.revision,
    props.goal.controlGeneration,
    props.goal.status,
    props.identityKey,
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

<style scoped>
section {
  margin-top: 16px;
  border-top: 1px solid #ddd;
  padding-top: 12px;
}
article {
  margin-top: 12px;
  padding: 8px;
  border: 1px solid #eee;
}
textarea {
  display: block;
  width: 100%;
}
button {
  margin: 6px 8px 6px 0;
}
</style>
