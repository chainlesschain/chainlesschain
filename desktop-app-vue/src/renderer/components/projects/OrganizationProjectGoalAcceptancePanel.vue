<template>
  <section data-testid="organization-goal-acceptance">
    <h5>组织目标独立验收</h5>
    <p>
      验收重新核对任务、选定风险、跨成员目标动作与人工记录。任务操作成功不代表目标通过验收。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      :disabled="locked"
      data-testid="organization-acceptance-refresh"
      @click="load()"
    >
      刷新共享验收记录
    </button>
    <form
      v-if="canConfigure && goal.status === 'active'"
      @submit.prevent="configure"
    >
      <label
        ><input
          v-model="tasks"
          type="checkbox"
          :disabled="locked || !!pending"
          data-testid="organization-acceptance-tasks"
        />项目非空且所有任务已完成</label
      >
      <label
        ><input
          v-model="risks"
          type="checkbox"
          :disabled="locked || !!pending"
          data-testid="organization-acceptance-risks"
        />逾期与直接依赖信号已消除</label
      >
      <label
        ><input
          v-model="actions"
          type="checkbox"
          :disabled="locked || !!pending"
          data-testid="organization-acceptance-actions"
        />跨成员目标动作均已处理</label
      >
      <label
        ><input
          v-model="manual"
          type="checkbox"
          :disabled="locked || !!pending"
          data-testid="organization-acceptance-manual"
        />授权成员已核对业务交付结果</label
      >
      <button
        :disabled="
          locked || !!pending || !(tasks || risks || actions || manual)
        "
        data-testid="organization-acceptance-configure"
      >
        原生确认并保存验收条件
      </button>
    </form>
    <p v-if="!currentPlan && goal.status === 'active'">
      当前版本尚无有效验收计划，请先核对并保存条件。
    </p>
    <div v-if="currentPlan && goal.status === 'active'">
      <ul>
        <li
          v-for="criterion in goal.acceptanceCriteria || []"
          :key="criterion.id"
        >
          {{ criterion.description }}
        </li>
      </ul>
      <button
        v-if="hasManual && canAccept"
        :disabled="locked || !!pending"
        data-testid="organization-acceptance-acknowledge"
        @click="acknowledge"
      >
        记录本人原生人工验收
      </button>
      <button
        v-if="canCheck"
        :disabled="locked || !!pending"
        data-testid="organization-acceptance-check"
        @click="inspect"
      >
        检查最新验收条件
      </button>
      <button
        v-if="canCheck && canConfigure"
        :disabled="locked || !!pending"
        data-testid="organization-acceptance-complete"
        @click="complete"
      >
        原生确认后重新检查并完成目标
      </button>
    </div>
    <p
      v-if="
        goal.status === 'done' &&
        status?.reports.some(
          (report) => report.met && report.appliedRevision === goal.revision,
        )
      "
      data-testid="organization-acceptance-done"
    >
      目标已通过该次独立验收；后续业务变化仍以当前项目记录为准。
    </p>
    <p v-if="pending" role="status">
      本次结果待核对，保留原始请求；其他验收操作暂不可提交。
    </p>
    <button
      v-if="pending"
      :disabled="locked"
      data-testid="organization-acceptance-retry"
      @click="retry"
    >
      核对或重试原验收请求
    </button>
    <ul>
      <li v-for="ack in status?.acknowledgements || []" :key="ack.id">
        人工验收成员：{{ ack.actorDid }} ·
        {{ ack.status === "accepted" ? "已确认" : "未确认" }}
      </li>
    </ul>
    <article
      v-for="report in status?.reports || []"
      :key="report.id"
      :data-organization-acceptance-report="report.id"
    >
      <p>
        {{ new Date(report.checkedAt).toLocaleString() }} ·
        {{ report.actorDid }} ·
        {{ report.met ? "该次条件满足" : "该次条件未满足" }}
      </p>
      <p v-if="report.blockedReason">{{ reason(report.blockedReason) }}</p>
      <ul>
        <li v-for="criterion in report.criteria" :key="criterion.id">
          {{ label(criterion.id) }}：{{ criterion.met ? "满足" : "未满足" }}（{{
            reason(criterion.reason)
          }}）
        </li>
      </ul>
      <button
        v-if="report.review"
        :disabled="locked"
        :data-organization-acceptance-review="report.id"
        @click="emit('review-id', report.review.id)"
      >
        查看本次风险来源证据
      </button>
      <p v-if="report.appliedRevision">
        本报告用于完成目标版本 {{ report.appliedRevision }}。
      </p>
    </article>
    <button
      v-if="status?.nextCursor"
      :disabled="locked"
      data-testid="organization-acceptance-more"
      @click="load(true)"
    >
      更早验收报告
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
import { actionCode } from "./task-description-ui";
type Criterion = { id: string; kind: string; description: string };
type Goal = {
  id: string;
  revision: number;
  status: string;
  projectRef: {
    id: string;
    scope: { kind: string; id: string };
    sourceKind: string;
  };
  acceptanceCriteria?: Criterion[];
};
type Pending = {
  method:
    | "configureGoalAcceptance"
    | "acknowledgeGoalAcceptance"
    | "checkGoalAcceptance"
    | "completeGoal";
  input: any;
};
type Report = {
  id: string;
  goalId: string;
  actorDid: string;
  requestId: string;
  goalRevision: number;
  checkedAt: number;
  met: boolean;
  appliedRevision: number | null;
  blockedReason: string | null;
  review: { id: string } | null;
  criteria: Array<{ id: string; met: boolean; reason: string }>;
};
type Status = {
  goal: Goal;
  plan: any;
  planCurrent?: boolean;
  acknowledgements: any[];
  reports: Report[];
  nextCursor: string | null;
};
const props = defineProps<{
  goal: Goal;
  projectId: string;
  orgId: string;
  identityKey?: string;
  permissions: string[];
  parentBusy?: boolean;
  recovery?: Pending | null;
}>();
const emit = defineEmits<{
  (event: "changed"): void;
  (event: "review-id", id: string): void;
  (event: "authority-error", value: unknown): void;
  (event: "recovery", value: Pending | null): void;
}>();
const status = ref<Status | null>(null),
  pending = ref<Pending | null>(null),
  busy = ref(false),
  error = ref("");
const tasks = ref(true),
  risks = ref(false),
  actions = ref(true),
  manual = ref(true);
const locked = computed(() => busy.value || props.parentBusy),
  canAccept = computed(() => props.permissions.includes("goal.accept"));
const canConfigure = computed(
  () => canAccept.value && props.permissions.includes("goal.update"),
);
const canCheck = computed(
  () => canAccept.value && props.permissions.includes("risk.evaluate"),
);
const currentPlan = computed(
  () => !!status.value?.plan && status.value.planCurrent === true,
);
const hasManual = computed(
  () => currentPlan.value && !!status.value?.plan?.manualCriterionIds?.length,
);
let epoch = 0,
  mounted = true,
  loaded = false;
const current = (token: number) => mounted && token === epoch;
function reason(code: string) {
  return (
    (
      {
        "member-accepted": "已有成员原生人工验收记录",
        "member-acceptance-required": "需要成员人工验收",
        "owner-accepted": "已有原生人工验收记录",
        "owner-acceptance-required": "需要人工验收",
        "project-tasks-incomplete": "仍有未完成任务",
        "project-tasks-completed": "所有任务已完成",
        "nonempty-project-required": "项目没有可验收任务",
        "source-insufficient": "业务来源不足",
        "goal-actions-unresolved": "存在待处理或结果未知的目标动作",
        "goal-actions-resolved": "目标动作均已处理",
        "selected-risk-signals-present": "选定风险仍存在",
        "selected-risk-signals-cleared": "选定风险已消除",
        GOAL_COMPLETION_EXPIRED: "目标已到期",
        GOAL_COMPLETION_BUDGET_EXCEEDED: "本次检查超过累计预算",
      } as Record<string, string>
    )[code] || code
  );
}
function label(id: string) {
  return (
    props.goal.acceptanceCriteria?.find((c) => c.id === id)?.description || id
  );
}
function validateGoal(goal: Goal) {
  if (
    goal?.id !== props.goal.id ||
    goal.projectRef?.id !== props.projectId ||
    goal.projectRef.scope.kind !== "organization" ||
    goal.projectRef.scope.id !== props.orgId ||
    goal.projectRef.sourceKind !== "desktop.organization-project-goals"
  )
    throw new Error("GOAL_NOT_FOUND_OR_DENIED");
}
function validateReport(report: Report) {
  if (
    report?.goalId !== props.goal.id ||
    typeof report.id !== "string" ||
    typeof report.actorDid !== "string" ||
    !report.actorDid.startsWith("did:") ||
    !Array.isArray(report.criteria)
  )
    throw new Error("GOAL_NOT_FOUND_OR_DENIED");
}
function save(value: Pending | null) {
  pending.value = value;
  emit("recovery", value ? structuredClone(toRaw(value)) : null);
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    epoch++;
    busy.value = false;
    loaded = false;
    status.value = null;
    save(null);
    emit("authority-error", value);
  }
  error.value = /(BUDGET|USAGE_UNKNOWN)/u.test(actionCode(value))
    ? "验收受到共享预算或未知用量限制，请先核对未决操作。"
    : organizationError(value);
}
function definite(value: unknown) {
  return (
    !/(UNRESOLVED|OUTCOME_UNKNOWN)/u.test(actionCode(value)) &&
    /^(ORG_AUTH_|GOAL_(INVALID_|NOT_FOUND_OR_DENIED|IDENTITY_|AUTHORITY_|REVISION_CONFLICT|USAGE_|COMPLETION_(INVALID_|NOT_ACTIVE|PLAN_|ACK_|EXPIRED|REQUEST_CONFLICT|FRESHNESS_|SOURCE_|NOT_MET))|PROJECT_RISK_(INVALID_|NOT_FOUND_OR_DENIED|AUTHORITY_))/u.test(
      actionCode(value),
    )
  );
}
async function work(operation: (token: number) => Promise<void>) {
  if (
    locked.value ||
    !["goal.read", "risk.read", "task.read"].every((p) =>
      props.permissions.includes(p),
    )
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
  const result = await organizationApi().getGoalAcceptanceStatus({
    goalId: props.goal.id,
    limit: 20,
    ...(more && status.value?.nextCursor
      ? { beforeId: status.value.nextCursor }
      : {}),
  });
  if (!current(token)) return;
  validateGoal(result.goal);
  if (result.plan && result.plan.goalId !== props.goal.id)
    throw new Error("GOAL_NOT_FOUND_OR_DENIED");
  for (const r of result.reports) validateReport(r);
  for (const a of result.acknowledgements || [])
    if (
      a.goalId !== props.goal.id ||
      typeof a.actorDid !== "string" ||
      !a.actorDid.startsWith("did:")
    )
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
  status.value =
    more && status.value
      ? {
          ...result,
          reports: [
            ...new Map(
              [...status.value.reports, ...result.reports].map((r) => [
                r.id,
                r,
              ]),
            ).values(),
          ],
        }
      : result;
  loaded = true;
  if (result.plan && !pending.value) {
    tasks.value = result.plan.assertions.some(
      (a: any) => a.type === "all-tasks-completed",
    );
    risks.value = result.plan.assertions.some(
      (a: any) => a.type === "selected-risk-signals-cleared",
    );
    actions.value = result.plan.assertions.some(
      (a: any) => a.type === "all-goal-actions-resolved",
    );
    manual.value = !!result.plan.manualCriterionIds.length;
  }
}
async function load(more = false) {
  await work((token) => fetch(token, more));
}
function request() {
  return {
    goalId: props.goal.id,
    expectedRevision: props.goal.revision,
    requestId: globalThis.crypto.randomUUID(),
  };
}
async function perform(value: Pending, token: number) {
  save(value);
  try {
    const result = await organizationApi()[value.method](
      structuredClone(toRaw(value.input)),
    );
    if (!current(token)) return;
    if (result.status === "cancelled") {
      save(null);
      return;
    }
    if (value.method === "acknowledgeGoalAcceptance") {
      const ack = result.acknowledgement;
      if (
        ack?.goalId !== props.goal.id ||
        ack.actorDid !== props.identityKey ||
        ack.requestId !== value.input.requestId
      )
        throw new Error("GOAL_NOT_FOUND_OR_DENIED");
    } else {
      validateGoal(result.goal);
      if (value.method === "configureGoalAcceptance") {
        if (result.plan?.goalId !== props.goal.id)
          throw new Error("GOAL_NOT_FOUND_OR_DENIED");
      } else {
        validateReport(result.report);
        if (
          result.report.actorDid !== props.identityKey ||
          result.report.requestId !== value.input.requestId ||
          result.report.goalRevision !== value.input.expectedRevision ||
          (result.completed &&
            (result.goal.status !== "done" ||
              !result.report.met ||
              result.report.appliedRevision !== result.goal.revision))
        )
          throw new Error("GOAL_NOT_FOUND_OR_DENIED");
      }
    }
    save(null);
    if (value.method === "configureGoalAcceptance" || result.completed) {
      emit("changed");
      return;
    }
    await fetch(token);
  } catch (value) {
    if (!current(token)) return;
    if (definite(value)) save(null);
    throw value;
  }
}
async function configure() {
  if (
    !canConfigure.value ||
    pending.value ||
    !(tasks.value || risks.value || actions.value || manual.value)
  )
    return;
  const acceptanceCriteria: Criterion[] = [],
    assertions: any[] = [];
  if (tasks.value) {
    acceptanceCriteria.push({
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
    acceptanceCriteria.push({
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
    acceptanceCriteria.push({
      id: "actions-resolved",
      kind: "business-assertion",
      description: "跨成员目标动作均已处理",
    });
    assertions.push({
      criterionId: "actions-resolved",
      type: "all-goal-actions-resolved",
    });
  }
  if (manual.value)
    acceptanceCriteria.push({
      id: "member-accepted",
      kind: "manual",
      description: "授权成员已核对业务交付结果",
    });
  await work((token) =>
    perform(
      {
        method: "configureGoalAcceptance",
        input: { ...request(), acceptanceCriteria, assertions },
      },
      token,
    ),
  );
}
async function acknowledge() {
  if (!canAccept.value || pending.value || !hasManual.value) return;
  await work((token) =>
    perform(
      {
        method: "acknowledgeGoalAcceptance",
        input: {
          ...request(),
          criterionIds: [...status.value!.plan.manualCriterionIds],
        },
      },
      token,
    ),
  );
}
async function inspect() {
  if (!canCheck.value || pending.value) return;
  await work((token) =>
    perform({ method: "checkGoalAcceptance", input: request() }, token),
  );
}
async function complete() {
  if (!canCheck.value || !canConfigure.value || pending.value) return;
  await work((token) =>
    perform({ method: "completeGoal", input: request() }, token),
  );
}
async function retry() {
  if (!pending.value) return;
  const original = toRaw(pending.value);
  await work((token) => perform(original, token));
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
    status.value = null;
    error.value = "";
    pending.value = previous?.length
      ? null
      : props.recovery
        ? structuredClone(toRaw(props.recovery))
        : null;
    if (previous?.length) emit("recovery", null);
    void load();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => [props.goal.revision, props.goal.status],
  () => {
    epoch++;
    busy.value = false;
    loaded = false;
    status.value = null;
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
  status.value = null;
});
</script>
