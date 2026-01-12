<template>
  <view class="scan-container">
    <!-- 扫描区域 -->
    <view class="scan-area">
      <!-- 扫描框 -->
      <view class="scan-box">
        <view class="corner corner-tl"></view>
        <view class="corner corner-tr"></view>
        <view class="corner corner-bl"></view>
        <view class="corner corner-br"></view>
        <view class="scan-line" :class="{ 'scanning': isScanning }"></view>
      </view>

      <!-- 提示文字 -->
      <text class="scan-tip">将二维码放入框内，即可自动扫描</text>
    </view>

    <!-- 底部操作栏 -->
    <view class="action-bar">
      <view class="action-item" @click="toggleFlash">
        <text class="action-icon">{{ flashOn ? '🔦' : '💡' }}</text>
        <text class="action-label">{{ flashOn ? '关闭' : '开启' }}闪光灯</text>
      </view>

      <view class="action-item" @click="scanFromAlbum">
        <text class="action-icon">🖼️</text>
        <text class="action-label">相册</text>
      </view>

      <view class="action-item" @click="goBack">
        <text class="action-icon">❌</text>
        <text class="action-label">取消</text>
      </view>
    </view>

    <!-- 扫描历史 -->
    <view v-if="scanHistory.length > 0" class="history-section">
      <view class="history-header">
        <text class="history-title">扫描历史</text>
        <text class="clear-btn" @click="clearHistory">清空</text>
      </view>
      <scroll-view class="history-list" scroll-y>
        <view
          v-for="(item, index) in scanHistory"
          :key="index"
          class="history-item"
          @click="handleHistoryItem(item)"
        >
          <text class="history-content">{{ item.content }}</text>
          <text class="history-time">{{ formatTime(item.timestamp) }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import qrcodeService from '@/services/qrcode'

export default {
  data() {
    return {
      isScanning: false,
      flashOn: false,
      scanHistory: []
    }
  },

  onLoad() {
    this.startScan()
    this.loadHistory()
  },

  onUnload() {
    this.stopScan()
  },

  methods: {
    /**
     * 开始扫描
     */
    async startScan() {
      this.isScanning = true

      try {
        const result = await qrcodeService.scanQRCode()
        this.handleScanResult(result)
      } catch (error) {
        console.error('扫描失败:', error)
        if (error.message !== '用户取消') {
          uni.showToast({
            title: '扫描失败',
            icon: 'none'
          })
        }
        this.goBack()
      }
    },

    /**
     * 停止扫描
     */
    stopScan() {
      this.isScanning = false
    },

    /**
     * 处理扫描结果
     */
    handleScanResult(result) {
      console.log('扫描结果:', result)

      // 保存到历史
      this.addToHistory(result)

      // 震动反馈
      uni.vibrateShort()

      // 返回结果
      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]

      if (prevPage) {
        // 通过事件通道返回结果
        const eventChannel = this.getOpenerEventChannel()
        if (eventChannel) {
          eventChannel.emit('scanResult', { result })
        }
      }

      // 延迟返回，让用户看到结果
      setTimeout(() => {
        uni.navigateBack()
      }, 500)
    },

    /**
     * 从相册选择
     */
    async scanFromAlbum() {
      try {
        const result = await qrcodeService.scanFromAlbum()
        this.handleScanResult(result)
      } catch (error) {
        console.error('识别失败:', error)
        uni.showToast({
          title: '未识别到二维码',
          icon: 'none'
        })
      }
    },

    /**
     * 切换闪光灯
     */
    toggleFlash() {
      // #ifdef APP-PLUS
      this.flashOn = !this.flashOn
      // 调用原生方法控制闪光灯
      // plus.camera.getCamera().setFlash(this.flashOn)
      // #endif

      // #ifdef MP-WEIXIN
      uni.showToast({
        title: '小程序暂不支持',
        icon: 'none'
      })
      // #endif
    },

    /**
     * 添加到历史
     */
    addToHistory(content) {
      const item = {
        content,
        timestamp: Date.now()
      }

      this.scanHistory.unshift(item)

      // 最多保存20条
      if (this.scanHistory.length > 20) {
        this.scanHistory = this.scanHistory.slice(0, 20)
      }

      // 保存到本地
      this.saveHistory()
    },

    /**
     * 加载历史
     */
    loadHistory() {
      try {
        const history = uni.getStorageSync('scan_history')
        if (history) {
          this.scanHistory = JSON.parse(history)
        }
      } catch (error) {
        console.error('加载历史失败:', error)
      }
    },

    /**
     * 保存历史
     */
    saveHistory() {
      try {
        uni.setStorageSync('scan_history', JSON.stringify(this.scanHistory))
      } catch (error) {
        console.error('保存历史失败:', error)
      }
    },

    /**
     * 清空历史
     */
    clearHistory() {
      uni.showModal({
        title: '确认清空',
        content: '确定要清空扫描历史吗？',
        success: (res) => {
          if (res.confirm) {
            this.scanHistory = []
            this.saveHistory()
            uni.showToast({
              title: '已清空',
              icon: 'success'
            })
          }
        }
      })
    },

    /**
     * 处理历史记录点击
     */
    handleHistoryItem(item) {
      qrcodeService.handleScanResult(item.content)
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) {
        return '刚刚'
      } else if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`
      } else if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`
      } else {
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
    },

    /**
     * 返回
     */
    goBack() {
      uni.navigateBack()
    }
  }
}
</script>

<style scoped>
.scan-container {
  width: 100vw;
  height: 100vh;
  background: #000;
  display: flex;
  flex-direction: column;
}

/* 扫描区域 */
.scan-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}

/* 扫描框 */
.scan-box {
  width: 280px;
  height: 280px;
  position: relative;
}

/* 四个角 */
.corner {
  position: absolute;
  width: 40px;
  height: 40px;
  border: 3px solid #667eea;
}

.corner-tl {
  top: 0;
  left: 0;
  border-right: none;
  border-bottom: none;
}

.corner-tr {
  top: 0;
  right: 0;
  border-left: none;
  border-bottom: none;
}

.corner-bl {
  bottom: 0;
  left: 0;
  border-right: none;
  border-top: none;
}

.corner-br {
  bottom: 0;
  right: 0;
  border-left: none;
  border-top: none;
}

/* 扫描线 */
.scan-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #667eea, transparent);
  animation: scan 2s linear infinite;
}

.scan-line.scanning {
  animation-play-state: running;
}

@keyframes scan {
  0% {
    top: 0;
  }
  100% {
    top: 100%;
  }
}

/* 提示文字 */
.scan-tip {
  position: absolute;
  bottom: 80px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

/* 操作栏 */
.action-bar {
  display: flex;
  justify-content: space-around;
  padding: 32px 20px;
  padding-bottom: calc(32px + env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.5);
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.action-icon {
  font-size: 32px;
}

.action-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

/* 历史记录 */
.history-section {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 40vh;
  background: rgba(0, 0, 0, 0.8);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.history-title {
  font-size: 15px;
  font-weight: 600;
  color: white;
}

.clear-btn {
  font-size: 13px;
  color: #667eea;
}

.history-list {
  max-height: 200px;
}

.history-item {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-content {
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin-left: 12px;
}
</style>
