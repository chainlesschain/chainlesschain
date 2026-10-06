<template>
  <section class="risk-review-panel section" data-testid="risk-review-panel">
    <div class="actions">
      <h3>交付风险记录</h3>
      <button
        v-if="available"
        :disabled="busy"
        data-testid="risk-history"
        @click="loadHistory()"
      >
        查看检查历史
      </button>
      <button
        v-if="review && available"
        :disabled="busy"
        data-testid="risk-lineage"
        @click="loadLineage()"
      >
        查看关联操作与人工核对
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul v-if="history.length" data-testid="risk-history-list">
      <li v-for="item in history" :key="item.review.id">
        <button
          :disabled="busy"
          :data-review-id="item.review.id"
          @click="selectReview(item.review.id)"
        >
          {{ item.review.createdAt }}：{{
            item.status === "evaluated"
              ? `${item.summary?.riskTaskCount ?? 0} 个信号`
              : "数据不足"
          }}
        </button>
      </li>
    </ul>
    <button
      v-if="historyCursor"
      :disabled="busy"
      data-testid="more-risk-history"
      @click="loadHistory(true)"
    >
      更早检查
    </button>
    <div v-if="review" data-testid="risk-result">
      <p v-if="review.evaluation.status !== 'evaluated'" class="notice">
        数据不足，暂不能完成风险检查。
      </p>
      <p v-else-if="review.evaluation.summary?.riskTaskCount === 0">
        未发现所选规则信号。
      </p>
      <template v-else>
        <p>
          发现
          {{ review.evaluation.summary?.riskTaskCount }} 个任务有待检查信号。
        </p>
        <ul>
          <li v-for="item in review.evaluation.tasks" :key="item.taskRef.id">
            {{ item.taskRef.id }}：{{
              item.reasonCodes.map(riskReason).join("；")
            }}
          </li>
        </ul>
      </template>
      <p class="muted">仅检查逾期与未完成的直接依赖，不预测交付结果。</p>
      <p class="muted">补充任务描述不会消除这些风险信号。</p>
      <p class="muted">来源时间：{{ review.evaluation.asOf || "未提供" }}</p>
      <p class="muted">检查记录：{{ review.review.id }}</p>
      <form
        v-if="available && review.evaluation.tasks.length"
        data-testid="risk-feedback-form"
        @submit.prevent="saveFeedback"
      >
        <label
          >核对任务<select v-model="feedbackTask" :disabled="busy || uncertain">
            <option value="">请选择任务</option>
            <option
              v-for="item in review.evaluation.tasks"
              :key="item.taskRef.id"
              :value="item.taskRef.id"
            >
              {{ item.taskRef.id }}
            </option>
          </select></label
        >
        <label
          >人工判断<select v-model="verdict" :disabled="busy || uncertain">
            <option value="affirmed">确认规则信号</option>
            <option value="dismissed">排除规则信号</option>
            <option value="needs-review">仍需核对</option>
          </select></label
        >
        <label
          >核对说明<textarea
            v-model="comment"
            rows="2"
            :disabled="busy || uncertain"
            data-testid="risk-feedback-comment"
          />
        </label>
        <button
          type="submit"
          :disabled="busy || uncertain || !feedbackTask || commentBytes > 4096"
          data-testid="save-risk-feedback"
        >
          保存人工核对
        </button>
        <p class="muted">人工判断单独保存，保留原始规则结果。</p>
      </form>
    </div>
    <div v-if="lineage" data-testid="risk-lineage-result">
      <h4>关联操作</h4>
      <p v-if="lineage.actionRuns.length === 0">暂无关联操作。</p>
      <ol>
        <li v-for="item in lineage.actionRuns" :key="item.run.id">
          {{ runLabel(item.run.status) }}：{{ item.run.id }}
        </li>
      </ol>
      <button
        v-if="lineage.nextCursor"
        :disabled="busy"
        @click="loadLineage('actions')"
      >
        更早操作
      </button>
      <h4>人工核对</h4>
      <p v-if="lineage.feedback.length === 0">暂无人工核对。</p>
      <ol>
        <li v-for="item in lineage.feedback" :key="item.feedback.id">
          {{ item.feedback.taskId }}：{{ verdictLabel(item.feedback.verdict) }}
          {{ item.feedback.comment }}
        </li>
      </ol>
      <button
        v-if="lineage.nextFeedbackCursor"
        :disabled="busy"
        @click="loadLineage('feedback')"
      >
        更早核对
      </button>
      <p class="muted">
        模型费用：未知。这里展示历史来源与操作记录，当前风险需重新检查。
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  isAuthorityError,
  riskReason,
  runLabel,
  type ActionReceipt,
  type RiskReview,
} from "./task-description-ui";
type History = {
  review: RiskReview["review"];
  status: string;
  summary: RiskReview["evaluation"]["summary"];
};
type Feedback = {
  feedback: { id: string; taskId: string; verdict: string; comment: string };
};
type Lineage = {
  review: RiskReview["review"];
  actionRuns: ActionReceipt[];
  feedback: Feedback[];
  nextCursor: string | null;
  nextFeedbackCursor: string | null;
};
type RiskHistoryApi = {
  listRiskReviews(input: {
    projectId: string;
    beforeId?: string;
    limit: number;
  }): Promise<{ reviews: History[]; nextCursor: string | null }>;
  getRiskReview(input: { reviewId: string }): Promise<RiskReview>;
  getRiskLineage(input: {
    reviewId: string;
    beforeId?: string;
    feedbackBeforeId?: string;
    limit: number;
  }): Promise<Lineage>;
  recordRiskFeedback(input: {
    reviewId: string;
    taskId: string;
    verdict: string;
    reasonCodes: string[];
    comment: string;
  }): Promise<unknown>;
};
const props = defineProps<{
  projectId: string;
  identityKey?: string;
  review: RiskReview | null;
}>();
const emit = defineEmits<{
  (event: "review", value: RiskReview | null): void;
  (event: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: RiskHistoryApi } })
    .electronAPI?.project;
const available = computed(() =>
  [
    "listRiskReviews",
    "getRiskReview",
    "getRiskLineage",
    "recordRiskFeedback",
  ].every((key) => typeof api()?.[key as keyof RiskHistoryApi] === "function"),
);
const history = ref<History[]>([]),
  historyCursor = ref<string | null>(null),
  lineage = ref<Lineage | null>(null);
const busy = ref(false),
  error = ref(""),
  uncertain = ref(false),
  feedbackTask = ref(""),
  verdict = ref("affirmed"),
  comment = ref("");
const commentBytes = computed(
  () => new TextEncoder().encode(comment.value).length,
);
let epoch = 0,
  mounted = true;
const current = (stamp: number) => mounted && stamp === epoch;
function verdictLabel(value: string) {
  return (
    {
      affirmed: "确认规则信号",
      dismissed: "排除规则信号",
      "needs-review": "仍需核对",
    }[value] || "未知判断"
  );
}
function failure(value: unknown, message: string) {
  if (isAuthorityError(value)) {
    reset();
    emit("review", null);
    emit("authority-error");
  }
  error.value = isAuthorityError(value)
    ? "当前身份已无法访问这些记录。"
    : message;
}
function reset() {
  epoch++;
  busy.value = false;
  history.value = [];
  historyCursor.value = null;
  lineage.value = null;
  feedbackTask.value = "";
  comment.value = "";
  uncertain.value = false;
  error.value = "";
}
async function loadHistory(more = false) {
  if (busy.value || !available.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const result = await api()!.listRiskReviews({
      projectId: props.projectId,
      limit: 10,
      ...(more && historyCursor.value ? { beforeId: historyCursor.value } : {}),
    });
    if (!current(stamp)) return;
    if (
      result.reviews.some((item) => item.review.projectId !== props.projectId)
    )
      throw new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    history.value = more
      ? [...history.value, ...result.reviews]
      : result.reviews;
    historyCursor.value = result.nextCursor;
  } catch (value) {
    if (current(stamp)) failure(value, "检查历史暂不可读取。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function selectReview(reviewId: string) {
  if (busy.value || !available.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  try {
    const result = await api()!.getRiskReview({ reviewId });
    if (!current(stamp)) return;
    if (
      result.review.projectId !== props.projectId ||
      result.review.id !== reviewId
    )
      throw new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    emit("review", { review: result.review, evaluation: result.evaluation });
  } catch (value) {
    if (current(stamp)) failure(value, "所选检查暂不可读取。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function loadLineage(more?: "actions" | "feedback") {
  if (busy.value || !available.value || !props.review) return;
  const stamp = epoch,
    reviewId = props.review.review.id;
  busy.value = true;
  error.value = "";
  try {
    const result = await api()!.getRiskLineage({
      reviewId,
      limit: 10,
      ...(more === "actions" && lineage.value?.nextCursor
        ? { beforeId: lineage.value.nextCursor }
        : {}),
      ...(more === "feedback" && lineage.value?.nextFeedbackCursor
        ? { feedbackBeforeId: lineage.value.nextFeedbackCursor }
        : {}),
    });
    if (!current(stamp)) return;
    if (
      result.review.id !== reviewId ||
      result.review.projectId !== props.projectId
    )
      throw new Error("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    lineage.value =
      more && lineage.value
        ? {
            ...result,
            actionRuns:
              more === "actions"
                ? [...lineage.value.actionRuns, ...result.actionRuns]
                : lineage.value.actionRuns,
            feedback:
              more === "feedback"
                ? [...lineage.value.feedback, ...result.feedback]
                : lineage.value.feedback,
            nextCursor:
              more === "feedback"
                ? lineage.value.nextCursor
                : result.nextCursor,
            nextFeedbackCursor:
              more === "actions"
                ? lineage.value.nextFeedbackCursor
                : result.nextFeedbackCursor,
          }
        : result;
    uncertain.value = false;
  } catch (value) {
    if (current(stamp)) failure(value, "关联操作与人工核对暂不可读取。");
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function saveFeedback() {
  if (
    busy.value ||
    uncertain.value ||
    !props.review ||
    !available.value ||
    !feedbackTask.value ||
    commentBytes.value > 4096
  )
    return;
  const stamp = epoch,
    item = props.review.evaluation.tasks.find(
      (item) => item.taskRef.id === feedbackTask.value,
    );
  if (!item) return;
  busy.value = true;
  error.value = "";
  try {
    await api()!.recordRiskFeedback({
      reviewId: props.review.review.id,
      taskId: item.taskRef.id,
      verdict: verdict.value,
      reasonCodes: verdict.value === "dismissed" ? [] : [...item.reasonCodes],
      comment: comment.value,
    });
    if (!current(stamp)) return;
    comment.value = "";
    busy.value = false;
    await loadLineage();
  } catch (value) {
    if (current(stamp)) {
      uncertain.value = true;
      failure(value, "核对结果待核实，请读取关联记录后继续。");
    }
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(() => [props.projectId, props.identityKey], reset, { flush: "sync" });
watch(
  () => props.review?.review.id,
  () => {
    epoch++;
    busy.value = false;
    lineage.value = null;
    feedbackTask.value = "";
    comment.value = "";
    uncertain.value = false;
    error.value = "";
  },
  { flush: "sync" },
);
onBeforeUnmount(() => {
  mounted = false;
  reset();
});
</script>

<style scoped>
.section {
  border-top: 1px solid #e2e8f0;
  margin-top: 20px;
  padding-top: 16px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.muted {
  color: #64748b;
  font-size: 12px;
  overflow-wrap: anywhere;
}
label {
  display: block;
  margin: 10px 0;
}
select,
textarea {
  display: block;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 6px;
}
button {
  padding: 7px 12px;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
li {
  overflow-wrap: anywhere;
  margin: 8px 0;
}
</style>
