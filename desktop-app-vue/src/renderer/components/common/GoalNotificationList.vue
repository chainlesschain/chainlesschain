<template>
  <section class="goal-notifications" aria-label="目标通知">
    <div class="goal-notifications-header">
      <strong
        >目标通知<span v-if="store.unreadCount"
          >（{{ store.unreadCount }} 条未读）</span
        ></strong
      >
      <a-button size="small" :loading="store.loading" @click="store.load()"
        >刷新</a-button
      >
    </div>
    <p v-if="store.error" role="alert">{{ store.error }}</p>
    <p v-else-if="!visible.length">暂无目标通知</p>
    <div
      v-for="notice in visible"
      :key="notice.id"
      class="goal-notice"
      :data-notice-id="notice.id"
    >
      <a-button type="link" @click="open(notice.id)"
        >目标状态有更新{{ notice.isRead ? "（已读）" : "（未读）" }}</a-button
      >
      <p>通知记录此前一次检查；打开目标复核当前状态与待确认建议。</p>
      <time>{{ new Date(notice.createdAt).toLocaleString() }}</time>
      <a-button
        v-if="!notice.isRead"
        size="small"
        @click="store.markRead(notice.id)"
        >标记已读</a-button
      >
    </div>
    <small v-if="store.notices.length"
      >仅显示最近 50 条；清空普通通知不会删除目标证据。</small
    >
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useGoalNotificationsStore } from "../../stores/goal-notifications";
const props = defineProps<{ unreadOnly?: boolean }>();
const store = useGoalNotificationsStore();
const router = useRouter();
const visible = computed(() =>
  store.notices.filter((item) => !props.unreadOnly || !item.isRead),
);
let detach: (() => void) | undefined;
onMounted(() => {
  detach = store.attach();
});
onBeforeUnmount(() => {
  detach?.();
});
async function open(id: string) {
  const target = await store.open(id);
  if (target)
    await router.push({
      name: "ProjectDetail",
      params: { id: target.projectId },
      query: { goalId: target.goalId, goalNoticeId: id },
    });
}
</script>
<style scoped>
.goal-notifications {
  padding: 16px;
  border-bottom: 1px solid #eee;
}
.goal-notifications-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.goal-notice {
  margin: 12px 0;
}
.goal-notice p {
  margin: 4px 0;
}
.goal-notice time {
  margin-right: 8px;
  color: #888;
  font-size: 12px;
}
</style>
