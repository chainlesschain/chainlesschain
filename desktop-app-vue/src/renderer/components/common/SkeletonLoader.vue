<template>
  <div class="skeleton-loader">
    <div v-if="type === 'project-card'" class="skeleton-project-card">
      <div class="skeleton-header">
        <div class="skeleton-avatar shimmer"></div>
        <div class="skeleton-title-group">
          <div class="skeleton-title shimmer"></div>
          <div class="skeleton-subtitle shimmer"></div>
        </div>
      </div>
      <div class="skeleton-content">
        <div class="skeleton-line shimmer"></div>
        <div class="skeleton-line shimmer"></div>
        <div class="skeleton-line short shimmer"></div>
      </div>
    </div>
    <div v-else-if="type === 'project-list'" class="skeleton-project-list">
      <div v-for="i in count" :key="i" class="skeleton-list-item">
        <div class="skeleton-icon shimmer"></div>
        <div class="skeleton-content-group">
          <div class="skeleton-title shimmer"></div>
          <div class="skeleton-meta shimmer"></div>
        </div>
      </div>
    </div>
    <div v-else class="skeleton-default">
      <div class="skeleton-line shimmer"></div>
      <div class="skeleton-line shimmer"></div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  type: { type: String, default: 'default' },
  count: { type: Number, default: 3 },
});
</script>

<style scoped>
@keyframes shimmer {
  0% { background-position: -468px 0; }
  100% { background-position: 468px 0; }
}
.shimmer {
  background: linear-gradient(90deg, #f0f0f0 0px, #f8f8f8 40px, #f0f0f0 80px);
  background-size: 800px;
  animation: shimmer 2s infinite linear;
}
.skeleton-line {
  height: 16px;
  border-radius: 4px;
  margin-bottom: 12px;
}
.skeleton-line.short {
  width: 60%;
}
.skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.skeleton-project-card {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 16px;
  background: white;
}
.skeleton-header {
  display: flex;
  margin-bottom: 16px;
}
.skeleton-title-group {
  flex: 1;
  margin-left: 12px;
}
.skeleton-title {
  height: 20px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.skeleton-subtitle {
  height: 14px;
  width: 60%;
  border-radius: 4px;
}
.skeleton-project-list .skeleton-list-item {
  display: flex;
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
}
.skeleton-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
}
.skeleton-content-group {
  flex: 1;
  margin-left: 12px;
}
.skeleton-meta {
  height: 12px;
  width: 150px;
}
</style>
