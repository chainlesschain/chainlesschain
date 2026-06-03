<template>
  <view class="project-chat-page">
    <!-- 开发中提示 -->
    <view class="placeholder-content">
      <view class="placeholder-icon">🤖</view>
      <text class="placeholder-title">项目AI助手</text>
      <text class="placeholder-subtitle">功能开发中...</text>
      <text class="placeholder-desc">即将支持：</text>
      <view class="feature-list">
        <view class="feature-item">✅ 自然语言对话操作项目</view>
        <view class="feature-item">✅ AI生成代码/文档/数据</view>
        <view class="feature-item">✅ 流式响应显示</view>
        <view class="feature-item">✅ 文件预览和下载</view>
        <view class="feature-item">✅ 任务状态跟踪</view>
        <view class="feature-item">✅ @引用知识库</view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {}
  }
}
</script>

<style scoped>
.project-chat-page {
  min-height: 100vh;
  background: #f5f5f5;
  padding: 20px;
}

.placeholder-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
  text-align: center;
}

.placeholder-icon {
  font-size: 80px;
  margin-bottom: 20px;
}

.placeholder-title {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.placeholder-subtitle {
  font-size: 16px;
  color: #999;
  margin-bottom: 30px;
}

.placeholder-desc {
  font-size: 14px;
  color: #666;
  margin-bottom: 16px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.feature-item {
  font-size: 14px;
  color: #333;
  text-align: left;
}
</style>
