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
      下方为常用操作（完整钱包请访问 <code>/wallet</code>）。
    </p>

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
  </a-modal>
</template>

<script setup lang="ts">
import { message as antMessage } from "ant-design-vue";
import { WalletOutlined } from "@ant-design/icons-vue";

interface WalletAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const actions: WalletAction[] = [
  {
    id: "balance",
    label: "查看余额",
    desc: "查看所有持有资产的余额，包括 CC、ETH、USDT 等。",
    cta: "查看",
  },
  {
    id: "send",
    label: "发送资产",
    desc: "向任意地址发送资产，支持 U-Key 硬件签名。",
    cta: "发送",
    primary: true,
  },
  {
    id: "receive",
    label: "接收资产",
    desc: "显示当前地址与二维码，便于他人转入。",
    cta: "接收",
  },
  {
    id: "connect-mm",
    label: "连接 MetaMask",
    desc: "连接浏览器/扩展 MetaMask 账户用于签名。",
    cta: "连接",
  },
  {
    id: "connect-wc",
    label: "连接 WalletConnect",
    desc: "扫码连接移动端或其他 WC 兼容钱包。",
    cta: "连接",
  },
];

function run(action: WalletAction): void {
  antMessage.info(`${action.label}（主进程接入将在后续迭代完成）`);
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
</style>
