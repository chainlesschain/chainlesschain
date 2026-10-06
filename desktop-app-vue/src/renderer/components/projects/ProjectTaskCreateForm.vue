<template>
  <section class="task-create" data-testid="controlled-task-create">
    <h3>创建项目任务</h3>
    <p>保存为待处理任务，需本人确认。保存后不会自动执行。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <label
      >任务类型
      <select v-model="taskType" :disabled="busy || attempted">
        <option v-for="[value, label] in taskTypes" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
    </label>
    <label
      >任务描述<textarea
        v-model="description"
        rows="3"
        :disabled="busy || attempted"
        data-testid="create-description"
      />
    </label>
    <p>{{ bytes }} / 8192 字节</p>
    <button
      :disabled="
        busy || attempted || uncertain || bytes > 8192 || !description.trim()
      "
      @click="preview"
      data-testid="preview-create"
    >
      预览创建
    </button>
    <div v-if="prepared" data-testid="create-preview">
      <pre>{{ prepared.after.description }}</pre>
      <button
        :disabled="busy || attempted"
        @click="execute"
        data-testid="execute-create"
      >
        确认创建
      </button>
    </div>
    <p v-if="uncertain" role="status">
      创建结果待核实，请刷新记录。系统不会自动重试。
    </p>
    <button :disabled="busy" @click="refresh" data-testid="refresh-create-runs">
      刷新创建记录
    </button>
    <button
      v-if="attempted && !uncertain"
      :disabled="busy"
      @click="newIntent"
      data-testid="new-create-intent"
    >
      开始新的创建
    </button>
    <ol>
      <li v-for="item in runs" :key="item.run.id">
        {{ runLabel(item.run.status) }} ·
        {{ item.run.completedAt || item.run.startedAt }}
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  actionCode,
  isAuthorityError,
  isDefiniteActionRejection,
  runLabel,
  unresolved,
  type ActionReceipt,
  type DescriptionPreview,
} from "./task-description-ui";
const props = defineProps<{ projectId: string; identityKey?: string }>();
const emit = defineEmits<{
  (event: "created"): void;
  (event: "authority-error", error: unknown): void;
}>();
type Api = {
  previewControlledCreate(input: {
    projectId: string;
    taskType: string;
    description: string;
    idempotencyKey: string;
  }): Promise<DescriptionPreview>;
  executeControlledCreate(input: {
    request: DescriptionPreview["request"];
  }): Promise<ActionReceipt>;
  listControlledCreateRuns(input: {
    projectId: string;
    limit: number;
  }): Promise<{ runs: ActionReceipt[] }>;
};
function api() {
  return (window as unknown as { electronAPI: { task: Api } }).electronAPI.task;
}
const taskTypes = [
  ["query_info", "信息查询"],
  ["analyze_data", "数据分析"],
  ["create_file", "创建文件"],
  ["edit_file", "编辑文件"],
  ["export_file", "导出文件"],
  ["deploy_project", "项目部署"],
];
const taskType = ref("query_info"),
  description = ref(""),
  error = ref("");
const busy = ref(false),
  attempted = ref(false),
  uncertain = ref(false);
const prepared = shallowRef<DescriptionPreview | null>(null),
  runs = ref<ActionReceipt[]>([]);
const bytes = computed(
  () => new TextEncoder().encode(description.value).length,
);
let epoch = 0,
  key = "",
  digest = "";
function fail(value: unknown) {
  if (isAuthorityError(value)) {
    epoch++;
    prepared.value = null;
    runs.value = [];
    description.value = "";
    emit("authority-error", value);
  } else
    error.value =
      actionCode(value) === "ACTION_UNRESOLVED_ACTION"
        ? "此前创建尚待核实，暂不能再次创建。"
        : "操作未完成，请刷新创建记录后核实。";
}
function newIntent() {
  if (busy.value || uncertain.value) return;
  attempted.value = false;
  prepared.value = null;
  description.value = "";
  key = "";
  digest = "";
  error.value = "";
}
async function refresh() {
  if (busy.value) return;
  const stamp = epoch;
  busy.value = true;
  try {
    const result = await api().listControlledCreateRuns({
      projectId: props.projectId,
      limit: 50,
    });
    if (stamp !== epoch) return;
    runs.value = result.runs;
    const matching = result.runs.find(
      (item) => item.run.invocationDigest === digest,
    );
    uncertain.value = result.runs.some(unresolved) || (!!digest && !matching);
  } catch (value) {
    if (stamp === epoch) fail(value);
  } finally {
    if (stamp === epoch) busy.value = false;
  }
}
async function preview() {
  if (
    busy.value ||
    attempted.value ||
    uncertain.value ||
    bytes.value > 8192 ||
    !description.value.trim()
  )
    return;
  const stamp = epoch;
  busy.value = true;
  error.value = "";
  prepared.value = null;
  try {
    key ||= crypto.randomUUID();
    const result = await api().previewControlledCreate({
      projectId: props.projectId,
      taskType: taskType.value,
      description: description.value,
      idempotencyKey: key,
    });
    if (stamp === epoch) prepared.value = result;
  } catch (value) {
    if (stamp === epoch) fail(value);
  } finally {
    if (stamp === epoch) busy.value = false;
  }
}
async function execute() {
  if (busy.value || attempted.value || !prepared.value) return;
  const stamp = epoch,
    request = prepared.value.request;
  attempted.value = true;
  busy.value = true;
  digest = request.invocationDigest;
  uncertain.value = true;
  error.value = "";
  try {
    const result = await api().executeControlledCreate({ request });
    if (stamp !== epoch) return;
    runs.value = [
      result,
      ...runs.value.filter((item) => item.run.id !== result.run.id),
    ];
    uncertain.value = unresolved(result);
    if (result.run.status === "succeeded") emit("created");
  } catch (value) {
    if (stamp === epoch) {
      if (isDefiniteActionRejection(value)) {
        uncertain.value = false;
        digest = "";
      }
      fail(value);
    }
  } finally {
    if (stamp === epoch) busy.value = false;
  }
}
watch([description, taskType], () => {
  if (!attempted.value) {
    prepared.value = null;
    key = "";
  }
});
watch(
  () => [props.projectId, props.identityKey],
  () => {
    epoch++;
    busy.value = false;
    attempted.value = false;
    uncertain.value = false;
    prepared.value = null;
    runs.value = [];
    description.value = "";
    error.value = "";
    key = "";
    digest = "";
    void refresh();
  },
  { immediate: true, flush: "sync" },
);
onBeforeUnmount(() => {
  epoch++;
});
</script>

<style scoped>
.task-create {
  border-top: 1px solid #e2e8f0;
  margin-top: 20px;
  padding-top: 16px;
}
label {
  display: block;
  margin: 12px 0;
}
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
}
button {
  margin-right: 8px;
  margin-bottom: 8px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
p {
  font-size: 12px;
  color: #64748b;
}
</style>
