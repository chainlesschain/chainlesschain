<template>
  <div class="page">
    <h1>分类</h1>
    <p>当前分类：{{ slug }}</p>
    <p>这里会展示该分类下的帖子列表。</p>
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
