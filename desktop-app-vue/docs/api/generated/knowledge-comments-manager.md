# knowledge-comments-manager

**Source**: `src/main/knowledge/knowledge-comments-manager.js`

**Generated**: 2026-02-15T10:10:53.415Z

---

## const

```javascript
const
```

* Knowledge Comments Manager
 *
 * Manages comments and annotations for knowledge base items.
 * Supports threaded discussions, inline comments, and mentions.
 *
 * Features:
 * - Create/edit/delete comments
 * - Threaded replies
 * - Inline comments (position-based)
 * - @mentions
 * - Comment resolution
 * - Activity tracking

---

## async createComment(params)

```javascript
async createComment(params)
```

* Create a new comment
   * @param {Object} params - Comment parameters
   * @returns {Object} Created comment

---

## async getComments(knowledgeId, options =

```javascript
async getComments(knowledgeId, options =
```

* Get comments for a knowledge item
   * @param {string} knowledgeId - Knowledge item ID
   * @param {Object} options - Query options
   * @returns {Array} Comments

---

## async updateComment(commentId, updates)

```javascript
async updateComment(commentId, updates)
```

* Update a comment
   * @param {string} commentId - Comment ID
   * @param {Object} updates - Updates to apply
   * @returns {Object} Updated comment

---

## async deleteComment(commentId)

```javascript
async deleteComment(commentId)
```

* Delete a comment
   * @param {string} commentId - Comment ID

---

## async resolveComment(commentId, resolvedBy)

```javascript
async resolveComment(commentId, resolvedBy)
```

* Resolve a comment thread
   * @param {string} commentId - Comment ID
   * @param {string} resolvedBy - User DID who resolved

---

## async getCommentStats(knowledgeId)

```javascript
async getCommentStats(knowledgeId)
```

* Get comment statistics
   * @param {string} knowledgeId - Knowledge item ID
   * @returns {Object} Statistics

---

## _extractMentions(content)

```javascript
_extractMentions(content)
```

* Extract @mentions from comment content
   * @private

---

## _buildCommentTree(comments)

```javascript
_buildCommentTree(comments)
```

* Build comment tree structure
   * @private

---

## async _logActivity(orgId, knowledgeId, userDid, activityType, resourceId)

```javascript
async _logActivity(orgId, knowledgeId, userDid, activityType, resourceId)
```

* Log activity
   * @private

---

## async _broadcastCommentEvent(knowledgeId, event)

```javascript
async _broadcastCommentEvent(knowledgeId, event)
```

* Broadcast comment event to peers
   * @private

---

## async _notifyMentionedUsers(knowledgeId, mentions, authorName, content)

```javascript
async _notifyMentionedUsers(knowledgeId, mentions, authorName, content)
```

* Notify mentioned users
   * @private

---

