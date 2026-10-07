<template>
  <section class="org-setup" data-testid="organization-project-setup">
    <h3>组织授权与审批设置</h3>
    <p>设置需要当前组织所有者本人确认。绑定后，项目任务将通过组织审批操作。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <label
      >组织
      <select
        v-model="orgId"
        :disabled="busy || !!context.binding"
        data-testid="setup-organization"
      >
        <option value="">选择组织</option>
        <option v-for="org in organizations" :key="org.id" :value="org.id">
          {{ org.name || org.id }}
        </option>
      </select>
    </label>
    <div v-if="data">
      <p>
        授权状态：{{
          data.policyState === "current"
            ? "已确认"
            : data.policyState === "stale"
              ? "需要重新确认"
              : "尚未设置"
        }}
      </p>
      <h4>审批计划</h4>
      <ul>
        <li v-for="workflow in data.workflows" :key="workflow.id">
          {{ workflow.name }} ·
          {{ workflow.actionType === "task.create" ? "创建任务" : "修改描述" }}
          · {{ workflow.steps.length }} 步
        </li>
      </ul>
      <label
        >计划名称<input
          v-model="workflowName"
          :disabled="busy"
          maxlength="80"
          data-testid="workflow-name"
      /></label>
      <label
        >操作<select
          v-model="workflowAction"
          :disabled="busy"
          data-testid="workflow-action"
        >
          <option value="task.update-description">修改描述</option>
          <option value="task.create">创建任务</option>
        </select></label
      >
      <label
        >审批方式<select v-model="approvalType" :disabled="busy">
          <option value="sequential">每步任一人批准</option>
          <option value="parallel">每步全部批准</option>
          <option value="any_one">每步任一人批准（兼容计划）</option>
        </select></label
      >
      <label v-for="(step, index) in steps" :key="index"
        >第 {{ index + 1 }} 步审批人
        <select
          v-model="steps[index]"
          multiple
          :disabled="busy"
          :data-testid="`workflow-step-${index}`"
        >
          <option
            v-for="member in activeMembers"
            :key="member.did"
            :value="member.did"
          >
            {{ member.name || member.did }}
          </option>
        </select>
      </label>
      <button :disabled="busy || steps.length >= 32" @click="steps.push([])">
        添加审批步骤
      </button>
      <label
        >有效时长（小时）<input
          v-model.number="timeoutHours"
          type="number"
          min="1"
          max="168"
          :disabled="busy"
      /></label>
      <button
        :disabled="
          busy ||
          data.workflows.length >= 20 ||
          !workflowName.trim() ||
          steps.some((step) => !step.length)
        "
        @click="saveWorkflow"
        data-testid="save-workflow"
      >
        保存审批计划
      </button>
      <h4>成员权限</h4>
      <p>仅以下明确授权生效。其他项目已有授权会保留在表中。</p>
      <div
        v-for="(grant, index) in grants"
        :key="index"
        class="grant"
        data-testid="policy-grant"
      >
        <label
          >成员<select
            v-model="grant.actorDid"
            :disabled="busy"
            @change="prepared = null"
          >
            <option
              v-for="member in data.members"
              :key="member.did"
              :value="member.did"
            >
              {{ member.name || member.did
              }}{{ member.status !== "active" ? "（已停用）" : "" }}
            </option>
          </select></label
        >
        <span>项目：{{ grant.projectId }}</span>
        <label v-for="permission in permissionChoices" :key="permission.value"
          ><input
            v-model="grant.permissions"
            type="checkbox"
            :value="permission.value"
            :disabled="busy"
            @change="prepared = null"
          />{{ permission.label }}</label
        >
        <label
          >到期时间<input
            type="datetime-local"
            :value="localDate(grant.expiresAt)"
            :disabled="busy"
            @change="changeExpiry(index, $event)"
        /></label>
        <button
          :disabled="busy"
          @click="
            grants.splice(index, 1);
            prepared = null;
          "
        >
          移除授权
        </button>
      </div>
      <button
        :disabled="busy || grants.length >= 100"
        @click="addGrant"
        data-testid="add-policy-grant"
      >
        添加成员授权
      </button>
      <label v-for="workflow in data.workflows" :key="`pin-${workflow.id}`"
        ><input
          v-model="workflowIds"
          type="checkbox"
          :value="workflow.id"
          :disabled="busy"
          @change="prepared = null"
        />使用 {{ workflow.name }}</label
      >
      <button
        :disabled="busy"
        @click="previewPolicy"
        data-testid="preview-policy"
      >
        预览授权
      </button>
      <div v-if="prepared" data-testid="policy-preview">
        <p>
          {{ prepared.policy.permissions.length }} 条授权，{{
            prepared.policy.workflows.length
          }}
          个审批计划。
        </p>
        <button
          :disabled="busy"
          @click="attestPolicy"
          data-testid="attest-policy"
        >
          本人确认授权
        </button>
      </div>
      <h4>项目归属</h4>
      <p v-if="data.binding">
        {{
          data.binding.status === "active"
            ? "项目已绑定组织。"
            : "绑定已撤销，个人访问不会自动恢复。"
        }}
      </p>
      <template v-else-if="context.isProjectOwner !== false">
        <label
          >组织项目<select
            v-model="organizationProjectId"
            :disabled="busy"
            data-testid="binding-project"
          >
            <option value="">选择组织项目</option>
            <option
              v-for="target in data.organizationProjects"
              :key="target.id"
              :value="target.id"
            >
              {{ target.name || target.id }}
            </option>
          </select></label
        >
        <button
          :disabled="
            busy || !organizationProjectId || data.policyState !== 'current'
          "
          @click="bindProject"
          data-testid="bind-project"
        >
          预览并确认绑定
        </button>
      </template>
      <p v-else>请先确认此项目的组织授权，再由原所有者在下方同意迁移。</p>
      <button
        v-if="data.binding?.status === 'active'"
        :disabled="busy"
        @click="revokeBinding"
        data-testid="revoke-binding"
      >
        撤销组织使用权限
      </button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationError,
  type OrganizationContext,
} from "./organization-project-ui";
const props = defineProps<{
  projectId: string;
  identityKey?: string;
  context: OrganizationContext;
}>();
const emit = defineEmits<{
  (event: "changed"): void;
  (event: "authority-error", value: unknown): void;
}>();
const data = shallowRef<any>(null),
  prepared = shallowRef<any>(null),
  orgId = ref(props.context.binding?.orgId || ""),
  error = ref(""),
  busy = ref(false);
const grants = ref<
    Array<{
      actorDid: string;
      projectId: string;
      permissions: string[];
      expiresAt: number;
    }>
  >([]),
  workflowIds = ref<string[]>([]),
  organizationProjectId = ref("");
const workflowName = ref(""),
  workflowAction = ref("task.update-description"),
  approvalType = ref("sequential"),
  steps = ref<string[][]>([[], []]),
  timeoutHours = ref(24);
const organizations = computed(() =>
  props.context.binding
    ? [{ id: props.context.binding.orgId, name: props.context.binding.orgId }]
    : props.context.ownedOrganizations,
);
const activeMembers = computed(
  () => data.value?.members.filter((m: any) => m.status === "active") || [],
);
const permissionChoices = [
  { value: "task.read", label: "查看任务及提议" },
  { value: "task.create", label: "提议创建任务" },
  { value: "task.update-description", label: "提议修改描述" },
  { value: "task.approve", label: "审批提议" },
  { value: "risk.read", label: "查看项目风险与历史" },
  { value: "risk.evaluate", label: "检查项目风险" },
  { value: "risk.feedback", label: "人工核对风险" },
  { value: "goal.read", label: "查看组织目标" },
  { value: "goal.create", label: "创建组织目标" },
  { value: "goal.update", label: "更新、暂停或结束组织目标" },
  { value: "goal.check", label: "手动检查组织目标风险" },
  { value: "goal.monitor", label: "启用或停止组织目标周期巡检" },
  { value: "goal.propose", label: "准备和提交组织目标任务建议" },
  { value: "goal.accept", label: "组织目标验收检查与人工确认" },
  { value: "goal.memory.read", label: "读取组织目标共享记忆" },
  { value: "goal.memory.write", label: "保存、修正与撤销共享记忆" },
  { value: "goal.memory.delete", label: "删除组织目标共享记忆" },
];
let epoch = 0;
function reset() {
  epoch++;
  data.value = null;
  prepared.value = null;
  grants.value = [];
  workflowIds.value = [];
  steps.value = [[], []];
  workflowName.value = "";
  organizationProjectId.value = "";
  error.value = "";
  busy.value = false;
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    reset();
    emit("authority-error", value);
  }
  error.value = organizationError(value);
}
async function load() {
  const token = ++epoch;
  data.value = null;
  prepared.value = null;
  grants.value = [];
  workflowIds.value = [];
  if (!orgId.value) return;
  busy.value = true;
  try {
    const result = await organizationApi().setup({
      projectId: props.projectId,
      orgId: orgId.value,
    });
    if (token !== epoch) return;
    data.value = result;
    grants.value = structuredClone(result.policy?.permissions || []);
    workflowIds.value = (result.policy?.workflows || []).map(
      (w: any) => w.workflowId,
    );
    organizationProjectId.value = result.binding?.organization_project_id || "";
  } catch (value) {
    if (token === epoch) failure(value);
  } finally {
    if (token === epoch) busy.value = false;
  }
}
function localDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function changeExpiry(index: number, event: Event) {
  const value = new Date((event.target as HTMLInputElement).value).getTime();
  grants.value[index].expiresAt = Number.isFinite(value) ? value : 0;
  prepared.value = null;
}
function addGrant() {
  grants.value.push({
    actorDid: props.context.actorDid,
    projectId: props.projectId,
    permissions: [],
    expiresAt: Date.now() + 7 * 86400000,
  });
  prepared.value = null;
}
function policyInput() {
  return {
    orgId: orgId.value,
    permissions: JSON.parse(JSON.stringify(grants.value)),
    workflowIds: [...workflowIds.value],
  };
}
async function operation(work: () => Promise<void>) {
  const token = epoch;
  busy.value = true;
  error.value = "";
  try {
    await work();
  } catch (value) {
    if (token === epoch) failure(value);
  } finally {
    if (token === epoch) busy.value = false;
  }
}
async function previewPolicy() {
  const token = epoch;
  await operation(async () => {
    const result = await organizationApi().previewPolicy(policyInput());
    if (token === epoch) prepared.value = result;
  });
}
async function attestPolicy() {
  if (!prepared.value) return;
  const token = epoch,
    expectedDigest = prepared.value.digest,
    request = policyInput();
  await operation(async () => {
    const result = await organizationApi().attestPolicy({
      ...request,
      expectedDigest,
    });
    if (token !== epoch) return;
    if (result.status === "attested") {
      await load();
      // Unbound projects retain the selected organization for the binding step.
      if (data.value && props.context.binding) emit("changed");
    } else prepared.value = null;
  });
}
async function saveWorkflow() {
  const token = epoch;
  const savedGrants = JSON.parse(JSON.stringify(grants.value));
  const savedPins = [...workflowIds.value];
  const request = {
    orgId: orgId.value,
    name: workflowName.value,
    actionType: workflowAction.value,
    steps: JSON.parse(JSON.stringify(steps.value)),
    approvalType: approvalType.value,
    timeoutHours: timeoutHours.value,
    expectedSourceDigest: data.value.sourceDigest,
  };
  await operation(async () => {
    const result = await organizationApi().configureWorkflow(request);
    if (token !== epoch) return;
    if (result.status === "configured") {
      const loadEpoch = epoch + 1;
      await load();
      if (epoch !== loadEpoch || !data.value) return;
      grants.value = savedGrants;
      workflowIds.value = [
        ...new Set([...savedPins, ...workflowIds.value, result.workflowId]),
      ];
      workflowName.value = "";
    }
  });
}
async function bindProject() {
  const token = epoch,
    request = {
      orgId: orgId.value,
      projectId: props.projectId,
      organizationProjectId: organizationProjectId.value,
    };
  await operation(async () => {
    const preview = await organizationApi().previewBinding(request);
    if (token !== epoch) return;
    const result = await organizationApi().bindProject({
      ...request,
      expectedDigest: preview.digest,
    });
    if (token === epoch && result.status === "bound") {
      await load();
      emit("changed");
    }
  });
}
async function revokeBinding() {
  const token = epoch;
  await operation(async () => {
    const result = await organizationApi().revokeBinding({
      projectId: props.projectId,
      expectedRevision: data.value.binding.revision,
    });
    if (token === epoch && result.status === "revoked") {
      await load();
      emit("changed");
    }
  });
}
watch(
  orgId,
  () => {
    void load();
  },
  { immediate: true },
);
watch(
  () => [props.projectId, props.identityKey],
  () => {
    reset();
    orgId.value = props.context.binding?.orgId || "";
    void load();
  },
);
onBeforeUnmount(reset);
</script>
<style scoped>
.org-setup {
  border-top: 1px solid #ddd;
  margin-top: 16px;
  padding-top: 12px;
}
label {
  display: block;
  margin: 8px 0;
}
input,
select {
  margin-left: 8px;
  max-width: 100%;
}
select[multiple] {
  min-width: 240px;
  min-height: 70px;
}
.grant {
  padding: 8px;
  border: 1px solid #ddd;
  margin: 8px 0;
}
button {
  margin: 6px 8px 6px 0;
}
p[role="alert"] {
  color: #b42318;
}
</style>
