<template>
  <div class="page">
    <h1>帖子详情</h1>
    <p>帖子 ID：{{ id }}</p>
    <p>这里会展示帖子的内容和评论。</p>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const id = route.params.id
</script>

<style scoped>
.page {
  padding: 24px;
}
</style>
