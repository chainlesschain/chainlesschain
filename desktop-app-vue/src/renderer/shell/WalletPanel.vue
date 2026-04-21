<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="钱包"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <WalletOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      内置钱包 + 硬件 U-Key/外部钱包连接。所有签名默认走 U-Key 硬件隔离。
      下方显示已有钱包概览和常用操作（完整钱包请访问
      <code>/wallet</code>）。
    </p>

    <div class="wallets-summary">
      <div class="summary-header">
        <span class="summary-label">已有钱包</span>
        <a-tag v-if="store.hasLoaded" color="blue">
          {{ store.wallets.length }}
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
      <ul v-if="store.wallets.length" class="wallet-list">
        <li
          v-for="w in store.wallets"
          :key="w.id"
          class="wallet-row"
          :class="{ 'wallet-default': w.id === store.defaultWallet?.id }"
        >
          <div class="wallet-meta">
            <span class="wallet-name">{{ w.name ?? w.id }}</span>
            <span class="wallet-addr">{{ shortAddr(w.address) }}</span>
          </div>
          <a-tag v-if="w.id === store.defaultWallet?.id" color="green">
            默认
          </a-tag>
          <a-button
            v-else
            size="small"
            type="link"
            @click="store.setDefault(w.id)"
          >
            设为默认
          </a-button>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无钱包，前往 <code>/wallet</code> 创建或导入。
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
import { WalletOutlined } from "@ant-design/icons-vue";
import { useWalletStore } from "../stores/wallet";

interface WalletAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useWalletStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadAll();
    }
  },
);

const actions: WalletAction[] = [
  {
    id: "send",
    label: "发送资产",
    desc: "向任意地址发送资产，支持 U-Key 硬件签名（完整表单在 /wallet）。",
    cta: "前往",
    primary: true,
  },
  {
    id: "receive",
    label: "接收资产",
    desc: "显示当前地址与二维码（/wallet 中查看详情）。",
    cta: "前往",
  },
  {
    id: "connect-mm",
    label: "连接 MetaMask",
    desc: "连接浏览器/扩展 MetaMask 账户用于签名（/wallet 中配置）。",
    cta: "前往",
  },
  {
    id: "connect-wc",
    label: "连接 WalletConnect",
    desc: "扫码连接移动端或其他 WC 兼容钱包（/wallet 中配置）。",
    cta: "前往",
  },
];

function shortAddr(addr?: string): string {
  if (!addr) {
    return "—";
  }
  if (addr.length <= 16) {
    return addr;
  }
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function run(action: WalletAction): void {
  antMessage.info(
    `${action.label}：请在 /wallet 完成该操作（快速面板仅展示概览）`,
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

.wallets-summary {
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

.wallet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wallet-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.wallet-row:first-child {
  border-top: none;
  padding-top: 0;
}

.wallet-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.wallet-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.wallet-addr {
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
