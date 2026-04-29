<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <SwapOutlined class="cc-preview-widget__icon" />
      <h3>去中心化交易</h3>
      <p>
        数字资产管理、智能合约交易、知识付费市场。订单与合约记录上链，不依赖中心化托管。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>合约链</dt>
        <dd>EVM + Substrate</dd>
      </div>
      <div>
        <dt>结算模式</dt>
        <dd>智能合约托管</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openTradingHub">
        进入交易中心
      </a-button>
      <a-button block @click="openMarketplace"> 浏览市场 </a-button>
      <a-button block @click="openContracts"> 我的合约 </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { SwapOutlined } from "@ant-design/icons-vue";

const router = useRouter();

function openTradingHub() {
  router.push({ name: "TradingHub" }).catch(() => {});
}

function openMarketplace() {
  router.push({ name: "Marketplace" }).catch(() => {});
}

function openContracts() {
  router.push({ name: "Contracts" }).catch(() => {});
}
</script>

<style scoped>
.cc-preview-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cc-preview-widget__hero {
  text-align: center;
  padding: 16px 8px 4px;
}

.cc-preview-widget__icon {
  font-size: 32px;
  color: var(--cc-preview-accent);
  margin-bottom: 8px;
}

.cc-preview-widget__hero h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-widget__hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-widget__kv {
  margin: 0;
  padding: 10px 12px;
  background: var(--cc-preview-bg-hover);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.cc-preview-widget__kv dt {
  color: var(--cc-preview-text-secondary);
  margin: 0;
}

.cc-preview-widget__kv dd {
  margin: 0;
  color: var(--cc-preview-text-primary);
  font-weight: 500;
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
