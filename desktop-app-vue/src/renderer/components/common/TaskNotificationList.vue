<template>
  <section class="task-notifications" aria-label="任务通知">
    <div class="task-notifications-header">
      <strong
        >任务通知<span v-if="store.unreadCount"
          >（{{ store.unreadCount }} 条未读）</span
        ></strong
      >
      <a-button size="small" :loading="store.loading" @click="store.load()"
        >刷新</a-button
      >
    </div>
    <p v-if="store.error" role="alert">{{ store.error }}</p>
    <p v-else-if="!visible.length">暂无任务通知</p>
    <div
      v-for="notice in visible"
      :key="notice.id"
      class="task-notice"
      :data-notice-id="notice.id"
    >
      <a-button type="link" @click="open(notice.id)"
        >有人在任务中提及你{{
          notice.isRead ? "（已读）" : "（未读）"
        }}</a-button
      >
      <p>打开任务以复核当前内容与访问权限。</p>
      <time>{{ new Date(notice.createdAt).toLocaleString() }}</time>
      <a-button
        v-if="!notice.isRead"
        size="small"
        @click="store.markRead(notice.id)"
        >标记已读</a-button
      >
    </div>
    <small v-if="store.notices.length"
      >仅显示最近 50 条；清空普通通知不会删除任务通知。</small
    >
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useTaskNotificationsStore } from "../../stores/task-notifications";
const props = defineProps<{ unreadOnly?: boolean }>();
const store = useTaskNotificationsStore();
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
      name: "TaskBoard",
      params: { id: target.boardId },
      query: { taskId: target.taskId, taskNoticeId: id },
    });
}
</script>
<style scoped>
.task-notifications {
  padding: 16px;
  border-bottom: 1px solid #eee;
}
.task-notifications-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.task-notice {
  margin: 12px 0;
}
.task-notice p {
  margin: 4px 0;
}
.task-notice time {
  margin-right: 8px;
  color: #888;
  font-size: 12px;
}
</style>
