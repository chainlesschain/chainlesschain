<template>
  <div class="admin-layout">
    <header class="topbar">
      <RouterLink class="logo" :to="{ name: 'Home' }">ChainlessChain Admin</RouterLink>
      <nav class="nav">
        <RouterLink :to="{ name: 'AdminDashboard' }">仪表盘</RouterLink>
        <RouterLink :to="{ name: 'AdminUsers' }">用户</RouterLink>
        <RouterLink :to="{ name: 'AdminPosts' }">帖子</RouterLink>
        <RouterLink :to="{ name: 'AdminCategories' }">分类</RouterLink>
        <RouterLink :to="{ name: 'AdminReports' }">举报</RouterLink>
      </nav>
    </header>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #111827;
  color: #fff;
}

.logo {
  font-weight: 700;
  color: #fff;
  text-decoration: none;
}

.nav {
  display: flex;
  gap: 12px;
}

.nav a {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  padding: 8px 12px;
  border-radius: 8px;
}

.nav a.router-link-active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.content {
  flex: 1;
  padding: 24px;
}
</style>
