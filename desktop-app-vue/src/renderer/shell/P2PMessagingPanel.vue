<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="P2P 加密消息"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <WifiOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      libp2p 节点 + Signal Protocol 加密会话。本地节点通过 WebRTC + DHT
      与其他设备点对点通信，无需中央服务器。
      下方显示当前节点状态与已连接对等节点（完整管理请访问
      <code>/p2p-messaging</code>）。
    </p>

    <div class="node-summary">
      <div class="summary-header">
        <span class="summary-label">节点状态</span>
        <a-tag v-if="store.hasLoaded && store.isOnline" color="green">
          在线
        </a-tag>
        <a-tag v-else-if="store.hasLoaded" color="default"> 未启动 </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          刷新
        </a-button>
      </div>
      <div v-if="store.nodeInfo" class="node-meta">
        <div class="meta-row">
          <span class="meta-label">Peer ID</span>
          <span class="meta-value mono">{{
            shortId(store.nodeInfo.peerId)
          }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">监听地址</span>
          <span class="meta-value mono">
            {{ (store.nodeInfo.addresses?.[0] as string) ?? "—" }}
            <a-tag
              v-if="(store.nodeInfo.addresses?.length ?? 0) > 1"
              color="default"
            >
              +{{ (store.nodeInfo.addresses?.length ?? 0) - 1 }}
            </a-tag>
          </span>
        </div>
        <div class="meta-row">
          <span class="meta-label">已连接对等</span>
          <a-tag color="cyan">
            {{ store.peerCount }}
          </a-tag>
        </div>
        <div v-if="store.natInfo" class="meta-row">
          <span class="meta-label">NAT 类型</span>
          <a-tag :color="natColor(store.natInfo.type)">
            {{ store.natInfo.type ?? "未知" }}
          </a-tag>
          <a-tag v-if="store.natInfo.reachable" color="green"> 可达 </a-tag>
        </div>
      </div>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        P2P 节点尚未启动，前往 <code>/p2p-messaging</code> 启动并配置传输层。
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
import { watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { WifiOutlined } from "@ant-design/icons-vue";
import { useP2PMessagingStore } from "../stores/p2pMessaging";

interface P2PAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useP2PMessagingStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadAll();
    }
  },
);

const actions: P2PAction[] = [
  {
    id: "connect",
    label: "连接对等节点",
    desc: "通过 multiaddr 直接连接其他节点（如 /ip4/.../p2p/Qm...）。",
    cta: "前往",
    primary: true,
  },
  {
    id: "messaging",
    label: "加密消息",
    desc: "Signal Protocol 端到端加密会话，双方需先完成密钥交换。",
    cta: "前往",
  },
  {
    id: "device-pairing",
    label: "设备配对",
    desc: "把多台设备绑定到同一个 DID 身份，自动同步会话密钥。",
    cta: "前往",
  },
  {
    id: "safety-numbers",
    label: "安全号码验证",
    desc: "比对双方安全号码以验证 P2P 信道未被中间人攻击。",
    cta: "前往",
  },
];

function shortId(id?: string): string {
  if (!id) {
    return "—";
  }
  if (id.length <= 16) {
    return id;
  }
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

const NAT_COLORS: Record<string, string> = {
  open: "green",
  symmetric: "red",
  "full-cone": "green",
  "restricted-cone": "orange",
  "port-restricted-cone": "orange",
  unknown: "default",
};
function natColor(type?: string): string {
  if (!type) {
    return "default";
  }
  return NAT_COLORS[type.toLowerCase()] || "default";
}

function run(action: P2PAction): void {
  antMessage.info(
    `${action.label}：请在 /p2p-messaging 完成该操作（快速面板仅展示概览）`,
  );
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

.node-summary {
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

.node-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
  font-size: 12px;
}

.meta-row:first-child {
  border-top: none;
}

.meta-label {
  width: 96px;
  color: var(--cc-shell-muted, #595959);
}

.meta-value {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
  word-break: break-all;
}

.mono {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
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
