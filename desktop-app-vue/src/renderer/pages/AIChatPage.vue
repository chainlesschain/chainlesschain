<template>
  <div class="ai-chat-page">
    <div class="page-container">
      <div class="placeholder-content">
        <div class="placeholder-icon">
          <RobotOutlined style="font-size: 80px" />
        </div>
        <h2>AI对话</h2>
        <p class="subtitle">功能开发中...</p>
        <p class="description">
          支持与AI进行自然语言对话，完成各类任务：文档生成、代码编写、数据分析等。
          可以将对话结果保存到知识库或创建为项目。
        </p>
        <div class="features-grid">
          <div class="feature-item">
            <MessageOutlined class="feature-icon" />
            <h4>智能对话</h4>
            <p>上下文理解与多轮对话</p>
          </div>
          <div class="feature-item">
            <ThunderboltOutlined class="feature-icon" />
            <h4>快速响应</h4>
            <p>实时流式输出</p>
          </div>
          <div class="feature-item">
            <SaveOutlined class="feature-icon" />
            <h4>保存对话</h4>
            <p>对话记录持久化</p>
          </div>
          <div class="feature-item">
            <FolderOutlined class="feature-icon" />
            <h4>创建项目</h4>
            <p>从对话创建项目</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  RobotOutlined,
  MessageOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  FolderOutlined,
} from '@ant-design/icons-vue';
</script>

<style scoped>
.ai-chat-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-container {
  background: white;
  border-radius: 8px;
  padding: 60px 40px;
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
  margin: 0 auto 48px auto;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.feature-item {
  padding: 24px;
  background: #f9fafb;
  border-radius: 8px;
  transition: all 0.3s;
}

.feature-item:hover {
  background: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.feature-icon {
  font-size: 32px;
  color: #667eea;
  margin-bottom: 12px;
}

.feature-item h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.feature-item p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}
</style>
