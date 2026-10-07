<template>
  <section data-testid="organization-goal-panel">
    <h3>组织目标与风险巡检</h3>
    <p>
      目标由授权成员共享；手动检查与周期巡检仅使用逾期和直接依赖规则。检查或任务操作成功不代表目标通过验收。
    </p>
    <button
      :disabled="locked"
      data-testid="organization-goal-refresh"
      @click="loadGoals()"
    >
      刷新目标
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <form
      v-if="permissions.includes('goal.create')"
      data-testid="organization-goal-create"
      @submit.prevent="createGoal"
    >
      <label
        >目标说明<textarea
          v-model="objective"
          :disabled="locked || !!pendingCreate"
          rows="2"
          data-testid="organization-goal-objective"
        />
      </label>
      <label
        >总检查次数预算<input
          v-model.number="maxRuns"
          :disabled="locked || !!pendingCreate"
          type="number"
          min="1"
          max="1000"
          data-testid="organization-goal-max-runs"
      /></label>
      <button
        type="submit"
        :disabled="
          locked ||
          !!pendingCreate ||
          !objective.trim() ||
          objectiveBytes > 8192 ||
          !validBudget
        "
        data-testid="organization-goal-save"
      >
        确认创建共享目标
      </button>
    </form>
    <p v-if="pendingCreate" role="status">
      创建结果待核对。重试使用原请求，不自动重复创建。
    </p>
    <button
      v-if="pendingCreate"
      :disabled="locked"
      data-testid="organization-goal-create-retry"
      @click="createGoal"
    >
      核对或重试原创建请求
    </button>
    <p v-if="!goals.length && !locked">暂无共享目标。</p>
    <article
      v-for="item in goals"
      :key="item.goal.id"
      :data-organization-goal-id="item.goal.id"
    >
      <h4>{{ item.goal.objective }}</h4>
      <p>
        创建者：{{ item.goal.ownerRef }} · 版本：{{ item.goal.revision }} ·
        {{ stateLabel(item.goal.status) }}
      </p>
      <p>
        累计检查/用量：{{ item.usage.totalRuns }} /
        {{ Math.min(item.goal.budgetPolicy.maxRuns ?? 1000, 1000) }}
        次。所有成员共用目标预算。
      </p>
      <p v-if="item.goal.expiresAt">到期时间：{{ item.goal.expiresAt }}</p>
      <div v-if="permissions.includes('goal.update')">
        <label
          >更新目标说明<textarea
            v-model="drafts[item.goal.id]"
            :disabled="locked || !!pendingRevisions[item.goal.id]"
            :data-goal-draft="item.goal.id"
            rows="2"
          />
        </label>
        <button
          :disabled="
            locked ||
            !!pendingRevisions[item.goal.id] ||
            !validDraft(item.goal.id)
          "
          :data-goal-update="item.goal.id"
          @click="revise(item, { objective: drafts[item.goal.id] })"
        >
          确认更新说明
        </button>
        <button
          v-if="item.goal.status === 'active'"
          :disabled="locked || !!pendingRevisions[item.goal.id]"
          :data-goal-pause="item.goal.id"
          @click="revise(item, { status: 'paused' })"
        >
          暂停目标
        </button>
        <button
          v-if="item.goal.status === 'paused'"
          :disabled="locked || !!pendingRevisions[item.goal.id]"
          :data-goal-resume="item.goal.id"
          @click="revise(item, { status: 'active' })"
        >
          恢复目标
        </button>
        <button
          v-if="item.goal.status !== 'abandoned'"
          :disabled="locked || !!pendingRevisions[item.goal.id]"
          :data-goal-end="item.goal.id"
          @click="revise(item, { status: 'abandoned' })"
        >
          结束跟进
        </button>
      </div>
      <p v-if="pendingRevisions[item.goal.id]" role="status">
        更新结果待核对，保留原请求。
      </p>
      <button
        v-if="pendingRevisions[item.goal.id]"
        :disabled="locked"
        :data-goal-revise-retry="item.goal.id"
        @click="revise(item)"
      >
        核对或重试原更新请求
      </button>
      <button
        v-if="canCheck"
        :disabled="
          locked ||
          (item.goal.status !== 'active' && !pendingChecks[item.goal.id])
        "
        :data-goal-check="item.goal.id"
        @click="check(item)"
      >
        {{ pendingChecks[item.goal.id] ? "重试同一次检查" : "检查当前风险" }}
      </button>
      <div v-if="canStartMonitor">
        <label
          >巡检间隔<select
            v-model.number="intervals[item.goal.id]"
            :disabled="locked || !!pendingMonitors[item.goal.id]"
            :data-goal-monitor-interval="item.goal.id"
          >
            <option :value="60_000">1 分钟</option>
            <option :value="900_000">15 分钟</option>
            <option :value="3_600_000">1 小时</option>
            <option :value="86_400_000">1 天</option>
          </select></label
        >
        <label
          >本次授权小时数<input
            v-model.number="monitorHours[item.goal.id]"
            :disabled="locked || !!pendingMonitors[item.goal.id]"
            :data-goal-monitor-hours="item.goal.id"
            type="number"
            min="1"
            max="24"
        /></label>
        <button
          :disabled="
            locked ||
            !!pendingMonitors[item.goal.id] ||
            item.goal.status !== 'active' ||
            !validMonitor(item.goal.id)
          "
          :data-goal-monitor-start="item.goal.id"
          @click="monitorControl(item, 'start')"
        >
          {{ item.monitor?.enabled ? "重新确认巡检授权" : "确认启用周期巡检" }}
        </button>
      </div>
      <div v-if="item.monitor" :data-goal-monitor-status="item.goal.id">
        <p>
          巡检身份：{{ item.monitor.executorDid }} ·
          {{ monitorState(item.monitor.state) }}
        </p>
        <p>
          间隔：{{ item.monitor.intervalMs / 60_000 }} 分钟 · 同意截止：{{
            new Date(item.monitor.expiresAt).toLocaleString()
          }}
        </p>
        <p v-if="item.monitor.blockedReason">
          当前巡检不可继续。请核对目标、成员授权或预算，必要时重新确认启用。
        </p>
        <p v-if="item.monitor.activeOccurrence">
          本次周期检查：{{
            item.monitor.activeOccurrence.status
          }}。停止请求不表示在途检查已中止。
        </p>
        <template
          v-if="
            permissions.includes('goal.monitor') &&
            (item.monitor.enabled ||
              item.monitor.activeOccurrence ||
              item.monitor.state === 'blocked')
          "
        >
          <button
            :disabled="locked || !!pendingMonitors[item.goal.id]"
            :data-goal-monitor-stop="item.goal.id"
            @click="monitorControl(item, 'periodic')"
          >
            关闭后续周期
          </button>
          <button
            :disabled="locked || !!pendingMonitors[item.goal.id]"
            :data-goal-monitor-abort="item.goal.id"
            @click="monitorControl(item, 'abort')"
          >
            关闭周期并中止其在途检查
          </button>
        </template>
      </div>
      <p v-if="pendingMonitors[item.goal.id]" role="status">
        巡检设置结果待核对。保留原请求，不自动重复启用或停止。
      </p>
      <button
        v-if="pendingMonitors[item.goal.id]"
        :disabled="locked"
        :data-goal-monitor-retry="item.goal.id"
        @click="monitorControl(item)"
      >
        核对或重试原巡检请求
      </button>
      <p v-if="pendingChecks[item.goal.id]" role="status">
        检查结果待核对，重试仍使用同一检查请求。
      </p>
      <button
        v-if="permissions.includes('risk.read')"
        :disabled="locked"
        :data-goal-history="item.goal.id"
        @click="loadHistory(item.goal.id)"
      >
        查看目标检查历史
      </button>
      <ol>
        <li
          v-for="record in histories[item.goal.id]?.checks || []"
          :key="record.occurrenceId"
        >
          <button
            :disabled="locked"
            :data-goal-review="record.reviewId"
            @click="emit('review-id', record.reviewId)"
          >
            {{ record.result.checkedAt }} · {{ record.actorDid }} ·
            {{
              record.result.status === "evaluated"
                ? `${record.result.riskTaskCount ?? 0} 个任务有信号`
                : "数据不足"
            }}
          </button>
        </li>
      </ol>
      <button
        v-if="histories[item.goal.id]?.nextCursor"
        :disabled="locked"
        :data-goal-history-more="item.goal.id"
        @click="loadHistory(item.goal.id, true)"
      >
        更早检查
      </button>
      <OrganizationProjectGoalActionsPanel
        v-if="
          permissions.includes('risk.read') && permissions.includes('task.read')
        "
        :goal="item.goal"
        :project-id="projectId"
        :org-id="orgId"
        :identity-key="identityKey"
        :permissions="permissions"
        :workflows="workflows || []"
        :parent-busy="locked"
        :recovery="goalActionRecovery[item.goal.id]"
        @recovery="goalActionRecovery[item.goal.id] = $event"
        @enable-actions="
          revise(item, {
            allowedActionTypes: ['task.create', 'task.update-description'],
          })
        "
        @review-id="emit('review-id', $event)"
        @proposal-id="emit('proposal-id', $event)"
        @authority-error="failure"
      />
      <OrganizationProjectGoalAcceptancePanel
        v-if="
          permissions.includes('risk.read') && permissions.includes('task.read')
        "
        :goal="item.goal"
        :project-id="projectId"
        :org-id="orgId"
        :identity-key="identityKey"
        :permissions="permissions"
        :parent-busy="locked"
        :recovery="goalAcceptanceRecovery[item.goal.id]"
        @recovery="goalAcceptanceRecovery[item.goal.id] = $event"
        @changed="loadGoals()"
        @review-id="emit('review-id', $event)"
        @authority-error="failure"
      />
    </article>
    <button
      v-if="afterId"
      :disabled="locked"
      data-testid="organization-goal-more"
      @click="loadGoals(true)"
    >
      更多目标
    </button>
    <p>
      周期授权最长 24
      小时，仅当前巡检身份解锁且应用运行时检查；离线到期会合并。目标任务建议需多级审批及逐次确认；目标完成需独立验收，模型费用：未知。
    </p>
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
import OrganizationProjectGoalActionsPanel from "./OrganizationProjectGoalActionsPanel.vue";
import OrganizationProjectGoalAcceptancePanel from "./OrganizationProjectGoalAcceptancePanel.vue";
type Goal = {
  id: string;
  projectRef: {
    id: string;
    sourceKind: string;
    scope: { kind: string; id: string };
  };
  ownerRef: string;
  revision: number;
  status: string;
  objective: string;
  expiresAt: string | null;
  budgetPolicy: { maxRuns: number | null };
  allowedActionTypes?: string[];
  acceptanceCriteria?: Array<{ id: string; kind: string; description: string }>;
};
type GoalStatus = {
  goal: Goal;
  usage: { totalRuns: number };
  manualOnly: boolean;
  monitor?: {
    id: string;
    monitorId: string;
    executorDid: string;
    goalId: string;
    goalRevision: number;
    scope: { kind: string; id: string };
    intervalMs: number;
    expiresAt: number;
    enabled: boolean;
    state: string;
    blockedReason: string | null;
    activeOccurrence: any;
  } | null;
};
type Request = { id: string; expectedRevision: number; requestId: string };
const props = defineProps<{
  projectId: string;
  orgId: string;
  identityKey?: string;
  permissions: string[];
  parentBusy?: boolean;
  refreshRevision?: number;
  workflows?: Array<{ id: string; name: string; actionType: string }>;
}>();
const emit = defineEmits<{
  (event: "review-id", id: string): void;
  (event: "authority-error", value: unknown): void;
  (event: "proposal-id", id: string): void;
}>();
const goals = ref<GoalStatus[]>([]),
  histories = ref<Record<string, any>>({}),
  drafts = ref<Record<string, string>>({});
const objective = ref(""),
  maxRuns = ref(20),
  error = ref(""),
  busy = ref(false),
  afterId = ref<string | null>(null);
const pendingCreate = ref<any>(null),
  pendingRevisions = ref<Record<string, any>>({}),
  pendingChecks = ref<Record<string, Request>>({});
const pendingMonitors = ref<Record<string, { method: string; input: any }>>({}),
  intervals = ref<Record<string, number>>({}),
  monitorHours = ref<Record<string, number>>({});
const goalActionRecovery = ref<Record<string, Record<string, any>>>({});
const goalAcceptanceRecovery = ref<Record<string, any>>({});
const locked = computed(() => busy.value || props.parentBusy),
  objectiveBytes = computed(
    () => new TextEncoder().encode(objective.value).length,
  );
const validBudget = computed(
  () =>
    Number.isSafeInteger(maxRuns.value) &&
    maxRuns.value >= 1 &&
    maxRuns.value <= 1000,
);
const canCheck = computed(() =>
  ["goal.check", "risk.read", "risk.evaluate"].every((permission) =>
    props.permissions.includes(permission),
  ),
);
const canStartMonitor = computed(
  () => canCheck.value && props.permissions.includes("goal.monitor"),
);
function validMonitor(id: string) {
  return (
    [60_000, 900_000, 3_600_000, 86_400_000].includes(intervals.value[id]) &&
    Number.isSafeInteger(monitorHours.value[id]) &&
    monitorHours.value[id] >= 1 &&
    monitorHours.value[id] <= 24
  );
}
function monitorState(state: string) {
  return (
    (
      {
        waiting: "等待周期检查",
        running: "周期检查进行中",
        blocked: "需要重新核对授权",
        stopped: "周期已关闭",
        expired: "同意已到期",
        "waiting-for-executor": "等待巡检身份解锁",
      } as Record<string, string>
    )[state] || "请核对当前巡检状态"
  );
}
let epoch = 0,
  mounted = true,
  loaded = false;
const current = (token: number) => mounted && epoch === token;
function validate(goal: Goal, expectedId?: string) {
  if (
    goal?.projectRef?.id !== props.projectId ||
    goal.projectRef.scope?.kind !== "organization" ||
    goal.projectRef.scope.id !== props.orgId ||
    goal.projectRef.sourceKind !== "desktop.organization-project-goals" ||
    (expectedId && goal.id !== expectedId)
  )
    throw new Error("GOAL_NOT_FOUND_OR_DENIED");
}
function validDraft(id: string) {
  const value = drafts.value[id] || "";
  return !!value.trim() && new TextEncoder().encode(value).length <= 8192;
}
function reset() {
  epoch++;
  loaded = false;
  busy.value = false;
  goals.value = [];
  histories.value = {};
  drafts.value = {};
  objective.value = "";
  afterId.value = null;
  pendingCreate.value = null;
  pendingRevisions.value = {};
  pendingChecks.value = {};
  pendingMonitors.value = {};
  goalActionRecovery.value = {};
  goalAcceptanceRecovery.value = {};
  intervals.value = {};
  monitorHours.value = {};
  error.value = "";
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    reset();
    emit("authority-error", value);
  }
  error.value = organizationError(value);
}
async function work(fn: (token: number) => Promise<void>) {
  if (locked.value || !props.permissions.includes("goal.read")) return;
  const token = epoch;
  busy.value = true;
  error.value = "";
  try {
    await fn(token);
  } catch (value) {
    if (current(token)) failure(value);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function fetchGoals(token: number, more = false) {
  const result = await organizationApi().listGoals({
    projectId: props.projectId,
    limit: 20,
    ...(more && afterId.value ? { afterId: afterId.value } : {}),
  });
  if (!current(token)) return;
  result.goals.forEach((goal: Goal) => validate(goal));
  const statuses: GoalStatus[] = [];
  for (const goal of result.goals) {
    const status = await organizationApi().getGoalStatus({ id: goal.id });
    if (!current(token)) return;
    validate(status.goal, goal.id);
    if (
      status.monitor &&
      (status.monitor.goalId !== goal.id ||
        status.monitor.scope?.kind !== "organization" ||
        status.monitor.scope.id !== props.orgId ||
        typeof status.monitor.executorDid !== "string" ||
        !status.monitor.executorDid.startsWith("did:") ||
        typeof status.monitor.id !== "string" ||
        status.monitor.id !== status.monitor.monitorId)
    )
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
    statuses.push(status);
  }
  goals.value = more
    ? [
        ...new Map(
          [...goals.value, ...statuses].map((item) => [item.goal.id, item]),
        ).values(),
      ]
    : statuses;
  for (const item of goals.value) {
    intervals.value[item.goal.id] ??= 3_600_000;
    monitorHours.value[item.goal.id] ??= 24;
    if (!pendingRevisions.value[item.goal.id])
      drafts.value[item.goal.id] = item.goal.objective;
  }
  afterId.value = result.nextCursor;
  loaded = true;
}
async function loadGoals(more = false) {
  await work((token) => fetchGoals(token, more));
}
const definite = (value: unknown) =>
  /^(ORG_AUTH_|PROJECT_RISK_(INVALID_|NOT_FOUND_OR_DENIED|AUTHORITY_|AUTHENTICATION_)|GOAL_(INVALID_|NOT_FOUND_OR_DENIED|IDENTITY_|AUTHORITY_|REVISION_CONFLICT|REQUEST_CONFLICT|PROJECT_(SOURCE_|NOT_ACTIVE|VERSION_CONFLICT)|USAGE_(BUDGET_EXHAUSTED|SCOPE_DENIED)|MONITOR_(INVALID_|NOT_ACTIVE|EXPIRED|BUDGET_EXHAUSTED|REQUEST_VERSION_CONFLICT|BINDING_STALE|CONFIG_|CONSENT_|STOP_|MONITOR_)))/u.test(
    actionCode(value),
  );
async function createGoal() {
  if (!props.permissions.includes("goal.create")) return;
  if (
    !pendingCreate.value &&
    (!objective.value.trim() ||
      objectiveBytes.value > 8192 ||
      !validBudget.value)
  )
    return;
  await work(async (token) => {
    const request = pendingCreate.value
      ? toRaw(pendingCreate.value)
      : {
          projectId: props.projectId,
          requestId: globalThis.crypto.randomUUID(),
          objective: objective.value,
          budgetPolicy: { maxRuns: maxRuns.value },
        };
    pendingCreate.value = request;
    try {
      const result = await organizationApi().createGoal(request);
      if (!current(token)) return;
      if (result.status === "cancelled") {
        pendingCreate.value = null;
        return;
      }
      validate(result.goal);
      pendingCreate.value = null;
      objective.value = "";
    } catch (value) {
      if (!current(token)) return;
      if (definite(value)) pendingCreate.value = null;
      else pendingCreate.value = request;
      throw value;
    }
    await fetchGoals(token);
  });
}
async function revise(item: GoalStatus, patch?: any) {
  if (!props.permissions.includes("goal.update")) return;
  const goalId = item.goal.id;
  if (!pendingRevisions.value[goalId] && !patch) return;
  await work(async (token) => {
    const request = pendingRevisions.value[goalId]
      ? toRaw(pendingRevisions.value[goalId])
      : {
          id: goalId,
          expectedRevision: item.goal.revision,
          requestId: globalThis.crypto.randomUUID(),
          patch,
        };
    pendingRevisions.value[goalId] = request;
    try {
      const result = await organizationApi().reviseGoal(request);
      if (!current(token)) return;
      if (result.status !== "cancelled") validate(result.goal, goalId);
      delete pendingRevisions.value[goalId];
    } catch (value) {
      if (!current(token)) return;
      if (definite(value)) delete pendingRevisions.value[goalId];
      else pendingRevisions.value[goalId] = request;
      throw value;
    }
    await fetchGoals(token);
  });
}
async function check(item: GoalStatus) {
  if (!canCheck.value) return;
  const goalId = item.goal.id;
  await work(async (token) => {
    const request = pendingChecks.value[goalId]
      ? toRaw(pendingChecks.value[goalId])
      : {
          id: goalId,
          expectedRevision: item.goal.revision,
          requestId: globalThis.crypto.randomUUID(),
        };
    pendingChecks.value[goalId] = request;
    try {
      const result = await organizationApi().checkGoalNow(request);
      if (!current(token)) return;
      if (result.status === "succeeded") {
        delete pendingChecks.value[goalId];
        await fetchGoals(token);
        if (current(token)) await fetchHistory(token, goalId);
      } else {
        if (["failed", "rejected", "dead_letter"].includes(result.status))
          delete pendingChecks.value[goalId];
        error.value = "本次检查未完成，请核对状态或目标预算。";
      }
    } catch (value) {
      if (!current(token)) return;
      if (definite(value)) delete pendingChecks.value[goalId];
      throw value;
    }
  });
}
async function monitorControl(
  item: GoalStatus,
  mode?: "start" | "periodic" | "abort",
) {
  if (!props.permissions.includes("goal.monitor")) return;
  const goalId = item.goal.id;
  const pending = pendingMonitors.value[goalId];
  if (
    !pending &&
    (!mode ||
      (mode === "start" && (!canStartMonitor.value || !validMonitor(goalId))))
  )
    return;
  await work(async (token) => {
    const request = pending
      ? toRaw(pending)
      : mode === "start"
        ? {
            method: "startGoalMonitoring",
            input: {
              id: goalId,
              expectedRevision: item.goal.revision,
              requestId: globalThis.crypto.randomUUID(),
              intervalMs: intervals.value[goalId],
              expiresAt: Date.now() + monitorHours.value[goalId] * 3_600_000,
            },
          }
        : {
            method: "stopGoalMonitoring",
            input: {
              id: goalId,
              monitorId: item.monitor!.id,
              requestId: globalThis.crypto.randomUUID(),
              mode,
            },
          };
    pendingMonitors.value[goalId] = request;
    try {
      await organizationApi()[request.method](request.input);
      if (!current(token)) return;
      delete pendingMonitors.value[goalId];
      await fetchGoals(token);
    } catch (value) {
      if (!current(token)) return;
      if (definite(value)) delete pendingMonitors.value[goalId];
      throw value;
    }
  });
}
async function fetchHistory(token: number, id: string, more = false) {
  const old = histories.value[id],
    result = await organizationApi().listGoalChecks({
      id,
      limit: 10,
      ...(more && old?.nextCursor ? { beforeId: old.nextCursor } : {}),
    });
  if (!current(token)) return;
  for (const item of result.checks)
    if (
      item.goalId !== id ||
      item.result?.goalId !== id ||
      typeof item.occurrenceId !== "string" ||
      typeof item.reviewId !== "string" ||
      !item.reviewId ||
      item.reviewId !== item.result.reviewId ||
      typeof item.actorDid !== "string" ||
      !item.actorDid.startsWith("did:")
    )
      throw new Error("GOAL_NOT_FOUND_OR_DENIED");
  histories.value[id] =
    more && old
      ? {
          ...result,
          checks: [
            ...new Map(
              [...old.checks, ...result.checks].map((item) => [
                item.occurrenceId,
                item,
              ]),
            ).values(),
          ],
        }
      : result;
}
async function loadHistory(id: string, more = false) {
  if (props.permissions.includes("risk.read"))
    await work((token) => fetchHistory(token, id, more));
}
function stateLabel(status: string) {
  return (
    (
      {
        active: "进行中",
        paused: "已暂停",
        abandoned: "跟进已结束，保留历史",
        done: "已验收",
      } as Record<string, string>
    )[status] || "状态待核对"
  );
}
watch(
  [
    () => props.projectId,
    () => props.orgId,
    () => props.identityKey,
    () => props.permissions.join(","),
  ],
  () => {
    reset();
    void loadGoals();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => props.parentBusy,
  (value, previous) => {
    if (previous && !value && !loaded) void loadGoals();
  },
);
watch(
  () => props.refreshRevision,
  () => {
    // A same-session parent refresh invalidates display facts and late replies,
    // while retaining exact request identities for explicit receipt recovery.
    epoch++;
    loaded = false;
    busy.value = false;
    goals.value = [];
    histories.value = {};
    drafts.value = {};
    error.value = "";
    if (!props.parentBusy) void loadGoals();
  },
);
onBeforeUnmount(() => {
  mounted = false;
  reset();
});
</script>
<style scoped>
section,
article {
  border-top: 1px solid #ddd;
  margin-top: 16px;
  padding-top: 12px;
}
label {
  display: block;
  margin: 8px 0;
}
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
}
button {
  margin: 6px 8px 6px 0;
}
li,
p,
h4 {
  overflow-wrap: anywhere;
}
p[role="alert"] {
  color: #b42318;
}
</style>
