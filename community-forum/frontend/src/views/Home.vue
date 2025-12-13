<template>
  <div class="home-page">
    <header class="hero">
      <div>
        <p class="eyebrow">ChainlessChain 社区</p>
        <h1>欢迎回家</h1>
        <p class="subtitle">讨论、分享、共建去中心化 AI 生态。</p>
        <div class="actions">
          <RouterLink class="btn primary" :to="{ name: 'CreatePost' }">立即发帖</RouterLink>
          <RouterLink class="btn ghost" :to="{ name: 'Search' }">浏览内容</RouterLink>
        </div>
      </div>
    </header>

    <section class="quick-links">
      <RouterLink class="card" :to="{ name: 'Category', params: { slug: 'announcements' } }">
        <h3>公告</h3>
        <p>了解最新更新和路线图。</p>
      </RouterLink>
      <RouterLink class="card" :to="{ name: 'Category', params: { slug: 'qa' } }">
        <h3>问答</h3>
        <p>提出问题或帮助其他用户。</p>
      </RouterLink>
      <RouterLink class="card" :to="{ name: 'Category', params: { slug: 'showcase' } }">
        <h3>作品展示</h3>
        <p>分享你的插件、脚本或案例。</p>
      </RouterLink>
    </section>
  </div>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.home-page {
  padding: 40px 24px;
}

.hero {
  background: linear-gradient(135deg, #1f6feb, #5a9bff);
  color: #fff;
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 32px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
}

.eyebrow {
  font-size: 12px;
  letter-spacing: 2px;
  text-transform: uppercase;
  opacity: 0.8;
  margin: 0 0 8px;
}

h1 {
  margin: 0 0 8px;
  font-size: 32px;
}

.subtitle {
  margin: 0 0 16px;
  opacity: 0.9;
  font-size: 16px;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
}

.btn.primary {
  background: #fff;
  color: #1f6feb;
}

.btn.primary:hover {
  background: #e9f1ff;
}

.btn.ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

.btn.ghost:hover {
  border-color: #fff;
}

.quick-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.card {
  display: block;
  padding: 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  color: inherit;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.card h3 {
  margin: 0 0 6px;
}

.card p {
  margin: 0;
  color: #4b5563;
  font-size: 14px;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
}
@media (max-width: 640px) {
  .hero {
    padding: 24px;
  }

  h1 {
    font-size: 26px;
  }

  .actions {
    flex-direction: column;
  }
}
</style>
