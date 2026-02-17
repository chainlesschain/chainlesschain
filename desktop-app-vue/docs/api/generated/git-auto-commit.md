# git-auto-commit

**Source**: `src/main/git/git-auto-commit.js`

**Generated**: 2026-02-17T10:13:18.244Z

---

## const git = require('isomorphic-git');

```javascript
const git = require('isomorphic-git');
```

* Git自动提交模块
 * 自动检测文件更改并定期提交

---

## start(projectId, repoPath)

```javascript
start(projectId, repoPath)
```

* 启动自动提交
   * @param {string} projectId - 项目ID
   * @param {string} repoPath - 仓库路径

---

## stop(projectId)

```javascript
stop(projectId)
```

* 停止自动提交
   * @param {string} projectId - 项目ID

---

## stopAll()

```javascript
stopAll()
```

* 停止所有自动提交

---

## async checkAndCommit(projectId, repoPath)

```javascript
async checkAndCommit(projectId, repoPath)
```

* 检查并提交更改
   * @param {string} projectId - 项目ID
   * @param {string} repoPath - 仓库路径
   * @private

---

## async isGitRepository(repoPath)

```javascript
async isGitRepository(repoPath)
```

* 检查是否是Git仓库
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<boolean>}
   * @private

---

## async getStatus(repoPath)

```javascript
async getStatus(repoPath)
```

* 获取Git状态
   * @param {string} repoPath - 仓库路径
   * @returns {Promise<Object>} 状态对象
   * @private

---

## async addAll(repoPath)

```javascript
async addAll(repoPath)
```

* 添加所有更改
   * @param {string} repoPath - 仓库路径
   * @private

---

## async commit(repoPath, message)

```javascript
async commit(repoPath, message)
```

* 提交更改
   * @param {string} repoPath - 仓库路径
   * @param {string} message - 提交消息
   * @private

---

## generateCommitMessage(status)

```javascript
generateCommitMessage(status)
```

* 生成提交消息
   * @param {Object} status - Git状态
   * @returns {string} 提交消息
   * @private

---

## setInterval(interval)

```javascript
setInterval(interval)
```

* 设置提交间隔
   * @param {number} interval - 间隔时间（毫秒）

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用自动提交
   * @param {boolean} enabled - 是否启用

---

## setAuthor(author)

```javascript
setAuthor(author)
```

* 设置提交作者信息
   * @param {Object} author - 作者信息

---

## getWatchedProjects()

```javascript
getWatchedProjects()
```

* 获取监视的项目列表
   * @returns {Array} 项目列表

---

