/**
 * 主题切换 Mixin
 * 用于页面监听主题变化并应用主题
 */
export default {
  data() {
    return {
      currentTheme: 'light'
    }
  },
  onLoad() {
    this.initPageTheme()
  },
  onShow() {
    this.applyPageTheme()
  },
  onUnload() {
    // 移除主题变更监听
    uni.$off('themeChange', this.handleThemeChange)
  },
  methods: {
    /**
     * 初始化页面主题
     */
    initPageTheme() {
      // 获取当前主题
      const savedTheme = uni.getStorageSync('app_theme') || 'light'
      let effectiveTheme = savedTheme

      // 如果是自动模式，获取系统主题
      if (savedTheme === 'auto') {
        const systemInfo = uni.getSystemInfoSync()
        effectiveTheme = systemInfo.theme || 'light'
      }

      this.currentTheme = effectiveTheme
      this.applyPageTheme()

      // 监听主题变更
      uni.$on('themeChange', this.handleThemeChange)
    },

    /**
     * 应用页面主题
     */
    applyPageTheme() {
      // 设置页面data-theme属性（H5平台）
      // #ifdef H5
      document.querySelector('page')?.setAttribute('data-theme', this.currentTheme)
      // #endif
    },

    /**
     * 处理主题变更
     */
    handleThemeChange(theme) {
      this.currentTheme = theme
      this.applyPageTheme()
    }
  }
}
