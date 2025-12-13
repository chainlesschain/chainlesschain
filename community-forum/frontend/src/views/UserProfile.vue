<template>
  <div class="page">
    <h1>用户主页</h1>
    <p>用户 ID：{{ id }}</p>
    <p>这里会展示用户信息和帖子。</p>
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
