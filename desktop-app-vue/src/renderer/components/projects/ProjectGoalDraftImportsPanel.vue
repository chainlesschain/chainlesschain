<template>
  <section v-if="available" data-testid="goal-draft-imports">
    <h5>采纳外部任务说明请求</h5>
    <p>
      选择 CLI / IDE
      导出的请求文件，逐份核对完整正文后采纳。文件声明的插件来源未经代码鉴定；修改任务还需当前预览和原生确认。
    </p>
    <label v-for="source in sourceRefs || []" :key="source"
      >可用于导出的当前原生风险来源 ID：<input
        readonly
        :value="source"
        @focus="($event.target as HTMLInputElement).select()"
    /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="hint">{{ hint }}</p>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="import-draft-request"
      @click="adopt"
    >
      选择文件并原生采纳
    </button>
    <button
      :disabled="busy"
      data-testid="refresh-draft-imports"
      @click="load(false)"
    >
      刷新采纳记录
    </button>
    <article v-for="entry in entries" :key="entry.id">
      <strong>{{ entry.title }}</strong>
      <p>
        请求声明：{{ entry.declaredPlugin.name }} ·
        {{ entry.declaredPlugin.scope }} ·
        {{ entry.declaredPlugin.version }}；{{
          entry.state === "revoked"
            ? "已撤销采纳"
            : entry.available
              ? "已保存，待核对"
              : "此前已保存，当前来源不可继续"
        }}
      </p>
      <p>请求：{{ entry.requestId }}；采纳记录：{{ entry.id }}</p>
      <button
        :disabled="busy || !entry.available"
        data-testid="read-imported-draft"
        @click="read(entry)"
      >
        重新核对草稿
      </button>
      <button
        :disabled="busy || !entry.enabled"
        data-testid="revoke-imported-draft"
        @click="revoke(entry)"
      >
        撤销此份采纳
      </button>
    </article>
    <div v-if="selected" data-testid="imported-draft-body">
      <pre>{{ selected.draft.proposal.description }}</pre>
      <button
        :disabled="busy || !selected.available"
        data-testid="prepare-imported-draft"
        @click="prepare"
      >
        建立或继续本次原生预览
      </button>
    </div>
    <button
      v-if="cursor"
      :disabled="busy"
      data-testid="more-draft-imports"
      @click="load(true)"
    >
      更多采纳记录
    </button>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = {
  id: string;
  storeId?: string;
  revision: number;
  controlGeneration?: number;
  status: string;
};
type Entry = {
  id: string;
  title: string;
  requestId: string;
  enabled: boolean;
  epoch: number;
  available: boolean;
  state: string;
  declaredPlugin: { name: string; scope: string; version: string };
};
const props = defineProps<{
  goal: Goal;
  identityKey?: string;
  sourceRefs?: string[];
  sourceKey?: string;
}>();
const emit = defineEmits<{
  (event: "intent-prepared"): void;
  (event: "extension-invalidated"): void;
  (event: "authority-error"): void;
}>();
const api = () => (window as any).electronAPI?.project;
const available = computed(
  () =>
    !!props.goal.storeId &&
    Number.isSafeInteger(props.goal.controlGeneration) &&
    [
      "importGoalDraftRequest",
      "listGoalDraftImports",
      "readGoalDraftImport",
      "prepareGoalDraftImport",
      "revokeGoalDraftImport",
    ].every((name) => typeof api()?.[name] === "function"),
);
const entries = ref<Entry[]>([]),
  selected = ref<any>(null),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  hint = ref("");
let generation = 0;
const goalRef = () => ({
  id: props.goal.id,
  storeId: props.goal.storeId,
  revision: props.goal.revision,
  controlGeneration: props.goal.controlGeneration,
});
function clear() {
  entries.value = [];
  selected.value = null;
  cursor.value = null;
  hint.value = "";
}
function failed(cause: any) {
  selected.value = null;
  emit("extension-invalidated");
  error.value = `操作未确认，请刷新记录核对：${actionCode(cause) || "读取失败"}`;
  if (isAuthorityError(cause)) {
    clear();
    emit("authority-error");
  }
}
async function load(more = false) {
  if (!available.value || busy.value) return;
  const stamp = ++generation;
  busy.value = true;
  error.value = "";
  selected.value = null;
  if (!more) entries.value = [];
  try {
    const page = await api().listGoalDraftImports({
      goalRef: goalRef(),
      ...(more && cursor.value ? { afterId: cursor.value } : {}),
    });
    if (stamp !== generation) return;
    entries.value = more ? [...entries.value, ...page.entries] : page.entries;
    cursor.value = page.nextCursor;
  } catch (cause) {
    if (stamp === generation) {
      clear();
      failed(cause);
    }
  } finally {
    if (stamp === generation) busy.value = false;
  }
}
async function perform(
  operation: () => Promise<any>,
  done: (result: any) => void,
) {
  if (!available.value || busy.value) return;
  const stamp = ++generation;
  busy.value = true;
  error.value = "";
  hint.value = "";
  selected.value = null;
  try {
    const result = await operation();
    if (stamp !== generation) return;
    done(result);
  } catch (cause) {
    if (stamp === generation) failed(cause);
  } finally {
    if (stamp === generation) busy.value = false;
  }
}
async function adopt() {
  let refresh = false;
  await perform(
    () => api().importGoalDraftRequest({ goalRef: goalRef() }),
    (result) => {
      if (result.state !== "cancelled") {
        hint.value =
          result.state === "revoked"
            ? "此请求的采纳已撤销，重新导入不会恢复。"
            : "请求已保存；请核对记录，再建立当前预览。";
        refresh = true;
      }
    },
  );
  if (refresh) await load(false);
}
async function read(entry: Entry) {
  await perform(
    () => api().readGoalDraftImport({ goalRef: goalRef(), id: entry.id }),
    (result) => {
      selected.value = result;
    },
  );
}
async function revoke(entry: Entry) {
  emit("extension-invalidated");
  let refresh = false;
  await perform(
    () =>
      api().revokeGoalDraftImport({
        goalRef: goalRef(),
        id: entry.id,
        expectedEpoch: entry.epoch,
      }),
    () => {
      emit("extension-invalidated");
      refresh = true;
    },
  );
  if (refresh) await load(false);
}
async function prepare() {
  const id = selected.value?.id;
  if (!id) return;
  emit("extension-invalidated");
  await perform(
    () => api().prepareGoalDraftImport({ goalRef: goalRef(), id }),
    () => {
      hint.value = "原生预览已建立，请在目标建议区核对修改前后正文并原生确认。";
      emit("extension-invalidated");
      emit("intent-prepared");
    },
  );
}
watch(
  [
    () => props.goal.id,
    () => props.goal.storeId,
    () => props.goal.revision,
    () => props.goal.controlGeneration,
    () => props.goal.status,
    () => props.identityKey,
    () => props.sourceKey,
  ],
  () => {
    generation++;
    busy.value = false;
    error.value = "";
    clear();
    void load(false);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
