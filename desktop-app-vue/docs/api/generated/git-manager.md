# git-manager

**Source**: `src/main/git/git-manager.js`

**Generated**: 2026-02-22T01:23:36.729Z

---

## const git = require('isomorphic-git');

```javascript
const git = require('isomorphic-git');
```

* Git 同步管理器
 *
 * 使用 isomorphic-git 实现Git功能

---

## class GitManager extends EventEmitter

```javascript
class GitManager extends EventEmitter
```

* Git管理器类
 *
 * 功能：
 * - 初始化仓库
 * - 克隆远程仓库
 * - 提交更改
 * - 推送到远程
 * - 拉取远程更新
 * - 状态查询

---

## getDefaultRepoPath()

```javascript
getDefaultRepoPath()
```

* 获取默认仓库路径

---

## async initialize()

```javascript
async initialize()
```

* 初始化Git管理器

---

## async isGitRepository()

```javascript
async isGitRepository()
```

* 检查是否是Git仓库

---

## async getStatus()

```javascript
async getStatus()
```

* 获取仓库状态

---

## async getLastCommitDate()

```javascript
async getLastCommitDate()
```

* 获取最后提交时间

---

## async calculateAheadBehind(branch)

```javascript
async calculateAheadBehind(branch)
```

* 计算本地分支与远程分支的ahead/behind commits
   * @param {string} branch - 本地分支名
   * @returns {Promise<{ahead: number, behind: number}>}

---

## async add(filepaths)

```javascript
async add(filepaths)
```

* 添加文件到暂存区
   * @param {string|string[]} filepaths - 文件路径

---

## async commit(message)

```javascript
async commit(message)
```

* 提交更改
   * @param {string} message - 提交消息

---

## async push()

```javascript
async push()
```

* 推送到远程仓库

---

## async pull()

```javascript
async pull()
```

* 从远程仓库拉取

---

## async getConflictFiles()

```javascript
async getConflictFiles()
```

* 获取冲突文件列表

---

## async readFile(filepath)

```javascript
async readFile(filepath)
```

* 读取文件内容

---

## async getConflictContent(filepath)

```javascript
async getConflictContent(filepath)
```

* 获取冲突文件的内容（解析冲突标记）

---

## parseConflictMarkers(content)

```javascript
parseConflictMarkers(content)
```

* 解析冲突标记
   * 格式:
   * <<<<<<< HEAD (ours)
   * our content
   * =======
   * their content
   * >>>>>>> branch-name (theirs)

---

## async resolveConflict(filepath, resolution, content = null)

```javascript
async resolveConflict(filepath, resolution, content = null)
```

* 解决冲突 - 选择一方
   * @param {string} filepath - 文件路径
   * @param {string} resolution - 'ours' | 'theirs' | 'manual'
   * @param {string} content - 如果是 manual，提供解决后的内容

---

## async abortMerge()

```javascript
async abortMerge()
```

* 中止合并

---

## async completeMerge(message = 'Merge completed')

```javascript
async completeMerge(message = 'Merge completed')
```

* 完成合并（所有冲突解决后）

---

## async clone(url, targetPath = null)

```javascript
async clone(url, targetPath = null)
```

* 克隆远程仓库
   * @param {string} url - 远程仓库URL
   * @param {string} targetPath - 目标路径

---

## async setRemote(url, name = 'origin')

```javascript
async setRemote(url, name = 'origin')
```

* 配置远程仓库
   * @param {string} url - 远程仓库URL
   * @param {string} name - 远程仓库名称

---

## setAuth(auth)

```javascript
setAuth(auth)
```

* 设置认证信息
   * @param {Object} auth - 认证信息

---

## setAuthor(name, email)

```javascript
setAuthor(name, email)
```

* 设置作者信息
   * @param {string} name - 作者名称
   * @param {string} email - 作者邮箱

---

## async getLog(depth = 10)

```javascript
async getLog(depth = 10)
```

* 获取提交历史
   * @param {number} depth - 深度

---

## async hasUncommittedChanges()

```javascript
async hasUncommittedChanges()
```

* 检查是否有未提交的更改

---

## async autoSync(message = 'Auto sync')

```javascript
async autoSync(message = 'Auto sync')
```

* 自动同步
   * - 添加所有更改
   * - 提交
   * - 推送

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

