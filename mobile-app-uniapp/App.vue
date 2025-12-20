<script>
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'

export default {
  onLaunch() {
    console.log('App Launch')
    // 初始化主题
    this.initTheme()
    // 检查登录状态
    this.checkLoginStatus()
    // 初始化数据库
    this.initDatabase()
    // 监听主题变更事件
    this.listenThemeChange()
  },
  onShow() {
    console.log('App Show')
  },
  onHide() {
    console.log('App Hide')
  },
  methods: {
    /**
     * 初始化主题
     */
    initTheme() {
      try {
        const savedTheme = uni.getStorageSync('app_theme') || 'light'
        this.applyTheme(savedTheme)
      } catch (error) {
        console.error('初始化主题失败:', error)
      }
    },

    /**
     * 应用主题
     */
    applyTheme(theme) {
      // 获取系统主题（如果是自动模式）
      let effectiveTheme = theme
      if (theme === 'auto') {
        const systemInfo = uni.getSystemInfoSync()
        effectiveTheme = systemInfo.theme || 'light'
      }

      // 设置页面主题属性
      const pages = getCurrentPages()
      if (pages.length > 0) {
        const currentPage = pages[pages.length - 1]
        if (currentPage.$vm) {
          currentPage.$vm.$el.setAttribute('data-theme', effectiveTheme)
        }
      }

      // 设置状态栏样式
      if (effectiveTheme === 'dark') {
        uni.setNavigationBarColor({
          frontColor: '#ffffff',
          backgroundColor: '#1f1f1f'
        })
        // 设置TabBar样式
        uni.setTabBarStyle({
          backgroundColor: '#1f1f1f',
          borderStyle: 'black',
          color: '#999999',
          selectedColor: '#3cc51f'
        })
      } else {
        uni.setNavigationBarColor({
          frontColor: '#000000',
          backgroundColor: '#ffffff'
        })
        // 设置TabBar样式
        uni.setTabBarStyle({
          backgroundColor: '#ffffff',
          borderStyle: 'white',
          color: '#999999',
          selectedColor: '#3cc51f'
        })
      }
    },

    /**
     * 监听主题变更
     */
    listenThemeChange() {
      uni.$on('themeChange', (theme) => {
        this.applyTheme(theme)
      })
    },

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

/* 全局CSS变量 - 浅色主题 */
page {
  /* 背景色 */
  --bg-page: #f8f8f8;
  --bg-card: #ffffff;
  --bg-input: #f5f5f5;
  --bg-hover: #f0f0f0;

  /* 文字色 */
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --text-inverse: #ffffff;

  /* 边框色 */
  --border-light: #f0f0f0;
  --border-normal: #e0e0e0;
  --border-dark: #d0d0d0;

  /* 主题色 */
  --color-primary: #3cc51f;
  --color-success: #52c41a;
  --color-warning: #fa8c16;
  --color-error: #ff4d4f;
  --color-info: #1890ff;

  /* 阴影 */
  --shadow-sm: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8rpx 24rpx rgba(0, 0, 0, 0.12);
}

/* 深色主题 */
page[data-theme='dark'] {
  /* 背景色 */
  --bg-page: #121212;
  --bg-card: #1f1f1f;
  --bg-input: #2a2a2a;
  --bg-hover: #2f2f2f;

  /* 文字色 */
  --text-primary: #e0e0e0;
  --text-secondary: #b0b0b0;
  --text-tertiary: #808080;
  --text-inverse: #ffffff;

  /* 边框色 */
  --border-light: #2a2a2a;
  --border-normal: #3a3a3a;
  --border-dark: #4a4a4a;

  /* 主题色保持不变 */
  --color-primary: #3cc51f;
  --color-success: #52c41a;
  --color-warning: #fa8c16;
  --color-error: #ff4d4f;
  --color-info: #1890ff;

  /* 阴影 */
  --shadow-sm: 0 2rpx 8rpx rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4rpx 16rpx rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8rpx 24rpx rgba(0, 0, 0, 0.5);
}

/* 全局样式 */
page {
  background-color: var(--bg-page);
  color: var(--text-primary);
  font-size: 16px;
}

/* 通用布局 */
.container {
  padding: 20rpx;
}

/* 通用按钮 */
.btn-primary {
  background-color: var(--color-primary);
  color: var(--text-inverse);
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  text-align: center;
}

.btn-default {
  background-color: var(--bg-input);
  color: var(--text-primary);
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  text-align: center;
}

/* 通用列表项 */
.list-item {
  background-color: var(--bg-card);
  padding: 24rpx;
  margin-bottom: 20rpx;
  border-radius: 12rpx;
  box-shadow: var(--shadow-sm);
}

/* 通用输入框 */
.input {
  background-color: var(--bg-input);
  color: var(--text-primary);
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 28rpx;
}

/* 加载中 */
.loading {
  text-align: center;
  padding: 40rpx;
  color: var(--text-tertiary);
}

/* 空状态 */
.empty {
  text-align: center;
  padding: 100rpx 40rpx;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  font-size: 28rpx;
  color: var(--text-secondary);
}
</style>
