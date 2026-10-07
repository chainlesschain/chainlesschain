<template>
  <section v-if="available" data-testid="goal-acceptance-panel">
    <h5>独立验收</h5>
    <p>验收会重新读取项目任务、选定风险和目标动作，并核对人工确认记录。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="goal.status === 'active'">
      <form @submit.prevent="configure">
        <label
          ><input
            v-model="tasks"
            type="checkbox"
            :disabled="busy"
          />项目非空且所有任务已完成</label
        >
        <label
          ><input
            v-model="risks"
            type="checkbox"
            :disabled="busy"
          />逾期与直接依赖信号已消除</label
        >
        <label
          ><input
            v-model="actions"
            type="checkbox"
            :disabled="busy"
          />目标动作均已处理</label
        >
        <label
          ><input
            v-model="manual"
            type="checkbox"
            :disabled="busy"
          />我已人工验收业务结果</label
        >
        <button
          :disabled="busy || !(tasks || risks || actions || manual)"
          data-testid="configure-acceptance"
        >
          保存这些验收条件并更新目标版本
        </button>
      </form>
      <p v-if="!status?.plan">当前版本尚无已确认的验收设置。</p>
      <div v-else>
        <ul>
          <li v-for="criterion in goal.acceptanceCriteria" :key="criterion.id">
            {{ criterion.description }}
          </li>
        </ul>
        <button
          v-if="hasManual"
          :disabled="busy"
          data-testid="acknowledge-acceptance"
          @click="acknowledge"
        >
          打开原生人工验收确认
        </button>
        <button
          :disabled="busy"
          data-testid="check-acceptance"
          @click="check(false)"
        >
          {{ pending?.mode === "check" ? "重试本次验收检查" : "检查验收条件" }}
        </button>
        <button
          :disabled="busy"
          data-testid="complete-goal"
          @click="check(true)"
        >
          {{
            pending?.mode === "complete"
              ? "核对本次完成结果"
              : "重新检查并完成目标"
          }}
        </button>
      </div>
    </template>
    <p
      v-if="
        goal.status === 'done' &&
        !error &&
        status?.reports.some(
          (report) => report.met && report.appliedRevision === goal.revision,
        )
      "
    >
      目标已通过独立验收；项目状态和后续变化仍按业务记录显示。
    </p>
    <button :disabled="busy" data-testid="refresh-acceptance" @click="load()">
      刷新验收记录
    </button>
    <article v-for="report in status?.reports ?? []" :key="report.id">
      <p>
        {{ new Date(report.checkedAt).toLocaleString() }}：{{
          report.met ? "该次条件满足" : "该次条件未满足"
        }}
      </p>
      <p v-if="report.blockedReason">{{ reasonLabel(report.blockedReason) }}</p>
      <ul>
        <li v-for="criterion in report.criteria" :key="criterion.id">
          {{ label(criterion.id) }}：{{ criterion.met ? "满足" : "未满足" }}（{{
            reasonLabel(criterion.reason)
          }}）
        </li>
      </ul>
      <button
        v-if="report.review"
        :disabled="busy"
        @click="emit('review-id', report.review.id)"
      >
        查看本次原始业务证据
      </button>
      <p v-if="report.appliedRevision">
        该次验收已用于完成目标版本 {{ report.appliedRevision }}。
      </p>
    </article>
    <button v-if="status?.nextCursor" :disabled="busy" @click="load(true)">
      更多验收记录
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Criterion = { id: string; kind: string; description: string };
type Goal = {
  id: string;
  revision: number;
  status: string;
  acceptanceCriteria?: Criterion[];
};
type Report = {
  id: string;
  checkedAt: number;
  met: boolean;
  blockedReason: string | null;
  appliedRevision: number | null;
  review: { id: string } | null;
  criteria: Array<{ id: string; met: boolean; reason: string }>;
};
type Status = {
  goal: Goal;
  plan: null | {
    assertions: Array<{ type: string }>;
    manualCriterionIds: string[];
  };
  reports: Report[];
  nextCursor: string | null;
};
type CheckInput = {
  goalId: string;
  expectedRevision: number;
  requestId: string;
};
type Api = {
  getGoalAcceptanceStatus(input: {
    goalId: string;
    limit: number;
    beforeId?: string;
  }): Promise<Status>;
  configureGoalAcceptance(input: {
    goalId: string;
    expectedRevision: number;
    acceptanceCriteria: Criterion[];
    assertions: Array<{
      criterionId: string;
      type: string;
      reasonCodes?: string[];
    }>;
  }): Promise<{ goal: Goal }>;
  acknowledgeGoalAcceptance(
    input: CheckInput,
  ): Promise<{ acknowledgement: { status: string } }>;
  checkGoalAcceptance(
    input: CheckInput,
  ): Promise<{ goal: Goal; report: Report; completed: boolean }>;
  completeGoal(
    input: CheckInput,
  ): Promise<{ goal: Goal; report: Report; completed: boolean }>;
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
    "getGoalAcceptanceStatus",
    "configureGoalAcceptance",
    "acknowledgeGoalAcceptance",
    "checkGoalAcceptance",
    "completeGoal",
  ].every((key) => typeof api()?.[key as keyof Api] === "function"),
);
const tasks = ref(true),
  risks = ref(false),
  actions = ref(true),
  manual = ref(true);
const busy = ref(false),
  error = ref(""),
  status = ref<Status | null>(null);
const pending = ref<null | { mode: "check" | "complete"; request: CheckInput }>(
    null,
  ),
  pendingAck = ref<CheckInput | null>(null);
const hasManual = computed(
  () => !!status.value?.plan?.manualCriterionIds.length,
);
let epoch = 0,
  mounted = true;
const current = (stamp: number) => mounted && epoch === stamp;
function reset() {
  epoch++;
  status.value = null;
  pending.value = null;
  pendingAck.value = null;
  busy.value = false;
  error.value = "";
}
function failure(value: unknown, message: string) {
  if (isAuthorityError(value)) {
    reset();
    emit("authority-error");
    error.value = "当前身份已无法读取验收数据。";
  } else
    error.value = [
      "GOAL_REVISION_CONFLICT",
      "GOAL_COMPLETION_PLAN_REQUIRED",
    ].includes(actionCode(value))
      ? "目标已更新，请刷新并确认当前版本的验收条件。"
      : ["GOAL_USAGE_UNKNOWN", "GOAL_USAGE_BUDGET_EXHAUSTED"].includes(
            actionCode(value),
          )
        ? "验收受到累计预算或未知用量限制，请核对目标预算与未解决的操作。"
        : message;
}
function reasonLabel(reason: string) {
  return (
    (
      {
        "owner-accepted": "已有原生人工验收记录",
        "owner-acceptance-required": "需要人工验收",
        "project-tasks-incomplete": "仍有未完成任务",
        "project-tasks-completed": "所有任务已完成",
        "nonempty-project-required": "项目没有可验收任务",
        "source-insufficient": "原始业务数据不足",
        "goal-actions-unresolved": "仍有待处理或结果未知的动作",
        "goal-actions-resolved": "动作均已有处理结果",
        "selected-risk-signals-present": "选定风险仍存在",
        "selected-risk-signals-cleared": "选定风险信号已消除",
        GOAL_COMPLETION_EXPIRED: "目标已到期",
        GOAL_COMPLETION_BUDGET_EXCEEDED: "本次真实耗时已超过累计预算",
      } as Record<string, string>
    )[reason] ?? "请核对验收证据"
  );
}
function label(id: string) {
  return (
    props.goal.acceptanceCriteria?.find((criterion) => criterion.id === id)
      ?.description ?? id
  );
}
function input(): CheckInput {
  return {
    goalId: props.goal.id,
    expectedRevision: props.goal.revision,
    requestId: crypto.randomUUID(),
  };
}
async function load(more = false) {
  if (!available.value || busy.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const result = await api()!.getGoalAcceptanceStatus({
      goalId: props.goal.id,
      limit: 20,
      ...(more && status.value?.nextCursor
        ? { beforeId: status.value.nextCursor }
        : {}),
    });
    if (!current(stamp)) return;
    if (result.goal.id !== props.goal.id)
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
    status.value =
      more && status.value
        ? { ...result, reports: [...status.value.reports, ...result.reports] }
        : result;
    if (result.plan) {
      tasks.value = result.plan.assertions.some(
        (assertion) => assertion.type === "all-tasks-completed",
      );
      risks.value = result.plan.assertions.some(
        (assertion) => assertion.type === "selected-risk-signals-cleared",
      );
      actions.value = result.plan.assertions.some(
        (assertion) => assertion.type === "all-goal-actions-resolved",
      );
      manual.value = result.plan.manualCriterionIds.length > 0;
    }
  } catch (value) {
    if (current(stamp)) {
      status.value = null;
      failure(value, "验收记录暂不可读取。");
    }
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function configure() {
  if (
    busy.value ||
    !(tasks.value || risks.value || actions.value || manual.value)
  )
    return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  const criteria: Criterion[] = [],
    assertions: Array<{
      criterionId: string;
      type: string;
      reasonCodes?: string[];
    }> = [];
  if (tasks.value) {
    criteria.push({
      id: "tasks-completed",
      kind: "business-assertion",
      description: "项目非空且所有任务已完成",
    });
    assertions.push({
      criterionId: "tasks-completed",
      type: "all-tasks-completed",
    });
  }
  if (risks.value) {
    criteria.push({
      id: "signals-cleared",
      kind: "business-assertion",
      description: "逾期与直接依赖信号已消除",
    });
    assertions.push({
      criterionId: "signals-cleared",
      type: "selected-risk-signals-cleared",
      reasonCodes: [
        "OVERDUE_INCOMPLETE_TASK",
        "BLOCKED_BY_INCOMPLETE_DEPENDENCY",
      ],
    });
  }
  if (actions.value) {
    criteria.push({
      id: "actions-resolved",
      kind: "business-assertion",
      description: "目标动作均已处理",
    });
    assertions.push({
      criterionId: "actions-resolved",
      type: "all-goal-actions-resolved",
    });
  }
  if (manual.value)
    criteria.push({
      id: "owner-accepted",
      kind: "manual",
      description: "我已人工验收业务结果",
    });
  try {
    await api()!.configureGoalAcceptance({
      goalId: props.goal.id,
      expectedRevision: props.goal.revision,
      acceptanceCriteria: criteria,
      assertions,
    });
    if (current(stamp)) emit("goal-changed");
  } catch (value) {
    if (current(stamp)) failure(value, "设置结果待核对，请刷新目标。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function acknowledge() {
  if (busy.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  pendingAck.value ??= input();
  try {
    const result = await api()!.acknowledgeGoalAcceptance(pendingAck.value);
    if (!current(stamp)) return;
    if (result.acknowledgement.status !== "running") pendingAck.value = null;
    error.value =
      result.acknowledgement.status === "accepted"
        ? "人工验收已记录，请重新检查全部业务条件。"
        : result.acknowledgement.status === "running"
          ? "本次原生确认结果待核对，重试会读取原记录。"
          : "本次人工验收未确认。";
  } catch (value) {
    if (current(stamp))
      failure(value, "确认结果待核对，请保留本次请求并刷新。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function check(complete: boolean) {
  if (busy.value) return;
  const stamp = epoch,
    mode = complete ? "complete" : "check";
  busy.value = true;
  error.value = "";
  if (pending.value && pending.value.mode !== mode) {
    error.value = "请先核对上一项验收请求。";
    busy.value = false;
    return;
  }
  pending.value ??= { mode, request: input() };
  try {
    const result = await (complete
      ? api()!.completeGoal(pending.value.request)
      : api()!.checkGoalAcceptance(pending.value.request));
    if (!current(stamp)) return;
    if (result.goal.id !== props.goal.id)
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
    pending.value = null;
    status.value = {
      goal: result.goal,
      plan: status.value?.plan ?? null,
      reports: [
        result.report,
        ...(status.value?.reports.filter(
          (report) => report.id !== result.report.id,
        ) ?? []),
      ],
      nextCursor: status.value?.nextCursor ?? null,
    };
    if (result.completed) emit("goal-changed");
  } catch (value) {
    if (current(stamp)) failure(value, "验收结果待核对，可沿本次请求重试。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  () => [
    props.goal.id,
    props.goal.revision,
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
form,
label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
form {
  flex-direction: column;
  align-items: flex-start;
}
button {
  margin: 6px 8px 6px 0;
}
article {
  margin-top: 12px;
  padding: 8px;
  border: 1px solid #eee;
}
</style>
