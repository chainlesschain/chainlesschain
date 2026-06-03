<!--
  MessageEnvelopeViewer — modal that shows the B4-merkle / B4-cross
  cryptographic evidence for a single channel message:
    - origin (local-batched vs fetched-from-remote)
    - tree-head id + batch id
    - inclusion proof (leaf index + audit path)
    - landmark (signer issuer + tree-head signature)
    - raw envelope JSON (collapsed, copyable)

  Triggered from CommunityDetailsDrawer message rows via "🔐 验证" button.
  Self-fetches via useMessageEnvelope on first open; reset on close.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  Modal,
  Tag,
  Spin,
  Alert,
  Typography,
  Descriptions,
  DescriptionsItem,
  Button,
  Tooltip,
} from "ant-design-vue";
import { useMessageEnvelope } from "@/composables/useMessageEnvelope";

const props = defineProps<{
  open: boolean;
  communityId: string;
  messageId: string;
  messagePreview?: string;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const { state, fetch, reset } = useMessageEnvelope();

const modalOpen = computed({
  get: () => props.open,
  set: (v) => emit("update:open", v),
});

watch(
  () => [props.open, props.communityId, props.messageId],
  ([open, cid, mid]) => {
    if (open && cid && mid) {
      fetch(cid as string, mid as string);
    } else if (!open) {
      reset();
    }
  },
  { immediate: true },
);

const showAdvanced = ref(false);

function copyJson(obj: unknown) {
  if (!navigator.clipboard) {
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
}
</script>

<template>
  <Modal
    v-model:open="modalOpen"
    :title="'🔐 消息密码学证据'"
    :footer="null"
    :width="720"
    destroy-on-close
  >
    <div class="envelope-viewer">
      <div v-if="messagePreview" class="message-preview">
        <Typography.Text type="secondary"> 消息： </Typography.Text>
        <Typography.Text>{{ messagePreview }}</Typography.Text>
      </div>

      <div v-if="state.phase === 'idle'" class="status-block">
        <Spin />
      </div>

      <div v-else-if="state.phase === 'loading'" class="status-block">
        <Spin tip="查询中（本地 → 已连 peer）..." />
      </div>

      <Alert
        v-else-if="state.phase === 'error'"
        type="error"
        show-icon
        :message="'加载失败'"
        :description="state.message"
      />

      <Alert
        v-else-if="state.phase === 'not-found'"
        type="warning"
        show-icon
        :message="'未找到密码学证据'"
        :description="
          state.reason ||
          '该消息可能尚未被打包到 Merkle 批，或已发送方未在线无法 peer-pull。'
        "
      />

      <template v-else-if="state.phase === 'found'">
        <Descriptions bordered :column="1" size="small" class="cred-table">
          <DescriptionsItem label="来源">
            <Tag :color="state.result.origin === 'local' ? 'green' : 'blue'">
              {{
                state.result.origin === "local"
                  ? "本机批次（本人发出）"
                  : "远端拉取（来自 peer）"
              }}
            </Tag>
            <Tag v-if="state.result.staging" color="orange"> 尚未关闭批次 </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="Tree Head ID">
            <Typography.Text code copyable>
              {{ state.result.treeHeadId }}
            </Typography.Text>
          </DescriptionsItem>
          <DescriptionsItem v-if="state.result.batchId" label="Batch ID">
            {{ state.result.batchId }}
          </DescriptionsItem>
          <DescriptionsItem v-if="state.result.namespace" label="MTC Namespace">
            <Typography.Text code copyable>
              {{ state.result.namespace }}
            </Typography.Text>
          </DescriptionsItem>
          <DescriptionsItem
            v-if="state.result.leafIndex !== undefined"
            label="Leaf 索引"
          >
            {{ state.result.leafIndex }}
          </DescriptionsItem>
          <DescriptionsItem label="签名验证">
            <Tag color="green"> ✅ Ed25519 签名 + Merkle 包含证明已就位 </Tag>
            <Tooltip
              title="点 '展开 raw JSON' 查看完整 envelope + landmark；可复制后用 cc mtc verify 等工具离线复核。"
            >
              <Typography.Text type="secondary"> ⓘ </Typography.Text>
            </Tooltip>
          </DescriptionsItem>
          <DescriptionsItem
            v-if="state.result.landmark === null"
            label="Landmark"
          >
            <Tag color="orange"> 尚未缓存对应 landmark（仅有 envelope） </Tag>
          </DescriptionsItem>
        </Descriptions>

        <Button
          type="link"
          size="small"
          class="advanced-toggle"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? "收起" : "展开" }} raw JSON
        </Button>

        <div v-if="showAdvanced" class="raw-blocks">
          <div class="raw-block">
            <div class="raw-block-header">
              <Typography.Text strong> Envelope </Typography.Text>
              <Button size="small" @click="copyJson(state.result.envelope)">
                复制
              </Button>
            </div>
            <pre>{{ JSON.stringify(state.result.envelope, null, 2) }}</pre>
          </div>
          <div v-if="state.result.landmark" class="raw-block">
            <div class="raw-block-header">
              <Typography.Text strong> Landmark </Typography.Text>
              <Button size="small" @click="copyJson(state.result.landmark)">
                复制
              </Button>
            </div>
            <pre>{{ JSON.stringify(state.result.landmark, null, 2) }}</pre>
          </div>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.envelope-viewer {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.message-preview {
  padding: 12px;
  background: var(--ant-color-fill-alter, #fafafa);
  border-radius: 6px;
  word-break: break-word;
}
.status-block {
  text-align: center;
  padding: 32px 0;
}
.cred-table {
  margin-top: 8px;
}
.advanced-toggle {
  align-self: flex-start;
  padding-left: 0;
}
.raw-blocks {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.raw-block {
  border: 1px solid var(--ant-color-border, #f0f0f0);
  border-radius: 4px;
  overflow: hidden;
}
.raw-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--ant-color-fill-alter, #fafafa);
}
.raw-block pre {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  max-height: 300px;
  overflow: auto;
  background: var(--ant-color-bg-container, #fff);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
