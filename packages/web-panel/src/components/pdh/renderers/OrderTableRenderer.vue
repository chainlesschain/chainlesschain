<template>
  <div class="order-card">
    <div class="head">
      <span class="time">{{ formattedTime }}</span>
      <a-tag color="gold">{{ event.source.adapter }}</a-tag>
      <a-tag>{{ event.subtype }}</a-tag>
    </div>
    <div class="row">
      <span class="key">商户</span>
      <span class="val">{{ merchantText }}</span>
    </div>
    <div class="row">
      <span class="key">商品/项目</span>
      <span class="val">{{ itemText }}</span>
    </div>
    <div class="row amount-row">
      <span class="key">金额</span>
      <span class="val amount">{{ amountText }}</span>
    </div>
    <div v-if="orderNo" class="row">
      <span class="key">单号</span>
      <span class="val mono">{{ orderNo }}</span>
    </div>
    <div v-if="statusText" class="row">
      <span class="key">状态</span>
      <a-tag :color="statusColor">{{ statusText }}</a-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const c = computed(() => props.event.content || {});
const e = computed(() => props.event.extra || {});

const merchantText = computed(
  () => e.value.merchant || c.value.merchant || c.value.counterparty || "—"
);
const itemText = computed(
  () => c.value.title || c.value.name || c.value.itemName || c.value.text || "—"
);
const amountText = computed(() => {
  const v = c.value.amount ?? c.value.price ?? c.value.total;
  if (v == null) return "—";
  const currency = c.value.currency || "¥";
  return `${currency} ${typeof v === "number" ? v.toFixed(2) : v}`;
});
const orderNo = computed(() => e.value.orderNo || c.value.orderNo || c.value.orderId);
const statusText = computed(() => c.value.status || c.value.state);
const statusColor = computed(() => {
  const s = (statusText.value || "").toLowerCase();
  if (s.includes("成功") || s.includes("succe") || s.includes("paid")) return "green";
  if (s.includes("退") || s.includes("refund")) return "orange";
  if (s.includes("失败") || s.includes("fail")) return "red";
  return "default";
});

const formattedTime = computed(() => {
  if (!props.event.occurredAt) return "";
  const d = new Date(props.event.occurredAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
});
</script>

<style scoped>
.order-card {
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  margin-bottom: 8px;
}
.head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #f0f0f0;
}
.time {
  font-size: 12px;
  color: #999;
  font-variant-numeric: tabular-nums;
}
.row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}
.row .key {
  width: 70px;
  color: #999;
  flex-shrink: 0;
}
.row .val {
  color: #333;
  word-break: break-word;
}
.row.amount-row .amount {
  font-weight: 600;
  color: #d48806;
  font-size: 15px;
}
.row .mono {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 12px;
  color: #666;
}
</style>
