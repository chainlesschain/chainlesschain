<template>
  <a-drawer
    :open="open"
    title="组织项目任务"
    :width="820"
    @close="emit('update:open', false)"
  >
    <div v-if="open" data-testid="organization-project-workbench">
      <p v-if="error" role="alert">{{ error }}</p>
      <button
        :disabled="busy"
        @click="reload"
        data-testid="refresh-organization"
      >
        刷新组织状态
      </button>
      <p v-if="context">当前身份：{{ context.actorDid }}</p>
      <p v-if="context?.mode === 'unbound'">
        此项目尚未绑定组织。组织所有者可在下方设置授权和审批计划。
      </p>
      <p v-if="context?.reason">
        当前任务访问不可用，请检查组织授权或绑定状态。
      </p>
      <div v-if="context?.permissions.includes('task.read')">
        <section>
          <h3>已保存任务</h3>
          <p v-if="!tasks.length">暂无已保存任务。</p>
          <ul>
            <li v-for="task in tasks" :key="task.id">
              <button
                :data-task-id="task.id"
                @click="selectTask(task.id)"
                :disabled="busy"
              >
                {{ task.descriptionPreview || "空描述" }} ·
                {{ taskStatus(task.status) }}
              </button>
            </li>
          </ul>
          <button
            v-if="taskCursor"
            :disabled="busy"
            @click="loadTasks(true)"
            data-testid="more-organization-tasks"
          >
            更多任务
          </button>
        </section>
        <section v-if="canCreate || canUpdate">
          <h3>准备任务提议</h3>
          <label
            >操作<select
              v-model="kind"
              :disabled="busy || attempted"
              data-testid="proposal-kind"
            >
              <option v-if="canUpdate" value="description">修改描述</option>
              <option v-if="canCreate" value="create">创建任务</option>
            </select></label
          >
          <p v-if="kind === 'description'">
            {{
              selectedTask
                ? `任务：${selectedTask.taskId}`
                : "请先选择一个任务。"
            }}
          </p>
          <label v-if="kind === 'create'"
            >任务类型<select v-model="taskType" :disabled="busy || attempted">
              <option v-for="item in taskTypes" :key="item[0]" :value="item[0]">
                {{ item[1] }}
              </option>
            </select></label
          >
          <label
            >提议内容<textarea
              v-model="draft"
              rows="5"
              :disabled="busy || attempted"
              data-testid="organization-description"
            />
          </label>
          <p>{{ bytes }} / 8192 字节。创建仅保存待处理任务，不会自动执行。</p>
          <button
            :disabled="!canPreview"
            @click="preview"
            data-testid="preview-organization-proposal"
          >
            预览提议
          </button>
          <div v-if="prepared" data-testid="organization-proposal-preview">
            <h4>修改前</h4>
            <pre>{{ prepared.before.description || "（空）" }}</pre>
            <h4>修改后</h4>
            <pre>{{ prepared.after.description || "（空）" }}</pre>
            <label
              >审批计划<select
                v-model="workflowId"
                :disabled="busy || attempted"
                data-testid="proposal-workflow"
              >
                <option value="">选择审批计划</option>
                <option
                  v-for="workflow in applicableWorkflows"
                  :key="workflow.id"
                  :value="workflow.id"
                >
                  {{ workflow.name || workflow.id }}
                </option>
              </select></label
            >
            <button
              :disabled="busy || attempted || !workflowId"
              @click="submit"
              data-testid="submit-organization-proposal"
            >
              提交审批
            </button>
          </div>
          <p v-if="submissionUnknown" role="status">
            提交结果待核实。请刷新提议列表，系统不会自动重试。
          </p>
          <button
            v-if="attempted && !submissionUnknown"
            :disabled="busy"
            @click="newIntent"
            data-testid="new-organization-intent"
          >
            准备新的提议
          </button>
        </section>
        <section>
          <h3>任务提议与审批</h3>
          <button
            :disabled="busy"
            @click="loadProposals()"
            data-testid="refresh-organization-proposals"
          >
            刷新提议记录
          </button>
          <p v-if="!proposals.length">暂无提议。</p>
          <ol>
            <li v-for="proposal in proposals" :key="proposal.proposalId">
              <button
                :data-proposal-id="proposal.proposalId"
                :disabled="busy"
                @click="selectProposal(proposal.proposalId)"
              >
                {{ proposalStatus(proposal.approvalStatus) }} ·
                {{ proposal.target.id }} · {{ timeLabel(proposal.createdAt) }}
              </button>
            </li>
          </ol>
          <button
            v-if="proposalCursor"
            :disabled="busy"
            @click="loadProposals(true)"
            data-testid="more-organization-proposals"
          >
            更早提议
          </button>
        </section>
        <section
          v-if="selectedProposal"
          data-testid="organization-proposal-detail"
        >
          <h3>{{ proposalStatus(selectedProposal.approvalStatus) }}</h3>
          <p>请求者：{{ selectedProposal.requesterDid }}</p>
          <p>提议内容可用至：{{ timeLabel(selectedProposal.expiresAt) }}</p>
          <template v-if="selectedProposal.request"
            ><h4>提议内容</h4>
            <pre data-testid="stored-proposal-body">{{
              selectedProposal.request.input.description
            }}</pre>
            <p>目标：{{ selectedProposal.request.target.id }}</p>
            <p>
              操作摘要：{{ selectedProposal.request.actionDigest }}
            </p></template
          >
          <p v-else>提议正文已不可用，历史记录仍保留。</p>
          <ol v-if="selectedProposal.approval">
            <li
              v-for="(step, index) in selectedProposal.approval.plan.steps"
              :key="index"
            >
              第 {{ index + 1 }} 步：{{ step.join("、")
              }}{{
                index === selectedProposal.currentStep &&
                selectedProposal.approvalStatus === "pending"
                  ? "（当前步骤）"
                  : ""
              }}
            </li>
          </ol>
          <p v-if="selectedProposal.eligibilityReason">
            {{
              organizationError({ code: selectedProposal.eligibilityReason })
            }}
          </p>
          <button
            v-if="selectedProposal.canRespond"
            :disabled="busy"
            @click="respond('approve')"
            data-testid="approve-organization-proposal"
          >
            核对并批准
          </button>
          <button
            v-if="selectedProposal.canRespond"
            :disabled="busy"
            @click="respond('reject')"
            data-testid="reject-organization-proposal"
          >
            核对并拒绝
          </button>
          <button
            v-if="selectedProposal.canCancel"
            :disabled="busy"
            @click="cancelProposal"
            data-testid="cancel-organization-proposal"
          >
            取消提议
          </button>
          <button
            v-if="selectedProposal.canExecute && !receipt"
            :disabled="busy || executionUnknown"
            @click="execute"
            data-testid="execute-organization-proposal"
          >
            本人确认执行
          </button>
          <p v-if="executionUnknown" role="status">
            执行结果待核实。请刷新记录，系统不会自动重试。
          </p>
          <p
            v-if="receipt"
            role="status"
            data-testid="organization-action-receipt"
          >
            {{ runLabel(receipt.run.status) }}
          </p>
          <button
            :disabled="busy"
            @click="selectProposal(selectedProposal.proposalId)"
            data-testid="refresh-selected-proposal"
          >
            核验此提议
          </button>
        </section>
      </div>
      <OrganizationProjectSetup
        v-if="context?.canManage"
        :key="`${projectId}:${identityKey}:${context.binding?.orgId || ''}`"
        :project-id="projectId"
        :identity-key="identityKey"
        :context="context"
        @changed="reload"
        @authority-error="failure"
      />
      <OrganizationProjectTransfer
        :key="`transfer:${projectId}:${identityKey}`"
        :project-id="projectId"
        :identity-key="identityKey"
        :session-revision="transferSessionRevision"
        :policy-revision="transferPolicyRevision"
        @changed="reload"
        @authority-error="failure"
      />
    </div>
  </a-drawer>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import OrganizationProjectSetup from "./OrganizationProjectSetup.vue";
import OrganizationProjectTransfer from "./OrganizationProjectTransfer.vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationSessionError,
  organizationError,
  proposalStatus,
  timeLabel,
  type OrganizationContext,
  type OrganizationProposal,
} from "./organization-project-ui";
import {
  actionCode,
  isDefiniteActionRejection,
  runLabel,
  taskStatus,
  unresolved,
} from "./task-description-ui";
const props = defineProps<{
  open: boolean;
  projectId: string;
  identityKey?: string;
}>();
const emit = defineEmits<{ (event: "update:open", value: boolean): void }>();
const context = shallowRef<OrganizationContext | null>(null),
  selectedTask = shallowRef<any>(null),
  prepared = shallowRef<any>(null),
  selectedProposal = shallowRef<OrganizationProposal | null>(null),
  receipt = shallowRef<any>(null);
const tasks = ref<any[]>([]),
  proposals = ref<OrganizationProposal[]>([]),
  taskCursor = ref<string | null>(null),
  proposalCursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false);
const kind = ref("description"),
  taskType = ref("query_info"),
  draft = ref(""),
  workflowId = ref(""),
  attempted = ref(false),
  submissionUnknown = ref(false),
  executionUnknown = ref(false);
const transferSessionRevision = ref(0),
  transferPolicyRevision = ref(0);
const taskTypes = [
  ["query_info", "信息查询"],
  ["analyze_data", "数据分析"],
  ["create_file", "创建文件"],
  ["edit_file", "编辑文件"],
  ["export_file", "导出文件"],
  ["deploy_project", "项目部署"],
];
const bytes = computed(() => new TextEncoder().encode(draft.value).length),
  canCreate = computed(() =>
    context.value?.permissions.includes("task.create"),
  ),
  canUpdate = computed(() =>
    context.value?.permissions.includes("task.update-description"),
  );
const applicableWorkflows = computed(
  () =>
    context.value?.workflows.filter(
      (w) =>
        w.actionType ===
        (kind.value === "create" ? "task.create" : "task.update-description"),
    ) || [],
);
const canPreview = computed(
  () =>
    !busy.value &&
    !attempted.value &&
    !submissionUnknown.value &&
    bytes.value <= 8192 &&
    (kind.value === "create"
      ? canCreate.value && !!draft.value.trim()
      : canUpdate.value && selectedTask.value?.editable === true),
);
let epoch = 0,
  selection = 0,
  taskListSequence = 0,
  proposalListSequence = 0,
  activeWork = 0,
  unknownDigest = "";
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const unknownExecutions = new Set<string>();
function stopExpiryTimer() {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
}
function expireBody(proposal: OrganizationProposal) {
  if (selectedProposal.value !== proposal || !proposal.request) return;
  const remaining = proposal.expiresAt - Date.now();
  if (remaining > 0) {
    expiryTimer = setTimeout(
      () => expireBody(proposal),
      Math.min(remaining, 2147483647),
    );
    return;
  }
  if (attempted.value && draft.value === proposal.request.input.description) {
    draft.value = "";
    prepared.value = null;
  }
  selectedProposal.value = {
    ...proposal,
    request: null,
    bodyAvailable: false,
    unavailableReason: "ORG_PROPOSAL_BODY_UNAVAILABLE",
    approvalStatus: ["pending", "approved"].includes(proposal.approvalStatus)
      ? "expired"
      : proposal.approvalStatus,
    canRespond: false,
    canExecute: false,
    canCancel: false,
    eligibilityReason: "ORG_PROPOSAL_BODY_UNAVAILABLE",
  };
}
function clear() {
  stopExpiryTimer();
  epoch++;
  selection++;
  taskListSequence++;
  proposalListSequence++;
  activeWork = 0;
  context.value = null;
  tasks.value = [];
  proposals.value = [];
  taskCursor.value = null;
  proposalCursor.value = null;
  selectedTask.value = null;
  prepared.value = null;
  selectedProposal.value = null;
  receipt.value = null;
  draft.value = "";
  workflowId.value = "";
  attempted.value = false;
  submissionUnknown.value = false;
  executionUnknown.value = false;
  unknownDigest = "";
  busy.value = false;
  error.value = "";
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    if (organizationSessionError(value)) {
      transferSessionRevision.value++;
    } else transferPolicyRevision.value++;
    clear();
    error.value = organizationError(value);
  } else error.value = organizationError(value);
}
async function work(fn: (token: number) => Promise<void>) {
  const token = epoch;
  activeWork++;
  busy.value = true;
  error.value = "";
  try {
    await fn(token);
  } catch (value) {
    if (token === epoch) failure(value);
  } finally {
    if (token === epoch) busy.value = --activeWork > 0;
  }
}
async function reload(preserveRecovery = true) {
  const recovery =
    preserveRecovery && submissionUnknown.value ? unknownDigest : "";
  clear();
  if (!props.open) return;
  if (recovery) {
    unknownDigest = recovery;
    submissionUnknown.value = true;
    attempted.value = true;
  }
  await work(async (token) => {
    const result = await organizationApi().context({
      projectId: props.projectId,
    });
    if (token !== epoch) return;
    context.value = result;
    if (!canUpdate.value && canCreate.value) kind.value = "create";
    if (result.permissions.includes("task.read")) {
      await loadTasks();
      if (token === epoch) await loadProposals();
    }
  });
}
async function loadTasks(more = false) {
  const sequence = ++taskListSequence;
  await work(async (token) => {
    const result = await organizationApi().listTasks({
      projectId: props.projectId,
      ...(more && taskCursor.value ? { afterId: taskCursor.value } : {}),
      limit: 50,
    });
    if (token !== epoch || sequence !== taskListSequence) return;
    tasks.value = more
      ? [
          ...new Map(
            [...tasks.value, ...result.tasks].map((task) => [task.id, task]),
          ).values(),
        ]
      : result.tasks;
    taskCursor.value = result.nextCursor;
  });
}
async function loadProposals(more = false) {
  const sequence = ++proposalListSequence;
  await work(async (token) => {
    const result = await organizationApi().listProposals({
      projectId: props.projectId,
      ...(more && proposalCursor.value
        ? { beforeId: proposalCursor.value }
        : {}),
      limit: 20,
    });
    if (token !== epoch || sequence !== proposalListSequence) return;
    proposals.value = more
      ? [
          ...new Map(
            [...proposals.value, ...result.proposals].map((proposal) => [
              proposal.proposalId,
              proposal,
            ]),
          ).values(),
        ]
      : result.proposals;
    proposalCursor.value = result.nextCursor;
    const recovered =
      unknownDigest &&
      proposals.value.find((p) => p.requestDigest === unknownDigest);
    if (recovered) {
      submissionUnknown.value = false;
      unknownDigest = "";
      await selectProposal(recovered.proposalId);
    }
  });
}
async function selectTask(taskId: string) {
  const token = epoch,
    selected = ++selection;
  selectedTask.value = null;
  prepared.value = null;
  draft.value = "";
  if (attempted.value) return;
  await work(async () => {
    const result = await organizationApi().readTask({ taskId });
    if (token !== epoch || selected !== selection) return;
    selectedTask.value = result;
    draft.value = result.description;
  });
}
function newIntent() {
  prepared.value = null;
  attempted.value = false;
  workflowId.value = "";
  draft.value =
    kind.value === "description" ? selectedTask.value?.description || "" : "";
}
async function preview() {
  const token = epoch,
    selected = selection;
  await work(async () => {
    const api = organizationApi();
    const key = globalThis.crypto.randomUUID();
    const result =
      kind.value === "create"
        ? await api.previewCreate({
            projectId: props.projectId,
            taskType: taskType.value,
            description: draft.value,
            idempotencyKey: key,
          })
        : await api.previewDescription({
            taskId: selectedTask.value.taskId,
            description: draft.value,
            idempotencyKey: key,
          });
    if (token !== epoch || selected !== selection) return;
    prepared.value = result;
    workflowId.value = applicableWorkflows.value[0]?.id || "";
  });
}
async function submit() {
  if (!prepared.value || attempted.value) return;
  const token = epoch,
    request = prepared.value.request,
    digest = prepared.value.requestDigest;
  attempted.value = true;
  await work(async () => {
    try {
      const result = await organizationApi().submitProposal({
        projectId: props.projectId,
        workflowId: workflowId.value,
        request,
      });
      if (token !== epoch) return;
      prepared.value = null;
      await loadProposals();
      if (token === epoch) await selectProposal(result.proposalId);
    } catch (value) {
      if (token !== epoch) return;
      prepared.value = null;
      if (
        !/^(ORG_AUTH_|ORG_APPROVAL_|ORG_PROPOSAL_)/u.test(actionCode(value))
      ) {
        submissionUnknown.value = true;
        unknownDigest = digest;
      }
      throw value;
    }
  });
}
async function selectProposal(proposalId: string) {
  const token = epoch,
    selected = ++selection;
  selectedProposal.value = null;
  receipt.value = null;
  executionUnknown.value = unknownExecutions.has(proposalId);
  await work(async () => {
    const result = await organizationApi().readProposal({ proposalId });
    if (token !== epoch || selected !== selection) return;
    selectedProposal.value = result;
    const runId = result.actionRunId || result.approval?.consumedRunId;
    if (runId && result.requesterDid === context.value?.actorDid) {
      const saved = await organizationApi().getRun({ runId });
      if (token !== epoch || selected !== selection) return;
      receipt.value = saved;
      if (!unresolved(saved)) {
        unknownExecutions.delete(proposalId);
        executionUnknown.value = false;
      }
    }
  });
}
async function respond(decision: string) {
  const p = selectedProposal.value;
  if (!p?.canRespond) return;
  const token = epoch;
  await work(async () => {
    await organizationApi().respondProposal({
      proposalId: p.proposalId,
      step: p.currentStep,
      decision,
    });
    if (token !== epoch) return;
    await loadProposals();
    if (token === epoch) await selectProposal(p.proposalId);
  });
}
async function cancelProposal() {
  const p = selectedProposal.value;
  if (!p?.canCancel) return;
  const token = epoch;
  await work(async () => {
    await organizationApi().cancelProposal({ proposalId: p.proposalId });
    if (token !== epoch) return;
    await loadProposals();
    if (token === epoch) await selectProposal(p.proposalId);
  });
}
async function execute() {
  const p = selectedProposal.value;
  if (!p?.canExecute || executionUnknown.value) return;
  const token = epoch,
    selected = selection;
  await work(async () => {
    try {
      const saved = await organizationApi().executeProposal({
        proposalId: p.proposalId,
      });
      if (token !== epoch || selected !== selection) return;
      receipt.value = saved;
      executionUnknown.value = unresolved(saved);
      if (executionUnknown.value) unknownExecutions.add(p.proposalId);
      await loadTasks();
      await loadProposals();
    } catch (value) {
      if (token !== epoch || selected !== selection) return;
      if (
        !isDefiniteActionRejection(value) &&
        !/^(ORG_AUTH_|ORG_APPROVAL_|ORG_PROPOSAL_)/u.test(actionCode(value))
      ) {
        unknownExecutions.add(p.proposalId);
        executionUnknown.value = true;
      }
      throw value;
    }
  });
}
watch(
  selectedProposal,
  (proposal) => {
    stopExpiryTimer();
    if (proposal?.request) expireBody(proposal);
  },
  { flush: "sync" },
);
watch(
  () => [draft.value, kind.value, taskType.value],
  () => {
    if (!attempted.value) prepared.value = null;
  },
);
watch(
  () => [props.open, props.projectId, props.identityKey],
  () => {
    void reload(false);
  },
  { immediate: true },
);
onBeforeUnmount(clear);
</script>
<style scoped>
section {
  border-top: 1px solid #ddd;
  padding-top: 12px;
  margin-top: 16px;
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
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 10px;
  background: #f5f5f5;
}
p[role="alert"] {
  color: #b42318;
}
li {
  overflow-wrap: anywhere;
}
</style>
