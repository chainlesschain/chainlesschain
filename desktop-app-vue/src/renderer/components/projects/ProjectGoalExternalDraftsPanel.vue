<template>
  <section v-if="available" data-testid="goal-external-drafts">
    <h5>在线来源授权与待审草稿</h5>
    <p>
      来源名称是连接持有者使用的标签。断开连接保留草稿；撤销来源授权使旧草稿和未确认预览失效，已完成操作保留回执。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      :disabled="busy"
      data-testid="refresh-external-grants"
      @click="loadGrants(false)"
    >
      刷新来源授权
    </button>
    <article v-for="entry in grants" :key="entry.id">
      <strong
        >{{ entry.plugin.name }} · {{ entry.plugin.scope }} ·
        {{ entry.plugin.version }}</strong
      >
      <p>
        {{ entry.enabled ? "已授权" : "已撤权" }}；已保存
        {{ entry.savedCount }} 份；代次 {{ entry.epoch }}
      </p>
      <button
        :disabled="busy || !entry.enabled"
        data-testid="read-external-grant"
        @click="loadDrafts(entry, false)"
      >
        核对待审草稿
      </button>
      <button
        :disabled="busy || !entry.enabled"
        data-testid="revoke-external-grant"
        @click="revoke(entry)"
      >
        撤销此来源授权
      </button>
    </article>
    <button v-if="grantCursor" :disabled="busy" @click="loadGrants(true)">
      更多来源
    </button>
    <div v-if="selectedGrant">
      <p>
        来源：{{ selectedGrant.plugin.name }}；{{ unavailableCount }}
        份草稿当前来源不可继续。
      </p>
      <article v-for="draft in drafts" :key="draft.id">
        <strong>{{ draft.proposal.title }}</strong>
        <button
          :disabled="busy"
          data-testid="read-external-draft"
          @click="read(draft.id)"
        >
          核对正文
        </button>
      </article>
      <button
        v-if="draftCursor"
        :disabled="busy"
        @click="loadDrafts(selectedGrant, true)"
      >
        更多草稿
      </button>
    </div>
    <div v-if="selected" data-testid="external-draft-body">
      <pre>{{ selected.proposal.description }}</pre>
      <button
        :disabled="busy || goal.status !== 'active'"
        data-testid="prepare-external-draft"
        @click="prepare"
      >
        建立或继续本次原生预览
      </button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { actionCode, isAuthorityError } from "./task-description-ui";
type Goal = {
  id: string;
  storeId?: string;
  revision: number;
  controlGeneration?: number;
  status: string;
};
type Grant = {
  id: string;
  epoch: number;
  enabled: boolean;
  savedCount: number;
  plugin: { name: string; scope: string; version: string };
};
const props = defineProps<{
  goal: Goal;
  identityKey?: string;
  sourceKey?: string;
}>();
const emit = defineEmits<{
  (event: "extension-invalidated"): void;
  (event: "intent-prepared"): void;
  (event: "authority-error"): void;
}>();
const api = () => (window as any).electronAPI?.project;
const available = computed(
  () =>
    !!props.goal.storeId &&
    Number.isSafeInteger(props.goal.controlGeneration) &&
    [
      "listGoalExternalDraftGrants",
      "revokeGoalExternalDraftGrant",
      "listGoalExternalDrafts",
      "readGoalExternalDraft",
      "prepareGoalExternalDraft",
    ].every((key) => typeof api()?.[key] === "function"),
);
const grants = ref<Grant[]>([]),
  selectedGrant = ref<Grant | null>(null),
  drafts = ref<any[]>([]),
  selected = ref<any>(null),
  grantCursor = ref<string | null>(null),
  draftCursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  unavailableCount = ref(0);
let generation = 0;
const goalRef = () => ({
  id: props.goal.id,
  storeId: props.goal.storeId,
  revision: props.goal.revision,
  controlGeneration: props.goal.controlGeneration,
});
function clearDrafts() {
  selectedGrant.value = null;
  drafts.value = [];
  selected.value = null;
  draftCursor.value = null;
  unavailableCount.value = 0;
}
async function perform(
  operation: () => Promise<any>,
  done: (result: any) => void,
) {
  if (!available.value || busy.value) return;
  const stamp = ++generation;
  busy.value = true;
  error.value = "";
  selected.value = null;
  try {
    const result = await operation();
    if (stamp === generation) done(result);
  } catch (cause) {
    if (stamp === generation) {
      clearDrafts();
      emit("extension-invalidated");
      error.value = `操作未确认，请刷新核对：${actionCode(cause) || "读取失败"}`;
      if (isAuthorityError(cause)) {
        grants.value = [];
        emit("authority-error");
      }
    }
  } finally {
    if (stamp === generation) busy.value = false;
  }
}
async function loadGrants(more = false) {
  if (busy.value) return;
  clearDrafts();
  if (!more) grants.value = [];
  await perform(
    () =>
      api().listGoalExternalDraftGrants({
        goalRef: goalRef(),
        ...(more && grantCursor.value ? { afterId: grantCursor.value } : {}),
      }),
    (page) => {
      grants.value = more ? [...grants.value, ...page.entries] : page.entries;
      grantCursor.value = page.nextCursor;
    },
  );
}
async function loadDrafts(entry: Grant, more = false) {
  if (busy.value) return;
  selected.value = null;
  if (!more) {
    drafts.value = [];
    draftCursor.value = null;
  }
  selectedGrant.value = entry;
  await perform(
    () =>
      api().listGoalExternalDrafts({
        goalRef: goalRef(),
        id: entry.id,
        ...(more && draftCursor.value ? { afterId: draftCursor.value } : {}),
      }),
    (page) => {
      drafts.value = more ? [...drafts.value, ...page.entries] : page.entries;
      draftCursor.value = page.nextCursor;
      unavailableCount.value = page.unavailableCount;
    },
  );
}
async function revoke(entry: Grant) {
  if (busy.value) return;
  emit("extension-invalidated");
  clearDrafts();
  await perform(
    () =>
      api().revokeGoalExternalDraftGrant({
        goalRef: goalRef(),
        id: entry.id,
        expectedEpoch: entry.epoch,
      }),
    (result) => {
      grants.value = grants.value.map((row) =>
        row.id === result.id ? result : row,
      );
      emit("extension-invalidated");
    },
  );
}
async function read(draftId: string) {
  const id = selectedGrant.value?.id;
  if (!id) return;
  await perform(
    () => api().readGoalExternalDraft({ goalRef: goalRef(), id, draftId }),
    (result) => {
      selected.value = result;
    },
  );
}
async function prepare() {
  const id = selectedGrant.value?.id,
    draftId = selected.value?.id;
  if (!id || !draftId || busy.value) return;
  emit("extension-invalidated");
  await perform(
    () => api().prepareGoalExternalDraft({ goalRef: goalRef(), id, draftId }),
    () => {
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
    grantCursor.value = null;
    clearDrafts();
    void loadGrants();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
