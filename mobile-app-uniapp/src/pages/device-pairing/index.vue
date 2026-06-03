<template>
  <view class="pairing-container">
    <view class="pairing-header">
      <text class="pairing-title">设备配对</text>
      <text class="pairing-subtitle">使用PC端扫描此二维码完成配对</text>
    </view>

    <!-- 二维码显示区域 -->
    <view class="qrcode-container" v-if="pairingStatus === 'generating' || pairingStatus === 'waiting'">
      <view class="qrcode-wrapper">
        <!-- 使用canvas绘制二维码或使用第三方组件 -->
        <canvas v-if="qrCodeData" canvas-id="qrcode" class="qrcode-canvas"></canvas>

        <!-- 如果是文本数据，显示提示 -->
        <view v-else class="qrcode-text">
          <text>{{ qrCodeText }}</text>
        </view>
      </view>

      <!-- 配对码 -->
      <view class="pairing-code-section">
        <text class="pairing-code-label">配对码</text>
        <text class="pairing-code">{{ pairingCode }}</text>
        <text class="pairing-code-hint">PC端也可手动输入配对码</text>
      </view>

      <!-- 倒计时 -->
      <view class="countdown">
        <text>二维码有效期：{{ countdown }}秒</text>
      </view>
    </view>

    <!-- 加载状态 -->
    <view class="loading-container" v-if="pairingStatus === 'connecting'">
      <view class="loading-icon"></view>
      <text class="loading-text">正在建立连接...</text>
    </view>

    <!-- 成功状态 -->
    <view class="success-container" v-if="pairingStatus === 'success'">
      <view class="success-icon">✓</view>
      <text class="success-title">配对成功！</text>
      <text class="success-subtitle">{{ pcDeviceName }}</text>
      <button class="btn-primary" @tap="goToHome">完成</button>
    </view>

    <!-- 失败状态 -->
    <view class="error-container" v-if="pairingStatus === 'error'">
      <view class="error-icon">✗</view>
      <text class="error-title">配对失败</text>
      <text class="error-message">{{ errorMessage }}</text>
      <button class="btn-primary" @tap="retry">重试</button>
    </view>

    <!-- 操作按钮 -->
    <view class="actions" v-if="pairingStatus === 'waiting'">
      <button class="btn-secondary" @tap="cancelPairing">取消</button>
      <button class="btn-primary" @tap="refreshQRCode">刷新二维码</button>
    </view>
  </view>
</template>

<script>
import { getDevicePairingService } from '@/services/device-pairing'
import { getP2PManager } from '@/services/p2p/p2p-manager'

export default {
  data() {
    return {
      // 配对状态：idle | generating | waiting | connecting | success | error
      pairingStatus: 'idle',

      // 二维码数据
      qrCodeData: null,
      qrCodeText: '',
      pairingCode: '',

      // 倒计时
      countdown: 300, // 5分钟
      countdownTimer: null,

      // PC设备信息
      pcDevice: null,
      pcDeviceName: '',

      // 错误信息
      errorMessage: ''
    }
  },

  async onLoad() {
    await this.initPairing()
  },

  onUnload() {
    this.cleanup()
  },

  methods: {
    /**
     * 初始化配对
     */
    async initPairing() {
      try {
        this.pairingStatus = 'generating'

        // 初始化服务
        const pairingService = getDevicePairingService()
        await pairingService.initialize()

        // 设置回调
        pairingService.onPairingSuccess = this.handlePairingSuccess
        pairingService.onPairingFailed = this.handlePairingFailed

        // 启动配对流程
        const result = await pairingService.startPairing()

        this.qrCodeData = result.qrCode
        this.pairingCode = result.pairingCode
        this.pairingStatus = 'waiting'

        // 如果qrCode是base64图片，渲染到canvas
        if (typeof result.qrCode === 'string' && result.qrCode.startsWith('data:image')) {
          this.renderQRCodeImage(result.qrCode)
        } else {
          // 否则显示为文本
          this.qrCodeText = result.qrCode
        }

        // 启动倒计时
        this.startCountdown()

      } catch (error) {
        console.error('[DevicePairing] 初始化配对失败:', error)
        this.pairingStatus = 'error'
        this.errorMessage = error.message || '初始化失败'
      }
    },

    /**
     * 渲染二维码图片
     */
    renderQRCodeImage(base64Image) {
      // 使用canvas API渲染base64图片
      const ctx = uni.createCanvasContext('qrcode', this)

      // 这里简化处理，实际需要将base64转为临时路径
      // 然后使用ctx.drawImage绘制

      ctx.draw()
    },

    /**
     * 启动倒计时
     */
    startCountdown() {
      this.countdown = 300

      if (this.countdownTimer) {
        clearInterval(this.countdownTimer)
      }

      this.countdownTimer = setInterval(() => {
        this.countdown--

        if (this.countdown <= 0) {
          this.handleTimeout()
        }
      }, 1000)
    },

    /**
     * 处理超时
     */
    handleTimeout() {
      clearInterval(this.countdownTimer)
      this.pairingStatus = 'error'
      this.errorMessage = '二维码已过期，请刷新重试'
    },

    /**
     * 刷新二维码
     */
    async refreshQRCode() {
      this.cleanup()
      await this.initPairing()
    },

    /**
     * 取消配对
     */
    cancelPairing() {
      const pairingService = getDevicePairingService()
      pairingService.cancelPairing()

      uni.navigateBack()
    },

    /**
     * 配对成功回调
     */
    handlePairingSuccess(pcDevice) {
      console.log('[DevicePairing] 配对成功:', pcDevice)

      this.pairingStatus = 'success'
      this.pcDevice = pcDevice
      this.pcDeviceName = pcDevice.deviceInfo?.name || 'PC设备'

      this.cleanup()
    },

    /**
     * 配对失败回调
     */
    handlePairingFailed(error) {
      console.error('[DevicePairing] 配对失败:', error)

      this.pairingStatus = 'error'
      this.errorMessage = error.message || '配对失败'

      this.cleanup()
    },

    /**
     * 重试
     */
    async retry() {
      await this.initPairing()
    },

    /**
     * 前往首页
     */
    goToHome() {
      uni.reLaunch({
        url: '/pages/index/index'
      })
    },

    /**
     * 清理资源
     */
    cleanup() {
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer)
        this.countdownTimer = null
      }
    }
  }
}
</script>

<style scoped>
.pairing-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx;
  min-height: 100vh;
  background-color: #f5f5f5;
}

.pairing-header {
  text-align: center;
  margin-bottom: 60rpx;
}

.pairing-title {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
  display: block;
  margin-bottom: 20rpx;
}

.pairing-subtitle {
  font-size: 28rpx;
  color: #666;
  display: block;
}

.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrcode-wrapper {
  width: 500rpx;
  height: 500rpx;
  background-color: #fff;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.1);
  margin-bottom: 40rpx;
}

.qrcode-canvas {
  width: 450rpx;
  height: 450rpx;
}

.qrcode-text {
  padding: 40rpx;
  word-break: break-all;
  font-size: 24rpx;
  color: #999;
  text-align: center;
}

.pairing-code-section {
  text-align: center;
  margin-bottom: 40rpx;
}

.pairing-code-label {
  font-size: 28rpx;
  color: #666;
  display: block;
  margin-bottom: 10rpx;
}

.pairing-code {
  font-size: 56rpx;
  font-weight: bold;
  color: #1890ff;
  letter-spacing: 10rpx;
  display: block;
  margin-bottom: 10rpx;
}

.pairing-code-hint {
  font-size: 24rpx;
  color: #999;
  display: block;
}

.countdown {
  font-size: 28rpx;
  color: #ff9800;
  margin-bottom: 40rpx;
}

.loading-container,
.success-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 40rpx;
}

.loading-icon {
  width: 80rpx;
  height: 80rpx;
  border: 6rpx solid #f3f3f3;
  border-top: 6rpx solid #1890ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 40rpx;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 32rpx;
  color: #666;
}

.success-icon,
.error-icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 80rpx;
  font-weight: bold;
  margin-bottom: 40rpx;
}

.success-icon {
  background-color: #52c41a;
  color: #fff;
}

.error-icon {
  background-color: #ff4d4f;
  color: #fff;
}

.success-title,
.error-title {
  font-size: 40rpx;
  font-weight: bold;
  margin-bottom: 20rpx;
}

.success-title {
  color: #52c41a;
}

.error-title {
  color: #ff4d4f;
}

.success-subtitle,
.error-message {
  font-size: 28rpx;
  color: #666;
  margin-bottom: 40rpx;
}

.actions {
  display: flex;
  gap: 20rpx;
  width: 100%;
  max-width: 600rpx;
}

.btn-primary,
.btn-secondary {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 32rpx;
  text-align: center;
  border: none;
}

.btn-primary {
  background-color: #1890ff;
  color: #fff;
}

.btn-secondary {
  background-color: #fff;
  color: #666;
  border: 2rpx solid #d9d9d9;
}
</style>
