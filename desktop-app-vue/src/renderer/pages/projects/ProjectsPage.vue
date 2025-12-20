<template>
  <div class="projects-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <FolderOpenOutlined />
            我的项目
          </h1>
          <p>AI驱动的项目管理，支持Web开发、文档处理、数据分析等多种项目类型</p>
        </div>
        <div class="header-right">
          <a-button type="primary" size="large">
            <PlusOutlined />
            新建项目
          </a-button>
        </div>
      </div>
    </div>

    <!-- 开发中提示 -->
    <div class="placeholder-content">
      <div class="placeholder-icon">
        <FolderOpenOutlined style="font-size: 80px" />
      </div>
      <h2>项目管理模块</h2>
      <p class="subtitle">正在开发中...</p>
      <div class="features">
        <h3>即将支持的功能：</h3>
        <a-row :gutter="[16, 16]" class="feature-grid">
          <a-col :span="8">
            <div class="feature-card">
              <CodeOutlined class="feature-icon" />
              <h4>Web开发项目</h4>
              <p>AI辅助前后端开发</p>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="feature-card">
              <FileTextOutlined class="feature-icon" />
              <h4>文档处理</h4>
              <p>智能文档生成与编辑</p>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="feature-card">
              <BarChartOutlined class="feature-icon" />
              <h4>数据分析</h4>
              <p>数据可视化与洞察</p>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="feature-card">
              <FileImageOutlined class="feature-icon" />
              <h4>图像设计</h4>
              <p>AI辅助设计创作</p>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="feature-card">
              <VideoCameraOutlined class="feature-icon" />
              <h4>视频处理</h4>
              <p>视频编辑与生成</p>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="feature-card">
              <TeamOutlined class="feature-icon" />
              <h4>协作共享</h4>
              <p>项目协作与市场交易</p>
            </div>
          </a-col>
        </a-row>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  FolderOpenOutlined,
  PlusOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';
</script>

<style scoped>
.projects-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-header {
  background: white;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2937;
}

.header-left p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.placeholder-content {
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
  margin: 0 0 48px 0;
}

.features {
  max-width: 1200px;
  margin: 0 auto;
}

.features h3 {
  font-size: 18px;
  font-weight: 500;
  color: #374151;
  margin: 0 0 24px 0;
}

.feature-grid {
  text-align: left;
}

.feature-card {
  background: #f9fafb;
  border-radius: 8px;
  padding: 24px;
  transition: all 0.3s;
  border: 2px solid transparent;
}

.feature-card:hover {
  background: white;
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
}

.feature-icon {
  font-size: 32px;
  color: #667eea;
  margin-bottom: 12px;
}

.feature-card h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.feature-card p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}
</style>
