<template>
  <div class="event-card">
    <div class="card-head">
      <span class="time">{{ formattedTime }}</span>
      <a-tag color="blue" class="adapter">{{ event.source.adapter }}</a-tag>
      <a-tag class="subtype">{{ event.subtype }}</a-tag>
      <span v-if="event.actor" class="actor">@{{ event.actor }}</span>
    </div>
    <div class="card-body">
      <div class="primary">{{ primaryText }}</div>
      <div v-if="secondaryText" class="secondary">{{ secondaryText }}</div>
    </div>
    <div v-if="metaChips.length > 0" class="card-meta">
      <a-tag v-for="chip in metaChips" :key="chip.k" :color="chip.color">
        <span class="meta-k">{{ chip.k }}:</span> {{ chip.v }}
      </a-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const formattedTime = computed(() => {
  if (!props.event.occurredAt) return "";
  try {
    const d = new Date(props.event.occurredAt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch (_e) {
    return "";
  }
});

const primaryText = computed(() => {
  const c = props.event.content || {};
  return (
    c.text ||
    c.title ||
    c.subject ||
    c.name ||
    c.prompt ||
    JSON.stringify(c).slice(0, 200)
  );
});

const secondaryText = computed(() => {
  const c = props.event.content || {};
  // Show a second-line snippet if there's a separate descriptive field
  return c.body || c.snippet || c.description || c.from || c.counterparty || null;
});

const metaChips = computed(() => {
  const c = props.event.content || {};
  const e = props.event.extra || {};
  const chips = [];
  if (c.amount != null) chips.push({ k: "金额", v: c.amount, color: "gold" });
  if (e.merchant) chips.push({ k: "商户", v: e.merchant, color: "green" });
  if (e.orderNo) chips.push({ k: "订单", v: e.orderNo, color: "purple" });
  if (c.from && c.to) chips.push({ k: "路线", v: `${c.from} → ${c.to}`, color: "cyan" });
  if (c.trainNo) chips.push({ k: "车次", v: c.trainNo, color: "cyan" });
  if (c.model) chips.push({ k: "模型", v: c.model, color: "magenta" });
  if (props.event.place) chips.push({ k: "地点", v: props.event.place, color: "geekblue" });
  return chips;
});
</script>

<style scoped>
.event-card {
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  margin-bottom: 8px;
  transition: border-color 0.15s;
}
.event-card:hover {
  border-color: #1677ff;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.time {
  font-size: 12px;
  color: #999;
  font-variant-numeric: tabular-nums;
}
.subtype {
  font-size: 11px;
}
.actor {
  font-size: 12px;
  color: #666;
}
.card-body {
  margin-bottom: 8px;
}
.primary {
  font-size: 14px;
  color: #333;
  word-break: break-word;
  white-space: pre-wrap;
}
.secondary {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
.card-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.meta-k {
  font-weight: 600;
  opacity: 0.7;
}
</style>
