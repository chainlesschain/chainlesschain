<template>
  <a-drawer
    :open="open"
    title="返回产物"
    placement="right"
    :width="680"
    @close="emit('update:open', false)"
  >
    <template #extra>
      <a-button size="small" :loading="loading" @click="refresh">
        刷新
      </a-button>
    </template>

    <a-alert
      v-if="errorMessage"
      class="artifact-alert"
      type="error"
      show-icon
      :message="errorMessage"
    />

    <a-alert
      v-if="workbench?.recovery.summary.itemCount"
      class="artifact-alert"
      type="warning"
      show-icon
      message="发现待人工复核的恢复项"
      :description="recoverySummary"
    />

    <section v-if="workbench" class="artifact-section">
      <div class="section-heading">
        <strong>交付物</strong>
        <span class="muted">{{ workbench.artifacts.length }} 项</span>
      </div>

      <a-empty
        v-if="workbench.artifacts.length === 0"
        description="暂无返回产物"
      />
      <a-list v-else item-layout="vertical" :data-source="workbench.artifacts">
        <template #renderItem="{ item }">
          <a-list-item class="artifact-card">
            <template #actions>
              <a-button
                type="link"
                size="small"
                :loading="isBusy(`open:${item.id}`)"
                @click="openArtifact(item.id)"
              >
                打开
              </a-button>
              <a-button
                type="link"
                size="small"
                :loading="isBusy(`download:${item.id}`)"
                @click="downloadArtifact(item.id)"
              >
                下载
              </a-button>
              <a-button
                danger
                type="link"
                size="small"
                :loading="isBusy(`remove:${item.id}`)"
                @click="confirmRemove(item)"
              >
                删除
              </a-button>
            </template>

            <a-list-item-meta :description="artifactDescription(item)">
              <template #title>
                <span>{{ item.title }}</span>
                <a-tag class="artifact-kind">{{ item.kind }}</a-tag>
              </template>
            </a-list-item-meta>

            <div class="metadata-grid">
              <span>Artifact: {{ item.id }}</span>
              <span>Session: {{ item.sessionId || "—" }}</span>
              <span>Record: {{ shortArtifactDigest(item.recordDigest) }}</span>
              <span>SHA-256: {{ shortArtifactDigest(item.sha256) }}</span>
              <span>访问审计: {{ item.history.accessCount }} 次</span>
              <span v-if="item.history.latestAccess">
                最近访问: {{ item.history.latestAccess.client }} /
                {{ item.history.latestAccess.action }}
              </span>
            </div>

            <div v-if="item.returnedResult" class="lineage-box">
              <strong>返回结果链路</strong>
              <div class="metadata-grid">
                <span>Request: {{ item.returnedResult.requestId }}</span>
                <span>Item: {{ item.returnedResult.item }}</span>
                <span>Kind: {{ item.returnedResult.kind }}</span>
                <span>
                  Review:
                  {{ shortArtifactDigest(item.returnedResult.reviewDigest) }}
                </span>
                <span>
                  Source:
                  {{ shortArtifactDigest(item.returnedResult.sourceDigest) }}
                </span>
              </div>
            </div>
          </a-list-item>
        </template>
      </a-list>
    </section>

    <section v-if="workbench?.recovery.items.length" class="artifact-section">
      <div class="section-heading">
        <strong>恢复复核</strong>
        <span class="muted">
          计划 {{ shortArtifactDigest(workbench.recovery.planDigest) }}
        </span>
      </div>
      <a-list :data-source="workbench.recovery.items">
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button
                :danger="item.recommendedDecision === 'delete-orphan'"
                size="small"
                :loading="isBusy(`recovery:${item.itemId}`)"
                @click="confirmRecovery(item)"
              >
                {{ recoveryDecisionLabel(item.recommendedDecision) }}
              </a-button>
            </template>
            <a-list-item-meta>
              <template #title>{{ item.kind }}</template>
              <template #description>
                {{ item.severity }}
                <span v-if="item.timedOut"> · 已超时</span>
                · {{ item.itemId }}
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </section>

    <section v-if="workbench" class="artifact-section">
      <a-collapse ghost>
        <a-collapse-panel key="history" :header="historyTitle">
          <a-empty
            v-if="workbench.history.activity.length === 0"
            description="暂无产物审计事件"
          />
          <a-timeline v-else>
            <a-timeline-item
              v-for="event in workbench.history.activity"
              :key="event.eventDigest || event.settlementId"
            >
              <div>{{ activityTitle(event) }}</div>
              <div class="muted">
                {{ formatDate(event.occurredAt) }} ·
                {{ shortArtifactDigest(event.eventDigest) }}
              </div>
            </a-timeline-item>
          </a-timeline>
        </a-collapse-panel>
      </a-collapse>
    </section>
  </a-drawer>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Modal, message } from "ant-design-vue";
import {
  formatArtifactBytes,
  recoveryDecisionLabel,
  shapeArtifactWorkbench,
  shortArtifactDigest,
} from "./artifact-workbench-utils.js";

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["update:open"]);

const POLL_INTERVAL_MS = 15_000;
const workbench = ref(null);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref("");
const busyKeys = ref(new Set());
let pollTimer = null;

const recoverySummary = computed(() => {
  const summary = workbench.value?.recovery.summary;
  if (!summary) {
    return "";
  }
  return `${summary.itemCount} 项待复核，${summary.criticalCount} 项严重，${summary.timedOutCount} 项超时。启动扫描不会自动修改产物。`;
});

const historyTitle = computed(() => {
  const history = workbench.value?.history;
  if (!history) {
    return "已验证审计历史";
  }
  return `已验证审计历史 · ${history.totalEventCount} 条${history.truncated ? "（显示最近 200 条）" : ""}`;
});

function api() {
  return window.electronAPI?.codingAgent;
}

function setBusy(key, value) {
  const next = new Set(busyKeys.value);
  if (value) {
    next.add(key);
  } else {
    next.delete(key);
  }
  busyKeys.value = next;
}

function isBusy(key) {
  return busyKeys.value.has(key);
}

async function refresh({ quiet = false } = {}) {
  if (refreshing.value) {
    return;
  }
  const codingAgent = api();
  if (!codingAgent?.getArtifactWorkbench) {
    errorMessage.value = "当前 Desktop 版本不支持返回产物工作台";
    return;
  }
  refreshing.value = true;
  if (!quiet) {
    loading.value = true;
  }
  try {
    const result = await codingAgent.getArtifactWorkbench();
    const shaped = result?.success
      ? shapeArtifactWorkbench(result.workbench)
      : null;
    if (!shaped) {
      throw new Error(result?.error || "返回产物数据校验失败");
    }
    workbench.value = shaped;
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error?.message || "返回产物工作台不可用";
  } finally {
    refreshing.value = false;
    if (!quiet) {
      loading.value = false;
    }
  }
}

async function runArtifactAction(key, invoke, successText) {
  setBusy(key, true);
  try {
    const result = await invoke();
    if (!result?.success) {
      throw new Error(result?.error || "操作未完成");
    }
    if (!result.canceled) {
      message.success(successText);
    }
    await refresh({ quiet: true });
  } catch (error) {
    message.error(error?.message || "操作失败");
  } finally {
    setBusy(key, false);
  }
}

function openArtifact(artifactId) {
  return runArtifactAction(
    `open:${artifactId}`,
    () => api().openArtifact({ artifactId }),
    "已通过审计授权打开产物",
  );
}

function downloadArtifact(artifactId) {
  return runArtifactAction(
    `download:${artifactId}`,
    () => api().downloadArtifact({ artifactId }),
    "产物已下载",
  );
}

function confirmRemove(item) {
  Modal.confirm({
    title: "删除托管产物？",
    content: `将删除“${item.title}”的托管副本并记录不可抵赖的结算事件。`,
    okText: "确认删除",
    okType: "danger",
    cancelText: "取消",
    onOk: () =>
      runArtifactAction(
        `remove:${item.id}`,
        () => api().removeArtifact({ artifactId: item.id }),
        "产物删除已结算",
      ),
  });
}

function confirmRecovery(item) {
  const decision = item.recommendedDecision;
  const label = recoveryDecisionLabel(decision);
  const planDigest = workbench.value.recovery.planDigest;
  Modal.confirm({
    title: `${label}？`,
    content: `将按当前计划摘要 ${shortArtifactDigest(planDigest)} 处理 ${item.itemId}。计划变化时操作会被拒绝。`,
    okText: label,
    okType: decision === "delete-orphan" ? "danger" : "primary",
    cancelText: "取消",
    onOk: () =>
      runArtifactAction(
        `recovery:${item.itemId}`,
        () =>
          api().adjudicateArtifactRecovery({
            itemId: item.itemId,
            planDigest,
            decision,
          }),
        decision === "defer" ? "恢复项已暂缓" : "恢复项已完成结算",
      ),
  });
}

function artifactDescription(item) {
  return [
    item.mime || "unknown",
    formatArtifactBytes(item.size),
    formatDate(item.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

function activityTitle(event) {
  return [event.type, event.phase, event.artifactId, event.client, event.action]
    .filter(Boolean)
    .join(" · ");
}

function formatDate(value) {
  if (!value) {
    return "时间未知";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "时间未知" : parsed.toLocaleString();
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }
  pollTimer = null;
}

watch(
  () => props.open,
  (visible) => {
    stopPolling();
    if (!visible) {
      return;
    }
    refresh();
    pollTimer = window.setInterval(
      () => refresh({ quiet: true }),
      POLL_INTERVAL_MS,
    );
  },
  { immediate: true },
);

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.artifact-alert,
.artifact-section {
  margin-bottom: 16px;
}

.section-heading {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.artifact-card {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 10px;
  padding: 12px;
}

.artifact-kind {
  margin-left: 8px;
}

.metadata-grid {
  display: grid;
  font-size: 12px;
  gap: 4px 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow-wrap: anywhere;
}

.lineage-box {
  background: var(--hover-bg, #f6f8fa);
  border-radius: 6px;
  margin-top: 10px;
  padding: 10px;
}

.lineage-box strong {
  display: block;
  margin-bottom: 6px;
}

.muted {
  color: var(--text-secondary, #8c8c8c);
  font-size: 12px;
}
</style>
