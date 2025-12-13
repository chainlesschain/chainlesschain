<template>
  <div class="page">
    <h1>编辑帖子</h1>
    <p>帖子 ID：{{ id }}</p>
    <p>这里将提供编辑表单。</p>
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
