<template>
  <div class="page">
    <h1>404</h1>
    <p>页面不存在，返回首页吧。</p>
    <RouterLink class="link" :to="{ name: 'Home' }">回首页</RouterLink>
  </div>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.page {
  padding: 24px;
  text-align: center;
}

.link {
  color: #409eff;
  text-decoration: none;
}
</style>
