<template>
  <section v-if="available" class="goal-panel" data-testid="project-goal-panel">
    <div class="actions">
      <h3>项目目标与巡检</h3>
      <button :disabled="busy" data-testid="refresh-goals" @click="loadGoals()">
        刷新目标
      </button>
    </div>
    <p class="muted">
      巡检在应用运行且身份解锁时检查逾期和依赖信号；重新打开后补做一次到期检查。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form data-testid="create-goal" @submit.prevent="createGoal">
      <label
        >目标说明<input
          v-model="objective"
          maxlength="2000"
          :disabled="busy"
          data-testid="goal-objective"
      /></label>
      <label
        >最多检查次数<input
          v-model.number="maxRuns"
          type="number"
          min="1"
          max="1000"
          :disabled="busy"
          data-testid="goal-max-runs"
      /></label>
      <button
        type="submit"
        :disabled="busy || !objective.trim() || !validBudget"
      >
        保存目标
      </button>
    </form>
    <p v-if="!goals.length && !busy">保存目标后，可立即检查或开启巡检。</p>
    <article
      v-for="item in goals"
      :key="item.goal.id"
      :data-goal-id="item.goal.id"
    >
      <h4>{{ item.goal.objective }}</h4>
      <p data-testid="goal-state">{{ stateLabel(item.executionState) }}</p>
      <p
        v-if="item.blockedReason && item.goal.status === 'active'"
        class="notice"
      >
        {{ reasonLabel(item.blockedReason) }}
      </p>
      <p>
        已检查 {{ item.usage.checks }} 次 /
        {{ item.goal.budgetPolicy.maxRuns ?? 1000 }} 次
      </p>
      <p v-if="item.usage.totalRuns !== undefined">
        检查与操作累计 {{ item.usage.totalRuns }} 次；预留
        {{ item.usage.reservedRuns ?? 0 }} 次。
      </p>
      <div class="actions">
        <template v-if="item.goal.status === 'active'">
          <label
            >检查间隔<select v-model.number="intervalMs" :disabled="busy">
              <option :value="60_000">1 分钟</option>
              <option :value="900_000">15 分钟</option>
              <option :value="3_600_000">1 小时</option>
              <option :value="86_400_000">1 天</option>
            </select></label
          >
          <button
            :disabled="busy || hardBlocked(item) || !!pending[item.goal.id]"
            data-testid="start-goal"
            @click="control(item, 'start')"
          >
            {{ item.monitor?.enabled ? "更新巡检间隔" : "开启巡检" }}
          </button>
          <button
            :disabled="busy || (hardBlocked(item) && !pending[item.goal.id])"
            data-testid="check-goal"
            @click="control(item, 'check')"
          >
            {{ pending[item.goal.id] ? "重试本次检查" : "立即检查" }}
          </button>
          <button
            :disabled="busy"
            data-testid="stop-goal"
            @click="control(item, 'stop')"
          >
            暂停目标
          </button>
        </template>
        <button
          v-else-if="item.goal.status === 'paused'"
          :disabled="busy || item.executionState === 'pause-requested'"
          data-testid="resume-goal"
          @click="control(item, 'resume')"
        >
          重新启用目标
        </button>
      </div>
      <p v-if="pending[item.goal.id]" class="notice">
        本次检查结果待核对，重试会读取同一次检查的结果。
      </p>
      <ul v-if="item.history.length" data-testid="goal-check-history">
        <li v-for="check in item.history" :key="check.occurrenceId">
          <button :disabled="busy" @click="emit('review-id', check.reviewId)">
            {{ check.result.checkedAt }}：{{
              check.result.status === "evaluated"
                ? `${check.result.riskTaskCount ?? 0} 个信号`
                : "数据不足"
            }}
          </button>
        </li>
      </ul>
      <ProjectGoalActionsPanel
        :goal="item.goal"
        :identity-key="identityKey"
        @review-id="emit('review-id', $event)"
        @goal-changed="loadGoals()"
        @authority-error="emit('authority-error')"
      />
    </article>
    <button
      v-if="afterId"
      :disabled="busy"
      data-testid="more-goals"
      @click="loadGoals(true)"
    >
      更多目标
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
import ProjectGoalActionsPanel from "./ProjectGoalActionsPanel.vue";
type Goal = {
  id: string;
  revision: number;
  status: string;
  objective: string;
  ownerRef: string;
  allowedActionTypes?: string[];
  projectRef: { id: string; scope: { kind: string; id: string } };
  budgetPolicy: { maxRuns: number | null };
};
type Status = {
  goal: Goal;
  executionState: string;
  blockedReason: string | null;
  monitor: { enabled: number } | null;
  usage: { checks: number; totalRuns?: number; reservedRuns?: number };
  history: Array<{
    occurrenceId: string;
    reviewId: string;
    result: { checkedAt: string; status: string; riskTaskCount: number | null };
  }>;
};
type Request = { id: string; expectedRevision: number; requestId: string };
type GoalApi = {
  createGoal(input: {
    projectId: string;
    objective: string;
    budgetPolicy: { maxRuns: number };
  }): Promise<Goal>;
  listGoals(input: {
    projectId: string;
    limit: number;
    afterId?: string;
  }): Promise<Goal[]>;
  reviseGoal(input: {
    id: string;
    expectedRevision: number;
    patch: { status: string };
  }): Promise<Goal>;
  getGoalMonitoringStatus(input: { id: string }): Promise<Status>;
  startGoalMonitoring(input: {
    id: string;
    expectedRevision: number;
    intervalMs: number;
  }): Promise<Status>;
  stopGoalMonitoring(input: {
    id: string;
    expectedRevision: number;
  }): Promise<Status>;
  checkGoalNow(
    input: Request,
  ): Promise<{ status: string; occurrenceId: string }>;
};
const props = defineProps<{ projectId: string; identityKey?: string }>();
const emit = defineEmits<{
  (event: "review-id", id: string): void;
  (event: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: GoalApi } }).electronAPI
    ?.project;
const available = computed(() =>
  [
    "createGoal",
    "listGoals",
    "reviseGoal",
    "getGoalMonitoringStatus",
    "startGoalMonitoring",
    "stopGoalMonitoring",
    "checkGoalNow",
  ].every((key) => typeof api()?.[key as keyof GoalApi] === "function"),
);
const goals = ref<Status[]>([]),
  pending = ref<Record<string, Request>>({});
const objective = ref(""),
  maxRuns = ref(20),
  intervalMs = ref(3_600_000);
const busy = ref(false),
  error = ref(""),
  afterId = ref<string | null>(null);
const validBudget = computed(
  () =>
    Number.isSafeInteger(maxRuns.value) &&
    maxRuns.value >= 1 &&
    maxRuns.value <= 1000,
);
let epoch = 0,
  mounted = true;
const current = (stamp: number) => mounted && epoch === stamp;
function stateLabel(state: string) {
  return (
    (
      {
        idle: "尚未开启巡检",
        waiting: "等待下次检查",
        running: "正在检查",
        paused: "已暂停",
        "pause-requested": "暂停中，等待在途检查结束",
        blocked: "巡检暂时受限",
      } as Record<string, string>
    )[state] ?? "状态待核对"
  );
}
function hardBlocked(item: Status) {
  return (
    !!item.blockedReason &&
    item.blockedReason !== "scheduler_authority_policy_stale"
  );
}
function reasonLabel(reason: string) {
  return (
    (
      {
        GOAL_MONITOR_BUDGET_EXHAUSTED: "检查次数或时间预算已用完。",
        GOAL_MONITOR_EXPIRED: "目标已到期。",
        GOAL_PROJECT_NOT_ACTIVE: "项目当前不处于草稿或进行中。",
        scheduler_authority_budget_exhausted:
          "当前身份的巡检额度已用完，额度恢复后继续。",
        scheduler_authority_policy_stale: "巡检授权已更新，请重新开启巡检。",
        scheduler_authority_permission_denied: "当前身份未获准执行风险巡检。",
        scheduler_authority_policy_required: "当前身份的巡检授权已停用。",
      } as Record<string, string>
    )[reason] ?? "请刷新目标并核对当前权限。"
  );
}
function validateGoal(goal: Goal, expectedId?: string) {
  if (
    goal?.projectRef?.id !== props.projectId ||
    goal.projectRef.scope.kind !== "personal" ||
    goal.projectRef.scope.id !== goal.ownerRef ||
    (expectedId && goal.id !== expectedId)
  )
    throw new Error("GOAL_NOT_FOUND_OR_DENIED");
}
function reset() {
  epoch++;
  goals.value = [];
  pending.value = {};
  objective.value = "";
  afterId.value = null;
  error.value = "";
  busy.value = false;
}
function failure(value: unknown, message: string) {
  if (isAuthorityError(value)) {
    reset();
    emit("authority-error");
    error.value = "当前身份已无法访问这些目标。";
  } else
    error.value =
      actionCode(value) === "GOAL_REVISION_CONFLICT"
        ? "目标已修改，请刷新后再操作。"
        : message;
}
async function loadGoals(more = false) {
  if (!available.value || busy.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const page = await api()!.listGoals({
      projectId: props.projectId,
      limit: 20,
      ...(more && afterId.value ? { afterId: afterId.value } : {}),
    });
    if (!current(stamp)) return;
    page.forEach((goal) => validateGoal(goal));
    const states = await Promise.all(
      page.map(async (goal) => {
        const state = await api()!.getGoalMonitoringStatus({ id: goal.id });
        if (current(stamp)) validateGoal(state.goal, goal.id);
        return state;
      }),
    );
    if (!current(stamp)) return;
    goals.value = more ? [...goals.value, ...states] : states;
    afterId.value = page.length === 20 ? page.at(-1)!.id : null;
  } catch (value) {
    if (current(stamp)) failure(value, "目标列表暂不可读取。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function createGoal() {
  if (
    busy.value ||
    !available.value ||
    !objective.value.trim() ||
    !validBudget.value
  )
    return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const goal = await api()!.createGoal({
      projectId: props.projectId,
      objective: objective.value.trim(),
      budgetPolicy: { maxRuns: maxRuns.value },
    });
    if (!current(stamp)) return;
    validateGoal(goal);
    const state = await api()!.getGoalMonitoringStatus({ id: goal.id });
    if (!current(stamp)) return;
    validateGoal(state.goal, goal.id);
    goals.value = [state, ...goals.value];
    objective.value = "";
  } catch (value) {
    if (current(stamp)) failure(value, "保存结果待核对，请刷新目标列表。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function control(
  item: Status,
  operation: "start" | "stop" | "resume" | "check",
) {
  if (busy.value || !available.value) return;
  const stamp = epoch,
    id = item.goal.id,
    expectedRevision = item.goal.revision;
  busy.value = true;
  error.value = "";
  try {
    let state: Status;
    if (operation === "start")
      state = await api()!.startGoalMonitoring({
        id,
        expectedRevision,
        intervalMs: intervalMs.value,
      });
    else if (operation === "stop") {
      state = await api()!.stopGoalMonitoring({ id, expectedRevision });
      if (current(stamp)) delete pending.value[id];
    } else {
      if (operation === "resume")
        await api()!.reviseGoal({
          id,
          expectedRevision,
          patch: { status: "active" },
        });
      else {
        const request = pending.value[id] ?? {
          id,
          expectedRevision,
          requestId: crypto.randomUUID(),
        };
        pending.value[id] = request;
        const outcome = await api()!.checkGoalNow(request);
        if (!current(stamp)) return;
        if (["succeeded", "dead_letter", "cancelled"].includes(outcome.status))
          delete pending.value[id];
        if (outcome.status === "dead_letter")
          error.value = "本次检查未完成，请核对巡检状态。";
      }
      if (!current(stamp)) return;
      state = await api()!.getGoalMonitoringStatus({ id });
    }
    if (!current(stamp)) return;
    validateGoal(state.goal, id);
    goals.value = goals.value.map((old) => (old.goal.id === id ? state : old));
  } catch (value) {
    if (current(stamp)) {
      if (
        [
          "GOAL_REVISION_CONFLICT",
          "GOAL_MONITOR_REQUEST_VERSION_CONFLICT",
        ].includes(actionCode(value))
      )
        delete pending.value[id];
      failure(
        value,
        operation === "check"
          ? "检查结果待核对，可重试本次检查。"
          : "操作结果待核对，请刷新目标。",
      );
    }
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  () => [props.projectId, props.identityKey],
  () => {
    reset();
    void loadGoals();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  mounted = false;
  reset();
});
</script>

<style scoped>
.goal-panel {
  margin-top: 20px;
  border-top: 1px solid #d9d9d9;
  padding-top: 16px;
}
.actions,
form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
input,
select,
button {
  padding: 6px 10px;
}
article {
  margin-top: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  padding: 12px;
}
.muted {
  color: #666;
}
.notice {
  color: #87620e;
}
</style>
