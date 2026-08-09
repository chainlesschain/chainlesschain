# post-manager

**Source**: `src/main/social/post-manager.js`

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

## function safeParse(raw, fallback)

```javascript
function safeParse(raw, fallback)
```

* Tolerant JSON column parse — a single post with a corrupt images string must
 * not throw out of the .map and drop the whole post list. The `x ? JSON.parse(x)
 * : d` form it replaces only guarded NULL, not a corrupt non-empty string.

---

## function buildPostSignedSubset(post)

```javascript
function buildPostSignedSubset(post)
```

* Build the canonical, IMMUTABLE subset of a post that is Ed25519-signed by its
 * author and verified on receipt. Only fields fixed at creation are included —
 * NEVER like_count / comment_count / share_count / updated_at, which mutate as
 * the post propagates and would otherwise break every relayed signature.
 *
 * canonicalize() (did-signer) rejects nested objects/arrays, so `images` (an
 * array) is flattened to its JSON string. Both sender and receiver call THIS
 * function, so the canonical bytes match exactly.
 * @param {Object} post
 * @returns {Object} flat subset suitable for did-signer canonicalize()

---

## function buildLikeSignedSubset(

```javascript
function buildLikeSignedSubset(
```

* Canonical immutable subset of a LIKE, signed by the liker (user_did) so a
 * peer cannot forge "X liked this" on X's behalf. Timestamp is deliberately
 * excluded: a like is idempotent (dedup on post_id+user_did), the receiver
 * stamps its own created_at, and omitting it means only pubkey+signature need
 * to be threaded through the P2P notification.
 * @param {{ postId: string, userDid: string }} like
 * @returns {Object} flat subset for did-signer canonicalize()

---

## function buildCommentSignedSubset(comment)

```javascript
function buildCommentSignedSubset(comment)
```

* Canonical immutable subset of a COMMENT, signed by its author (author_did).
 * parent_id is normalized to null (not undefined) so sender and receiver
 * canonicalize identically — canonicalize() serializes null but SKIPS
 * undefined, so the two must not diverge.
 * @param {Object} comment
 * @returns {Object} flat subset for did-signer canonicalize()

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

## _signPost(post)

```javascript
_signPost(post)
```

* 用当前身份的 Ed25519 DID 私钥对动态签名。
   * 无签名密钥的旧身份返回 {null,null}（收端按 legacy 未签名兼容处理）；
   * 签名抛错时降级为未签名（记 error 日志，动态本身已本地保存）。
   * @param {Object} post - 动态对象
   * @returns {{ author_pubkey: string|null, signature: string|null }}
   * @private

---

## _signSubset(subset, ctx)

```javascript
_signSubset(subset, ctx)
```

* 用当前身份的 Ed25519 DID 私钥对给定 canonical 子集签名（动态/点赞/评论共用）。
   * 无签名密钥的旧身份返回 {null,null}（收端按 legacy 未签名兼容处理）；
   * 签名抛错时降级为未签名（记 error 日志，本地记录已保存）。
   * @param {Object} subset - 已构造的可签名扁平子集
   * @param {string} ctx - 日志上下文标签
   * @returns {{ author_pubkey: string|null, signature: string|null }}
   * @private

---

## _verifyInbound(subset, signerDid, pubkey, signature, label)

```javascript
_verifyInbound(subset, signerDid, pubkey, signature, label)
```

* 接收路径通用真实性门（对齐 handlePostReceived 三模式，B4a）：
   *   pubkey+signature 都在 → 严格验签（pubkey 必 hash 成 signerDid 且验签通过），失败即拒；
   *   两者都缺 → legacy 未签名，接受 + 警告（迁移窗口）；
   *   只有其一 → 信封损坏，拒绝。
   * @param {Object} subset - 收端用同一 builder 重建的 canonical 子集
   * @param {string} signerDid - 声称的签名者 DID（点赞=user_did / 评论=author_did）
   * @param {string|null} pubkey - author_pubkey
   * @param {string|null} signature
   * @param {string} label - 日志用（如 "点赞"/"评论"）
   * @returns {{ ok: boolean, legacy?: boolean, reason?: string }}
   * @private

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

## async handleLikeReceived(postId, userDid, authorPubkey, signature)

```javascript
async handleLikeReceived(postId, userDid, authorPubkey, signature)
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

