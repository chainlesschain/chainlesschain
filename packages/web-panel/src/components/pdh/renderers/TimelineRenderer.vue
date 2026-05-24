<template>
  <div class="timeline-event">
    <div class="dot">
      <CarOutlined v-if="isTravel" />
      <EnvironmentOutlined v-else />
    </div>
    <div class="card">
      <div class="head">
        <span class="time">{{ formattedTime }}</span>
        <a-tag color="cyan">{{ event.source.adapter }}</a-tag>
        <a-tag>{{ event.subtype }}</a-tag>
      </div>
      <div class="primary">
        <span v-if="route">{{ route }}</span>
        <span v-else-if="placeName">📍 {{ placeName }}</span>
        <span v-else>{{ fallbackText }}</span>
      </div>
      <div v-if="trainNo || flightNo" class="trip-no">
        <a-tag color="blue">{{ trainNo || flightNo }}</a-tag>
      </div>
      <div v-if="extraDetail" class="extra">{{ extraDetail }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { CarOutlined, EnvironmentOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const c = computed(() => props.event.content || {});

const isTravel = computed(() => {
  const a = props.event.source.adapter || "";
  return a.startsWith("travel-12306") || a.startsWith("travel-ctrip");
});

const route = computed(() => {
  if (c.value.from && c.value.to) return `${c.value.from} → ${c.value.to}`;
  if (c.value.origin && c.value.destination)
    return `${c.value.origin} → ${c.value.destination}`;
  return null;
});

const placeName = computed(
  () => props.event.place || c.value.placeName || c.value.poi
);

const trainNo = computed(() => c.value.trainNo);
const flightNo = computed(() => c.value.flightNo);

const fallbackText = computed(
  () => c.value.title || c.value.text || c.value.description || "—"
);

const extraDetail = computed(() => {
  const parts = [];
  if (c.value.departureTime) parts.push(`出发 ${c.value.departureTime}`);
  if (c.value.arrivalTime) parts.push(`到达 ${c.value.arrivalTime}`);
  if (c.value.duration) parts.push(`${c.value.duration}`);
  if (c.value.distance) parts.push(`${c.value.distance}`);
  return parts.length ? parts.join(" · ") : null;
});

const formattedTime = computed(() => {
  if (!props.event.occurredAt) return "";
  const d = new Date(props.event.occurredAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
});
</script>

<style scoped>
.timeline-event {
  display: flex;
  margin-bottom: 8px;
  position: relative;
}
.dot {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: 12px;
  color: #1677ff;
  font-size: 18px;
}
.card {
  flex: 1;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 12px 16px;
  position: relative;
}
.card::before {
  content: "";
  position: absolute;
  left: -8px;
  top: 18px;
  width: 8px;
  height: 1px;
  background: #d9d9d9;
}
.head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.time {
  font-size: 12px;
  color: #999;
}
.primary {
  font-size: 14px;
  color: #333;
  font-weight: 500;
  margin-bottom: 6px;
}
.trip-no {
  margin-bottom: 4px;
}
.extra {
  font-size: 12px;
  color: #666;
}
</style>
