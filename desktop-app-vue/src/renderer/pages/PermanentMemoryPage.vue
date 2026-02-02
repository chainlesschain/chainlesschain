<template>
  <div class="permanent-memory-page">
    <PermanentMemoryPanel />
  </div>
</template>

<script setup>
import { PermanentMemoryPanel } from '@/components/memory';
</script>

<style scoped>
.permanent-memory-page {
  height: 100%;
  overflow: hidden;
  background: var(--bg-color, #fff);
}
</style>
