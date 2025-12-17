import request from './request'

/**
 * 通知相关API
 */

// 获取通知列表
export function getNotifications(params) {
  return request({
    url: '/notifications',
    method: 'get',
    params
  })
}

// 获取未读通知数量
export function getUnreadCount() {
  return request({
    url: '/notifications/unread-count',
    method: 'get'
  })
}

// 标记通知为已读
export function markAsRead(notificationId) {
  return request({
    url: `/notifications/${notificationId}/read`,
    method: 'put'
  })
}

// 标记所有通知为已读
export function markAllAsRead() {
  return request({
    url: '/notifications/read-all',
    method: 'put'
  })
}

// 删除通知
export function deleteNotification(notificationId) {
  return request({
    url: `/notifications/${notificationId}`,
    method: 'delete'
  })
}

// 清空所有已读通知
export function clearReadNotifications() {
  return request({
    url: '/notifications/clear-read',
    method: 'delete'
  })
}
