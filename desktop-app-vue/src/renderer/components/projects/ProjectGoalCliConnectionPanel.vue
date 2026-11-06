<template>
  <section v-if="available" data-testid="goal-cli-connection">
    <h5>连接 CLI / IDE 目标摘要</h5>
    <p>
      通过原生确认保存 15 分钟有效的连接文件，供 CLI 和 IDE
      读取此目标说明与状态。
    </p>
    <p v-if="status?.enabled">
      当前连接目标：{{ status.goalRef?.id }}；到期后需重新确认。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-connection"
      @click="act('open')"
    >
      原生确认并保存连接
    </button>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-evidence"
      @click="act('evidence')"
    >
      另行授权风险与回执摘要
    </button>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-events"
      @click="act('events')"
    >
      另行授权风险与动作事件订阅
    </button>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-event-history"
      @click="act('eventHistory')"
    >
      另行授权保留的事件历史
    </button>
    <p>
      历史连接可分页恢复账本启用后保留的事件，过期游标会报告缺口，不会补造旧历史。
    </p>
    <p>
      事件连接仅供轮询检查与回执摘要，不含目标说明，没有历史重放。停止连接即可撤销后续读取。
    </p>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-drafts"
      @click="act('drafts')"
    >
      另行授权在线待审草稿连接
    </button>
    <p>
      在线提议仅保存待审草稿。停止连接后可继续在桌面处理；在来源授权区撤权会使旧草稿及未确认预览失效。
    </p>
    <button
      :disabled="busy || goal.status !== 'active'"
      data-testid="open-goal-cli-create-drafts"
      @click="act('createDrafts')"
    >
      另行授权在线创建任务待审连接
    </button>
    <p>
      创建提议使用独立授权，不沿用说明草稿连接；保存后仍须当前预览与逐次原生确认。
    </p>
    <button
      v-if="status?.enabled"
      :disabled="busy"
      data-testid="close-goal-cli-connection"
      @click="act('close')"
    >
      停止当前 CLI / IDE 连接
    </button>
    <button
      :disabled="busy"
      data-testid="refresh-goal-cli-connection"
      @click="act('status')"
    >
      刷新连接状态
    </button>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
type Goal = {
  id: string;
  storeId?: string;
  revision: number;
  controlGeneration?: number;
  status: string;
};
type Status = {
  enabled: boolean;
  expiresAt: number | null;
  goalRef: { id: string } | null;
};
const props = defineProps<{ goal: Goal; identityKey?: string }>();
const api = () => (window as any).electronAPI?.project;
const available = computed(
  () =>
    !!props.goal.storeId &&
    Number.isSafeInteger(props.goal.controlGeneration) &&
    [
      "openGoalCliConnection",
      "closeGoalCliConnection",
      "getGoalCliConnectionStatus",
    ].every((key) => typeof api()?.[key] === "function"),
);
const status = ref<Status | null>(null),
  busy = ref(false),
  error = ref("");
let generation = 0;
async function act(
  method:
    | "open"
    | "evidence"
    | "drafts"
    | "createDrafts"
    | "events"
    | "eventHistory"
    | "close"
    | "status",
) {
  if (!available.value || busy.value) return;
  const stamp = generation;
  busy.value = true;
  error.value = "";
  status.value = null;
  try {
    const result =
      method === "open" ||
      method === "evidence" ||
      method === "drafts" ||
      method === "createDrafts" ||
      method === "events" ||
      method === "eventHistory"
        ? await api().openGoalCliConnection({
            goalRef: {
              id: props.goal.id,
              storeId: props.goal.storeId,
              revision: props.goal.revision,
              controlGeneration: props.goal.controlGeneration,
            },
            ...(method === "evidence" ? { evidence: true } : {}),
            ...(method === "drafts" ? { drafts: true } : {}),
            ...(method === "createDrafts" ? { createDrafts: true } : {}),
            ...(method === "events" ? { events: true } : {}),
            ...(method === "eventHistory" ? { eventHistory: true } : {}),
          })
        : method === "close"
          ? await api().closeGoalCliConnection()
          : await api().getGoalCliConnectionStatus();
    if (stamp !== generation) return;
    status.value = result;
  } catch {
    if (stamp === generation)
      error.value =
        "连接未建立或已失效，请刷新核对；请在本机私有连接目录中选择不存在的文件。";
  } finally {
    if (stamp === generation) busy.value = false;
  }
}
watch(
  [
    () => props.goal.id,
    () => props.goal.storeId,
    () => props.goal.revision,
    () => props.goal.controlGeneration,
    () => props.goal.status,
    () => props.identityKey,
  ],
  () => {
    generation++;
    status.value = null;
    busy.value = false;
    error.value = "";
    void act("status");
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
