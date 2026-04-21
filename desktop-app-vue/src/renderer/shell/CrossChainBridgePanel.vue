<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="跨链桥"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SwapOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      在 ChainlessChain 之间安全转移资产与消息。支持多签/ZK 证明两类通道。
      下方为支持的链对（完整桥面板请访问 <code>/bridge</code>）。
    </p>

    <ul class="action-list">
      <li v-for="lane in lanes" :key="lane.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ lane.from }} ↔ {{ lane.to }}</span>
          <a-tag :color="lane.status === 'active' ? 'green' : 'orange'">
            {{ lane.status === "active" ? "运行中" : "维护中" }}
          </a-tag>
        </div>
        <p class="action-desc">
          {{ lane.desc }}
        </p>
      </li>
    </ul>
  </a-modal>
</template>

<script setup lang="ts">
import { SwapOutlined } from "@ant-design/icons-vue";

interface Lane {
  id: string;
  from: string;
  to: string;
  status: "active" | "maintenance";
  desc: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const lanes: Lane[] = [
  {
    id: "cc-eth",
    from: "ChainlessChain",
    to: "Ethereum",
    status: "active",
    desc: "多签中继，5 分钟确认，每日上限 1000 CC。",
  },
  {
    id: "cc-bsc",
    from: "ChainlessChain",
    to: "BNB Chain",
    status: "active",
    desc: "ZK 证明通道，2 分钟确认，无上限。",
  },
  {
    id: "cc-polygon",
    from: "ChainlessChain",
    to: "Polygon",
    status: "active",
    desc: "多签中继，3 分钟确认。",
  },
  {
    id: "cc-arbitrum",
    from: "ChainlessChain",
    to: "Arbitrum",
    status: "maintenance",
    desc: "维护中：等待 L2 最终性升级。",
  },
];
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
