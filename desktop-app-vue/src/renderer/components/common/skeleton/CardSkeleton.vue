<template>
  <div class="card-skeleton">
    <div class="card-header">
      <div class="skeleton-box avatar"></div>
      <div class="header-content">
        <div class="skeleton-box title"></div>
        <div class="skeleton-box subtitle"></div>
      </div>
    </div>

    <div class="card-image skeleton-box"></div>

    <div class="card-content">
      <div class="skeleton-box line" v-for="i in 3" :key="i" :style="{ width: getWidth(i) }"></div>
    </div>

    <div class="card-actions">
      <div class="skeleton-box action-button" v-for="i in 3" :key="'action' + i"></div>
    </div>
  </div>
</template>

<script setup>
const getWidth = (index) => {
  const widths = [100, 95, 70]
  return `${widths[index - 1]}%`
}
</script>

<style scoped>
.card-skeleton {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.card-header {
  display: flex;
  gap: 12px;
  padding: 16px;
}

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
}

.header-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
}

.title {
  width: 150px;
  height: 18px;
}

.subtitle {
  width: 100px;
  height: 14px;
}

.card-image {
  width: 100%;
  height: 200px;
}

.card-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.line {
  height: 16px;
}

.card-actions {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid #f0f0f0;
}

.action-button {
  width: 80px;
  height: 32px;
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
.dark .card-skeleton {
  background: #1f1f1f;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.dark .skeleton-box {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
}

.dark .card-actions {
  border-top-color: #3e3e3e;
}
</style>
