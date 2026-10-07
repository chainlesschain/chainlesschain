<template>
  <section data-testid="organization-goal-actions">
    <h5>组织目标建议与审批</h5>
    <p>
      风险检查产生建议；任务写入须逐级审批，再由请求者原生确认。保存任务不代表目标通过验收。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      v-if="
        permissions.includes('goal.update') &&
        !enabled &&
        goal.status === 'active'
      "
      :disabled="locked"
      data-testid="organization-goal-enable-actions"
      @click="emit('enable-actions')"
    >
      确认允许目标任务建议
    </button>
    <button
      :disabled="locked"
      data-testid="organization-goal-actions-refresh"
      @click="load()"
    >
      刷新建议与审批关联
    </button>
    <p v-if="omitted">
      {{ omitted }} 条建议因容量限制暂未保存；风险检查证据保留。
    </p>
    <p v-if="!items.length && !busy">
      启用任务建议后，新的风险检查将生成待核对的建议。
    </p>
    <article
      v-for="item in items"
      :key="item.suggestion.id"
      :data-goal-suggestion="item.suggestion.id"
    >
      <strong>{{
        item.suggestion.actionType === "task.create"
          ? "创建风险处理任务"
          : "更新风险任务说明"
      }}</strong>
      <p>来源任务：{{ item.suggestion.sourceTaskId }}</p>
      <button
        :disabled="locked"
        :data-goal-suggestion-review="item.suggestion.id"
        @click="emit('review-id', item.suggestion.reviewId)"
      >
        查看风险证据
      </button>
      <p v-if="!item.current">该建议属于先前目标或来源版本，仅保留历史关联。</p>
      <template v-if="item.intent">
        <p>
          执行身份：{{ item.intent.intent.actorDid }} ·
          {{ intentState(item.intent.intent.status) }}
        </p>
        <template
          v-if="
            item.intent.intent.actorDid === identityKey && item.intent.preview
          "
        >
          <p>
            当前说明：{{ item.intent.preview.before.description || "（空）" }}
          </p>
          <p :data-goal-action-preview="item.suggestion.id">
            拟保存说明：{{ item.intent.preview.after.description }}
          </p>
          <label v-if="!item.intent.proposal"
            >审批计划
            <select
              v-model="workflowIds[item.suggestion.id]"
              :disabled="locked || !!pending[item.suggestion.id]"
              :data-goal-action-workflow="item.suggestion.id"
            >
              <option value="">选择审批计划</option>
              <option
                v-for="flow in matchingWorkflows(item)"
                :key="flow.id"
                :value="flow.id"
              >
                {{ flow.name }}
              </option>
            </select>
          </label>
          <button
            v-if="!item.intent.proposal && canPrepare(item)"
            :disabled="
              locked ||
              !!pending[item.suggestion.id] ||
              !workflowIds[item.suggestion.id]
            "
            :data-goal-action-submit="item.suggestion.id"
            @click="submit(item)"
          >
            提交多级审批
          </button>
        </template>
        <button
          v-if="item.intent.proposal"
          :disabled="locked"
          :data-goal-action-open="item.suggestion.id"
          @click="emit('proposal-id', item.intent.proposal.proposalId)"
        >
          查看审批与执行记录
        </button>
        <p v-if="item.intent.receipt">
          操作状态：{{
            runLabel(item.intent.receipt.run.status)
          }}，仍需复查风险。
        </p>
      </template>
      <form v-else-if="canPrepare(item)" @submit.prevent="prepare(item)">
        <label
          >拟保存说明<textarea
            v-model="descriptions[item.suggestion.id]"
            :disabled="locked || !!pending[item.suggestion.id]"
            :data-goal-action-description="item.suggestion.id"
            rows="2"
          />
        </label>
        <label v-if="item.suggestion.actionType === 'task.create'"
          >任务类型
          <select
            v-model="taskTypes[item.suggestion.id]"
            :disabled="locked || !!pending[item.suggestion.id]"
            :data-goal-action-type="item.suggestion.id"
          >
            <option value="query_info">信息查询</option>
            <option value="analyze_data">数据分析</option>
            <option value="create_file">创建文件</option>
            <option value="edit_file">编辑文件</option>
            <option value="export_file">导出文件</option>
            <option value="deploy_project">项目部署</option>
          </select>
        </label>
        <button
          type="submit"
          :disabled="
            locked ||
            !!pending[item.suggestion.id] ||
            !validDescription(item.suggestion.id)
          "
          :data-goal-action-prepare="item.suggestion.id"
        >
          核对当前来源并预览
        </button>
      </form>
      <p v-if="pending[item.suggestion.id]" role="status">
        结果待核对，保留原始请求；不自动重复准备或提交。
      </p>
      <button
        v-if="pending[item.suggestion.id]"
        :disabled="locked"
        :data-goal-action-retry="item.suggestion.id"
        @click="retry(item.suggestion.id)"
      >
        核对或重试同一次请求
      </button>
    </article>
    <button
      v-if="afterId"
      :disabled="locked"
      data-testid="organization-goal-actions-more"
      @click="load(true)"
    >
      更多建议
    </button>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRaw, watch } from "vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationError,
} from "./organization-project-ui";
import { actionCode, runLabel } from "./task-description-ui";
type Goal = {
  id: string;
  revision: number;
  status: string;
  allowedActionTypes?: string[];
};
type IntentResult = {
  intent: {
    id: string;
    goalId: string;
    suggestionId: string;
    actorDid: string;
    status: string;
  };
  preview: any;
  proposal: any;
  receipt: any;
};
type Item = {
  suggestion: {
    id: string;
    goalId: string;
    projectId: string;
    actionType: string;
    sourceTaskId: string;
    reviewId: string;
  };
  current: boolean;
  intent: IntentResult | null;
};
type Recovery = {
  method: "prepareGoalAction" | "submitGoalAction";
  input: any;
};
const props = defineProps<{
  goal: Goal;
  projectId: string;
  orgId: string;
  identityKey?: string;
  permissions: string[];
  workflows: Array<{ id: string; name: string; actionType: string }>;
  parentBusy?: boolean;
  recovery?: Record<string, Recovery>;
}>();
const emit = defineEmits<{
  (event: "enable-actions"): void;
  (event: "review-id", id: string): void;
  (event: "proposal-id", id: string): void;
  (event: "authority-error", value: unknown): void;
  (event: "recovery", value: Record<string, Recovery>): void;
}>();
const items = ref<Item[]>([]),
  descriptions = ref<Record<string, string>>({}),
  taskTypes = ref<Record<string, string>>({}),
  workflowIds = ref<Record<string, string>>({});
const pending = ref<Record<string, Recovery>>({}),
  busy = ref(false),
  error = ref(""),
  afterId = ref<string | null>(null),
  omitted = ref(0);
const locked = computed(() => busy.value || props.parentBusy);
const enabled = computed(() =>
  ["task.create", "task.update-description"].some((type) =>
    props.goal.allowedActionTypes?.includes(type),
  ),
);
let epoch = 0,
  mounted = true,
  loaded = false;
const current = (token: number) => mounted && token === epoch;
function intentState(status: string) {
  return (
    (
      {
        draft: "待读取预览",
        prepared: "待提交审批",
        submitted: "已提交审批",
        succeeded: "操作已保存",
        cancelled: "已取消",
        denied: "写入未获准",
        unknown: "结果待核查",
        running: "结果待核查",
      } as Record<string, string>
    )[status] || "状态待核查"
  );
}
function canPrepare(item: Item) {
  return (
    item.current &&
    props.goal.status === "active" &&
    props.goal.allowedActionTypes?.includes(item.suggestion.actionType) &&
    ["goal.propose", "task.read", item.suggestion.actionType].every((p) =>
      props.permissions.includes(p),
    )
  );
}
function validDescription(id: string) {
  const value = descriptions.value[id] || "";
  return !!value.trim() && new TextEncoder().encode(value).length <= 8192;
}
function matchingWorkflows(item: Item) {
  return props.workflows.filter(
    (flow) => flow.actionType === item.suggestion.actionType,
  );
}
function savePending(id: string, value: Recovery | null) {
  if (value) pending.value[id] = value;
  else delete pending.value[id];
  emit("recovery", structuredClone(toRaw(pending.value)));
}
function validateResult(
  value: IntentResult,
  suggestionId: string,
  expectedIntentId?: string,
) {
  if (
    !value?.intent ||
    value.intent.goalId !== props.goal.id ||
    value.intent.suggestionId !== suggestionId ||
    value.intent.actorDid !== props.identityKey ||
    (expectedIntentId && value.intent.id !== expectedIntentId) ||
    (value.proposal &&
      (value.proposal.projectId !== props.projectId ||
        value.proposal.orgId !== props.orgId ||
        value.proposal.requesterDid !== value.intent.actorDid))
  )
    throw new Error("ACTION_GOAL_NOT_FOUND_OR_DENIED");
  if (
    value.preview &&
    (value.preview.request?.input?.goalIntent?.id !== value.intent.id ||
      value.preview.request.input.goalIntent.goalId !== props.goal.id)
  )
    throw new Error("ACTION_GOAL_NOT_FOUND_OR_DENIED");
}
function failure(value: unknown) {
  if (
    organizationAuthorityError(value) ||
    /^ACTION_GOAL_(NOT_FOUND_OR_DENIED|AUTHORITY_|IDENTITY_)/u.test(
      actionCode(value),
    )
  ) {
    epoch++;
    busy.value = false;
    items.value = [];
    descriptions.value = {};
    pending.value = {};
    afterId.value = null;
    loaded = false;
    emit("recovery", {});
    emit("authority-error", value);
  }
  error.value = organizationError(value);
}
const definite = (value: unknown) =>
  !/(UNRESOLVED|OUTCOME_UNKNOWN)/u.test(actionCode(value)) &&
  /^(ORG_(AUTH|APPROVAL|PROPOSAL)_|PROJECT_RISK_|GOAL_|ACTION_(INVALID_|NOT_FOUND_OR_DENIED|UNSUPPORTED_|GOAL_))/u.test(
    actionCode(value),
  );
async function work(operation: (token: number) => Promise<void>) {
  if (
    locked.value ||
    !["goal.read", "risk.read"].every((p) => props.permissions.includes(p))
  )
    return;
  const token = epoch;
  busy.value = true;
  error.value = "";
  try {
    await operation(token);
  } catch (value) {
    if (current(token)) failure(value);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function fetch(token: number, more = false) {
  const result = await organizationApi().listGoalSuggestions({
    goalId: props.goal.id,
    limit: 20,
    ...(more && afterId.value ? { afterId: afterId.value } : {}),
  });
  if (!current(token)) return;
  for (const item of result.suggestions as Item[]) {
    if (
      item.suggestion.goalId !== props.goal.id ||
      item.suggestion.projectId !== props.projectId ||
      !["task.create", "task.update-description"].includes(
        item.suggestion.actionType,
      ) ||
      typeof item.suggestion.reviewId !== "string"
    )
      throw new Error("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    if (item.intent && item.intent.intent.actorDid === props.identityKey)
      validateResult(item.intent, item.suggestion.id);
    if (
      item.intent &&
      item.intent.intent.actorDid !== props.identityKey &&
      item.intent.preview
    )
      throw new Error("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    taskTypes.value[item.suggestion.id] ??= "query_info";
    workflowIds.value[item.suggestion.id] ??=
      matchingWorkflows(item)[0]?.id || "";
  }
  items.value = more
    ? [
        ...new Map(
          [...items.value, ...result.suggestions].map((item) => [
            item.suggestion.id,
            item,
          ]),
        ).values(),
      ]
    : result.suggestions;
  afterId.value = result.nextCursor;
  omitted.value = result.summary?.omittedCount || 0;
  loaded = true;
}
async function load(more = false) {
  await work((token) => fetch(token, more));
}
async function perform(id: string, request: Recovery, token: number) {
  savePending(id, request);
  try {
    const result = await organizationApi()[request.method](
      structuredClone(toRaw(request.input)),
    );
    if (!current(token)) return;
    validateResult(
      result,
      id,
      request.method === "submitGoalAction"
        ? request.input.intentId
        : undefined,
    );
    savePending(id, null);
    const item = items.value.find((item) => item.suggestion.id === id);
    if (item) item.intent = result;
    if (result.proposal) emit("proposal-id", result.proposal.proposalId);
  } catch (value) {
    if (!current(token)) return;
    if (definite(value)) savePending(id, null);
    throw value;
  }
}
async function prepare(item: Item) {
  if (!canPrepare(item) || !validDescription(item.suggestion.id)) return;
  await work((token) =>
    perform(
      item.suggestion.id,
      {
        method: "prepareGoalAction",
        input: {
          goalId: props.goal.id,
          suggestionId: item.suggestion.id,
          expectedRevision: props.goal.revision,
          requestId: globalThis.crypto.randomUUID(),
          description: descriptions.value[item.suggestion.id],
          ...(item.suggestion.actionType === "task.create"
            ? { taskType: taskTypes.value[item.suggestion.id] }
            : {}),
        },
      },
      token,
    ),
  );
}
async function submit(item: Item) {
  if (
    !canPrepare(item) ||
    !item.intent ||
    item.intent.intent.actorDid !== props.identityKey ||
    !workflowIds.value[item.suggestion.id]
  )
    return;
  await work((token) =>
    perform(
      item.suggestion.id,
      {
        method: "submitGoalAction",
        input: {
          intentId: item.intent!.intent.id,
          workflowId: workflowIds.value[item.suggestion.id],
        },
      },
      token,
    ),
  );
}
async function retry(id: string) {
  const prior = pending.value[id];
  if (!prior) return;
  await work((token) => perform(id, toRaw(prior), token));
}
watch(
  [
    () => props.goal.id,
    () => props.projectId,
    () => props.orgId,
    () => props.identityKey,
    () => props.permissions.join(","),
  ],
  (_value, previous) => {
    epoch++;
    busy.value = false;
    loaded = false;
    items.value = [];
    descriptions.value = {};
    workflowIds.value = {};
    taskTypes.value = {};
    afterId.value = null;
    error.value = "";
    pending.value = previous?.length
      ? {}
      : structuredClone(toRaw(props.recovery || {}));
    if (previous?.length) emit("recovery", {});
    void load();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => [props.goal.revision, props.goal.status],
  () => {
    epoch++;
    loaded = false;
    busy.value = false;
    items.value = [];
    descriptions.value = {};
    void load();
  },
);
watch(
  () => props.parentBusy,
  (value, previous) => {
    if (previous && !value && !loaded) void load();
  },
);
onBeforeUnmount(() => {
  mounted = false;
  epoch++;
  items.value = [];
  descriptions.value = {};
});
</script>
