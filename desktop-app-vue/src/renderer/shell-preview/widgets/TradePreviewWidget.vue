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
        <dt>活跃订单</dt>
        <dd>{{ activeOrders }} 条</dd>
      </div>
      <div v-if="hasIdentity">
        <dt>我的订单</dt>
        <dd>{{ myOrders }} 条</dd>
      </div>
      <div>
        <dt>合约链</dt>
        <dd>EVM + Substrate</dd>
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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { SwapOutlined } from "@ant-design/icons-vue";

interface MarketplaceApi {
  getOrders?: (filters: unknown) => Promise<unknown>;
  getMyOrders?: (userDid: string) => Promise<unknown>;
}

interface DidApi {
  getCurrentIdentity?: () => Promise<unknown>;
}

const router = useRouter();
const activeOrders = ref(0);
const myOrders = ref(0);
const currentDid = ref<string | null>(null);
const hasIdentity = computed(() => Boolean(currentDid.value));

function openTradingHub() {
  router.push({ name: "TradingHub" }).catch(() => {});
}

function openMarketplace() {
  router.push({ name: "Marketplace" }).catch(() => {});
}

function openContracts() {
  router.push({ name: "Contracts" }).catch(() => {});
}

function pickDid(value: unknown): string | null {
  if (typeof value === "string" && value) {
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.did === "string" && obj.did) {
      return obj.did;
    }
    if (typeof obj.id === "string" && obj.id) {
      return obj.id;
    }
  }
  return null;
}

async function loadActiveOrders(market: MarketplaceApi) {
  if (!market.getOrders) {
    return;
  }
  try {
    const result = (await market.getOrders({ status: "open" })) as
      | { total?: unknown; items?: unknown[] }
      | unknown[]
      | null
      | undefined;
    if (Array.isArray(result)) {
      activeOrders.value = result.length;
    } else if (result && typeof result === "object") {
      if (typeof result.total === "number") {
        activeOrders.value = result.total;
      } else if (Array.isArray(result.items)) {
        activeOrders.value = result.items.length;
      }
    }
  } catch {
    /* leave activeOrders=0 on failure */
  }
}

async function loadMyOrders(market: MarketplaceApi, did: string) {
  if (!market.getMyOrders) {
    return;
  }
  try {
    const result = (await market.getMyOrders(did)) as
      | { createdOrders?: unknown[]; purchasedOrders?: unknown[] }
      | null
      | undefined;
    if (result && typeof result === "object") {
      const created = Array.isArray(result.createdOrders)
        ? result.createdOrders.length
        : 0;
      const purchased = Array.isArray(result.purchasedOrders)
        ? result.purchasedOrders.length
        : 0;
      myOrders.value = created + purchased;
    }
  } catch {
    /* leave myOrders=0 on failure */
  }
}

onMounted(async () => {
  if (typeof window === "undefined") {
    return;
  }
  const electronAPI = (
    window as unknown as {
      electronAPI?: { marketplace?: MarketplaceApi; did?: DidApi };
    }
  ).electronAPI;
  const market = electronAPI?.marketplace;
  const did = electronAPI?.did;
  if (!market) {
    return;
  }

  await loadActiveOrders(market);

  if (did?.getCurrentIdentity) {
    try {
      const identity = await did.getCurrentIdentity();
      const didStr = pickDid(identity);
      if (didStr) {
        currentDid.value = didStr;
        await loadMyOrders(market, didStr);
      }
    } catch {
      /* leave hasIdentity=false on lookup failure */
    }
  }
});
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
