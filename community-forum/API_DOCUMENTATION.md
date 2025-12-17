# ChainlessChain 社区论坛 API 文档

## 📋 目录

- [认证相关 API](#认证相关-api)
- [帖子相关 API](#帖子相关-api)
- [用户相关 API](#用户相关-api)
- [分类和标签 API](#分类和标签-api)
- [通知系统 API](#通知系统-api)
- [私信系统 API](#私信系统-api)
- [搜索功能 API](#搜索功能-api)
- [管理后台 API](#管理后台-api)

## 🔐 认证相关 API

### U盾登录
```javascript
POST /api/auth/login/ukey
Content-Type: application/json

{
  "deviceId": "string",  // U盾设备ID
  "pin": "string"        // PIN码
}

Response:
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "string",
    "user": {
      "id": "number",
      "nickname": "string",
      "avatar": "string",
      "role": "string"
    }
  }
}
```

### SIMKey登录
```javascript
POST /api/auth/login/simkey
Content-Type: application/json

{
  "simId": "string",   // SIM卡ID
  "pin": "string"      // PIN码
}
```

### 获取当前用户信息
```javascript
GET /api/auth/current
Authorization: Bearer {token}
```

### 退出登录
```javascript
POST /api/auth/logout
Authorization: Bearer {token}
```

### 刷新Token
```javascript
POST /api/auth/refresh
Authorization: Bearer {token}
```

## 📝 帖子相关 API

### 获取帖子列表
```javascript
GET /api/posts?page=1&pageSize=20&sortBy=latest&categoryId=1&tagId=1

Response:
{
  "code": 200,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### 获取帖子详情
```javascript
GET /api/posts/{id}
```

### 创建帖子
```javascript
POST /api/posts
Authorization: Bearer {token}

{
  "title": "string",
  "content": "string",
  "categoryId": "number",
  "tags": ["string"]
}
```

### 更新帖子
```javascript
PUT /api/posts/{id}
Authorization: Bearer {token}

{
  "title": "string",
  "content": "string",
  "categoryId": "number",
  "tags": ["string"]
}
```

### 删除帖子
```javascript
DELETE /api/posts/{id}
Authorization: Bearer {token}
```

### 点赞/取消点赞
```javascript
POST /api/posts/{id}/like
POST /api/posts/{id}/unlike
Authorization: Bearer {token}
```

### 收藏/取消收藏
```javascript
POST /api/posts/{id}/favorite
POST /api/posts/{id}/unfavorite
Authorization: Bearer {token}
```

### 获取帖子回复
```javascript
GET /api/posts/{postId}/replies?page=1&pageSize=20
```

### 创建回复
```javascript
POST /api/posts/{postId}/replies
Authorization: Bearer {token}

{
  "content": "string",
  "parentId": "number"  // 可选，回复某条回复
}
```

### 删除回复
```javascript
DELETE /api/replies/{id}
Authorization: Bearer {token}
```

### 采纳最佳答案
```javascript
POST /api/posts/{postId}/best-answer
Authorization: Bearer {token}

{
  "replyId": "number"
}
```

## 👤 用户相关 API

### 获取用户信息
```javascript
GET /api/users/{userId}
```

### 更新用户信息
```javascript
PUT /api/users/profile
Authorization: Bearer {token}

{
  "nickname": "string",
  "avatar": "string",
  "bio": "string"
}
```

### 获取用户的帖子
```javascript
GET /api/users/{userId}/posts?page=1&pageSize=20
```

### 获取用户的回复
```javascript
GET /api/users/{userId}/replies?page=1&pageSize=20
```

### 获取用户关注列表
```javascript
GET /api/users/{userId}/following?page=1&pageSize=20
```

### 获取用户粉丝列表
```javascript
GET /api/users/{userId}/followers?page=1&pageSize=20
```

### 关注/取消关注
```javascript
POST /api/users/{userId}/follow
POST /api/users/{userId}/unfollow
Authorization: Bearer {token}
```

### 获取收藏列表
```javascript
GET /api/users/favorites?page=1&pageSize=20
Authorization: Bearer {token}
```

### 草稿管理
```javascript
GET /api/users/drafts              // 获取草稿列表
POST /api/users/drafts             // 保存草稿
DELETE /api/users/drafts/{id}      // 删除草稿
Authorization: Bearer {token}
```

### 搜索用户
```javascript
GET /api/users/search?keyword=xxx
```

## 📂 分类和标签 API

### 获取所有分类
```javascript
GET /api/categories
```

### 获取分类详情
```javascript
GET /api/categories/{slug}
```

### 获取分类下的帖子
```javascript
GET /api/categories/{slug}/posts?page=1&pageSize=20
```

### 获取热门标签
```javascript
GET /api/tags/popular?limit=20
```

### 获取标签详情
```javascript
GET /api/tags/{slug}
```

### 获取标签下的帖子
```javascript
GET /api/tags/{slug}/posts?page=1&pageSize=20
```

### 搜索标签
```javascript
GET /api/tags/search?keyword=xxx
```

## 🔔 通知系统 API

### 获取通知列表
```javascript
GET /api/notifications?page=1&pageSize=20&type=all
Authorization: Bearer {token}

type可选值: all, system, interaction
```

### 获取未读数量
```javascript
GET /api/notifications/unread-count
Authorization: Bearer {token}
```

### 标记为已读
```javascript
PUT /api/notifications/{id}/read
PUT /api/notifications/read-all  // 全部标记为已读
Authorization: Bearer {token}
```

### 删除通知
```javascript
DELETE /api/notifications/{id}
DELETE /api/notifications/clear-read  // 清空已读
Authorization: Bearer {token}
```

## 💬 私信系统 API

### 获取会话列表
```javascript
GET /api/messages/conversations?page=1&pageSize=20
Authorization: Bearer {token}
```

### 获取会话消息
```javascript
GET /api/messages/conversations/{conversationId}/messages?page=1&pageSize=50
Authorization: Bearer {token}
```

### 发送消息
```javascript
POST /api/messages/conversations/{conversationId}/messages
Authorization: Bearer {token}

{
  "content": "string"
}
```

### 创建会话
```javascript
POST /api/messages/conversations
Authorization: Bearer {token}

{
  "userId": "number",
  "content": "string"
}
```

### 删除会话
```javascript
DELETE /api/messages/conversations/{id}
Authorization: Bearer {token}
```

### 标记会话为已读
```javascript
PUT /api/messages/conversations/{id}/read
Authorization: Bearer {token}
```

### 获取未读消息数
```javascript
GET /api/messages/unread-count
Authorization: Bearer {token}
```

## 🔍 搜索功能 API

### 全局搜索
```javascript
GET /api/search?keyword=xxx&type=all&page=1&pageSize=20

type可选值: all, post, user
```

### 搜索帖子
```javascript
GET /api/search/posts?keyword=xxx&categoryId=1&tagId=1&sortBy=relevant
```

### 搜索用户
```javascript
GET /api/search/users?keyword=xxx
```

### 获取热门搜索
```javascript
GET /api/search/hot
```

### 获取搜索建议
```javascript
GET /api/search/suggestions?keyword=xxx
```

## 🛠️ 管理后台 API

> 所有管理后台API都需要管理员权限

### 仪表盘

```javascript
// 获取统计数据
GET /admin/dashboard/stats

// 获取用户增长数据
GET /admin/dashboard/user-growth?period=week

// 获取内容统计
GET /admin/dashboard/content-stats?type=category

// 获取最新活动
GET /admin/dashboard/activities?page=1&pageSize=10
```

### 用户管理

```javascript
// 获取用户列表
GET /admin/users?page=1&pageSize=20&status=all&role=all&keyword=xxx

// 获取用户详情
GET /admin/users/{id}

// 封禁用户
POST /admin/users/{id}/ban
{
  "reason": "string",
  "duration": "number"  // 天数，0表示永久
}

// 解封用户
POST /admin/users/{id}/unban

// 删除用户
DELETE /admin/users/{id}

// 更新用户角色
PUT /admin/users/{id}/role
{
  "role": "ADMIN | USER"
}
```

### 内容审核

```javascript
// 获取待审核帖子
GET /admin/posts/pending?page=1&pageSize=20

// 获取被举报帖子
GET /admin/posts/reported?page=1&pageSize=20

// 获取所有帖子
GET /admin/posts?page=1&pageSize=20&status=all

// 审核通过
POST /admin/posts/{id}/approve

// 拒绝帖子
POST /admin/posts/{id}/reject
{
  "reason": "string"
}

// 删除帖子
DELETE /admin/posts/{id}

// 恢复帖子
POST /admin/posts/{id}/restore

// 获取举报记录
GET /admin/posts/{id}/reports
```

### 系统设置

```javascript
// 获取所有设置
GET /admin/settings

// 更新设置
PUT /admin/settings
{
  "key": "value"
}

// 获取/更新各类设置
GET/PUT /admin/settings/basic       // 基本设置
GET/PUT /admin/settings/user        // 用户设置
GET/PUT /admin/settings/content     // 内容设置
GET/PUT /admin/settings/email       // 邮件设置
GET/PUT /admin/settings/security    // 安全设置
GET/PUT /admin/settings/cache       // 缓存设置

// 测试邮件
POST /admin/settings/email/test
{
  "email": "string"
}

// 清空缓存
POST /admin/cache/clear

// 获取缓存统计
GET /admin/cache/stats
```

## 📊 通用响应格式

### 成功响应
```javascript
{
  "code": 200,
  "message": "成功",
  "data": {}  // 具体数据
}
```

### 错误响应
```javascript
{
  "code": 400,  // 错误码
  "message": "错误信息",
  "data": null
}
```

### 分页响应
```javascript
{
  "code": 200,
  "message": "成功",
  "data": {
    "items": [],       // 数据列表
    "total": 100,      // 总数
    "page": 1,         // 当前页
    "pageSize": 20,    // 每页数量
    "totalPages": 5    // 总页数
  }
}
```

## 🔑 错误码说明

| 错误码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未授权，需要登录 |
| 403 | 没有权限 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

## 🌐 环境配置

### 开发环境
```
VITE_API_BASE_URL=http://localhost:8080/api
```

### 生产环境
```
VITE_API_BASE_URL=/api
```

## 📝 使用示例

```javascript
// 引入API
import { loginWithUKey } from '@/api/auth'
import { getPostList, createPost } from '@/api/posts'

// 调用API
const login = async () => {
  try {
    const res = await loginWithUKey('device-id', 'pin-code')
    console.log('登录成功:', res)
  } catch (error) {
    console.error('登录失败:', error)
  }
}

// 获取帖子列表
const fetchPosts = async () => {
  try {
    const res = await getPostList({ page: 1, pageSize: 20 })
    console.log('帖子列表:', res)
  } catch (error) {
    console.error('获取失败:', error)
  }
}
```

## 🔗 相关文档

- [前端技术栈](/community-forum/FEATURES.md)
- [项目进度](/community-forum/PROGRESS.md)
- [README](/community-forum/README.md)

---

**更新时间**: 2025-12-17
**版本**: v1.0
**状态**: API接口定义完成，待后端实现
