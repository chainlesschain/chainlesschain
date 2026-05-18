import request from './request'

/**
 * 搜索相关API
 */

// 全局搜索
export function globalSearch(params) {
  return request({
    url: '/search',
    method: 'get',
    params
  })
}

// 搜索帖子
export function searchPosts(params) {
  return request({
    url: '/search/posts',
    method: 'get',
    params
  })
}

// 搜索用户
export function searchUsers(params) {
  return request({
    url: '/search/users',
    method: 'get',
    params
  })
}

// 获取热门搜索
export function getHotSearches() {
  return request({
    url: '/search/hot',
    method: 'get'
  })
}

// 获取搜索建议
export function getSearchSuggestions(keyword) {
  return request({
    url: '/search/suggestions',
    method: 'get',
    params: { keyword }
  })
}
