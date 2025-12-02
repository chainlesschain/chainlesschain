import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import router from '@/router'

const request = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// 请求拦截器
request.interceptors.request.use(
  config => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  error => {
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  response => {
    const res = response.data

    // 如果返回的状态码为200，说明接口请求成功
    if (res.code === 200) {
      return res.data
    }

    // 其他状态码都当作错误处理
    ElMessage.error(res.message || '请求失败')
    return Promise.reject(new Error(res.message || '请求失败'))
  },
  error => {
    console.error('Response error:', error)

    if (error.response) {
      const { status, data } = error.response

      switch (status) {
        case 401:
          // 未授权，清除token并跳转登录
          const userStore = useUserStore()
          userStore.clearAuth()
          router.push({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
          ElMessage.error('登录已过期，请重新登录')
          break

        case 403:
          ElMessage.error('没有权限访问')
          break

        case 404:
          ElMessage.error('请求的资源不存在')
          break

        case 500:
          ElMessage.error('服务器错误')
          break

        default:
          ElMessage.error(data?.message || '请求失败')
      }
    } else if (error.request) {
      ElMessage.error('网络错误，请检查您的网络连接')
    } else {
      ElMessage.error(error.message || '请求失败')
    }

    return Promise.reject(error)
  }
)

export default request
