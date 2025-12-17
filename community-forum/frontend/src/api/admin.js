import request from './request'

/**
 * 管理后台相关API
 */

// ============ 仪表盘 ============

// 获取仪表盘统计数据
export function getDashboardStats() {
  return request({
    url: '/admin/dashboard/stats',
    method: 'get'
  })
}

// 获取用户增长数据
export function getUserGrowthData(params) {
  return request({
    url: '/admin/dashboard/user-growth',
    method: 'get',
    params
  })
}

// 获取内容统计数据
export function getContentStats(params) {
  return request({
    url: '/admin/dashboard/content-stats',
    method: 'get',
    params
  })
}

// 获取最新活动
export function getRecentActivities(params) {
  return request({
    url: '/admin/dashboard/activities',
    method: 'get',
    params
  })
}

// ============ 用户管理 ============

// 获取用户列表
export function getAdminUsers(params) {
  return request({
    url: '/admin/users',
    method: 'get',
    params
  })
}

// 获取用户详情
export function getAdminUserDetail(userId) {
  return request({
    url: `/admin/users/${userId}`,
    method: 'get'
  })
}

// 封禁用户
export function banUser(userId, data) {
  return request({
    url: `/admin/users/${userId}/ban`,
    method: 'post',
    data
  })
}

// 解封用户
export function unbanUser(userId) {
  return request({
    url: `/admin/users/${userId}/unban`,
    method: 'post'
  })
}

// 删除用户
export function deleteAdminUser(userId) {
  return request({
    url: `/admin/users/${userId}`,
    method: 'delete'
  })
}

// 更新用户角色
export function updateUserRole(userId, role) {
  return request({
    url: `/admin/users/${userId}/role`,
    method: 'put',
    data: { role }
  })
}

// ============ 内容审核 ============

// 获取待审核帖子列表
export function getPendingPosts(params) {
  return request({
    url: '/admin/posts/pending',
    method: 'get',
    params
  })
}

// 获取被举报帖子列表
export function getReportedPosts(params) {
  return request({
    url: '/admin/posts/reported',
    method: 'get',
    params
  })
}

// 获取所有帖子列表（管理员）
export function getAdminPosts(params) {
  return request({
    url: '/admin/posts',
    method: 'get',
    params
  })
}

// 审核通过帖子
export function approvePost(postId) {
  return request({
    url: `/admin/posts/${postId}/approve`,
    method: 'post'
  })
}

// 拒绝帖子
export function rejectPost(postId, data) {
  return request({
    url: `/admin/posts/${postId}/reject`,
    method: 'post',
    data
  })
}

// 删除帖子（管理员）
export function deleteAdminPost(postId) {
  return request({
    url: `/admin/posts/${postId}`,
    method: 'delete'
  })
}

// 恢复已删除的帖子
export function restorePost(postId) {
  return request({
    url: `/admin/posts/${postId}/restore`,
    method: 'post'
  })
}

// 获取举报记录
export function getPostReports(postId) {
  return request({
    url: `/admin/posts/${postId}/reports`,
    method: 'get'
  })
}

// ============ 系统设置 ============

// 获取系统设置
export function getSystemSettings() {
  return request({
    url: '/admin/settings',
    method: 'get'
  })
}

// 更新系统设置
export function updateSystemSettings(data) {
  return request({
    url: '/admin/settings',
    method: 'put',
    data
  })
}

// 获取基本设置
export function getBasicSettings() {
  return request({
    url: '/admin/settings/basic',
    method: 'get'
  })
}

// 更新基本设置
export function updateBasicSettings(data) {
  return request({
    url: '/admin/settings/basic',
    method: 'put',
    data
  })
}

// 获取用户设置
export function getUserSettings() {
  return request({
    url: '/admin/settings/user',
    method: 'get'
  })
}

// 更新用户设置
export function updateUserSettings(data) {
  return request({
    url: '/admin/settings/user',
    method: 'put',
    data
  })
}

// 获取内容设置
export function getContentSettings() {
  return request({
    url: '/admin/settings/content',
    method: 'get'
  })
}

// 更新内容设置
export function updateContentSettings(data) {
  return request({
    url: '/admin/settings/content',
    method: 'put',
    data
  })
}

// 获取邮件设置
export function getEmailSettings() {
  return request({
    url: '/admin/settings/email',
    method: 'get'
  })
}

// 更新邮件设置
export function updateEmailSettings(data) {
  return request({
    url: '/admin/settings/email',
    method: 'put',
    data
  })
}

// 测试邮件设置
export function testEmailSettings(email) {
  return request({
    url: '/admin/settings/email/test',
    method: 'post',
    data: { email }
  })
}

// 获取安全设置
export function getSecuritySettings() {
  return request({
    url: '/admin/settings/security',
    method: 'get'
  })
}

// 更新安全设置
export function updateSecuritySettings(data) {
  return request({
    url: '/admin/settings/security',
    method: 'put',
    data
  })
}

// 获取缓存设置
export function getCacheSettings() {
  return request({
    url: '/admin/settings/cache',
    method: 'get'
  })
}

// 更新缓存设置
export function updateCacheSettings(data) {
  return request({
    url: '/admin/settings/cache',
    method: 'put',
    data
  })
}

// 清空缓存
export function clearCache() {
  return request({
    url: '/admin/cache/clear',
    method: 'post'
  })
}

// 获取缓存统计
export function getCacheStats() {
  return request({
    url: '/admin/cache/stats',
    method: 'get'
  })
}
