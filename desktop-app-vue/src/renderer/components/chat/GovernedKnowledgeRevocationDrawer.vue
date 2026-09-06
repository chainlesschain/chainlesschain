<template>
  <a-drawer
    :open="open"
    title="知识撤销与依赖处置"
    placement="right"
    :width="760"
    @close="emit('update:open', false)"
  >
    <a-alert
      v-if="errorMessage"
      type="error"
      show-icon
      :message="errorMessage"
      class="block"
    />

    <template v-if="!prepared">
      <a-alert
        type="warning"
        show-icon
        message="第一步会持久化撤销计划，并立即阻断新的受影响引用；此时尚未执行回滚、隔离或删除。"
        class="block"
      />
      <div class="field-label">Governed Knowledge 撤销记录（JSON）</div>
      <a-textarea
        v-model:value="recordJson"
        :rows="14"
        :disabled="preparing"
        placeholder="粘贴不含 dependencies 的完整撤销记录"
      />
      <a-checkbox
        v-model:checked="prepareAcknowledged"
        :disabled="preparing"
        class="confirmation"
      >
        我确认创建持久计划会立即安装准入 fence，并由认证库存自动计算全部依赖
      </a-checkbox>
      <div class="actions">
        <a-button
          type="primary"
          danger
          :loading="preparing"
          :disabled="!prepareAcknowledged || !recordJson.trim()"
          @click="prepareRevocation"
        >
          创建持久计划并预览影响
        </a-button>
      </div>
    </template>

    <template v-else-if="!published">
      <a-alert
        type="warning"
        show-icon
        message="持久准入 fence 已安装。请核对以下完整依赖清单；确认发布后将按顺序执行实际处置。"
        class="block"
      />
      <a-descriptions bordered size="small" :column="1" class="block">
        <a-descriptions-item label="Knowledge">
          {{ prepared.knowledgeId }}
        </a-descriptions-item>
        <a-descriptions-item label="作用域">
          {{ prepared.scope }} / {{ prepared.scopeId }}
        </a-descriptions-item>
        <a-descriptions-item label="内容摘要">
          {{ shortDigest(prepared.contentDigest) }}
        </a-descriptions-item>
        <a-descriptions-item label="计划摘要">
          {{ shortDigest(prepared.operationDigest) }}
        </a-descriptions-item>
        <a-descriptions-item label="库存摘要">
          {{ shortDigest(prepared.inventoryDigest) }}
        </a-descriptions-item>
      </a-descriptions>

      <a-list
        bordered
        size="small"
        :data-source="prepared.dependencies"
        class="block"
      >
        <template #header>
          将处置 {{ prepared.dependencies.length }} 个依赖（顺序不可更改）
        </template>
        <template #renderItem="{ item, index }">
          <a-list-item>
            <a-space wrap>
              <span>{{ index + 1 }}.</span>
              <a-tag>{{ item.kind }}</a-tag>
              <a-tag color="orange">{{ item.disposition }}</a-tag>
              <code>{{ shortDigest(item.digest) }}</code>
            </a-space>
          </a-list-item>
        </template>
      </a-list>

      <div class="field-label">
        输入确认短语：<code>{{ confirmationPhrase }}</code>
      </div>
      <a-input
        v-model:value="publishConfirmation"
        :disabled="publishing"
        autocomplete="off"
      />
      <a-checkbox
        v-model:checked="publishAcknowledged"
        :disabled="publishing"
        class="confirmation"
      >
        我已核对作用域、摘要和全部依赖，确认执行回滚、隔离或 tombstone
      </a-checkbox>
      <div class="actions">
        <a-button
          type="primary"
          danger
          :loading="publishing"
          :disabled="
            !publishAcknowledged || publishConfirmation !== confirmationPhrase
          "
          @click="publishRevocation"
        >
          确认并发布撤销
        </a-button>
      </div>
    </template>

    <a-result
      v-else
      status="success"
      title="知识撤销已持久发布"
      sub-title="全部依赖效果已结算，发布回执已通过认证摘要校验。"
    >
      <template #extra>
        <a-button @click="reset">处理下一条</a-button>
      </template>
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="Knowledge">
          {{ published.knowledgeId }}
        </a-descriptions-item>
        <a-descriptions-item label="依赖数">
          {{ published.dependencyCount }}
        </a-descriptions-item>
        <a-descriptions-item label="操作摘要">
          {{ published.operationDigest }}
        </a-descriptions-item>
        <a-descriptions-item label="发布信封摘要">
          {{ published.envelopeDigest }}
        </a-descriptions-item>
      </a-descriptions>
    </a-result>
  </a-drawer>
</template>

<script setup>
import { message } from "ant-design-vue";
import { computed, ref } from "vue";

import {
  buildGovernedKnowledgeRevocationPublishRequest,
  governedKnowledgeRevocationConfirmation,
  parseGovernedKnowledgeRevocationDraft,
  shortRevocationDigest,
  validateGovernedKnowledgeRevocationPrepareResponse,
  validateGovernedKnowledgeRevocationPublishResponse,
} from "./governed-knowledge-revocation-utils.js";

defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(["update:open"]);
const recordJson = ref("");
const prepareAcknowledged = ref(false);
const preparing = ref(false);
const prepared = ref(null);
const publishConfirmation = ref("");
const publishAcknowledged = ref(false);
const publishing = ref(false);
const published = ref(null);
const errorMessage = ref("");
const shortDigest = shortRevocationDigest;
const api = () => window.electronAPI?.codingAgent;
const confirmationPhrase = computed(() =>
  prepared.value ? governedKnowledgeRevocationConfirmation(prepared.value) : "",
);

async function prepareRevocation() {
  if (!prepareAcknowledged.value) {
    return;
  }
  preparing.value = true;
  errorMessage.value = "";
  try {
    const record = parseGovernedKnowledgeRevocationDraft(recordJson.value);
    prepared.value = validateGovernedKnowledgeRevocationPrepareResponse(
      await api()?.appServerGovernedKnowledgeRevocationPrepare({ record }),
    );
    message.warning("持久撤销计划已创建，准入 fence 已立即生效");
  } catch (error) {
    errorMessage.value = error?.message || String(error);
  } finally {
    preparing.value = false;
  }
}

async function publishRevocation() {
  publishing.value = true;
  errorMessage.value = "";
  try {
    const request = buildGovernedKnowledgeRevocationPublishRequest(
      prepared.value,
      publishConfirmation.value,
      publishAcknowledged.value,
    );
    published.value = validateGovernedKnowledgeRevocationPublishResponse(
      await api()?.appServerGovernedKnowledgeRevocationPublish(request),
      prepared.value,
    );
    message.success("知识撤销及依赖处置已持久完成");
  } catch (error) {
    errorMessage.value = error?.message || String(error);
  } finally {
    publishing.value = false;
  }
}

function reset() {
  recordJson.value = "";
  prepareAcknowledged.value = false;
  prepared.value = null;
  publishConfirmation.value = "";
  publishAcknowledged.value = false;
  published.value = null;
  errorMessage.value = "";
}
</script>

<style scoped>
.block {
  margin-bottom: 16px;
}
.field-label {
  margin: 16px 0 6px;
  font-weight: 600;
}
.confirmation {
  margin-top: 16px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}
code {
  overflow-wrap: anywhere;
}
</style>
