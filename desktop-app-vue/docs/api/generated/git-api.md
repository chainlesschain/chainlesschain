# git-api

**Source**: `src/main/project/git-api.js`

**Generated**: 2026-02-21T22:04:25.799Z

---

## class GitAPI

```javascript
class GitAPI
```

* Git API 封装
 * 提供项目 Git 操作的后端API调用
 *
 * @module git-api
 * @description Git API 封装，用于调用后端 project-service 的 Git 接口
 *              如果后端不可用，会自动降级到本地 isomorphic-git

---

## class GitAPI

```javascript
class GitAPI
```

* Git API 类
 * 封装对后端 project-service Git 接口的调用

---

## async _call(endpoint, data =

```javascript
async _call(endpoint, data =
```

* 调用后端API
   * @param {string} endpoint - API 端点
   * @param {Object} data - 请求数据
   * @returns {Promise<Object>} API 响应
   * @private

---

## async init(repoPath, remoteUrl = null)

```javascript
async init(repoPath, remoteUrl = null)
```

* 初始化 Git 仓库
   * @param {string} repoPath - 仓库路径
   * @param {string} remoteUrl - 远程仓库URL（可选）
   * @returns {Promise<Object>} 操作结果

---

## async status(repoPath)

```javascript
async status(repoPath)
```

* 获取 Git 状态
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 状态信息

---

## async commit(repoPath, message, author, autoGenerate = false)

```javascript
async commit(repoPath, message, author, autoGenerate = false)
```

* 提交更改
   * @param {string} repoPath - 仓库路径
   * @param {string} message - 提交消息
   * @param {Object} author - 作者信息
   * @param {boolean} autoGenerate - 是否自动生成提交消息
   * @returns {Promise<Object>} 提交结果

---

## async push(repoPath, remote = "origin", branch = "main")

```javascript
async push(repoPath, remote = "origin", branch = "main")
```

* 推送到远程仓库
   * @param {string} repoPath - 仓库路径
   * @param {string} remote - 远程仓库名称
   * @param {string} branch - 分支名称
   * @returns {Promise<Object>} 推送结果

---

## async pull(repoPath, remote = "origin", branch = "main")

```javascript
async pull(repoPath, remote = "origin", branch = "main")
```

* 从远程仓库拉取
   * @param {string} repoPath - 仓库路径
   * @param {string} remote - 远程仓库名称
   * @param {string} branch - 分支名称
   * @returns {Promise<Object>} 拉取结果

---

## async log(repoPath, limit = 10)

```javascript
async log(repoPath, limit = 10)
```

* 获取提交日志
   * @param {string} repoPath - 仓库路径
   * @param {number} limit - 日志条数限制
   * @returns {Promise<Object>} 提交日志

---

## async diff(repoPath, ref1, ref2)

```javascript
async diff(repoPath, ref1, ref2)
```

* 获取文件差异
   * @param {string} repoPath - 仓库路径
   * @param {string} ref1 - 第一个引用
   * @param {string} ref2 - 第二个引用
   * @returns {Promise<Object>} 差异信息

---

## async branches(repoPath)

```javascript
async branches(repoPath)
```

* 获取分支列表
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 分支列表

---

## async createBranch(repoPath, branchName, fromBranch = null)

```javascript
async createBranch(repoPath, branchName, fromBranch = null)
```

* 创建分支
   * @param {string} repoPath - 仓库路径
   * @param {string} branchName - 新分支名称
   * @param {string} fromBranch - 基于的分支
   * @returns {Promise<Object>} 创建结果

---

## async checkoutBranch(repoPath, branchName)

```javascript
async checkoutBranch(repoPath, branchName)
```

* 切换分支
   * @param {string} repoPath - 仓库路径
   * @param {string} branchName - 目标分支名称
   * @returns {Promise<Object>} 切换结果

---

## async merge(repoPath, sourceBranch, targetBranch)

```javascript
async merge(repoPath, sourceBranch, targetBranch)
```

* 合并分支
   * @param {string} repoPath - 仓库路径
   * @param {string} sourceBranch - 源分支
   * @param {string} targetBranch - 目标分支
   * @returns {Promise<Object>} 合并结果

---

## async resolveConflicts(repoPath, filePath, useOurs, strategy)

```javascript
async resolveConflicts(repoPath, filePath, useOurs, strategy)
```

* 解决冲突
   * @param {string} repoPath - 仓库路径
   * @param {string} filePath - 文件路径
   * @param {boolean} useOurs - 是否使用本地版本
   * @param {string} strategy - 解决策略
   * @returns {Promise<Object>} 解决结果

---

## async generateCommitMessage(repoPath)

```javascript
async generateCommitMessage(repoPath)
```

* 生成提交消息
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 生成的提交消息

---

