# Code Tools IPC Modules

This directory contains modularized IPC handlers for code-related and review-related functionality.

## Files

### 1. code-ipc.js
Contains 10 code-related IPC handlers:
- `code:generate` - 生成代码
- `code:generateTests` - 生成单元测试
- `code:review` - 代码审查
- `code:refactor` - 代码重构
- `code:explain` - 解释代码
- `code:fixBug` - 修复bug
- `code:generateScaffold` - 生成项目脚手架
- `code:executePython` - 执行Python代码
- `code:executeFile` - 执行代码文件
- `code:checkSafety` - 检查代码安全性

### 2. review-ipc.js
Contains 10 review system IPC handlers:
- `review:create` - 创建评价
- `review:update` - 更新评价
- `review:delete` - 删除评价
- `review:get` - 获取评价
- `review:get-by-target` - 根据目标获取评价列表
- `review:reply` - 回复评价
- `review:mark-helpful` - 标记评价是否有帮助
- `review:report` - 举报评价
- `review:get-statistics` - 获取评价统计信息
- `review:get-my-reviews` - 获取我的评价列表

## Usage in index.js

To use these modules in the main index.js file, import and call the register functions:

```javascript
// At the top of index.js
const { registerCodeIPC } = require('./code-tools/code-ipc');
const { registerReviewIPC } = require('./code-tools/review-ipc');

// In the appropriate initialization method (e.g., registerCoreIPCHandlers or similar)
registerCodeIPC({
  llmManager: this.llmManager
});

registerReviewIPC({
  reviewManager: this.reviewManager
});
```

## Integration Example

```javascript
class ChainlessChainApp {
  registerCoreIPCHandlers() {
    // ... other registrations ...

    // Register code tools IPC handlers
    const { registerCodeIPC } = require('./code-tools/code-ipc');
    registerCodeIPC({
      llmManager: this.llmManager
    });

    // Register review system IPC handlers
    const { registerReviewIPC } = require('./code-tools/review-ipc');
    registerReviewIPC({
      reviewManager: this.reviewManager
    });

    // ... other registrations ...
  }
}
```

## Benefits

1. **Modularity**: Code is organized by functionality
2. **Maintainability**: Easier to locate and update specific handlers
3. **Reusability**: Can be imported and used in different contexts
4. **Clarity**: Clear separation of concerns between code tools and review system
5. **Scalability**: Easy to add new handlers to existing modules

## Dependencies

### code-ipc.js dependencies:
- `../engines/code-engine` - For code generation, review, refactoring, etc.
- `../engines/code-executor` - For code execution and safety checks

### review-ipc.js dependencies:
- Context must provide `reviewManager` object with methods:
  - `createReview(options)`
  - `updateReview(reviewId, updates)`
  - `deleteReview(reviewId)`
  - `getReview(reviewId)`
  - `getReviewsByTarget(targetId, targetType, filters)`
  - `replyToReview(reviewId, content)`
  - `markHelpful(reviewId, helpful)`
  - `reportReview(reviewId, reason, description)`
  - `getStatistics(targetId, targetType)`
  - `getMyReviews(userDid)`
