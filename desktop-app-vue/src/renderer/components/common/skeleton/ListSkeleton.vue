<template>
  <div class="list-skeleton">
    <div
      v-for="i in rows"
      :key="i"
      class="list-item-skeleton"
      :style="{ animationDelay: `${i * 0.05}s` }"
    >
      <div class="item-icon skeleton-box" />
      <div class="item-content">
        <div
          class="skeleton-box title"
          :style="{ width: getTitleWidth(i) }"
        />
        <div
          class="skeleton-box description"
          :style="{ width: getDescWidth(i) }"
        />
      </div>
      <div class="item-meta skeleton-box" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  rows: {
    type: Number,
    default: 8
  }
})

const getTitleWidth = (index) => {
  const widths = [70, 60, 80, 65, 75, 55, 85, 70]
  return `${widths[index % widths.length]}%`
}

const getDescWidth = (index) => {
  const widths = [90, 85, 95, 80, 92, 88, 93, 87]
  return `${widths[index % widths.length]}%`
}
</script>

<style scoped>
.list-skeleton {
  padding: 8px 0;
}

.list-item-skeleton {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  opacity: 0;
  animation: fadeIn 0.3s ease-out forwards;
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}

.item-icon {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  height: 16px;
}

.description {
  height: 14px;
}

.item-meta {
  width: 60px;
  height: 20px;
  flex-shrink: 0;
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
.dark .list-item-skeleton {
  border-bottom-color: #3e3e3e;
}

.dark .skeleton-box {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
}
</style>
