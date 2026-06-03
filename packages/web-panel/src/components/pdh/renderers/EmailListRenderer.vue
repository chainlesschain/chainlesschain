<template>
  <div class="email-row">
    <div class="left">
      <MailOutlined class="icon" :class="{ unread: isUnread }" />
    </div>
    <div class="body">
      <div class="head">
        <span class="from">{{ fromText }}</span>
        <span class="time">{{ formattedTime }}</span>
      </div>
      <div class="subject">{{ subjectText }}</div>
      <div v-if="snippetText" class="snippet">{{ snippetText }}</div>
      <div class="meta">
        <a-tag color="blue" class="src">{{ event.source.adapter }}</a-tag>
        <a-tag v-if="attachmentCount > 0" color="orange">
          📎 {{ attachmentCount }}
        </a-tag>
        <a-tag v-if="category">{{ category }}</a-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { MailOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const c = computed(() => props.event.content || {});
const e = computed(() => props.event.extra || {});

const fromText = computed(
  () => c.value.from || c.value.sender || c.value.fromName || props.event.actor || "(未知发件人)"
);
const subjectText = computed(
  () => c.value.subject || c.value.title || "(无主题)"
);
const snippetText = computed(
  () => c.value.snippet || c.value.preview || c.value.body?.slice(0, 100) || null
);
const attachmentCount = computed(() => {
  if (Array.isArray(c.value.attachments)) return c.value.attachments.length;
  if (typeof c.value.attachmentCount === "number") return c.value.attachmentCount;
  return 0;
});
const category = computed(() => e.value.category || c.value.category);
const isUnread = computed(() => c.value.unread === true);

const formattedTime = computed(() => {
  if (!props.event.occurredAt) return "";
  const d = new Date(props.event.occurredAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
});
</script>

<style scoped>
.email-row {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  margin-bottom: 8px;
}
.left {
  display: flex;
  align-items: flex-start;
  padding-top: 4px;
}
.left .icon {
  font-size: 18px;
  color: #999;
}
.left .icon.unread {
  color: #1677ff;
}
.body {
  flex: 1;
  min-width: 0;
}
.head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.from {
  font-weight: 600;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}
.time {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
  margin-left: 8px;
}
.subject {
  font-size: 14px;
  color: #333;
  margin-bottom: 4px;
  font-weight: 500;
}
.snippet {
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
}
.meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.src {
  font-size: 10px;
}
</style>
