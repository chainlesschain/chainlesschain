import request from './request'

/**
 * 用户相关API
 */

// 获取用户信息
export function getUserProfile(userId) {
  return request({
    url: `/users/${userId}`,
    method: 'get'
  })
}

// 更新用户信息
export function updateUserProfile(data) {
  return request({
    url: '/users/profile',
    method: 'put',
    data
  })
}

// 获取用户的帖子列表
export function getUserPosts(userId, params) {
  return request({
    url: `/users/${userId}/posts`,
    method: 'get',
    params
  })
}

// 获取用户的回复列表
export function getUserReplies(userId, params) {
  return request({
    url: `/users/${userId}/replies`,
    method: 'get',
    params
  })
}

// 获取用户的关注列表
export function getUserFollowing(userId, params) {
  return request({
    url: `/users/${userId}/following`,
    method: 'get',
    params
  })
}

// 获取用户的粉丝列表
export function getUserFollowers(userId, params) {
  return request({
    url: `/users/${userId}/followers`,
    method: 'get',
    params
  })
}

// 关注用户
export function followUser(userId) {
  return request({
    url: `/users/${userId}/follow`,
    method: 'post'
  })
}

// 取消关注用户
export function unfollowUser(userId) {
  return request({
    url: `/users/${userId}/unfollow`,
    method: 'post'
  })
}

// 获取用户收藏列表
export function getUserFavorites(params) {
  return request({
    url: '/users/favorites',
    method: 'get',
    params
  })
}

// 获取用户草稿列表
export function getUserDrafts(params) {
  return request({
    url: '/users/drafts',
    method: 'get',
    params
  })
}

// 保存草稿
export function saveDraft(data) {
  return request({
    url: '/users/drafts',
    method: 'post',
    data
  })
}

// 删除草稿
export function deleteDraft(draftId) {
  return request({
    url: `/users/drafts/${draftId}`,
    method: 'delete'
  })
}

// 搜索用户
export function searchUsers(params) {
  return request({
    url: '/users/search',
    method: 'get',
    params
  })
}
