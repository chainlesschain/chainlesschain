<template>
  <view class="login-container">
    <view class="logo-section">
      <image class="logo" src="/static/images/logo.png" mode="aspectFit"></image>
      <text class="app-name">ChainlessChain</text>
      <text class="app-slogan">去中心化 · 隐私优先 · AI原生</text>
    </view>

    <view class="sim-status" v-if="simKeyStatus">
      <view class="status-item">
        <text class="status-label">SIMKey 状态:</text>
        <text class="status-value" :class="simKeyStatus.detected ? 'status-success' : 'status-error'">
          {{ simKeyStatus.detected ? '已连接' : '未检测到' }}
        </text>
      </view>
      <view class="status-item" v-if="simKeyStatus.detected">
        <text class="status-label">序列号:</text>
        <text class="status-value">{{ simKeyStatus.serialNumber }}</text>
      </view>
    </view>

    <view class="pin-section">
      <text class="section-title">请输入 PIN 码</text>
      <view class="pin-input-container">
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="pin"
          placeholder="输入4-6位数字PIN码"
          :password="true"
          @confirm="handleLogin"
        />
      </view>

      <view class="pin-tips">
        <text class="tip-text" v-if="isFirstTime">
          首次登录，请设置PIN码（4-6位数字）
        </text>
        <text class="tip-text" v-else>
          使用PIN码解锁
        </text>
      </view>

      <button
        class="login-btn"
        :class="{ 'btn-disabled': pin.length < 4 }"
        :disabled="pin.length < 4 || loading"
        @click="handleLogin"
      >
        <text v-if="!loading">{{ isFirstTime ? '设置PIN码' : '解锁' }}</text>
        <text v-else>验证中...</text>
      </button>
    </view>

    <view class="footer">
      <text class="footer-text">基于硬件级安全的个人AI助手</text>
    </view>
  </view>
</template>

<script>
import { auth } from '@/services/auth'
import { db } from '@/services/database'

export default {
  data() {
    return {
      pin: '',
      simKeyStatus: null,
      isFirstTime: false,
      loading: false
    }
  },
  onLoad() {
    this.checkSIMKey()
    this.checkFirstTime()
  },
  methods: {
    async checkSIMKey() {
      try {
        const status = await auth.detectSIMKey()
        this.simKeyStatus = status
      } catch (error) {
        console.error('检测SIMKey失败:', error)
        uni.showToast({
          title: 'SIMKey检测失败',
          icon: 'none'
        })
      }
    },
    checkFirstTime() {
      const storedPIN = uni.getStorageSync('user_pin')
      this.isFirstTime = !storedPIN
    },
    async handleLogin() {
      if (this.pin.length < 4 || this.loading) {
        return
      }

      this.loading = true

      try {
        // 验证 PIN 码
        const result = await auth.verifyPIN(this.pin)

        // 初始化数据库
        await db.init(this.pin)

        // 首次登录时添加模拟数据
        if (this.isFirstTime) {
          await this.initMockData()
        }

        uni.showToast({
          title: result.message,
          icon: 'success'
        })

        // 延迟跳转
        setTimeout(() => {
          uni.reLaunch({
            url: '/pages/knowledge/list/list'
          })
        }, 1000)
      } catch (error) {
        console.error('登录失败:', error)
        uni.showToast({
          title: error.message || '登录失败',
          icon: 'none',
          duration: 2000
        })
        this.pin = '' // 清空输入
      } finally {
        this.loading = false
      }
    },
    /**
     * 初始化模拟数据（仅首次登录）
     */
    async initMockData() {
      try {
        console.log('初始化模拟数据...')

        // 获取当前用户DID（模拟）
        const myDid = uni.getStorageSync('device_id') || 'did:chainless:user123'

        // 添加3个模拟好友
        const mockFriends = [
          {
            friend_did: 'did:chainless:alice',
            nickname: 'Alice',
            group_name: '好友',
            status: 'accepted'
          },
          {
            friend_did: 'did:chainless:bob',
            nickname: 'Bob',
            group_name: '同事',
            status: 'accepted'
          },
          {
            friend_did: 'did:chainless:carol',
            nickname: 'Carol',
            group_name: '家人',
            status: 'accepted'
          }
        ]

        for (const friend of mockFriends) {
          const sql = `INSERT INTO friendships (user_did, friend_did, nickname, group_name, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`
          await db.executeSql(sql, [
            myDid,
            friend.friend_did,
            friend.nickname,
            friend.group_name,
            friend.status,
            Date.now()
          ])
        }

        // 为Alice创建一个对话并添加几条消息
        await db.receiveFriendMessage('did:chainless:alice', 'Alice', '嗨！欢迎使用ChainlessChain！')
        await db.sendFriendMessage('did:chainless:alice', 'Alice', '你好Alice！很高兴认识你')
        await db.receiveFriendMessage('did:chainless:alice', 'Alice', '这个应用真不错，可以安全地聊天')

        // 为Bob创建一个对话
        await db.sendFriendMessage('did:chainless:bob', 'Bob', '嘿Bob，项目进展怎么样？')
        await db.receiveFriendMessage('did:chainless:bob', 'Bob', '进展顺利！准备下周上线')

        console.log('模拟数据初始化完成')
      } catch (error) {
        console.error('初始化模拟数据失败:', error)
        // 不影响登录流程
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.login-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 100rpx 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo-section {
  text-align: center;
  margin-bottom: 80rpx;

  .logo {
    width: 160rpx;
    height: 160rpx;
    margin-bottom: 30rpx;
  }

  .app-name {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    color: #ffffff;
    margin-bottom: 16rpx;
  }

  .app-slogan {
    display: block;
    font-size: 24rpx;
    color: rgba(255, 255, 255, 0.8);
  }
}

.sim-status {
  width: 100%;
  background-color: rgba(255, 255, 255, 0.15);
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 60rpx;
  backdrop-filter: blur(10rpx);

  .status-item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 16rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .status-label {
      font-size: 28rpx;
      color: rgba(255, 255, 255, 0.7);
    }

    .status-value {
      font-size: 28rpx;
      color: #ffffff;

      &.status-success {
        color: #52c41a;
      }

      &.status-error {
        color: #f5222d;
      }
    }
  }
}

.pin-section {
  width: 100%;

  .section-title {
    display: block;
    font-size: 32rpx;
    color: #ffffff;
    margin-bottom: 32rpx;
    text-align: center;
  }

  .pin-input-container {
    width: 100%;
    margin-bottom: 24rpx;

    .pin-input {
      width: 100%;
      height: 96rpx;
      background-color: rgba(255, 255, 255, 0.2);
      border: 2rpx solid rgba(255, 255, 255, 0.3);
      border-radius: 16rpx;
      padding: 0 32rpx;
      font-size: 36rpx;
      color: #ffffff;
      text-align: center;
      letter-spacing: 8rpx;
    }

    .pin-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-size: 28rpx;
      letter-spacing: 0;
    }
  }

  .pin-tips {
    margin-bottom: 48rpx;

    .tip-text {
      display: block;
      font-size: 24rpx;
      color: rgba(255, 255, 255, 0.7);
      text-align: center;
    }
  }

  .login-btn {
    width: 100%;
    height: 96rpx;
    background-color: #ffffff;
    color: #667eea;
    border-radius: 48rpx;
    font-size: 32rpx;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;

    &.btn-disabled {
      opacity: 0.5;
    }
  }

  .login-btn::after {
    border: none;
  }
}

.footer {
  margin-top: auto;
  padding-top: 60rpx;

  .footer-text {
    font-size: 24rpx;
    color: rgba(255, 255, 255, 0.6);
  }
}
</style>
