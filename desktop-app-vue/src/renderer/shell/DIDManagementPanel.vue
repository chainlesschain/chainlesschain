<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="DID 身份管理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <IdcardOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      去中心化身份 (DID) 管理。每个身份对应一个 Ed25519 密钥对，可签名
      Artifact、加密 P2P 消息，并可选发布到 DHT 供他人解析。
      下方显示已有身份概览（完整管理请访问 <code>/did</code>）。
    </p>

    <div class="identities-summary">
      <div class="summary-header">
        <span class="summary-label">已有身份</span>
        <a-tag v-if="store.hasLoaded" color="purple">
          {{ store.identities.length }}
        </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          刷新
        </a-button>
      </div>
      <ul v-if="store.identities.length" class="identity-list">
        <li
          v-for="identity in store.identities"
          :key="identity.did"
          class="identity-row"
          :class="{
            'identity-default': identity.did === store.defaultIdentity?.did,
          }"
        >
          <div class="identity-meta">
            <div class="identity-line-1">
              <span class="identity-name">{{
                identity.displayName ?? "(未命名)"
              }}</span>
              <a-tag
                v-if="identity.did === store.defaultIdentity?.did"
                color="green"
              >
                默认
              </a-tag>
              <a-tag
                v-if="store.publishStatus[identity.did] === true"
                color="blue"
              >
                <CloudOutlined /> 已发布
              </a-tag>
              <a-tag
                v-else-if="store.publishStatus[identity.did] === false"
                color="default"
              >
                未发布
              </a-tag>
            </div>
            <div class="identity-line-2">
              <span class="identity-did">{{ shortDid(identity.did) }}</span>
              <span v-if="identity.createdAt" class="identity-created">
                · 创建于 {{ formatCreatedAt(identity.createdAt) }}
              </span>
            </div>
          </div>
          <div class="identity-actions">
            <a-button
              v-if="identity.did !== store.defaultIdentity?.did"
              size="small"
              type="link"
              @click="store.setDefault(identity.did)"
            >
              设为默认
            </a-button>
            <a-tooltip
              v-if="identity.did === store.defaultIdentity?.did"
              title="默认身份不能删除，请先切换默认"
            >
              <a-button size="small" type="link" disabled>
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
            <a-button
              v-else
              size="small"
              type="link"
              danger
              :loading="deletingDid === identity.did"
              @click="confirmDelete(identity)"
            >
              <DeleteOutlined />
            </a-button>
          </div>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无身份，前往 <code>/did</code> 创建第一个 DID。
      </div>
    </div>

    <a-divider />

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button
            size="small"
            :type="action.primary ? 'primary' : 'default'"
            :disabled="action.disabled"
            @click="run(action)"
          >
            {{ action.cta }}
          </a-button>
        </div>
        <p class="action-desc">
          {{ action.desc }}
        </p>
      </li>
    </ul>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.clearError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  IdcardOutlined,
  CloudOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import {
  useDIDManagementStore,
  type IdentitySummary,
} from "../stores/didManagement";

interface DidAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useDIDManagementStore();
const deletingDid = ref<string | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      await store.loadAll();
      await store.loadPublishStatus();
    }
  },
);

const actions: DidAction[] = [
  {
    id: "create",
    label: "创建身份",
    desc: "生成新的 Ed25519 密钥对 + DID Document（含助记词备份流程，Phase 3 内嵌于此面板）。",
    cta: "前往",
    primary: true,
  },
  {
    id: "backup",
    label: "备份助记词",
    desc: "导出 BIP39 助记词以便在其他设备恢复（强烈建议离线保存，Phase 5 内嵌）。",
    cta: "前往",
  },
  {
    id: "publish",
    label: "发布到 DHT",
    desc: "将身份发布到 P2P DHT 网络供他人解析（需 P2P 在线，Phase 4 内嵌）。",
    cta: "前往",
  },
  {
    id: "verify",
    label: "验证签名",
    desc: "用任一 DID 公钥验证消息签名是否有效（Phase 4 内嵌）。",
    cta: "前往",
  },
];

function shortDid(did?: string): string {
  if (!did) {
    return "—";
  }
  if (did.length <= 24) {
    return did;
  }
  return `${did.slice(0, 16)}…${did.slice(-6)}`;
}

function formatCreatedAt(value: string | number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleDateString();
}

function confirmDelete(identity: IdentitySummary): void {
  Modal.confirm({
    title: "删除身份",
    content: `确定删除 ${identity.displayName ?? identity.did}？此操作不可撤销，建议先备份助记词。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      deletingDid.value = identity.did;
      const ok = await store.deleteIdentity(identity.did);
      deletingDid.value = null;
      if (ok) {
        antMessage.success(`已删除 ${identity.displayName ?? "身份"}`);
        await store.loadPublishStatus();
      }
    },
  });
}

function run(action: DidAction): void {
  antMessage.info(`${action.label}：当前在 /did 完成，下一阶段将内嵌到此面板`);
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.identities-summary {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.summary-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.summary-header > .ant-btn-link {
  margin-left: auto;
}

.identity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.identity-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.identity-row:first-child {
  border-top: none;
  padding-top: 0;
}

.identity-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.identity-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.identity-line-2 {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.identity-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.identity-did {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.identity-created {
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
}

.identity-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.empty-hint code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.action-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.action-title {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.action-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}

.error-alert {
  margin-top: 12px;
}
</style>
