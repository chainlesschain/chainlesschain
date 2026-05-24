<template>
  <div class="chat-row" :class="{ mine: isMine }">
    <div class="bubble">
      <div class="meta">
        <span class="actor">{{ actorLabel }}</span>
        <span class="time">{{ formattedTime }}</span>
      </div>
      <div class="body">{{ messageText }}</div>
      <a-tag v-if="event.source.adapter" class="src" :color="adapterColor">
        {{ event.source.adapter }}
      </a-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const messageText = computed(() => {
  const c = props.event.content || {};
  return c.text || c.body || c.message || c.title || JSON.stringify(c).slice(0, 200);
});

const actorLabel = computed(() => {
  const c = props.event.content || {};
  return c.from || c.sender || c.senderName || props.event.actor || "(unknown)";
});

// Heuristic: events whose actor looks like the user's own id (wxid_self,
// or anything matching "self" / "me") get right-aligned. Vault has no
// owner field — caller would need to plumb the user's own id in for a
// precise check. This is good-enough for visual variety.
const isMine = computed(() => {
  const a = (props.event.actor || "").toLowerCase();
  return a.includes("self") || a === "me" || a.endsWith("_self");
});

const adapterColor = computed(() => {
  const a = props.event.source.adapter || "";
  if (a.startsWith("messaging-qq")) return "magenta";
  if (a === "wechat") return "green";
  return "blue";
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
</script>

<style scoped>
.chat-row {
  display: flex;
  margin-bottom: 8px;
  justify-content: flex-start;
}
.chat-row.mine {
  justify-content: flex-end;
}
.bubble {
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 12px;
  padding: 8px 12px;
  max-width: 70%;
  position: relative;
}
.chat-row.mine .bubble {
  background: #e6f4ff;
  border-color: #91caff;
}
.meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
  margin-bottom: 4px;
}
.actor {
  font-weight: 600;
  color: #333;
}
.body {
  font-size: 13px;
  color: #333;
  word-break: break-word;
  white-space: pre-wrap;
}
.src {
  font-size: 10px;
  margin-top: 4px;
}
</style>
