<script>
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'

export default {
  onLaunch() {
    console.log('App Launch')
    // 检查登录状态
    this.checkLoginStatus()
    // 初始化数据库
    this.initDatabase()
  },
  onShow() {
    console.log('App Show')
  },
  onHide() {
    console.log('App Hide')
  },
  methods: {
    checkLoginStatus() {
      const isLoggedIn = uni.getStorageSync('isLoggedIn')
      if (!isLoggedIn) {
        uni.reLaunch({
          url: '/pages/login/login'
        })
      }
    },
    async initDatabase() {
      try {
        // TODO: 初始化 SQLite 数据库
        console.log('Database initialized')
      } catch (error) {
        console.error('Database initialization failed:', error)
      }
    }
  }
}
</script>

<style lang="scss">
@import './uni.scss';

/* 全局样式 */
page {
  background-color: #f8f8f8;
  font-size: 16px;
}

/* 通用布局 */
.container {
  padding: 20rpx;
}

/* 通用按钮 */
.btn-primary {
  background-color: #3cc51f;
  color: #ffffff;
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  text-align: center;
}

.btn-default {
  background-color: #f0f0f0;
  color: #333333;
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  text-align: center;
}

/* 通用列表项 */
.list-item {
  background-color: #ffffff;
  padding: 24rpx;
  margin-bottom: 20rpx;
  border-radius: 12rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}

/* 通用输入框 */
.input {
  background-color: #f5f5f5;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 28rpx;
}

/* 加载中 */
.loading {
  text-align: center;
  padding: 40rpx;
  color: #999999;
}

/* 空状态 */
.empty {
  text-align: center;
  padding: 100rpx 40rpx;
  color: #999999;
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  font-size: 28rpx;
}
</style>
