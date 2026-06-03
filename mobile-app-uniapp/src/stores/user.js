import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  // State
  const userId = ref('')
  const username = ref('')
  const nickname = ref('')
  const avatar = ref('')
  const bio = ref('')
  const email = ref('')
  const phone = ref('')
  const did = ref('')
  const deviceId = ref('')
  const isAuthenticated = ref(false)
  const isPinSet = ref(false)
  const isSimKeyConnected = ref(false)
  const biometricType = ref('') // fingerprint, face, none

  // User stats
  const stats = ref({
    notesCount: 0,
    conversationsCount: 0,
    friendsCount: 0,
    postsCount: 0,
    storageUsed: 0,
    storageTotal: 0
  })

  // Computed
  const storagePercentage = computed(() => {
    if (stats.value.storageTotal === 0) return 0
    return Math.round((stats.value.storageUsed / stats.value.storageTotal) * 100)
  })

  const displayName = computed(() => {
    return nickname.value || username.value || '未命名用户'
  })

  const hasAvatar = computed(() => {
    return avatar.value && avatar.value.length > 0
  })

  // Actions
  function loadUserInfo() {
    try {
      const userInfo = uni.getStorageSync('user_info')
      if (userInfo) {
        const user = JSON.parse(userInfo)
        userId.value = user.userId || ''
        username.value = user.username || ''
        nickname.value = user.nickname || ''
        avatar.value = user.avatar || ''
        bio.value = user.bio || ''
        email.value = user.email || ''
        phone.value = user.phone || ''
        did.value = user.did || ''
        deviceId.value = user.deviceId || ''
        isAuthenticated.value = user.isAuthenticated || false
        isPinSet.value = user.isPinSet || false
        isSimKeyConnected.value = user.isSimKeyConnected || false
        biometricType.value = user.biometricType || ''
      }

      // Load stats
      const userStats = uni.getStorageSync('user_stats')
      if (userStats) {
        stats.value = JSON.parse(userStats)
      }
    } catch (error) {
      console.error('Failed to load user info:', error)
    }
  }

  function saveUserInfo() {
    try {
      const userInfo = {
        userId: userId.value,
        username: username.value,
        nickname: nickname.value,
        avatar: avatar.value,
        bio: bio.value,
        email: email.value,
        phone: phone.value,
        did: did.value,
        deviceId: deviceId.value,
        isAuthenticated: isAuthenticated.value,
        isPinSet: isPinSet.value,
        isSimKeyConnected: isSimKeyConnected.value,
        biometricType: biometricType.value
      }

      uni.setStorageSync('user_info', JSON.stringify(userInfo))

      // Emit event
      uni.$emit('userInfoChanged', userInfo)
    } catch (error) {
      console.error('Failed to save user info:', error)
    }
  }

  function updateProfile(profile) {
    if (profile.nickname !== undefined) nickname.value = profile.nickname
    if (profile.avatar !== undefined) avatar.value = profile.avatar
    if (profile.bio !== undefined) bio.value = profile.bio
    if (profile.email !== undefined) email.value = profile.email
    if (profile.phone !== undefined) phone.value = profile.phone
    saveUserInfo()
  }

  function updateAvatar(newAvatar) {
    avatar.value = newAvatar
    saveUserInfo()
  }

  function setAuthenticated(authenticated) {
    isAuthenticated.value = authenticated
    saveUserInfo()
  }

  function setPinStatus(pinSet) {
    isPinSet.value = pinSet
    saveUserInfo()
  }

  function setSimKeyStatus(connected) {
    isSimKeyConnected.value = connected
    saveUserInfo()
  }

  function setBiometricType(type) {
    biometricType.value = type
    saveUserInfo()
  }

  function updateStats(newStats) {
    stats.value = { ...stats.value, ...newStats }
    try {
      uni.setStorageSync('user_stats', JSON.stringify(stats.value))
    } catch (error) {
      console.error('Failed to save user stats:', error)
    }
  }

  async function refreshStats() {
    try {
      // Get stats from database service
      const dbService = require('../services/database').default

      const notesCount = await dbService.getNotesCount()
      const conversationsCount = await dbService.getConversationsCount()
      const friendsCount = await dbService.getFriendsCount()
      const postsCount = await dbService.getPostsCount()
      const storageInfo = await dbService.getStorageInfo()

      updateStats({
        notesCount,
        conversationsCount,
        friendsCount,
        postsCount,
        storageUsed: storageInfo.used,
        storageTotal: storageInfo.total
      })
    } catch (error) {
      console.error('Failed to refresh stats:', error)
    }
  }

  function logout() {
    userId.value = ''
    username.value = ''
    nickname.value = ''
    avatar.value = ''
    bio.value = ''
    email.value = ''
    phone.value = ''
    did.value = ''
    isAuthenticated.value = false

    // Clear storage
    uni.removeStorageSync('user_info')
    uni.removeStorageSync('user_stats')
    uni.removeStorageSync('auth_token')

    // Emit event
    uni.$emit('userLoggedOut')
  }

  function clearCache() {
    try {
      // Clear cached data but keep user info
      uni.removeStorageSync('cached_conversations')
      uni.removeStorageSync('cached_notes')
      uni.removeStorageSync('cached_posts')

      uni.showToast({
        title: '缓存已清除',
        icon: 'success'
      })
    } catch (error) {
      console.error('Failed to clear cache:', error)
      uni.showToast({
        title: '清除缓存失败',
        icon: 'error'
      })
    }
  }

  return {
    // State
    userId,
    username,
    nickname,
    avatar,
    bio,
    email,
    phone,
    did,
    deviceId,
    isAuthenticated,
    isPinSet,
    isSimKeyConnected,
    biometricType,
    stats,

    // Computed
    storagePercentage,
    displayName,
    hasAvatar,

    // Actions
    loadUserInfo,
    saveUserInfo,
    updateProfile,
    updateAvatar,
    setAuthenticated,
    setPinStatus,
    setSimKeyStatus,
    setBiometricType,
    updateStats,
    refreshStats,
    logout,
    clearCache
  }
})
