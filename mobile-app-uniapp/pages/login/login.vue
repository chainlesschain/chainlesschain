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

        // 添加模拟动态
        // Alice的动态
        await db.createPost('did:chainless:alice', '刚刚发现了 ChainlessChain，这个去中心化的理念真的很酷！期待看到更多功能 🚀', 'public')

        // Bob的动态
        await db.createPost('did:chainless:bob', '今天在公司分享了区块链技术，同事们都很感兴趣。有时候技术的力量就是能改变人们的思维方式。', 'public')

        // Carol的动态
        await db.createPost('did:chainless:carol', '周末愉快！准备研究一下这个新应用 😊', 'friends')

        // 当前用户的动态
        await db.createPost(myDid, '第一次使用 ChainlessChain，感觉界面很清爽，隐私保护做得不错！', 'public')
        await db.createPost(myDid, '学习了一下 uni-app 开发，原来跨平台开发可以这么简单 💡', 'public')

        // 为Alice的动态添加一些点赞和评论
        const alicePosts = await db.getPosts('all', 10)
        const alicePost = alicePosts.find(p => p.author_did === 'did:chainless:alice')
        if (alicePost) {
          await db.likePost(alicePost.id)
          await db.addComment(alicePost.id, myDid, '我也这么觉得！很期待后续的功能')
          await db.addComment(alicePost.id, 'did:chainless:bob', '同感，这个项目很有潜力')
        }

        // 添加交易模块模拟数据

        // 给用户初始余额（充值100 CLC）
        await db.updateBalance(myDid, 100)
        await db.addTransaction(myDid, 'deposit', 100)

        // 给好友们也初始化余额
        await db.updateBalance('did:chainless:alice', 50)
        await db.updateBalance('did:chainless:bob', 80)
        await db.updateBalance('did:chainless:carol', 30)

        // 创建一些知识项用于上架
        const knowledgeForSale = []

        // Alice的知识
        const aliceKnowledge1 = await db.addKnowledgeItem({
          title: 'Vue 3 组合式 API 完全指南',
          type: 'document',
          content: '详细介绍Vue 3组合式API的使用方法、最佳实践和常见问题解决方案...',
          deviceId: 'did:chainless:alice'
        })
        knowledgeForSale.push(aliceKnowledge1)

        const aliceKnowledge2 = await db.addKnowledgeItem({
          title: 'uni-app 跨平台开发实战经验',
          type: 'note',
          content: 'uni-app开发中的踩坑经验总结，包括条件编译、性能优化、适配问题等...',
          deviceId: 'did:chainless:alice'
        })
        knowledgeForSale.push(aliceKnowledge2)

        // Bob的知识
        const bobKnowledge = await db.addKnowledgeItem({
          title: '区块链技术原理与应用',
          type: 'document',
          content: '从零开始了解区块链，包括共识算法、智能合约、去中心化应用开发...',
          deviceId: 'did:chainless:bob'
        })
        knowledgeForSale.push(bobKnowledge)

        // 上架这些知识到市场
        await db.createListing(
          aliceKnowledge1.id,
          'did:chainless:alice',
          'Vue 3 组合式 API 完全指南',
          '适合想深入学习Vue 3的开发者，包含大量实战案例',
          15
        )

        await db.createListing(
          aliceKnowledge2.id,
          'did:chainless:alice',
          'uni-app 跨平台开发实战经验',
          '多年uni-app开发经验总结，避坑指南',
          12
        )

        await db.createListing(
          bobKnowledge.id,
          'did:chainless:bob',
          '区块链技术原理与应用',
          '从入门到精通，涵盖理论和实践',
          25
        )

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
    color: var(--bg-card);
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
      color: var(--bg-card);

      &.status-success {
        color: var(--color-success);
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
    color: var(--bg-card);
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
      color: var(--bg-card);
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
    background-color: var(--bg-card);
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
