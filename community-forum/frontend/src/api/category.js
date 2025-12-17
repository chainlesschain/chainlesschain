import request from './request'

/**
 * 分类相关API
 */

// 获取所有分类
export function getCategories() {
  return request({
    url: '/categories',
    method: 'get'
  })
}

// 获取分类详情
export function getCategoryDetail(slug) {
  return request({
    url: `/categories/${slug}`,
    method: 'get'
  })
}

// 获取分类下的帖子
export function getCategoryPosts(slug, params) {
  return request({
    url: `/categories/${slug}/posts`,
    method: 'get',
    params
  })
}

/**
 * 标签相关API
 */

// 获取热门标签
export function getPopularTags(params) {
  return request({
    url: '/tags/popular',
    method: 'get',
    params
  })
}

// 获取标签详情
export function getTagDetail(slug) {
  return request({
    url: `/tags/${slug}`,
    method: 'get'
  })
}

// 获取标签下的帖子
export function getTagPosts(slug, params) {
  return request({
    url: `/tags/${slug}/posts`,
    method: 'get',
    params
  })
}

// 搜索标签
export function searchTags(keyword) {
  return request({
    url: '/tags/search',
    method: 'get',
    params: { keyword }
  })
}
