# 数据库初始化问题修复

## 问题描述

**错误信息:**
```
[Database] h5Data 未初始化，尝试初始化
加载好友列表: 0
```

**原因分析:**
1. 用户直接访问社交功能页面（好友/消息/动态）
2. 这些页面的服务在初始化时调用数据库方法
3. 但数据库没有通过 `init(pin)` 完整初始化
4. H5模式下的 `h5Data` 为 null
5. `ensureH5Data()` 方法的数据结构不完整

## 修复内容

### 1. 修复 `ensureH5Data()` 数据结构 (database.js:150)

**问题:** 缺少新添加的表定义

**修复前:**
```javascript
this.h5Data = {
  knowledge_items: [],
  tags: [],
  // ... 缺少 identities, did_services, friend_requests, blocked_users, post_likes
  friendships: [],
  posts: [],
  post_comments: []
}
```

**修复后:**
```javascript
this.h5Data = {
  knowledge_items: [],
  tags: [],
  knowledge_tags: [],
  knowledge_links: [],
  folders: [],
  conversations: [],
  messages: [],
  identities: [],           // ✅ 新增
  did_services: [],         // ✅ 新增
  friendships: [],
  friend_requests: [],      // ✅ 新增
  blocked_users: [],        // ✅ 新增
  posts: [],
  post_likes: [],           // ✅ 新增
  post_comments: [],
  market_listings: [],
  orders: [],
  user_assets: [],
  transactions: []
}
// 保存到localStorage
this.saveH5Data()
```

### 2. 添加无PIN初始化方法 (database.js:49)

**新增方法:**
```javascript
/**
 * 简化初始化（无需PIN，仅用于H5模式的基本功能）
 */
async initWithoutPin() {
  if (this.isH5) {
    return this.initH5()
  } else {
    console.warn('[Database] App模式需要PIN初始化')
    return Promise.reject(new Error('App模式需要PIN初始化'))
  }
}
```

**用途:**
- H5模式下无需加密的基本数据访问
- 在用户未登录时也能浏览社交功能（只读）
- 自动加载 localStorage 中的数据

### 3. 修复好友服务初始化 (friends.js:26)

**修复前:**
```javascript
async init() {
  try {
    await this.loadFriends()
    await this.loadFriendRequests()
    await this.loadBlockedUsers()
    console.log('好友服务初始化完成')
  } catch (error) {
    console.error('好友服务初始化失败:', error)
    throw error
  }
}
```

**修复后:**
```javascript
async init() {
  try {
    // ✅ 确保数据库已初始化
    if (!database.isOpen) {
      console.log('[FriendService] 数据库未初始化，尝试初始化...')
      await database.initWithoutPin()
    }

    await this.loadFriends()
    await this.loadFriendRequests()
    await this.loadBlockedUsers()
    console.log('好友服务初始化完成')
  } catch (error) {
    console.error('好友服务初始化失败:', error)
    throw error
  }
}
```

### 4. 修复消息服务初始化 (messaging.js:26)

**添加相同的数据库检查:**
```javascript
async init() {
  try {
    // ✅ 确保数据库已初始化
    if (!database.isOpen) {
      console.log('[MessagingService] 数据库未初始化，尝试初始化...')
      await database.initWithoutPin()
    }

    await this.loadConversations()
    console.log('消息服务初始化完成')
  } catch (error) {
    console.error('消息服务初始化失败:', error)
    throw error
  }
}
```

### 5. 修复动态服务初始化 (posts.js:24)

**添加相同的数据库检查:**
```javascript
async init() {
  try {
    // ✅ 确保数据库已初始化
    if (!database.isOpen) {
      console.log('[PostsService] 数据库未初始化，尝试初始化...')
      await database.initWithoutPin()
    }

    await this.loadTimeline()
    console.log('动态服务初始化完成')
  } catch (error) {
    console.error('动态服务初始化失败:', error)
    throw error
  }
}
```

## 修复效果

### 修复前
```
❌ 直接访问社交页面 → h5Data 为 null → 崩溃
❌ ensureH5Data 创建不完整的数据结构 → 缺少表
❌ 好友列表显示 0 → 数据加载失败
```

### 修复后
```
✅ 直接访问社交页面 → 自动调用 initWithoutPin()
✅ ensureH5Data 创建完整数据结构 → 包含所有表
✅ 从 localStorage 正确加载数据
✅ 好友列表正常显示
```

## 工作流程

### H5模式（无需登录）
```
用户访问社交页面
    ↓
服务 init() 检查 database.isOpen
    ↓
调用 database.initWithoutPin()
    ↓
initH5() 从 localStorage 加载数据
    ↓
ensureH5Data() 确保所有表存在
    ↓
服务正常加载数据
```

### H5模式（已登录）
```
用户登录 → database.init(pin)
    ↓
initH5() 完整初始化
    ↓
用户访问社交页面
    ↓
服务 init() 检查 database.isOpen → 已打开
    ↓
直接加载数据
```

### App模式
```
用户必须先登录 → database.init(pin)
    ↓
用户访问社交页面
    ↓
服务 init() 检查 database.isOpen → 已打开
    ↓
直接从 SQLite 加载数据
```

## 测试验证

### 测试场景1: H5模式直接访问
```bash
1. 清空浏览器缓存
2. 直接访问 /pages/social/friends/list
3. 预期：自动初始化，显示空列表（而非崩溃）
```

### 测试场景2: H5模式有缓存数据
```bash
1. 先登录并添加好友
2. 刷新页面或重新打开
3. 直接访问好友列表
4. 预期：正确加载并显示好友
```

### 测试场景3: 完整登录流程
```bash
1. 访问登录页
2. 输入PIN登录
3. database.init(pin) 执行
4. 访问社交页面
5. 预期：正常加载，可以使用所有功能
```

## 相关文件

**修改的文件:**
- `services/database.js` - 2处修改
- `services/friends.js` - 1处修改
- `services/messaging.js` - 1处修改
- `services/posts.js` - 1处修改

**影响范围:**
- 所有社交功能（好友、消息、动态）
- H5模式的数据持久化
- localStorage 数据结构

## 注意事项

1. **App模式**: 仍然需要PIN初始化，`initWithoutPin()` 会拒绝
2. **加密数据**: 无PIN初始化时无法解密加密内容
3. **数据一致性**: localStorage 和 init(pin) 使用相同的数据结构
4. **向后兼容**: 不影响已有的登录流程

## 版本信息

- **修复日期**: 2024-12-21
- **版本**: 1.0.1
- **修复人**: Claude Sonnet 4.5
