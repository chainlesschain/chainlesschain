<template>
  <div class="new-project-page">
    <div class="page-container">
      <div class="placeholder-content">
        <div class="placeholder-icon">
          <PlusCircleOutlined style="font-size: 80px" />
        </div>
        <h2>新建项目</h2>
        <p class="subtitle">功能开发中...</p>
        <p class="description">
          支持通过AI对话创建各类项目：Web开发、文档处理、数据分析、PPT制作、视频处理、图像设计等
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { PlusCircleOutlined } from '@ant-design/icons-vue';
</script>

<style scoped>
.new-project-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-container {
  background: white;
  border-radius: 8px;
  padding: 80px 40px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.placeholder-icon {
  color: #667eea;
  margin-bottom: 24px;
}

.placeholder-content h2 {
  font-size: 28px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #9ca3af;
  font-size: 16px;
  margin: 0 0 16px 0;
}

.description {
  color: #6b7280;
  font-size: 14px;
  max-width: 600px;
  margin: 0 auto;
}
</style>
