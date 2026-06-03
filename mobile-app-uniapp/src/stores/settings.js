import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // State
  const theme = ref('auto')
  const language = ref('zh-CN')
  const fontSize = ref('medium')

  // LLM Settings
  const llmProvider = ref('ollama')
  const llmModel = ref('qwen2:7b')
  const llmApiKey = ref('')
  const llmBaseUrl = ref('http://localhost:11434')
  const llmTemperature = ref(0.7)
  const llmMaxTokens = ref(2000)

  // Notification Settings
  const notificationEnabled = ref(true)
  const messageNotification = ref(true)
  const tradeNotification = ref(true)
  const socialNotification = ref(true)
  const notificationSound = ref(true)
  const notificationVibration = ref(true)
  const doNotDisturbEnabled = ref(false)
  const doNotDisturbStart = ref('22:00')
  const doNotDisturbEnd = ref('08:00')

  // Privacy Settings
  const profileVisibility = ref('public')
  const onlineStatus = ref(true)
  const dataEncryption = ref(true)
  const autoLock = ref(true)
  const autoLockTimeout = ref(5)
  const biometricEnabled = ref(false)

  // Data Management
  const autoBackup = ref(true)
  const backupFrequency = ref('daily')
  const cloudSyncEnabled = ref(false)
  const wifiOnlySync = ref(true)

  // Accessibility
  const highContrast = ref(false)
  const reduceMotion = ref(false)
  const screenReaderEnabled = ref(false)

  // Developer Options
  const developerMode = ref(false)
  const debugLogging = ref(false)
  const showPerformanceMetrics = ref(false)

  // Computed
  const isDarkMode = computed(() => {
    if (theme.value === 'dark') return true
    if (theme.value === 'light') return false
    // Auto mode - check system preference
    return uni.getSystemInfoSync().theme === 'dark'
  })

  const isDoNotDisturbActive = computed(() => {
    if (!doNotDisturbEnabled.value) return false

    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const start = doNotDisturbStart.value
    const end = doNotDisturbEnd.value

    if (start < end) {
      return currentTime >= start && currentTime < end
    } else {
      return currentTime >= start || currentTime < end
    }
  })

  // Actions
  function loadSettings() {
    try {
      const savedSettings = uni.getStorageSync('app_settings')
      if (savedSettings) {
        const settings = JSON.parse(savedSettings)

        // Apply saved settings
        theme.value = settings.theme || 'auto'
        language.value = settings.language || 'zh-CN'
        fontSize.value = settings.fontSize || 'medium'

        // LLM settings
        llmProvider.value = settings.llmProvider || 'ollama'
        llmModel.value = settings.llmModel || 'qwen2:7b'
        llmApiKey.value = settings.llmApiKey || ''
        llmBaseUrl.value = settings.llmBaseUrl || 'http://localhost:11434'
        llmTemperature.value = settings.llmTemperature || 0.7
        llmMaxTokens.value = settings.llmMaxTokens || 2000

        // Notification settings
        notificationEnabled.value = settings.notificationEnabled !== false
        messageNotification.value = settings.messageNotification !== false
        tradeNotification.value = settings.tradeNotification !== false
        socialNotification.value = settings.socialNotification !== false
        notificationSound.value = settings.notificationSound !== false
        notificationVibration.value = settings.notificationVibration !== false
        doNotDisturbEnabled.value = settings.doNotDisturbEnabled || false
        doNotDisturbStart.value = settings.doNotDisturbStart || '22:00'
        doNotDisturbEnd.value = settings.doNotDisturbEnd || '08:00'

        // Privacy settings
        profileVisibility.value = settings.profileVisibility || 'public'
        onlineStatus.value = settings.onlineStatus !== false
        dataEncryption.value = settings.dataEncryption !== false
        autoLock.value = settings.autoLock !== false
        autoLockTimeout.value = settings.autoLockTimeout || 5
        biometricEnabled.value = settings.biometricEnabled || false

        // Data management
        autoBackup.value = settings.autoBackup !== false
        backupFrequency.value = settings.backupFrequency || 'daily'
        cloudSyncEnabled.value = settings.cloudSyncEnabled || false
        wifiOnlySync.value = settings.wifiOnlySync !== false

        // Accessibility
        highContrast.value = settings.highContrast || false
        reduceMotion.value = settings.reduceMotion || false
        screenReaderEnabled.value = settings.screenReaderEnabled || false

        // Developer options
        developerMode.value = settings.developerMode || false
        debugLogging.value = settings.debugLogging || false
        showPerformanceMetrics.value = settings.showPerformanceMetrics || false
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  function saveSettings() {
    try {
      const settings = {
        theme: theme.value,
        language: language.value,
        fontSize: fontSize.value,
        llmProvider: llmProvider.value,
        llmModel: llmModel.value,
        llmApiKey: llmApiKey.value,
        llmBaseUrl: llmBaseUrl.value,
        llmTemperature: llmTemperature.value,
        llmMaxTokens: llmMaxTokens.value,
        notificationEnabled: notificationEnabled.value,
        messageNotification: messageNotification.value,
        tradeNotification: tradeNotification.value,
        socialNotification: socialNotification.value,
        notificationSound: notificationSound.value,
        notificationVibration: notificationVibration.value,
        doNotDisturbEnabled: doNotDisturbEnabled.value,
        doNotDisturbStart: doNotDisturbStart.value,
        doNotDisturbEnd: doNotDisturbEnd.value,
        profileVisibility: profileVisibility.value,
        onlineStatus: onlineStatus.value,
        dataEncryption: dataEncryption.value,
        autoLock: autoLock.value,
        autoLockTimeout: autoLockTimeout.value,
        biometricEnabled: biometricEnabled.value,
        autoBackup: autoBackup.value,
        backupFrequency: backupFrequency.value,
        cloudSyncEnabled: cloudSyncEnabled.value,
        wifiOnlySync: wifiOnlySync.value,
        highContrast: highContrast.value,
        reduceMotion: reduceMotion.value,
        screenReaderEnabled: screenReaderEnabled.value,
        developerMode: developerMode.value,
        debugLogging: debugLogging.value,
        showPerformanceMetrics: showPerformanceMetrics.value
      }

      uni.setStorageSync('app_settings', JSON.stringify(settings))

      // Emit event for settings change
      uni.$emit('settingsChanged', settings)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  function updateTheme(newTheme) {
    theme.value = newTheme
    saveSettings()
  }

  function updateLLMConfig(config) {
    if (config.provider) llmProvider.value = config.provider
    if (config.model) llmModel.value = config.model
    if (config.apiKey !== undefined) llmApiKey.value = config.apiKey
    if (config.baseUrl) llmBaseUrl.value = config.baseUrl
    if (config.temperature !== undefined) llmTemperature.value = config.temperature
    if (config.maxTokens !== undefined) llmMaxTokens.value = config.maxTokens
    saveSettings()
  }

  function updateNotificationSettings(config) {
    if (config.enabled !== undefined) notificationEnabled.value = config.enabled
    if (config.message !== undefined) messageNotification.value = config.message
    if (config.trade !== undefined) tradeNotification.value = config.trade
    if (config.social !== undefined) socialNotification.value = config.social
    if (config.sound !== undefined) notificationSound.value = config.sound
    if (config.vibration !== undefined) notificationVibration.value = config.vibration
    saveSettings()
  }

  function updateDoNotDisturb(config) {
    if (config.enabled !== undefined) doNotDisturbEnabled.value = config.enabled
    if (config.start) doNotDisturbStart.value = config.start
    if (config.end) doNotDisturbEnd.value = config.end
    saveSettings()
  }

  function resetSettings() {
    theme.value = 'auto'
    language.value = 'zh-CN'
    fontSize.value = 'medium'
    llmProvider.value = 'ollama'
    llmModel.value = 'qwen2:7b'
    llmApiKey.value = ''
    llmBaseUrl.value = 'http://localhost:11434'
    llmTemperature.value = 0.7
    llmMaxTokens.value = 2000
    notificationEnabled.value = true
    messageNotification.value = true
    tradeNotification.value = true
    socialNotification.value = true
    notificationSound.value = true
    notificationVibration.value = true
    doNotDisturbEnabled.value = false
    profileVisibility.value = 'public'
    onlineStatus.value = true
    dataEncryption.value = true
    autoLock.value = true
    autoLockTimeout.value = 5
    biometricEnabled.value = false
    autoBackup.value = true
    backupFrequency.value = 'daily'
    cloudSyncEnabled.value = false
    wifiOnlySync.value = true
    highContrast.value = false
    reduceMotion.value = false
    screenReaderEnabled.value = false
    developerMode.value = false
    debugLogging.value = false
    showPerformanceMetrics.value = false
    saveSettings()
  }

  function exportSettings() {
    const settings = {
      theme: theme.value,
      language: language.value,
      fontSize: fontSize.value,
      llmProvider: llmProvider.value,
      llmModel: llmModel.value,
      llmBaseUrl: llmBaseUrl.value,
      llmTemperature: llmTemperature.value,
      llmMaxTokens: llmMaxTokens.value,
      notificationEnabled: notificationEnabled.value,
      messageNotification: messageNotification.value,
      tradeNotification: tradeNotification.value,
      socialNotification: socialNotification.value,
      notificationSound: notificationSound.value,
      notificationVibration: notificationVibration.value,
      doNotDisturbEnabled: doNotDisturbEnabled.value,
      doNotDisturbStart: doNotDisturbStart.value,
      doNotDisturbEnd: doNotDisturbEnd.value,
      profileVisibility: profileVisibility.value,
      onlineStatus: onlineStatus.value,
      dataEncryption: dataEncryption.value,
      autoLock: autoLock.value,
      autoLockTimeout: autoLockTimeout.value,
      autoBackup: autoBackup.value,
      backupFrequency: backupFrequency.value,
      cloudSyncEnabled: cloudSyncEnabled.value,
      wifiOnlySync: wifiOnlySync.value,
      highContrast: highContrast.value,
      reduceMotion: reduceMotion.value,
      screenReaderEnabled: screenReaderEnabled.value
    }
    return JSON.stringify(settings, null, 2)
  }

  function importSettings(settingsJson) {
    try {
      const settings = JSON.parse(settingsJson)

      // Validate and apply settings
      if (settings.theme) theme.value = settings.theme
      if (settings.language) language.value = settings.language
      if (settings.fontSize) fontSize.value = settings.fontSize
      if (settings.llmProvider) llmProvider.value = settings.llmProvider
      if (settings.llmModel) llmModel.value = settings.llmModel
      if (settings.llmBaseUrl) llmBaseUrl.value = settings.llmBaseUrl
      if (settings.llmTemperature !== undefined) llmTemperature.value = settings.llmTemperature
      if (settings.llmMaxTokens !== undefined) llmMaxTokens.value = settings.llmMaxTokens

      // Apply other settings...
      if (settings.notificationEnabled !== undefined) notificationEnabled.value = settings.notificationEnabled
      if (settings.messageNotification !== undefined) messageNotification.value = settings.messageNotification
      if (settings.tradeNotification !== undefined) tradeNotification.value = settings.tradeNotification
      if (settings.socialNotification !== undefined) socialNotification.value = settings.socialNotification

      saveSettings()
      return true
    } catch (error) {
      console.error('Failed to import settings:', error)
      return false
    }
  }

  return {
    // State
    theme,
    language,
    fontSize,
    llmProvider,
    llmModel,
    llmApiKey,
    llmBaseUrl,
    llmTemperature,
    llmMaxTokens,
    notificationEnabled,
    messageNotification,
    tradeNotification,
    socialNotification,
    notificationSound,
    notificationVibration,
    doNotDisturbEnabled,
    doNotDisturbStart,
    doNotDisturbEnd,
    profileVisibility,
    onlineStatus,
    dataEncryption,
    autoLock,
    autoLockTimeout,
    biometricEnabled,
    autoBackup,
    backupFrequency,
    cloudSyncEnabled,
    wifiOnlySync,
    highContrast,
    reduceMotion,
    screenReaderEnabled,
    developerMode,
    debugLogging,
    showPerformanceMetrics,

    // Computed
    isDarkMode,
    isDoNotDisturbActive,

    // Actions
    loadSettings,
    saveSettings,
    updateTheme,
    updateLLMConfig,
    updateNotificationSettings,
    updateDoNotDisturb,
    resetSettings,
    exportSettings,
    importSettings
  }
})
