<template>
  <section data-testid="goal-notification-policy">
    <h4>目标通知</h4>
    <p>通知显示在应用内通知中心。静默时仍保留检查记录，可在目标中查看。</p>
    <p v-if="!available" role="status">当前环境暂不支持修改通知设置。</p>
    <form @submit.prevent="save">
      <fieldset :disabled="busy || !available || needsRefresh || denied">
        <label>
          通知方式
          <select v-model="mode" data-testid="goal-notification-mode">
            <option value="changes-only">仅在风险变化或需要决策时通知</option>
            <option value="silent">静默</option>
          </select>
        </label>
        <label>
          <input
            v-model="quietEnabled"
            type="checkbox"
            data-testid="goal-notification-quiet-enabled"
          />
          设置免打扰时段
        </label>
        <div v-if="quietEnabled" class="quiet-hours">
          <label>
            时区
            <input
              v-model="timeZone"
              type="text"
              maxlength="80"
              placeholder="例如 Asia/Shanghai"
              data-testid="goal-notification-time-zone"
            />
          </label>
          <label>
            开始时间
            <input
              v-model="startTime"
              type="time"
              data-testid="goal-notification-start"
            />
          </label>
          <label>
            结束时间
            <input
              v-model="endTime"
              type="time"
              data-testid="goal-notification-end"
            />
          </label>
          <p>按所选时区计算，可跨午夜；待发通知将在免打扰结束后继续投递。</p>
        </div>
        <button type="submit" data-testid="save-goal-notification-policy">
          {{ busy ? "正在保存…" : "保存通知设置" }}
        </button>
      </fieldset>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";

type Policy = {
  channel: "in-app";
  mode: "changes-only" | "silent";
  quietHours?: {
    timeZone: string;
    startMinute: number;
    endMinute: number;
  } | null;
};
type Goal = { id: string; revision: number; notificationPolicy?: Policy };
type Api = {
  reviseGoal(input: {
    id: string;
    expectedRevision: number;
    patch: { notificationPolicy: Policy };
  }): Promise<Goal>;
};
const props = defineProps<{ goal: Goal; identityKey?: string }>();
const emit = defineEmits<{
  (event: "goal-changed"): void;
  (event: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: Api } }).electronAPI
    ?.project;
const available = computed(() => typeof api()?.reviseGoal === "function");
const mode = ref<Policy["mode"]>("changes-only"),
  quietEnabled = ref(false);
const timeZone = ref("UTC"),
  startTime = ref("22:00"),
  endTime = ref("08:00");
const busy = ref(false),
  needsRefresh = ref(false),
  denied = ref(false);
const error = ref(""),
  message = ref("");
let epoch = 0,
  mounted = true;
const displayMinute = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function reset(fromGoal = true) {
  epoch++;
  const policy = fromGoal ? props.goal.notificationPolicy : undefined;
  mode.value = policy?.mode ?? "changes-only";
  quietEnabled.value = Boolean(policy?.quietHours);
  timeZone.value = policy?.quietHours?.timeZone ?? "UTC";
  startTime.value = displayMinute(policy?.quietHours?.startMinute ?? 1320);
  endTime.value = displayMinute(policy?.quietHours?.endMinute ?? 480);
  busy.value = false;
  needsRefresh.value = false;
  denied.value = false;
  error.value = "";
  message.value = "";
}
function minute(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
function policyDraft(): Policy | null {
  if (!["changes-only", "silent"].includes(mode.value)) return null;
  const policy: Policy = {
    channel: "in-app",
    mode: mode.value,
    quietHours: null,
  };
  if (!quietEnabled.value) return policy;
  const zone = timeZone.value.trim(),
    start = minute(startTime.value),
    end = minute(endTime.value);
  if (
    !/^[A-Za-z][A-Za-z0-9_./+-]{0,79}$/u.test(zone) ||
    start === null ||
    end === null ||
    start === end
  )
    return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
  } catch {
    return null;
  }
  policy.quietHours = { timeZone: zone, startMinute: start, endMinute: end };
  return policy;
}
function samePolicy(saved: Policy | undefined, requested: Policy) {
  if (saved?.channel !== requested.channel || saved.mode !== requested.mode)
    return false;
  const left = saved.quietHours ?? null,
    right = requested.quietHours ?? null;
  return left === null || right === null
    ? left === right
    : left.timeZone === right.timeZone &&
        left.startMinute === right.startMinute &&
        left.endMinute === right.endMinute;
}
async function save() {
  if (busy.value || needsRefresh.value || denied.value || !available.value)
    return;
  error.value = "";
  message.value = "";
  const policy = policyDraft();
  if (!policy) {
    error.value = "请填写有效的时区和时间；开始与结束时间不能相同。";
    return;
  }
  const stamp = epoch,
    goalId = props.goal.id,
    revision = props.goal.revision,
    identity = props.identityKey;
  const current = () =>
    mounted &&
    stamp === epoch &&
    props.goal.id === goalId &&
    props.goal.revision === revision &&
    props.identityKey === identity;
  busy.value = true;
  try {
    const result = await api()!.reviseGoal({
      id: goalId,
      expectedRevision: revision,
      patch: { notificationPolicy: policy },
    });
    if (!current()) return;
    if (
      result?.id !== goalId ||
      result.revision !== revision + 1 ||
      !samePolicy(result.notificationPolicy, policy)
    )
      throw new Error("GOAL_NOTIFICATION_RESULT_UNCERTAIN");
    needsRefresh.value = true;
    message.value = "通知设置已保存，正在刷新目标。";
    emit("goal-changed");
  } catch (value) {
    if (!current()) return;
    if (isAuthorityError(value)) {
      reset(false);
      denied.value = true;
      error.value = "当前身份已无法修改此目标的通知设置。";
      emit("authority-error");
    } else {
      needsRefresh.value = true;
      error.value = /REVISION_CONFLICT|VERSION_CONFLICT/u.test(
        actionCode(value),
      )
        ? "目标已更新，正在刷新；请核对最新设置后重新编辑。"
        : "保存结果待核对，正在刷新目标；请核对最新设置后再操作。";
      emit("goal-changed");
    }
  } finally {
    if (current()) busy.value = false;
  }
}
watch(
  () => [props.goal, props.goal.id, props.goal.revision, props.identityKey],
  () => reset(),
  { immediate: true, flush: "sync" },
);
onBeforeUnmount(() => {
  mounted = false;
  reset(false);
});
</script>

<style scoped>
section {
  margin-top: 16px;
  border-top: 1px solid #ddd;
  padding-top: 12px;
}
fieldset {
  border: 0;
  padding: 0;
}
label {
  display: block;
  margin: 8px 0;
}
input,
select {
  margin-left: 8px;
}
.quiet-hours {
  padding-left: 16px;
}
</style>
