import request from './request'

/**
 * 私信相关API
 */

// 获取会话列表
export function getConversations(params) {
  return request({
    url: '/messages/conversations',
    method: 'get',
    params
  })
}

// 获取会话详情
export function getConversationDetail(conversationId) {
  return request({
    url: `/messages/conversations/${conversationId}`,
    method: 'get'
  })
}

// 获取会话消息列表
export function getMessages(conversationId, params) {
  return request({
    url: `/messages/conversations/${conversationId}/messages`,
    method: 'get',
    params
  })
}

// 发送消息
export function sendMessage(conversationId, data) {
  return request({
    url: `/messages/conversations/${conversationId}/messages`,
    method: 'post',
    data
  })
}

// 创建新会话
export function createConversation(data) {
  return request({
    url: '/messages/conversations',
    method: 'post',
    data
  })
}

// 删除会话
export function deleteConversation(conversationId) {
  return request({
    url: `/messages/conversations/${conversationId}`,
    method: 'delete'
  })
}

// 标记会话为已读
export function markConversationAsRead(conversationId) {
  return request({
    url: `/messages/conversations/${conversationId}/read`,
    method: 'put'
  })
}

// 获取未读消息数量
export function getUnreadMessagesCount() {
  return request({
    url: '/messages/unread-count',
    method: 'get'
  })
}
