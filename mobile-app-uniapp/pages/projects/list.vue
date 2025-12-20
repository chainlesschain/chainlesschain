<template>
  <view class="projects-page">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <view class="search-input">
        <text class="search-icon">🔍</text>
        <input type="text" placeholder="搜索项目..." disabled />
      </view>
    </view>

    <!-- 项目分类Tab -->
    <view class="project-tabs">
      <view class="tab-item active">
        <text>全部</text>
      </view>
      <view class="tab-item">
        <text>进行中</text>
      </view>
      <view class="tab-item">
        <text>已完成</text>
      </view>
      <view class="tab-item">
        <text>协作</text>
      </view>
    </view>

    <!-- 开发中提示 -->
    <view class="placeholder-content">
      <view class="placeholder-icon">🚧</view>
      <text class="placeholder-title">项目管理模块</text>
      <text class="placeholder-subtitle">正在开发中...</text>
      <text class="placeholder-desc">即将支持：</text>
      <view class="feature-list">
        <view class="feature-item">✅ 创建和管理项目</view>
        <view class="feature-item">✅ AI对话式操作项目</view>
        <view class="feature-item">✅ Web开发、文档处理、数据分析</view>
        <view class="feature-item">✅ PPT制作、视频处理、图像设计</view>
        <view class="feature-item">✅ 项目协作与分享</view>
        <view class="feature-item">✅ 项目市场与交易</view>
      </view>
    </view>

    <!-- 快速创建按钮 -->
    <view class="fab-button" @click="showCreateTip">
      <text class="fab-icon">➕</text>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      // 占位数据
    }
  },
  methods: {
    showCreateTip() {
      uni.showToast({
        title: '功能开发中',
        icon: 'none',
        duration: 2000
      })
    }
  }
}
</script>

<style scoped>
.projects-page {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: calc(env(safe-area-inset-bottom) + 50px);
}

/* 搜索栏 */
.search-bar {
  background: white;
  padding: 12px 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.search-input {
  display: flex;
  align-items: center;
  background: #f5f5f5;
  border-radius: 20px;
  padding: 8px 16px;
}

.search-icon {
  font-size: 16px;
  margin-right: 8px;
}

.search-input input {
  flex: 1;
  font-size: 14px;
  border: none;
  background: transparent;
}

/* 分类Tab */
.project-tabs {
  display: flex;
  background: white;
  padding: 12px 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 8px 12px;
  font-size: 14px;
  color: #666;
  border-radius: 8px;
  transition: all 0.3s;
}

.tab-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
}

/* 占位内容 */
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

/* 悬浮按钮 */
.fab-button {
  position: fixed;
  right: 20px;
  bottom: calc(env(safe-area-inset-bottom) + 70px);
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.fab-icon {
  font-size: 24px;
  color: white;
}
</style>
