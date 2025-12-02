import request from './request'

/**
 * U盾登录
 */
export function loginWithUKey(deviceId, pin) {
  return request({
    url: '/auth/login/ukey',
    method: 'post',
    data: { deviceId, pin }
  })
}

/**
 * SIMKey登录
 */
export function loginWithSIMKey(simId, pin) {
  return request({
    url: '/auth/login/simkey',
    method: 'post',
    data: { simId, pin }
  })
}

/**
 * 登出
 */
export function logout() {
  return request({
    url: '/auth/logout',
    method: 'post'
  })
}

/**
 * 获取当前用户信息
 */
export function getCurrentUser() {
  return request({
    url: '/auth/current',
    method: 'get'
  })
}

/**
 * 刷新Token
 */
export function refreshToken() {
  return request({
    url: '/auth/refresh',
    method: 'post'
  })
}
