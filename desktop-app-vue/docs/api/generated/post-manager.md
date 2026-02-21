# post-manager

**Source**: `src/main/social/post-manager.js`

**Generated**: 2026-02-21T22:04:25.778Z

---

## const

```javascript
const
```

* 动态管理器
 *
 * 负责社交动态的管理，包括：
 * - 动态发布和编辑
 * - 动态流查询
 * - 点赞和取消点赞
 * - 评论和回复
 * - P2P 动态同步

---

## const PostVisibility =

```javascript
const PostVisibility =
```

* 动态可见性

---

## class PostManager extends EventEmitter

```javascript
class PostManager extends EventEmitter
```

* 动态管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化动态管理器

---

## async initializeTables()

```javascript
async initializeTables()
```

* 初始化数据库表

---

## setupP2PListeners()

```javascript
setupP2PListeners()
```

* 设置 P2P 监听器

---

## async createPost(

```javascript
async createPost(
```

* 发布动态
   * @param {Object} options - 动态选项
   * @param {string} options.content - 动态内容
   * @param {Array<string>} options.images - 图片 URL 列表
   * @param {string} options.linkUrl - 链接 URL
   * @param {string} options.linkTitle - 链接标题
   * @param {string} options.linkDescription - 链接描述
   * @param {string} options.visibility - 可见性

---

## async syncPost(post)

```javascript
async syncPost(post)
```

* 同步动态到 P2P 网络
   * @param {Object} post - 动态对象

---

## async handlePostReceived(post)

```javascript
async handlePostReceived(post)
```

* 处理收到的动态
   * @param {Object} post - 动态对象

---

## async getFeed(

```javascript
async getFeed(
```

* 获取动态流
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 限制数量
   * @param {number} options.offset - 偏移量
   * @param {string} options.authorDid - 作者 DID（可选）

---

## async getPost(postId)

```javascript
async getPost(postId)
```

* 获取单条动态
   * @param {string} postId - 动态 ID

---

## async deletePost(postId)

```javascript
async deletePost(postId)
```

* 删除动态
   * @param {string} postId - 动态 ID

---

## async likePost(postId)

```javascript
async likePost(postId)
```

* 点赞动态
   * @param {string} postId - 动态 ID

---

## async unlikePost(postId)

```javascript
async unlikePost(postId)
```

* 取消点赞
   * @param {string} postId - 动态 ID

---

## hasLiked(postId, userDid)

```javascript
hasLiked(postId, userDid)
```

* 检查是否已点赞
   * @param {string} postId - 动态 ID
   * @param {string} userDid - 用户 DID

---

## async handleLikeReceived(postId, userDid)

```javascript
async handleLikeReceived(postId, userDid)
```

* 处理收到的点赞
   * @param {string} postId - 动态 ID
   * @param {string} userDid - 用户 DID

---

## async getLikes(postId)

```javascript
async getLikes(postId)
```

* 获取点赞列表
   * @param {string} postId - 动态 ID

---

## async addComment(postId, content, parentId = null)

```javascript
async addComment(postId, content, parentId = null)
```

* 添加评论
   * @param {string} postId - 动态 ID
   * @param {string} content - 评论内容
   * @param {string} parentId - 父评论 ID（可选，用于回复）

---

## async handleCommentReceived(comment)

```javascript
async handleCommentReceived(comment)
```

* 处理收到的评论
   * @param {Object} comment - 评论对象

---

## async getComments(postId)

```javascript
async getComments(postId)
```

* 获取评论列表
   * @param {string} postId - 动态 ID

---

## async deleteComment(commentId)

```javascript
async deleteComment(commentId)
```

* 删除评论
   * @param {string} commentId - 评论 ID

---

## async close()

```javascript
async close()
```

* 关闭动态管理器

---

