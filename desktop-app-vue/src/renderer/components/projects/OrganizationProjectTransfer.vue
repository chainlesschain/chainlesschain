<template>
  <section data-testid="organization-project-transfer">
    <h3>双主体项目迁移</h3>
    <p>
      原所有者确认转出后，目标组织所有者还需本人确认接收。接收完成后，个人访问停止，任务权限按组织已确认的授权生效。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button :disabled="busy" @click="refresh()" data-testid="refresh-transfers">
      刷新迁移记录
    </button>
    <div v-if="catalog?.canInitiate">
      <label
        >目标组织<select
          v-model="orgId"
          :disabled="busy || attempted"
          data-testid="transfer-organization"
        >
          <option value="">选择组织</option>
          <option
            v-for="org in catalog.organizations"
            :key="org.id"
            :value="org.id"
          >
            {{ org.name || org.id }}
          </option>
        </select></label
      >
      <label
        >组织项目<select
          v-model="organizationProjectId"
          :disabled="busy || attempted"
          data-testid="transfer-target"
        >
          <option value="">选择组织项目</option>
          <option
            v-for="project in destination?.projects || []"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name || project.id }}
          </option>
        </select></label
      >
      <button
        :disabled="busy || attempted || !orgId || !organizationProjectId"
        @click="preview"
        data-testid="preview-transfer"
      >
        预览迁移
      </button>
      <div v-if="prepared" data-testid="transfer-preview">
        <p>原所有者：{{ prepared.evidence.originalOwnerDid }}</p>
        <p>接收组织所有者：{{ prepared.evidence.organizationOwnerDid }}</p>
        <p>迁移后的明确任务权限：</p>
        <ul>
          <li
            v-for="grant in prepared.evidence.projectPermissions || []"
            :key="grant.actorDid"
          >
            {{ grant.actorDid }}：{{
              grant.permissions.map(permissionLabel).join("、")
            }}，有效至
            {{ timeLabel(grant.expiresAt) }}
          </li>
        </ul>
        <p>有效至：{{ timeLabel(prepared.expiresAt) }}</p>
        <button
          :disabled="busy || attempted"
          @click="submit"
          data-testid="submit-transfer"
        >
          本人确认转出
        </button>
      </div>
      <button
        v-if="attempted && !unknownConsent"
        :disabled="busy"
        @click="newIntent"
        data-testid="new-transfer"
      >
        准备新的迁移
      </button>
    </div>
    <p v-if="unknownConsent" role="status">
      转出确认结果待核实，请刷新记录；系统不会自动重试。
    </p>
    <p v-if="!transfers.length">暂无本人参与的迁移记录。</p>
    <ul>
      <li v-for="transfer in transfers" :key="transfer.transferId">
        <button
          :disabled="busy"
          :data-transfer-id="transfer.transferId"
          @click="select(transfer.transferId)"
        >
          {{ statusLabel(transfer.status) }} · {{ transfer.orgId }} ·
          {{ timeLabel(transfer.createdAt) }}
        </button>
      </li>
    </ul>
    <button
      v-if="cursor"
      :disabled="busy"
      @click="more"
      data-testid="more-transfers"
    >
      更早迁移
    </button>
    <div v-if="selected" data-testid="transfer-detail">
      <h4>{{ statusLabel(selected.status) }}</h4>
      <p>
        项目：{{ selected.projectId }} → {{ selected.orgId }} /
        {{ selected.organizationProjectId }}
      </p>
      <p>原所有者：{{ selected.originalOwnerDid }}</p>
      <p>接收组织所有者：{{ selected.organizationOwnerDid }}</p>
      <p>有效至：{{ timeLabel(selected.expiresAt) }}</p>
      <p v-if="selected.eligibilityReason">
        {{ organizationError({ code: selected.eligibilityReason }) }}
      </p>
      <button
        v-if="selected.canAccept"
        :disabled="busy || unknownAccept === selected.transferId"
        @click="decide('accept')"
        data-testid="accept-transfer"
      >
        本人确认接收
      </button>
      <button
        v-if="selected.canCancel"
        :disabled="busy"
        @click="decide('cancel')"
        data-testid="cancel-transfer"
      >
        撤回转出同意
      </button>
      <button
        v-if="selected.canReject"
        :disabled="busy"
        @click="decide('reject')"
        data-testid="reject-transfer"
      >
        拒绝接收
      </button>
      <p v-if="unknownAccept === selected.transferId" role="status">
        接收结果待核实，请核对记录；系统不会自动重试。
      </p>
      <p v-if="selected.terminalReceipt" data-testid="transfer-receipt">
        已保存{{ statusLabel(selected.status) }}回执。
      </p>
      <button
        :disabled="busy"
        @click="select(selected.transferId)"
        data-testid="read-transfer"
      >
        核对迁移与回执
      </button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  organizationApi,
  organizationAuthorityError,
  organizationSessionError,
  organizationError,
  timeLabel,
} from "./organization-project-ui";
import { actionCode } from "./task-description-ui";
const props = defineProps<{
  projectId: string;
  identityKey?: string;
  sessionRevision?: number;
  policyRevision?: number;
}>();
const emit = defineEmits<{
  (event: "changed"): void;
  (event: "authority-error", value: unknown): void;
}>();
const catalog = shallowRef<any>(null),
  prepared = shallowRef<any>(null),
  selected = shallowRef<any>(null);
const transfers = ref<any[]>([]),
  cursor = ref<string | null>(null),
  error = ref(""),
  busy = ref(false);
const orgId = ref(""),
  organizationProjectId = ref(""),
  attempted = ref(false),
  unknownConsent = ref(""),
  unknownAccept = ref("");
const destination = computed(() =>
  catalog.value?.organizations.find((org: any) => org.id === orgId.value),
);
let privateEpoch = 0;
let epoch = 0,
  selection = 0,
  active = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
function stopTimer() {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
}
function reset() {
  epoch++;
  selection++;
  active = 0;
  stopTimer();
  catalog.value = null;
  prepared.value = null;
  selected.value = null;
  transfers.value = [];
  cursor.value = null;
  orgId.value = "";
  organizationProjectId.value = "";
  attempted.value = false;
  unknownConsent.value = "";
  unknownAccept.value = "";
  busy.value = false;
  error.value = "";
}
function failure(value: unknown) {
  if (organizationAuthorityError(value)) {
    if (organizationSessionError(value)) reset();
    else invalidatePolicy();
    emit("authority-error", value);
  }
  error.value = organizationError(value);
}
function invalidatePolicy() {
  privateEpoch++;
  prepared.value = null;
  catalog.value = null;
  orgId.value = "";
  organizationProjectId.value = "";
  if (selected.value) selected.value = { ...selected.value, canAccept: false };
}
async function work(fn: (token: number) => Promise<void>) {
  const token = epoch;
  active++;
  busy.value = true;
  error.value = "";
  try {
    await fn(token);
  } catch (value) {
    if (token === epoch) failure(value);
  } finally {
    if (token === epoch) busy.value = --active > 0;
  }
}
async function list(more = false) {
  await work(async (token) => {
    const result = await organizationApi().listTransfers({
      projectId: props.projectId,
      limit: 20,
      ...(more && cursor.value ? { beforeId: cursor.value } : {}),
    });
    if (token !== epoch) return;
    transfers.value = more
      ? [
          ...new Map(
            [...transfers.value, ...result.transfers].map((item) => [
              item.transferId,
              item,
            ]),
          ).values(),
        ]
      : result.transfers;
    cursor.value = result.nextCursor;
    const recovered =
      unknownConsent.value &&
      transfers.value.find(
        (item) => item.consentDigest === unknownConsent.value,
      );
    if (recovered) {
      unknownConsent.value = "";
      await select(recovered.transferId);
    }
  });
}
async function refresh(preserve = true) {
  const digest = preserve ? unknownConsent.value : "",
    accepting = preserve ? unknownAccept.value : "",
    selectedId = preserve ? selected.value?.transferId : "";
  reset();
  unknownConsent.value = digest;
  unknownAccept.value = accepting;
  attempted.value = !!digest;
  const privateToken = privateEpoch;
  await work(async (token) => {
    const result = await organizationApi().transferCatalog({
      projectId: props.projectId,
    });
    if (token !== epoch) return;
    if (privateToken === privateEpoch) catalog.value = result;
    await list();
    if (token === epoch && selectedId && !selected.value)
      await select(selectedId);
  });
}
async function more() {
  if (!busy.value) await list(true);
}
async function select(transferId: string) {
  const chosen = ++selection;
  const policyToken = privateEpoch;
  selected.value = null;
  await work(async (token) => {
    const result = await organizationApi().readTransfer({ transferId });
    if (token !== epoch || chosen !== selection || policyToken !== privateEpoch)
      return;
    selected.value = result;
    const recoveredAcceptance =
      unknownAccept.value === transferId && result.status === "bound";
    if (result.status !== "pending" && unknownAccept.value === transferId)
      unknownAccept.value = "";
    if (
      result.eligibilityReason &&
      organizationAuthorityError({ code: result.eligibilityReason })
    )
      emit("authority-error", { code: result.eligibilityReason });
    if (recoveredAcceptance) emit("changed");
  });
}
function newIntent() {
  attempted.value = false;
  prepared.value = null;
}
async function preview() {
  const privateToken = privateEpoch;
  const input = {
    projectId: props.projectId,
    orgId: orgId.value,
    organizationProjectId: organizationProjectId.value,
  };
  await work(async (token) => {
    const result = await organizationApi().previewTransfer(input);
    if (token === epoch && privateToken === privateEpoch)
      prepared.value = { ...result, input };
  });
}
async function submit() {
  if (!prepared.value || attempted.value) return;
  const value = prepared.value;
  attempted.value = true;
  await work(async (token) => {
    try {
      const result = await organizationApi().submitTransfer({
        ...value.input,
        expiresAt: value.expiresAt,
        expectedDigest: value.consentDigest,
      });
      if (token !== epoch) return;
      prepared.value = null;
      if (!result.transferId) {
        attempted.value = false;
        return;
      }
      await list();
      if (token === epoch) await select(result.transferId);
    } catch (valueError) {
      if (token !== epoch) return;
      prepared.value = null;
      if (!/^(ORG_AUTH_|ORG_TRANSFER_)/u.test(actionCode(valueError)))
        unknownConsent.value = value.consentDigest;
      throw valueError;
    }
  });
}
async function decide(decision: "accept" | "cancel" | "reject") {
  const transferId = selected.value?.transferId;
  if (!transferId || busy.value) return;
  if (decision === "accept" && unknownAccept.value === transferId) return;
  await work(async (token) => {
    try {
      const method =
        decision === "accept"
          ? "acceptTransfer"
          : decision === "cancel"
            ? "cancelTransfer"
            : "rejectTransfer";
      const result = await organizationApi()[method]({ transferId });
      if (token !== epoch) return;
      await list();
      if (token !== epoch) return;
      await select(transferId);
      if (result.status === "bound" && token === epoch) emit("changed");
    } catch (value) {
      if (token !== epoch) return;
      if (
        decision === "accept" &&
        !/^(ORG_AUTH_|ORG_TRANSFER_)/u.test(actionCode(value))
      )
        unknownAccept.value = transferId;
      throw value;
    }
  });
}
function statusLabel(status: string) {
  return (
    (
      {
        pending: "等待组织所有者接收",
        bound: "迁移已完成",
        cancelled: "已撤回",
        rejected: "已拒绝接收",
        expired: "已过期",
      } as Record<string, string>
    )[status] || "状态待核实"
  );
}
function permissionLabel(permission: string) {
  return (
    (
      {
        "task.read": "查看任务与提议",
        "task.create": "创建任务",
        "task.update-description": "修改任务描述",
        "task.approve": "审批任务提议",
        "risk.read": "查看项目风险与历史",
        "risk.evaluate": "检查项目风险",
        "risk.feedback": "人工核对风险",
        "goal.read": "查看组织目标",
        "goal.create": "创建组织目标",
        "goal.update": "更新、暂停或结束组织目标",
        "goal.check": "手动检查组织目标风险",
        "goal.monitor": "启用或停止组织目标周期巡检",
        "goal.propose": "准备和提交组织目标任务建议",
        "goal.accept": "组织目标验收检查与人工确认",
        "goal.memory.read": "读取组织目标共享记忆",
        "goal.memory.write": "保存、修正与撤销共享记忆",
        "goal.memory.delete": "删除组织目标共享记忆",
      } as Record<string, string>
    )[permission] || "未知权限"
  );
}
function expire() {
  stopTimer();
  const deadlines = [
    prepared.value?.expiresAt,
    selected.value?.status === "pending" ? selected.value.expiresAt : null,
  ].filter((value) => Number.isFinite(value));
  if (!deadlines.length) return;
  const next = Math.min(...deadlines),
    delay = next - Date.now();
  if (delay > 0) {
    expiryTimer = setTimeout(expire, Math.min(delay, 2147483647));
    return;
  }
  if (prepared.value && prepared.value.expiresAt <= Date.now())
    prepared.value = null;
  if (
    selected.value?.status === "pending" &&
    selected.value.expiresAt <= Date.now()
  )
    selected.value = {
      ...selected.value,
      status: "expired",
      canAccept: false,
      canCancel: false,
      canReject: false,
    };
}
watch(orgId, () => {
  organizationProjectId.value = "";
  prepared.value = null;
});
watch(() => props.sessionRevision, reset, { flush: "sync" });
watch(() => props.policyRevision, invalidatePolicy, { flush: "sync" });
watch(organizationProjectId, () => {
  prepared.value = null;
});
watch([prepared, selected], expire, { flush: "sync" });
watch(
  () => [props.projectId, props.identityKey],
  () => {
    void refresh(false);
  },
  { immediate: true },
);
onBeforeUnmount(reset);
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
p[role="alert"] {
  color: #b42318;
}
p,
li {
  overflow-wrap: anywhere;
}
</style>
