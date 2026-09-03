<template>
  <a-drawer
    :open="open"
    title="知识冲突审阅"
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
      v-else-if="!loading && conflicts.length === 0"
      description="暂无待裁决的知识冲突"
    />

    <a-list :data-source="conflicts" item-layout="vertical">
      <template #renderItem="{ item }">
        <a-list-item class="conflict-card">
          <template #actions>
            <a-button type="link" @click="beginMerge(item)">人工合并</a-button>
          </template>
          <a-list-item-meta :description="item.conflictEnvelopeDigest">
            <template #title>
              {{ item.knowledgeId }}
              <a-tag>{{ item.scope }} / {{ item.action }}</a-tag>
            </template>
          </a-list-item-meta>
          <div class="details">
            <div>来源设备：{{ item.senderDeviceId }}</div>
            <div>本地：{{ shortDigest(item.localContentDigest) }}</div>
            <div>远端：{{ shortDigest(item.remoteContentDigest) }}</div>
            <div>提交时间：{{ item.committedAt }}</div>
            <div>远端时钟：{{ JSON.stringify(item.remoteVectorClock) }}</div>
          </div>
        </a-list-item>
      </template>
    </a-list>

    <a-modal
      v-model:open="mergeVisible"
      title="确认人工合并"
      :confirm-loading="merging"
      :ok-button-props="{ disabled: !confirmed }"
      ok-text="确认并持久发布"
      width="720px"
      @ok="submitMerge"
    >
      <a-alert
        type="warning"
        show-icon
        message="完整记录将由可信宿主校验；身份签名、发布与审计凭据不会下放到界面。"
      />
      <div class="field-label">Canonical merged record (JSON)</div>
      <a-textarea
        v-model:value="mergedRecordJson"
        :rows="12"
        placeholder="粘贴完整的合并后 governed knowledge record"
      />
      <div class="field-label">人工裁决原因</div>
      <a-textarea
        v-model:value="mergeReason"
        :maxlength="2048"
        :rows="3"
        placeholder="说明如何处理两端离线修改"
      />
      <a-checkbox v-model:checked="confirmed" class="confirmation">
        我已核对冲突摘要、合并内容及作用域，并确认提交一次不可变裁决
      </a-checkbox>
    </a-modal>
  </a-drawer>
</template>

<script setup>
import { message } from "ant-design-vue";
import { ref, watch } from "vue";

import {
  buildGovernedKnowledgeMergeRequest,
  shortKnowledgeDigest,
  validateGovernedKnowledgeConflictResponse,
} from "./governed-knowledge-review-utils.js";

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(["update:open"]);
const loading = ref(false);
const merging = ref(false);
const errorMessage = ref("");
const conflicts = ref([]);
const mergeVisible = ref(false);
const mergeTarget = ref(null);
const mergedRecordJson = ref("");
const mergeReason = ref("");
const confirmed = ref(false);

const api = () => window.electronAPI?.codingAgent;
const shortDigest = shortKnowledgeDigest;

async function refresh() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = validateGovernedKnowledgeConflictResponse(
      await api()?.appServerGovernedKnowledgeConflicts({
        cursor: 0,
        limit: 256,
      }),
    );
    conflicts.value = result.items;
  } catch (error) {
    conflicts.value = [];
    errorMessage.value = error?.message || String(error);
  } finally {
    loading.value = false;
  }
}

function beginMerge(conflict) {
  mergeTarget.value = conflict;
  mergedRecordJson.value = "";
  mergeReason.value = "";
  confirmed.value = false;
  mergeVisible.value = true;
}

async function submitMerge() {
  if (!confirmed.value) {
    return;
  }
  merging.value = true;
  try {
    const request = buildGovernedKnowledgeMergeRequest(
      mergeTarget.value,
      mergedRecordJson.value,
      mergeReason.value,
    );
    const response = await api()?.appServerGovernedKnowledgeMerge(request);
    if (response?.success !== true || response?.result?.durable !== true) {
      throw new Error(response?.error || "知识冲突未能持久合并");
    }
    mergeVisible.value = false;
    message.success("知识冲突已由可信宿主持久裁决");
    await refresh();
  } catch (error) {
    message.error(error?.message || String(error));
  } finally {
    merging.value = false;
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
.conflict-card {
  border-bottom: 1px solid var(--border-color, #eee);
}
.details {
  color: #666;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.field-label {
  margin: 16px 0 6px;
  font-weight: 600;
}
.confirmation {
  margin-top: 16px;
}
</style>
