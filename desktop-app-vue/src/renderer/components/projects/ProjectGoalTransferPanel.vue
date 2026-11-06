<template>
  <section v-if="available" data-testid="goal-transfer-panel">
    <h4>CLI 目标移交</h4>
    <p>
      先导出项目导入凭据，再在 CLI
      冻结目标并导出移交文件，最后在此导入。原始备份和 ID
      映射保留；新目标保持暂停。
    </p>
    <button
      :disabled="busy"
      data-testid="goal-transfer-target"
      @click="exportTarget()"
    >
      导出导入凭据
    </button>
    <button
      :disabled="busy"
      data-testid="goal-transfer-import"
      @click="run('import')"
    >
      选择并导入移交文件
    </button>
    <button
      :disabled="busy"
      data-testid="goal-transfer-refresh"
      @click="load()"
    >
      刷新移交记录
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <ul>
      <li v-for="record in records" :key="record.target.id">
        <code>{{ record.target.id }}</code
        >：{{ label(record.state) }}
        <span v-if="record.source"
          >；来源 {{ record.source.id }} / revision
          {{ record.source.revision }}</span
        >
        <span v-if="record.goalRef">；项目目标 {{ record.goalRef.id }}</span>
        <button
          v-if="record.state === 'prepared'"
          :disabled="busy"
          @click="exportTarget(record.target.id)"
        >
          重新导出凭据
        </button>
        <button
          :disabled="busy"
          data-testid="goal-transfer-cancel"
          @click="run('cancel', record.target.id)"
        >
          {{
            record.state === "cancelled"
              ? "重新导出回退回执"
              : "作废并导出回退回执"
          }}
        </button>
      </li>
    </ul>
    <button
      v-if="records.length === 20"
      :disabled="busy"
      data-testid="goal-transfer-more"
      @click="load(records[records.length - 1].target.id)"
    >
      下一页移交记录
    </button>
    <p>
      失败或超时后请刷新同一记录并检查已选文件。只有作废导入且目标没有后续数据时，CLI
      才能凭签名回执恢复原文件。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { isAuthorityError } from "./task-description-ui";
type Transfer = {
  target: { id: string; projectRef: { id: string }; ownerRef: string };
  state: "prepared" | "imported" | "cancelled";
  source: { id: string; revision: number } | null;
  goalRef: { id: string } | null;
};
type Api = {
  exportGoalTransferTarget(input: {
    projectId: string;
    requestId?: string;
  }): Promise<Transfer>;
  importGoalTransfer(input: { projectId: string }): Promise<Transfer>;
  listGoalTransfers(input: {
    projectId: string;
    afterId: string;
  }): Promise<Transfer[]>;
  cancelGoalTransfer(input: {
    projectId: string;
    targetId: string;
  }): Promise<Transfer>;
};
const props = defineProps<{ projectId: string; identityKey?: string }>();
const emit = defineEmits<{
  (e: "changed"): void;
  (e: "authority-error"): void;
}>();
const api = () =>
  (window as unknown as { electronAPI?: { project?: Api } }).electronAPI
    ?.project;
const available = computed(() =>
  [
    "exportGoalTransferTarget",
    "importGoalTransfer",
    "listGoalTransfers",
    "cancelGoalTransfer",
  ].every((k) => typeof api()?.[k as keyof Api] === "function"),
);
const records = ref<Transfer[]>([]),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
let epoch = 0,
  mounted = true;
const current = (stamp: number) => mounted && stamp === epoch;
const label = (state: Transfer["state"]) =>
  ({
    prepared: "等待移交文件",
    imported: "已导入，保留来源备份",
    cancelled: "已作废，回退回执可重新导出",
  })[state];
function validate(record: Transfer) {
  if (
    !record?.target ||
    record.target.projectRef?.id !== props.projectId ||
    !record.target.id ||
    !label(record.state)
  )
    throw new Error("GOAL_TRANSFER_TARGET_MISMATCH");
}
function failure(value: unknown) {
  records.value = [];
  notice.value = "";
  if (isAuthorityError(value)) {
    epoch++;
    busy.value = false;
    emit("authority-error");
    error.value = "当前身份已无法访问移交记录。";
  } else
    error.value =
      "操作结果尚未核实。请刷新同一移交记录并检查已选文件；不要重新冻结或恢复来源。";
}
async function fetchRows(afterId = "") {
  const result = await api()!.listGoalTransfers({
    projectId: props.projectId,
    afterId,
  });
  if (!Array.isArray(result) || result.length > 20)
    throw new Error("GOAL_TRANSFER_INVALID");
  result.forEach(validate);
  return result;
}
async function load(afterId = "") {
  if (!available.value || busy.value) return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  notice.value = "";
  records.value = [];
  try {
    const result = await fetchRows(afterId);
    if (current(stamp)) records.value = result;
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
async function exportTarget(requestId?: string) {
  await run("export", requestId);
}
async function run(kind: "export" | "import" | "cancel", id?: string) {
  if (busy.value || !available.value) return;
  const stamp = epoch,
    projectId = props.projectId;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result =
      kind === "export"
        ? await api()!.exportGoalTransferTarget({
            projectId,
            ...(id ? { requestId: id } : {}),
          })
        : kind === "import"
          ? await api()!.importGoalTransfer({ projectId })
          : await api()!.cancelGoalTransfer({ projectId, targetId: id! });
    if (!current(stamp)) return;
    // Native cancellation of a picker/confirmation has no target descriptor.
    if (!result?.target && result?.state === "cancelled") return;
    validate(result);
    if (kind !== "export") emit("changed");
    const rows = await fetchRows();
    if (!current(stamp)) return;
    records.value = rows;
    notice.value =
      kind === "export"
        ? "项目导入凭据已保存。请停止原 CLI 运行后显式移交目标。"
        : kind === "import"
          ? "移交记录已核实。新导入目标保持暂停；已有目标的状态保持当前值。"
          : "导入凭据已作废，签名回退回执已保存。请在 CLI 显式恢复原目标。";
  } catch (value) {
    if (current(stamp)) failure(value);
  } finally {
    if (current(stamp)) busy.value = false;
  }
}
watch(
  () => [props.projectId, props.identityKey],
  () => {
    epoch++;
    records.value = [];
    error.value = "";
    notice.value = "";
    busy.value = false;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  mounted = false;
  epoch++;
  records.value = [];
});
</script>
