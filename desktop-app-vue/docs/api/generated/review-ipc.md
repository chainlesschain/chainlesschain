# review-ipc

**Source**: `src/main/code-tools/review-ipc.js`

**Generated**: 2026-02-16T13:44:34.673Z

---

## const

```javascript
const
```

* Review System IPC Handlers
 * 评价反馈系统相关的 IPC 处理函数
 *
 * 包含10个评价管理handlers:
 * - review:create - 创建评价
 * - review:update - 更新评价
 * - review:delete - 删除评价
 * - review:get - 获取评价
 * - review:get-by-target - 根据目标获取评价列表
 * - review:reply - 回复评价
 * - review:mark-helpful - 标记评价是否有帮助
 * - review:report - 举报评价
 * - review:get-statistics - 获取评价统计信息
 * - review:get-my-reviews - 获取我的评价列表

---

## function registerReviewIPC(context)

```javascript
function registerReviewIPC(context)
```

* 注册所有评价系统相关的 IPC handlers
 * @param {Object} context - 上下文对象，包含 reviewManager 等

---

