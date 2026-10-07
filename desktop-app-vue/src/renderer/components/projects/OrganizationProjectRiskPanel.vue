<template>
  <section data-testid="organization-risk-panel">
    <h3>组织交付风险检查</h3>
    <p>
      仅检查逾期与未完成的直接依赖，不预测交付结果。修改描述不会消除这些信号。
    </p>
    <button
      v-if="permissions.includes('risk.evaluate')"
      :disabled="locked"
      data-testid="organization-risk-evaluate"
      @click="evaluate"
    >
      检查当前风险
    </button>
    <button
      :disabled="locked"
      data-testid="organization-risk-history"
      @click="loadHistory()"
    >
      查看检查历史
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <ol>
      <li v-for="item in history" :key="item.review.id">
        <button
          :disabled="locked"
          :data-risk-review-id="item.review.id"
          @click="selectReview(item.review.id)"
        >
          {{ item.review.createdAt }} · {{ item.review.actorDid }} ·
          {{
            item.status === "evaluated"
              ? `${item.summary?.riskTaskCount ?? 0} 个任务有信号`
              : "数据不足"
          }}
        </button>
      </li>
    </ol>
    <button
      v-if="historyCursor"
      :disabled="locked"
      data-testid="organization-risk-more"
      @click="loadHistory(true)"
    >
      更早检查
    </button>
    <div v-if="selected" data-testid="organization-risk-result">
      <p>检查记录：{{ selected.review.id }}</p>
      <p>检查者：{{ selected.review.actorDid }}</p>
      <p>
        来源时间：{{
          selected.evaluation.asOf || "未提供"
        }}。历史记录不代表当前风险。
      </p>
      <p v-if="selected.evaluation.status !== 'evaluated'">
        数据不足，暂不能完成风险检查。
      </p>
      <p v-else-if="!selected.evaluation.summary?.riskTaskCount">
        未发现所选规则信号。
      </p>
      <ul>
        <li v-for="task in selected.evaluation.tasks" :key="task.taskRef.id">
          {{ task.taskRef.id }}：{{
            task.reasonCodes.map(riskReason).join("；")
          }}
        </li>
      </ul>
      <button
        :disabled="locked"
        data-testid="organization-risk-lineage"
        @click="loadLineage()"
      >
        查看关联操作与人工核对
      </button>
      <form
        v-if="
          permissions.includes('risk.feedback') &&
          selected.evaluation.tasks.length
        "
        data-testid="organization-risk-feedback"
        @submit.prevent="saveFeedback"
      >
        <label
          >核对任务<select
            v-model="feedbackTask"
            :disabled="locked || uncertain"
            data-testid="organization-risk-feedback-task"
          >
            <option value="">请选择任务</option>
            <option
              v-for="task in selected.evaluation.tasks"
              :key="task.taskRef.id"
              :value="task.taskRef.id"
            >
              {{ task.taskRef.id }}
            </option>
          </select></label
        >
        <label
          >人工判断<select
            v-model="verdict"
            :disabled="locked || uncertain"
            data-testid="organization-risk-feedback-verdict"
          >
            <option value="affirmed">确认规则信号</option>
            <option value="dismissed">排除规则信号</option>
            <option value="needs-review">仍需核对</option>
          </select></label
        >
        <label
          >核对说明<textarea
            v-model="comment"
            :disabled="locked || uncertain"
            data-testid="organization-risk-feedback-comment"
            rows="2"
          />
        </label>
        <button
          :disabled="
            locked || uncertain || !feedbackTask || commentBytes > 4096
          "
          data-testid="organization-risk-feedback-save"
          type="submit"
        >
          保存人工核对
        </button>
        <p>人工判断单独保存，原始规则结果保持可查。说明最多 4096 字节。</p>
      </form>
      <p v-if="uncertain" role="status">
        核对保存结果待核实。请查看核对记录，系统不会自动重试。
      </p>
    </div>
    <div v-if="lineage" data-testid="organization-risk-lineage-result">
      <h4>关联操作</h4>
      <p v-if="!lineage.actionRuns.length">暂无关联操作。</p>
      <ol>
        <li v-for="item in lineage.actionRuns" :key="item.run.id">
          {{ runLabel(item.run.status) }} · {{ item.run.id }}
        </li>
      </ol>
      <button
        v-if="lineage.nextCursor"
        :disabled="locked"
        @click="loadLineage('actions')"
      >
        更早操作
      </button>
      <h4>人工核对</h4>
      <p v-if="!lineage.feedback.length">暂无人工核对。</p>
      <ol>
        <li v-for="item in lineage.feedback" :key="item.feedback.id">
          {{ item.feedback.actorDid }} · {{ item.feedback.taskId }} ·
          {{ verdictLabel(item.feedback.verdict) }}：{{ item.feedback.comment }}
        </li>
      </ol>
      <button
        v-if="lineage.nextFeedbackCursor"
        :disabled="locked"
        @click="loadLineage('feedback')"
      >
        更早核对
      </button>
    </div>
    <p>模型费用：未知。当前检查使用本地规则。</p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationError,
} from "./organization-project-ui";
import { actionCode, riskReason, runLabel } from "./task-description-ui";
type Review = {
  review: {
    id: string;
    projectId: string;
    actorDid: string;
    createdAt: string;
  };
  evaluation: any;
};
const props = defineProps<{
  projectId: string;
  orgId: string;
  identityKey?: string;
  permissions: string[];
  parentBusy?: boolean;
}>();
const emit = defineEmits<{
  (event: "review", value: Review | null): void;
  (event: "authority-error", value: unknown): void;
}>();
const selected = shallowRef<Review | null>(null),
  lineage = shallowRef<any>(null);
const history = ref<any[]>([]),
  historyCursor = ref<string | null>(null),
  busy = ref(false),
  error = ref("");
const feedbackTask = ref(""),
  verdict = ref("affirmed"),
  comment = ref(""),
  uncertain = ref(false);
const commentBytes = computed(
    () => new TextEncoder().encode(comment.value).length,
  ),
  locked = computed(() => busy.value || props.parentBusy);
const unknownFeedback = new Set<string>();
const feedbackKey = (reviewId: string) =>
  `${props.projectId}:${props.orgId}:${props.identityKey || ""}:${reviewId}`;
let epoch = 0,
  mounted = true;
const current = (token: number) => mounted && token === epoch;
function denied(): never {
  throw new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED");
}
function checkReview(value: any, reviewId?: string) {
  if (
    value.review?.projectId !== props.projectId ||
    (reviewId && value.review.id !== reviewId)
  )
    denied();
}
function checkEvaluation(evaluation: any) {
  if (
    evaluation.status === "evaluated" &&
    (evaluation.projectRef?.id !== props.projectId ||
      evaluation.projectRef?.scope?.kind !== "organization" ||
      evaluation.projectRef?.scope?.id !== props.orgId)
  )
    denied();
}
function clearSelected() {
  selected.value = null;
  lineage.value = null;
  feedbackTask.value = "";
  verdict.value = "affirmed";
  comment.value = "";
  uncertain.value = false;
  emit("review", null);
}
function reset() {
  epoch++;
  busy.value = false;
  history.value = [];
  historyCursor.value = null;
  error.value = "";
  clearSelected();
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    reset();
    emit("authority-error", value);
  }
  error.value = organizationError(value);
}
async function work(fn: (token: number) => Promise<void>) {
  if (locked.value || !props.permissions.includes("risk.read")) return;
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
function accept(value: any, reviewId?: string) {
  checkReview(value, reviewId);
  checkEvaluation(value.evaluation);
  if (
    value.authority?.scope?.kind !== "organization" ||
    value.authority?.scope?.id !== props.orgId ||
    value.sourceSnapshot?.scope?.kind !== "organization" ||
    value.sourceSnapshot?.scope?.id !== props.orgId ||
    value.sourceSnapshot?.project?.id !== props.projectId
  )
    denied();
  clearSelected();
  // Drop raw snapshots and authority after scope validation; retain display facts only.
  selected.value = { review: value.review, evaluation: value.evaluation };
  uncertain.value = unknownFeedback.has(feedbackKey(value.review.id));
  emit("review", selected.value);
}
async function evaluate() {
  if (!props.permissions.includes("risk.evaluate")) return;
  await work(async (token) => {
    const result = await organizationApi().evaluateRisk({
      projectId: props.projectId,
    });
    if (current(token)) accept(result);
  });
}
async function loadHistory(more = false) {
  await work(async (token) => {
    const result = await organizationApi().listRiskReviews({
      projectId: props.projectId,
      limit: 10,
      ...(more && historyCursor.value ? { beforeId: historyCursor.value } : {}),
    });
    if (!current(token)) return;
    result.reviews.forEach((item: any) => checkReview(item));
    history.value = more
      ? [...history.value, ...result.reviews]
      : result.reviews;
    historyCursor.value = result.nextCursor;
  });
}
async function selectReview(reviewId: string) {
  if (locked.value) return;
  epoch++;
  clearSelected();
  await work(async (token) => {
    const result = await organizationApi().getRiskReview({ reviewId });
    if (current(token)) accept(result, reviewId);
  });
}
async function loadLineage(more?: "actions" | "feedback") {
  const reviewId = selected.value?.review.id;
  if (!reviewId) return;
  await work(async (token) => {
    const result = await organizationApi().getRiskLineage({
      reviewId,
      limit: 10,
      ...(more === "actions" && lineage.value?.nextCursor
        ? { beforeId: lineage.value.nextCursor }
        : {}),
      ...(more === "feedback" && lineage.value?.nextFeedbackCursor
        ? { feedbackBeforeId: lineage.value.nextFeedbackCursor }
        : {}),
    });
    if (!current(token) || selected.value?.review.id !== reviewId) return;
    checkReview(result, reviewId);
    checkEvaluation(result.evaluation);
    const previous = lineage.value;
    lineage.value =
      more && previous
        ? {
            ...result,
            actionRuns:
              more === "actions"
                ? [...previous.actionRuns, ...result.actionRuns]
                : previous.actionRuns,
            feedback:
              more === "feedback"
                ? [...previous.feedback, ...result.feedback]
                : previous.feedback,
            nextCursor:
              more === "feedback" ? previous.nextCursor : result.nextCursor,
            nextFeedbackCursor:
              more === "actions"
                ? previous.nextFeedbackCursor
                : result.nextFeedbackCursor,
          }
        : result;
  });
}
async function saveFeedback() {
  const review = selected.value;
  if (
    !review ||
    uncertain.value ||
    !props.permissions.includes("risk.feedback") ||
    commentBytes.value > 4096
  )
    return;
  const task = review.evaluation.tasks.find(
    (item: any) => item.taskRef.id === feedbackTask.value,
  );
  if (!task) return;
  await work(async (token) => {
    try {
      const result = await organizationApi().recordRiskFeedback({
        reviewId: review.review.id,
        taskId: task.taskRef.id,
        verdict: verdict.value,
        reasonCodes: verdict.value === "dismissed" ? [] : [...task.reasonCodes],
        comment: comment.value,
      });
      if (!current(token)) return;
      if (result?.status !== "cancelled") {
        comment.value = "";
        feedbackTask.value = "";
        lineage.value = null;
      }
    } catch (value) {
      if (!current(token)) return;
      if (!/^(ORG_AUTH_|PROJECT_RISK_)/u.test(actionCode(value))) {
        unknownFeedback.add(feedbackKey(review.review.id));
        uncertain.value = true;
      }
      throw value;
    }
  });
}
function verdictLabel(value: string) {
  return (
    (
      {
        affirmed: "确认规则信号",
        dismissed: "排除规则信号",
        "needs-review": "仍需核对",
      } as Record<string, string>
    )[value] || "未知判断"
  );
}
watch(
  () => [
    props.projectId,
    props.orgId,
    props.identityKey,
    props.permissions.join(","),
  ],
  reset,
  { flush: "sync" },
);
onBeforeUnmount(() => {
  mounted = false;
  reset();
});
defineExpose({ selectReview });
</script>
<style scoped>
section {
  border-top: 1px solid #ddd;
  margin-top: 16px;
  padding-top: 12px;
}
label {
  display: block;
  margin: 8px 0;
}
button {
  margin: 6px 8px 6px 0;
}
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
}
li,
p {
  overflow-wrap: anywhere;
}
p[role="alert"] {
  color: #b42318;
}
</style>
