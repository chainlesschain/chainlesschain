import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginWithUKey, loginWithSIMKey, logout as apiLogout, getCurrentUser } from '@/api/auth'

export const useUserStore = defineStore('user', () => {
  const user = ref(null)
  const token = ref(localStorage.getItem('token') || '')

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const isAdmin = computed(() => user.value?.role === 'ADMIN')
  const isModerator = computed(() => user.value?.role === 'MODERATOR' || user.value?.role === 'ADMIN')

  // 检查认证状态
  async function checkAuth() {
    if (token.value) {
      try {
        const userData = await getCurrentUser()
        user.value = userData
      } catch (error) {
        // Token失效，清除
        clearAuth()
      }
    }
  }

  // U盾登录
  async function loginUKey(deviceId, pin) {
    try {
      const response = await loginWithUKey(deviceId, pin)
      setAuth(response.token, response.user)
      return response
    } catch (error) {
      throw error
    }
  }

  // SIMKey登录
  async function loginSIMKey(simId, pin) {
    try {
      const response = await loginWithSIMKey(simId, pin)
      setAuth(response.token, response.user)
      return response
    } catch (error) {
      throw error
    }
  }

  // 设置认证信息
  function setAuth(newToken, userData) {
    token.value = newToken
    user.value = userData
    localStorage.setItem('token', newToken)
  }

  // 清除认证信息
  function clearAuth() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
  }

  // 登出
  async function logout() {
    try {
      await apiLogout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearAuth()
    }
  }

  // 更新用户信息
  function updateUser(userData) {
    user.value = { ...user.value, ...userData }
  }

  return {
    user,
    token,
    isLoggedIn,
    isAdmin,
    isModerator,
    checkAuth,
    loginUKey,
    loginSIMKey,
    logout,
    updateUser
  }
})
