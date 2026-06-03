<template>
  <div class="chat-skeleton">
    <div
      v-for="i in messages"
      :key="i"
      class="message-skeleton"
      :class="{ 'user-message': i % 3 === 0 }"
      :style="{ animationDelay: `${i * 0.1}s` }"
    >
      <div class="message-avatar skeleton-box" />
      <div class="message-content">
        <div class="message-header">
          <div class="skeleton-box username" />
          <div class="skeleton-box timestamp" />
        </div>
        <div class="message-text">
          <div
            class="skeleton-box text-line"
            :style="{ width: getLineWidth(i, 0) }"
          />
          <div
            class="skeleton-box text-line"
            :style="{ width: getLineWidth(i, 1) }"
          />
          <div
            v-if="i % 2 === 0"
            class="skeleton-box text-line"
            :style="{ width: getLineWidth(i, 2) }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  messages: {
    type: Number,
    default: 5
  }
})

const getLineWidth = (messageIndex, lineIndex) => {
  const widths = [
    [90, 85, 60],
    [80, 75, 0],
    [95, 88, 70],
    [85, 0, 0],
    [92, 80, 65]
  ]

  const pattern = widths[messageIndex % widths.length]
  return pattern[lineIndex] ? `${pattern[lineIndex]}%` : '0'
}
</script>

<style scoped>
.chat-skeleton {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.message-skeleton {
  display: flex;
  gap: 12px;
  opacity: 0;
  animation: fadeInUp 0.4s ease-out forwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.user-message {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  max-width: 70%;
}

.user-message .message-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.message-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}

.username {
  width: 80px;
  height: 14px;
}

.timestamp {
  width: 50px;
  height: 12px;
}

.message-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.text-line {
  height: 16px;
}

.skeleton-box {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: skeleton-loading 1.5s ease-in-out infinite;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* 暗色主题 */
.dark .skeleton-box {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
}
</style>
