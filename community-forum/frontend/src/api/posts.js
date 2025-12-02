import request from './request'

/**
 * 获取帖子列表
 */
export function getPostList(params) {
  return request({
    url: '/posts',
    method: 'get',
    params
  })
}

/**
 * 获取帖子详情
 */
export function getPostDetail(id) {
  return request({
    url: `/posts/${id}`,
    method: 'get'
  })
}

/**
 * 创建帖子
 */
export function createPost(data) {
  return request({
    url: '/posts',
    method: 'post',
    data
  })
}

/**
 * 更新帖子
 */
export function updatePost(id, data) {
  return request({
    url: `/posts/${id}`,
    method: 'put',
    data
  })
}

/**
 * 删除帖子
 */
export function deletePost(id) {
  return request({
    url: `/posts/${id}`,
    method: 'delete'
  })
}

/**
 * 点赞帖子
 */
export function likePost(id) {
  return request({
    url: `/posts/${id}/like`,
    method: 'post'
  })
}

/**
 * 取消点赞帖子
 */
export function unlikePost(id) {
  return request({
    url: `/posts/${id}/unlike`,
    method: 'post'
  })
}

/**
 * 收藏帖子
 */
export function favoritePost(id) {
  return request({
    url: `/posts/${id}/favorite`,
    method: 'post'
  })
}

/**
 * 取消收藏帖子
 */
export function unfavoritePost(id) {
  return request({
    url: `/posts/${id}/unfavorite`,
    method: 'post'
  })
}

/**
 * 获取帖子回复列表
 */
export function getPostReplies(postId, params) {
  return request({
    url: `/posts/${postId}/replies`,
    method: 'get',
    params
  })
}

/**
 * 创建回复
 */
export function createReply(postId, data) {
  return request({
    url: `/posts/${postId}/replies`,
    method: 'post',
    data
  })
}

/**
 * 更新回复
 */
export function updateReply(id, data) {
  return request({
    url: `/replies/${id}`,
    method: 'put',
    data
  })
}

/**
 * 删除回复
 */
export function deleteReply(id) {
  return request({
    url: `/replies/${id}`,
    method: 'delete'
  })
}

/**
 * 采纳最佳答案
 */
export function acceptBestAnswer(postId, replyId) {
  return request({
    url: `/posts/${postId}/best-answer`,
    method: 'post',
    data: { replyId }
  })
}
