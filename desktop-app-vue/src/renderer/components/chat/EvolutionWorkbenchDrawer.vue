<template>
  <a-drawer
    :open="open"
    title="演化工作台"
    placement="right"
    :width="760"
    @close="emit('update:open', false)"
  >
    <template #extra>
      <a-button size="small" :loading="loading" @click="refresh">刷新</a-button>
    </template>

    <a-alert
      v-if="errorMessage"
      type="error"
      show-icon
      :message="errorMessage"
    />
    <a-empty
      v-else-if="!loading && candidates.length === 0"
      description="暂无候选版本"
    />

    <div v-if="candidates.length > 1" class="compare-row">
      <a-select
        v-model:value="compareLeft"
        placeholder="版本 A"
        :options="versionOptions"
      />
      <a-select
        v-model:value="compareRight"
        placeholder="版本 B"
        :options="versionOptions"
      />
      <a-button :disabled="!canCompare" @click="compare">版本对比</a-button>
    </div>

    <a-list :data-source="candidates" item-layout="vertical">
      <template #renderItem="{ item }">
        <a-list-item class="candidate-card">
          <template #actions>
            <a-button type="link" @click="toggleDetails(item)">
              证据与 Diff
            </a-button>
            <a-button
              v-if="item.status === 'pending'"
              type="link"
              @click="beginMutation('approve', item)"
            >
              批准
            </a-button>
            <a-button
              v-if="item.status === 'pending'"
              danger
              type="link"
              @click="beginMutation('reject', item)"
            >
              拒绝
            </a-button>
            <a-button
              v-if="item.status === 'approved' && !item.actualUsage.active"
              danger
              type="link"
              @click="beginMutation('rollback', item)"
            >
              回滚至此版本
            </a-button>
          </template>
          <a-list-item-meta :description="item.candidateContentDigest">
            <template #title>
              {{ item.candidateId }}
              <a-tag :color="item.actualUsage.active ? 'green' : undefined">
                {{ item.actualUsage.active ? "当前生效" : item.status }}
              </a-tag>
            </template>
          </a-list-item-meta>
          <div class="metrics">
            调用 {{ item.actualUsage.receiptCount }} · 成功
            {{ item.actualUsage.completed }} · 失败/阻断
            {{ item.actualUsage.failedOrBlocked }} · 成本 ${{
              Number(item.actualUsage.totalCostUsd || 0).toFixed(4)
            }}
          </div>
          <div v-if="expandedPacket === item.packetDigest" class="details">
            <div>Packet: {{ item.packetDigest }}</div>
            <div>
              Matrix: {{ shortDigest(item.validation?.matrixReceiptDigest) }}
            </div>
            <div>
              Runtime: {{ item.validation?.targetRuntimes?.join(", ") || "—" }}
            </div>
            <pre>{{ item.changes?.unifiedDiff || "(no diff)" }}</pre>
          </div>
        </a-list-item>
      </template>
    </a-list>

    <a-modal
      v-model:open="mutationVisible"
      :title="mutationTitle"
      :confirm-loading="mutating"
      ok-text="确认执行"
      @ok="submitMutation"
    >
      <a-alert
        type="warning"
        show-icon
        message="操作由 CLI 权威执行，结果会写入持久审计链。"
      />
      <a-textarea
        v-model:value="mutationReason"
        class="reason-input"
        :maxlength="2048"
        :rows="4"
        placeholder="请输入人工决策原因"
      />
    </a-modal>

    <a-modal
      v-model:open="comparisonVisible"
      title="版本对比"
      :footer="null"
      width="800px"
    >
      <pre class="comparison">{{ formattedComparison }}</pre>
    </a-modal>
  </a-drawer>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  buildEvolutionReviewRequest,
  buildEvolutionRollbackRequest,
  shortEvolutionDigest,
  validateEvolutionWorkbenchResponse,
} from "./evolution-workbench-utils.js";

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(["update:open"]);
const loading = ref(false);
const mutating = ref(false);
const errorMessage = ref("");
const candidates = ref([]);
const expandedPacket = ref(null);
const compareLeft = ref(null);
const compareRight = ref(null);
const comparison = ref(null);
const comparisonVisible = ref(false);
const mutationVisible = ref(false);
const mutationKind = ref(null);
const mutationTarget = ref(null);
const mutationReason = ref("");

const api = () => window.electronAPI?.codingAgent;
const shortDigest = shortEvolutionDigest;
const versionOptions = computed(() =>
  candidates.value.map((item) => ({
    label: item.candidateId,
    value: item.packetDigest,
  })),
);
const canCompare = computed(
  () =>
    compareLeft.value &&
    compareRight.value &&
    compareLeft.value !== compareRight.value,
);
const mutationTitle = computed(() => {
  if (mutationKind.value === "approve") {
    return "批准候选版本";
  }
  if (mutationKind.value === "reject") {
    return "拒绝候选版本";
  }
  return "回滚至已批准版本";
});
const formattedComparison = computed(() =>
  JSON.stringify(comparison.value, null, 2),
);

async function refresh() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = validateEvolutionWorkbenchResponse(
      await api()?.appServerEvolutionWorkbenchList({ limit: 500 }),
    );
    candidates.value = result.candidates;
    const active = result.candidates.find(
      ({ actualUsage }) => actualUsage.active,
    );
    compareLeft.value =
      active?.packetDigest || result.candidates[0]?.packetDigest || null;
    compareRight.value =
      result.candidates.find(
        ({ packetDigest }) => packetDigest !== compareLeft.value,
      )?.packetDigest || null;
  } catch (error) {
    candidates.value = [];
    errorMessage.value = error?.message || String(error);
  } finally {
    loading.value = false;
  }
}

function toggleDetails(item) {
  expandedPacket.value =
    expandedPacket.value === item.packetDigest ? null : item.packetDigest;
}

async function compare() {
  try {
    const response = await api()?.appServerEvolutionWorkbenchCompare({
      leftPacketDigest: compareLeft.value,
      rightPacketDigest: compareRight.value,
    });
    if (response?.success !== true) {
      throw new Error(response?.error || "版本对比失败");
    }
    comparison.value = response.result;
    comparisonVisible.value = true;
  } catch (error) {
    message.error(error?.message || String(error));
  }
}

function beginMutation(kind, target) {
  mutationKind.value = kind;
  mutationTarget.value = target;
  mutationReason.value = "";
  mutationVisible.value = true;
}

async function submitMutation() {
  mutating.value = true;
  try {
    const request =
      mutationKind.value === "rollback"
        ? buildEvolutionRollbackRequest(
            candidates.value,
            mutationTarget.value,
            mutationReason.value,
          )
        : buildEvolutionReviewRequest(
            mutationTarget.value,
            mutationKind.value,
            mutationReason.value,
          );
    const method =
      mutationKind.value === "rollback"
        ? "appServerEvolutionWorkbenchRollback"
        : "appServerEvolutionWorkbenchReview";
    const response = await api()?.[method](request);
    if (response?.success !== true) {
      throw new Error(response?.error || "演化治理操作失败");
    }
    mutationVisible.value = false;
    message.success("演化治理操作已由 CLI 权威持久确认");
    await refresh();
  } catch (error) {
    message.error(error?.message || String(error));
  } finally {
    mutating.value = false;
  }
}

watch(
  () => props.open,
  (value) => {
    if (value) {
      void refresh();
    }
  },
);
</script>

<style scoped>
.compare-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 16px;
}
.candidate-card {
  border-bottom: 1px solid var(--border-color, #eee);
}
.metrics {
  color: #666;
  font-size: 12px;
}
.details {
  margin-top: 12px;
  overflow-wrap: anywhere;
}
pre {
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  background: #111827;
  color: #e5e7eb;
}
.reason-input {
  margin-top: 16px;
}
.comparison {
  max-height: 60vh;
}
</style>
