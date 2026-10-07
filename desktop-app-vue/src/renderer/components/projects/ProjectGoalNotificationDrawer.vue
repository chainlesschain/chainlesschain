<template>
  <a-drawer
    :open="visible"
    title="通知中的项目目标"
    :width="820"
    @close="close"
  >
    <div v-if="visible" data-testid="goal-notification-drawer">
      <p>
        通知记录此前一次检查。请在此核对目标当前状态、历史来源与待确认建议。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="!denied">
        <ProjectGoalMonitoringPanel
          v-if="goalAvailable"
          :key="generation"
          :project-id="projectId"
          :focus-goal-id="selectedGoalId"
          :identity-key="identityKey"
          @review-id="loadReview"
          @authority-error="authorityFailure"
        />
        <p v-else role="status">当前环境暂不能读取目标，请稍后重试。</p>
        <p v-if="loadingReview" role="status">正在读取检查来源…</p>
        <ProjectRiskReviewPanel
          v-if="review"
          :key="generation"
          :project-id="projectId"
          :identity-key="identityKey"
          :review="review"
          @review="review = $event"
          @authority-error="authorityFailure"
        />
      </template>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ProjectGoalMonitoringPanel from "./ProjectGoalMonitoringPanel.vue";
import ProjectRiskReviewPanel from "./ProjectRiskReviewPanel.vue";
import { isAuthorityError, type RiskReview } from "./task-description-ui";

const props = defineProps<{
  projectId: string;
  goalId?: unknown;
  noticeId?: unknown;
  identityKey?: string;
  authenticated: boolean;
}>();
const emit = defineEmits<{
  (event: "close"): void;
  (event: "authority-error"): void;
}>();
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value);
// Query values are navigation hints only. No Goal content, ownership, source
// version or authorization is accepted from the URL or a notification cache.
const selectedGoalId = computed(() =>
  identifier(props.goalId) ? props.goalId : undefined,
);
const validNavigation = computed(
  () =>
    identifier(props.projectId) &&
    selectedGoalId.value !== undefined &&
    (props.noticeId === undefined || identifier(props.noticeId)),
);
const api = () =>
  (
    window as unknown as {
      electronAPI?: {
        project?: {
          getGoalMonitoringStatus?: unknown;
          getRiskReview?: (input: { reviewId: string }) => Promise<RiskReview>;
        };
      };
    }
  ).electronAPI?.project;
const goalAvailable = computed(
  () => typeof api()?.getGoalMonitoringStatus === "function",
);
const dismissed = ref(false),
  denied = ref(false),
  loadingReview = ref(false);
const review = ref<RiskReview | null>(null),
  error = ref("");
const generation = ref(0);
const visible = computed(
  () => props.authenticated && validNavigation.value && !dismissed.value,
);
let reviewEpoch = 0,
  mounted = true;
let unsubscribe: (() => void) | undefined;
function reset() {
  generation.value++;
  reviewEpoch++;
  review.value = null;
  error.value = "";
  loadingReview.value = false;
  denied.value = false;
  dismissed.value = false;
}
function close() {
  reset();
  dismissed.value = true;
  emit("close");
}
function authorityFailure() {
  reviewEpoch++;
  review.value = null;
  loadingReview.value = false;
  denied.value = true;
  error.value = "当前身份已无法访问此目标或检查来源。";
  emit("authority-error");
}
async function loadReview(reviewId: string) {
  if (!visible.value || denied.value || !identifier(reviewId)) return;
  const stamp = generation.value,
    read = ++reviewEpoch,
    projectId = props.projectId;
  const current = () =>
    mounted &&
    visible.value &&
    !denied.value &&
    stamp === generation.value &&
    read === reviewEpoch;
  review.value = null;
  error.value = "";
  loadingReview.value = true;
  try {
    const result = await api()?.getRiskReview?.({ reviewId });
    if (!current()) return;
    if (
      !result ||
      result.review?.id !== reviewId ||
      result.review.projectId !== projectId
    )
      throw new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    review.value = result;
  } catch (value) {
    if (!current()) return;
    if (isAuthorityError(value)) authorityFailure();
    else error.value = "检查来源暂不可读取，请重新选择检查记录。";
  } finally {
    if (current()) loadingReview.value = false;
  }
}
watch(
  () => [
    props.projectId,
    props.goalId,
    props.noticeId,
    props.identityKey,
    props.authenticated,
  ],
  reset,
  { immediate: true, flush: "sync" },
);
onMounted(() => {
  const notifications = (
    window as unknown as {
      electronAPI?: {
        notification?: { onInvalidated?: (callback: () => void) => () => void };
      };
    }
  ).electronAPI?.notification;
  unsubscribe = notifications?.onInvalidated?.(() => {
    if (visible.value) close();
    else {
      reset();
      dismissed.value = true;
    }
  });
});
onBeforeUnmount(() => {
  mounted = false;
  unsubscribe?.();
  reset();
});
</script>
