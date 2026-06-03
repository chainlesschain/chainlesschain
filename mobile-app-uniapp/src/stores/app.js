import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAppStore = defineStore('app', () => {
  // State
  const isOnline = ref(true)
  const networkType = ref('wifi') // wifi, 4g, 5g, none
  const isLoading = ref(false)
  const loadingText = ref('')
  const currentPage = ref('')
  const pageStack = ref([])

  // System info
  const systemInfo = ref({
    platform: '',
    system: '',
    version: '',
    screenWidth: 0,
    screenHeight: 0,
    statusBarHeight: 0,
    safeAreaInsets: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    }
  })

  // App state
  const isFirstLaunch = ref(true)
  const appVersion = ref('0.16.0')
  const lastUpdateCheck = ref(null)
  const hasUpdate = ref(false)

  // Performance metrics
  const performanceMetrics = ref({
    appStartTime: Date.now(),
    pageLoadTimes: {},
    apiResponseTimes: {},
    memoryUsage: 0
  })

  // Computed
  const isWifi = computed(() => networkType.value === 'wifi')
  const isMobile = computed(() => ['4g', '5g', '3g', '2g'].includes(networkType.value))
  const hasNetwork = computed(() => isOnline.value && networkType.value !== 'none')

  const safeAreaTop = computed(() => systemInfo.value.safeAreaInsets.top || systemInfo.value.statusBarHeight || 0)
  const safeAreaBottom = computed(() => systemInfo.value.safeAreaInsets.bottom || 0)

  // Actions
  function init() {
    // Get system info
    const info = uni.getSystemInfoSync()
    systemInfo.value = {
      platform: info.platform,
      system: info.system,
      version: info.version,
      screenWidth: info.screenWidth,
      screenHeight: info.screenHeight,
      statusBarHeight: info.statusBarHeight,
      safeAreaInsets: info.safeAreaInsets || {
        top: info.statusBarHeight || 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    }

    // Check network status
    uni.getNetworkType({
      success: (res) => {
        networkType.value = res.networkType
        isOnline.value = res.networkType !== 'none'
      }
    })

    // Listen for network changes
    uni.onNetworkStatusChange((res) => {
      isOnline.value = res.isConnected
      networkType.value = res.networkType

      if (!res.isConnected) {
        uni.showToast({
          title: '网络已断开',
          icon: 'none'
        })
      }
    })

    // Check if first launch
    const hasLaunched = uni.getStorageSync('has_launched')
    isFirstLaunch.value = !hasLaunched
    if (isFirstLaunch.value) {
      uni.setStorageSync('has_launched', true)
    }

    // Load last update check
    const lastCheck = uni.getStorageSync('last_update_check')
    if (lastCheck) {
      lastUpdateCheck.value = new Date(lastCheck)
    }
  }

  function showLoading(text = '加载中...') {
    isLoading.value = true
    loadingText.value = text
    uni.showLoading({
      title: text,
      mask: true
    })
  }

  function hideLoading() {
    isLoading.value = false
    loadingText.value = ''
    uni.hideLoading()
  }

  function setCurrentPage(page) {
    currentPage.value = page
    pageStack.value.push({
      page,
      timestamp: Date.now()
    })

    // Keep only last 10 pages
    if (pageStack.value.length > 10) {
      pageStack.value.shift()
    }
  }

  function trackPageLoadTime(page, loadTime) {
    if (!performanceMetrics.value.pageLoadTimes[page]) {
      performanceMetrics.value.pageLoadTimes[page] = []
    }
    performanceMetrics.value.pageLoadTimes[page].push(loadTime)

    // Keep only last 10 measurements
    if (performanceMetrics.value.pageLoadTimes[page].length > 10) {
      performanceMetrics.value.pageLoadTimes[page].shift()
    }
  }

  function trackApiResponseTime(api, responseTime) {
    if (!performanceMetrics.value.apiResponseTimes[api]) {
      performanceMetrics.value.apiResponseTimes[api] = []
    }
    performanceMetrics.value.apiResponseTimes[api].push(responseTime)

    // Keep only last 10 measurements
    if (performanceMetrics.value.apiResponseTimes[api].length > 10) {
      performanceMetrics.value.apiResponseTimes[api].shift()
    }
  }

  function getAveragePageLoadTime(page) {
    const times = performanceMetrics.value.pageLoadTimes[page]
    if (!times || times.length === 0) return 0
    return times.reduce((a, b) => a + b, 0) / times.length
  }

  function getAverageApiResponseTime(api) {
    const times = performanceMetrics.value.apiResponseTimes[api]
    if (!times || times.length === 0) return 0
    return times.reduce((a, b) => a + b, 0) / times.length
  }

  async function checkForUpdates() {
    try {
      // Check for app updates
      // This would typically call an API to check for new versions
      lastUpdateCheck.value = new Date()
      uni.setStorageSync('last_update_check', lastUpdateCheck.value.toISOString())

      // For now, just return false
      hasUpdate.value = false
      return false
    } catch (error) {
      console.error('Failed to check for updates:', error)
      return false
    }
  }

  function getPerformanceReport() {
    const report = {
      appUptime: Date.now() - performanceMetrics.value.appStartTime,
      pageLoadTimes: {},
      apiResponseTimes: {},
      memoryUsage: performanceMetrics.value.memoryUsage,
      networkType: networkType.value,
      platform: systemInfo.value.platform
    }

    // Calculate averages
    for (const page in performanceMetrics.value.pageLoadTimes) {
      report.pageLoadTimes[page] = getAveragePageLoadTime(page)
    }

    for (const api in performanceMetrics.value.apiResponseTimes) {
      report.apiResponseTimes[api] = getAverageApiResponseTime(api)
    }

    return report
  }

  function clearPerformanceMetrics() {
    performanceMetrics.value = {
      appStartTime: Date.now(),
      pageLoadTimes: {},
      apiResponseTimes: {},
      memoryUsage: 0
    }
  }

  return {
    // State
    isOnline,
    networkType,
    isLoading,
    loadingText,
    currentPage,
    pageStack,
    systemInfo,
    isFirstLaunch,
    appVersion,
    lastUpdateCheck,
    hasUpdate,
    performanceMetrics,

    // Computed
    isWifi,
    isMobile,
    hasNetwork,
    safeAreaTop,
    safeAreaBottom,

    // Actions
    init,
    showLoading,
    hideLoading,
    setCurrentPage,
    trackPageLoadTime,
    trackApiResponseTime,
    getAveragePageLoadTime,
    getAverageApiResponseTime,
    checkForUpdates,
    getPerformanceReport,
    clearPerformanceMetrics
  }
})
