# backend-client

**Source**: `src\main\api\backend-client.js`

**Generated**: 2026-01-27T06:44:03.875Z

---

## const

```javascript
const
```

* 后端API客户端
 * 封装与Java和Python后端服务的HTTP通信

---

## const javaClient = axios.create(

```javascript
const javaClient = axios.create(
```

* 创建axios实例

---

## function handleError(error, context, silent = false)

```javascript
function handleError(error, context, silent = false)
```

* 错误处理
 * @param {boolean} silent - 是否静默错误日志（不输出到控制台）

---

## class ProjectFileAPI

```javascript
class ProjectFileAPI
```

* 项目文件管理API

---

## static async getFiles(projectId, fileType = null, pageNum = 1, pageSize = 50)

```javascript
static async getFiles(projectId, fileType = null, pageNum = 1, pageSize = 50)
```

* 获取文件列表

---

## static async getFile(projectId, fileId)

```javascript
static async getFile(projectId, fileId)
```

* 获取单个文件详情

---

## static async createFile(projectId, fileData)

```javascript
static async createFile(projectId, fileData)
```

* 创建文件

---

## static async batchCreateFiles(projectId, files)

```javascript
static async batchCreateFiles(projectId, files)
```

* 批量创建文件

---

## static async updateFile(projectId, fileId, fileData)

```javascript
static async updateFile(projectId, fileId, fileData)
```

* 更新文件

---

## static async deleteFile(projectId, fileId)

```javascript
static async deleteFile(projectId, fileId)
```

* 删除文件

---

## class GitAPI

```javascript
class GitAPI
```

* Git操作API

---

## static async init(repoPath, remoteUrl = null, branchName = 'main')

```javascript
static async init(repoPath, remoteUrl = null, branchName = 'main')
```

* 初始化仓库

---

## static async status(repoPath)

```javascript
static async status(repoPath)
```

* 获取状态

---

## static async commit(repoPath, message = null, files = null, autoGenerateMessage = false)

```javascript
static async commit(repoPath, message = null, files = null, autoGenerateMessage = false)
```

* 提交更改

---

## static async push(repoPath, remote = 'origin', branch = null)

```javascript
static async push(repoPath, remote = 'origin', branch = null)
```

* 推送到远程

---

## static async pull(repoPath, remote = 'origin', branch = null)

```javascript
static async pull(repoPath, remote = 'origin', branch = null)
```

* 从远程拉取

---

## static async log(repoPath, limit = 20)

```javascript
static async log(repoPath, limit = 20)
```

* 获取提交历史

---

## static async diff(repoPath, commit1 = null, commit2 = null)

```javascript
static async diff(repoPath, commit1 = null, commit2 = null)
```

* 获取差异

---

## static async branches(repoPath)

```javascript
static async branches(repoPath)
```

* 列出分支

---

## static async createBranch(repoPath, branchName, fromBranch = null)

```javascript
static async createBranch(repoPath, branchName, fromBranch = null)
```

* 创建分支

---

## static async checkoutBranch(repoPath, branchName)

```javascript
static async checkoutBranch(repoPath, branchName)
```

* 切换分支

---

## static async merge(repoPath, sourceBranch, targetBranch = null)

```javascript
static async merge(repoPath, sourceBranch, targetBranch = null)
```

* 合并分支

---

## static async resolveConflicts(repoPath, filePath = null, autoResolve = false, strategy = null)

```javascript
static async resolveConflicts(repoPath, filePath = null, autoResolve = false, strategy = null)
```

* 解决冲突

---

## static async generateCommitMessage(repoPath, stagedFiles = null, diffContent = null)

```javascript
static async generateCommitMessage(repoPath, stagedFiles = null, diffContent = null)
```

* AI生成提交消息

---

## class RAGAPI

```javascript
class RAGAPI
```

* RAG索引API

---

## static async indexProject(projectId, repoPath, fileTypes = null, forceReindex = false)

```javascript
static async indexProject(projectId, repoPath, fileTypes = null, forceReindex = false)
```

* 索引项目文件

---

## static async getIndexStats(projectId)

```javascript
static async getIndexStats(projectId)
```

* 获取索引统计

---

## static async enhancedQuery(projectId, query, topK = 5, useReranker = false, sources = ['project'])

```javascript
static async enhancedQuery(projectId, query, topK = 5, useReranker = false, sources = ['project'])
```

* 增强查询

---

## static async deleteProjectIndex(projectId)

```javascript
static async deleteProjectIndex(projectId)
```

* 删除项目索引

---

## static async updateFileIndex(projectId, filePath, content)

```javascript
static async updateFileIndex(projectId, filePath, content)
```

* 更新单文件索引

---

## class CodeAPI

```javascript
class CodeAPI
```

* 代码助手API

---

## static async generate(description, language, style = 'modern', includeTests = false, includeComments = true, context = null)

```javascript
static async generate(description, language, style = 'modern', includeTests = false, includeComments = true, context = null)
```

* 生成代码

---

## static async review(code, language, focusAreas = null)

```javascript
static async review(code, language, focusAreas = null)
```

* 代码审查

---

## static async refactor(code, language, refactorType = 'general', target = null)

```javascript
static async refactor(code, language, refactorType = 'general', target = null)
```

* 代码重构

---

## static async explain(code, language)

```javascript
static async explain(code, language)
```

* 代码解释

---

## static async fixBug(code, language, bugDescription = null)

```javascript
static async fixBug(code, language, bugDescription = null)
```

* 修复Bug

---

## static async generateTests(code, language)

```javascript
static async generateTests(code, language)
```

* 生成单元测试

---

## static async optimize(code, language)

```javascript
static async optimize(code, language)
```

* 性能优化

---

