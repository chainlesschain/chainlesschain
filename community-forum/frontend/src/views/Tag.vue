<template>
  <div class="page">
    <h1>标签</h1>
    <p>当前标签：{{ slug }}</p>
    <p>这里会展示带有该标签的帖子。</p>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const slug = route.params.slug
</script>

<style scoped>
.page {
  padding: 24px;
}
</style>
