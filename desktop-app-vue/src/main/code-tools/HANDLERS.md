# IPC Handlers Reference

## Code Tools Handlers (code-ipc.js)

### 1. code:generate
**Purpose**: 生成代码
**Parameters**:
- `description` (string): 代码描述
- `options` (object, optional): 配置选项
  - `language` (string): 编程语言，默认 'javascript'

**Returns**: 生成的代码结果

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:generate', '创建一个用户登录函数', {
  language: 'javascript'
});
```

---

### 2. code:generateTests
**Purpose**: 生成单元测试
**Parameters**:
- `code` (string): 源代码
- `language` (string): 编程语言

**Returns**: 生成的测试代码

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:generateTests', sourceCode, 'javascript');
```

---

### 3. code:review
**Purpose**: 代码审查
**Parameters**:
- `code` (string): 源代码
- `language` (string): 编程语言

**Returns**: 审查结果（包含评分和建议）

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:review', sourceCode, 'python');
console.log('评分:', result.score);
```

---

### 4. code:refactor
**Purpose**: 代码重构
**Parameters**:
- `code` (string): 源代码
- `language` (string): 编程语言
- `refactoringType` (string): 重构类型

**Returns**: 重构后的代码

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:refactor', sourceCode, 'javascript', 'extract-function');
```

---

### 5. code:explain
**Purpose**: 解释代码
**Parameters**:
- `code` (string): 源代码
- `language` (string): 编程语言

**Returns**: 代码解释

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:explain', sourceCode, 'rust');
```

---

### 6. code:fixBug
**Purpose**: 修复bug
**Parameters**:
- `code` (string): 源代码
- `language` (string): 编程语言
- `errorMessage` (string): 错误信息

**Returns**: 修复后的代码

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:fixBug', sourceCode, 'java', 'NullPointerException at line 42');
```

---

### 7. code:generateScaffold
**Purpose**: 生成项目脚手架
**Parameters**:
- `projectType` (string): 项目类型
- `options` (object, optional): 配置选项
  - `projectName` (string): 项目名称
  - `outputDir` (string): 输出目录

**Returns**: 脚手架生成结果

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:generateScaffold', 'vue3-app', {
  projectName: 'my-app',
  outputDir: '/path/to/output'
});
```

---

### 8. code:executePython
**Purpose**: 执行Python代码
**Parameters**:
- `code` (string): Python代码
- `options` (object, optional): 执行选项
  - `ignoreWarnings` (boolean): 忽略安全警告

**Returns**: 执行结果
- `success` (boolean): 是否成功
- `stdout` (string): 标准输出
- `stderr` (string): 错误输出
- `error` (string): 错误类型
- `warnings` (array): 警告信息

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:executePython', 'print("Hello World")', {
  ignoreWarnings: false
});
console.log(result.stdout);
```

---

### 9. code:executeFile
**Purpose**: 执行代码文件
**Parameters**:
- `filepath` (string): 文件路径
- `options` (object, optional): 执行选项

**Returns**: 执行结果（同 code:executePython）

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:executeFile', '/path/to/script.py', {});
```

---

### 10. code:checkSafety
**Purpose**: 检查代码安全性
**Parameters**:
- `code` (string): 代码

**Returns**: 安全检查结果
- `safe` (boolean): 是否安全
- `warnings` (array): 警告列表

**Example**:
```javascript
const result = await ipcRenderer.invoke('code:checkSafety', pythonCode);
if (!result.safe) {
  console.warn('安全警告:', result.warnings);
}
```

---

## Review System Handlers (review-ipc.js)

### 1. review:create
**Purpose**: 创建评价
**Parameters**:
- `options` (object): 评价选项

**Returns**: 创建的评价对象

**Example**:
```javascript
const review = await ipcRenderer.invoke('review:create', {
  targetId: 'note123',
  targetType: 'note',
  rating: 5,
  content: '非常有用的笔记'
});
```

---

### 2. review:update
**Purpose**: 更新评价
**Parameters**:
- `reviewId` (string): 评价ID
- `updates` (object): 更新内容

**Returns**: 更新后的评价对象

**Example**:
```javascript
const updated = await ipcRenderer.invoke('review:update', 'review123', {
  rating: 4,
  content: '更新后的评价内容'
});
```

---

### 3. review:delete
**Purpose**: 删除评价
**Parameters**:
- `reviewId` (string): 评价ID

**Returns**: 删除结果

**Example**:
```javascript
await ipcRenderer.invoke('review:delete', 'review123');
```

---

### 4. review:get
**Purpose**: 获取评价
**Parameters**:
- `reviewId` (string): 评价ID

**Returns**: 评价对象或null

**Example**:
```javascript
const review = await ipcRenderer.invoke('review:get', 'review123');
```

---

### 5. review:get-by-target
**Purpose**: 根据目标获取评价列表
**Parameters**:
- `targetId` (string): 目标ID
- `targetType` (string): 目标类型
- `filters` (object): 过滤条件

**Returns**: 评价列表数组

**Example**:
```javascript
const reviews = await ipcRenderer.invoke('review:get-by-target', 'note123', 'note', {
  minRating: 4,
  sortBy: 'createdAt'
});
```

---

### 6. review:reply
**Purpose**: 回复评价
**Parameters**:
- `reviewId` (string): 评价ID
- `content` (string): 回复内容

**Returns**: 回复结果

**Example**:
```javascript
await ipcRenderer.invoke('review:reply', 'review123', '感谢您的反馈！');
```

---

### 7. review:mark-helpful
**Purpose**: 标记评价是否有帮助
**Parameters**:
- `reviewId` (string): 评价ID
- `helpful` (boolean): 是否有帮助

**Returns**: 标记结果

**Example**:
```javascript
await ipcRenderer.invoke('review:mark-helpful', 'review123', true);
```

---

### 8. review:report
**Purpose**: 举报评价
**Parameters**:
- `reviewId` (string): 评价ID
- `reason` (string): 举报原因
- `description` (string): 详细描述

**Returns**: 举报结果

**Example**:
```javascript
await ipcRenderer.invoke('review:report', 'review123', 'spam', '这是垃圾信息');
```

---

### 9. review:get-statistics
**Purpose**: 获取评价统计信息
**Parameters**:
- `targetId` (string): 目标ID
- `targetType` (string): 目标类型

**Returns**: 统计信息对象或null

**Example**:
```javascript
const stats = await ipcRenderer.invoke('review:get-statistics', 'note123', 'note');
console.log('平均评分:', stats.averageRating);
console.log('总评价数:', stats.totalReviews);
```

---

### 10. review:get-my-reviews
**Purpose**: 获取我的评价列表
**Parameters**:
- `userDid` (string): 用户DID

**Returns**: 评价列表数组

**Example**:
```javascript
const myReviews = await ipcRenderer.invoke('review:get-my-reviews', 'did:example:123456');
```

---

## Integration Status

- **Total Handlers**: 20 (10 code + 10 review)
- **Extracted From**: /Users/mac/Documents/code2/chainlesschain/desktop-app-vue/src/main/index.js
- **Module Pattern**: Standard function registration pattern
- **Dependencies**:
  - code-ipc.js requires `llmManager`
  - review-ipc.js requires `reviewManager`
