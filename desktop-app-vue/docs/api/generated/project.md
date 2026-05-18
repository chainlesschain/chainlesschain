# project

**Source**: `src\renderer\stores\project.js`

**Generated**: 2026-01-27T06:44:03.890Z

---

## export const useProjectStore = defineStore("project",

```javascript
export const useProjectStore = defineStore("project",
```

* 项目管理Store
 * 管理项目列表、文件、模板、同步状态等

---

## filteredProjects: (state) =>

```javascript
filteredProjects: (state) =>
```

* 过滤和排序后的项目列表

---

## paginatedProjects: (state) =>

```javascript
paginatedProjects: (state) =>
```

* 分页后的项目

---

## projectStats: (state) =>

```javascript
projectStats: (state) =>
```

* 项目统计

---

## fileTree: (state) =>

```javascript
fileTree: (state) =>
```

* 文件树结构

---

## async fetchProjects(userId, forceSync = false)

```javascript
async fetchProjects(userId, forceSync = false)
```

* 获取项目列表
     * @param {string} userId - 用户ID
     * @param {boolean} forceSync - 是否强制同步

---

## async createProject(createData)

```javascript
async createProject(createData)
```

* 创建项目
     * @param {Object} createData - 创建数据

---

## async createProjectStream(createData, onProgress)

```javascript
async createProjectStream(createData, onProgress)
```

* 流式创建项目
     * @param {Object} createData - 创建数据（可能包含回调函数）
     * @param {Function} onProgress - 进度回调（可选，如果createData中有回调则使用createData中的）
     * @returns {Promise<Object>} 创建结果

---

## async cancelProjectStream()

```javascript
async cancelProjectStream()
```

* 取消流式创建

---

## async getProject(projectId)

```javascript
async getProject(projectId)
```

* 获取项目详情
     * @param {string} projectId - 项目ID

---

## async fetchProjectById(projectId)

```javascript
async fetchProjectById(projectId)
```

* 通过ID获取项目（别名）
     * @param {string} projectId - 项目ID

---

## async updateProject(projectId, updates)

```javascript
async updateProject(projectId, updates)
```

* 更新项目
     * @param {string} projectId - 项目ID
     * @param {Object} updates - 更新数据

---

## async deleteProject(projectId)

```javascript
async deleteProject(projectId)
```

* 删除项目
     * @param {string} projectId - 项目ID

---

## async loadProjectFiles(projectId)

```javascript
async loadProjectFiles(projectId)
```

* 加载项目文件
     * @param {string} projectId - 项目ID

---

## async saveProjectFiles(projectId, files)

```javascript
async saveProjectFiles(projectId, files)
```

* 保存项目文件
     * @param {string} projectId - 项目ID
     * @param {Array} files - 文件列表

---

## async updateFile(fileId, content)

```javascript
async updateFile(fileId, content)
```

* 更新文件
     * @param {string} fileId - 文件ID
     * @param {string} content - 文件内容

---

## setCurrentFile(file)

```javascript
setCurrentFile(file)
```

* 设置当前文件
     * @param {Object} file - 文件对象

---

## toggleFolderExpanded(folderPath)

```javascript
toggleFolderExpanded(folderPath)
```

* 切换文件夹展开状态
     * @param {string} folderPath - 文件夹路径

---

## async syncProjects(userId)

```javascript
async syncProjects(userId)
```

* 同步项目
     * @param {string} userId - 用户ID

---

## async syncProjectToBackend(projectId)

```javascript
async syncProjectToBackend(projectId)
```

* 同步单个项目到后端
     * @param {string} projectId - 项目ID

---

## shouldSync()

```javascript
shouldSync()
```

* 判断是否需要同步
     * @returns {boolean}

---

## setFilter(key, value)

```javascript
setFilter(key, value)
```

* 设置筛选条件
     * @param {string} key - 筛选键
     * @param {*} value - 筛选值

---

## resetFilters()

```javascript
resetFilters()
```

* 重置筛选条件

---

## setSort(sortBy, sortOrder)

```javascript
setSort(sortBy, sortOrder)
```

* 设置排序
     * @param {string} sortBy - 排序字段
     * @param {string} sortOrder - 排序顺序

---

## setViewMode(mode)

```javascript
setViewMode(mode)
```

* 设置视图模式
     * @param {string} mode - 视图模式

---

## setPagination(current, pageSize)

```javascript
setPagination(current, pageSize)
```

* 设置分页
     * @param {number} current - 当前页
     * @param {number} pageSize - 每页数量

---

## async initGit(projectId, remoteUrl = null)

```javascript
async initGit(projectId, remoteUrl = null)
```

* 初始化Git仓库
     * @param {string} projectId - 项目ID
     * @param {string} remoteUrl - 远程仓库URL（可选）

---

## async gitCommit(projectId, message, autoGenerate = false)

```javascript
async gitCommit(projectId, message, autoGenerate = false)
```

* Git提交
     * @param {string} projectId - 项目ID
     * @param {string} message - 提交消息
     * @param {boolean} autoGenerate - 是否自动生成提交消息

---

## async gitPush(projectId, remote = "origin", branch = null)

```javascript
async gitPush(projectId, remote = "origin", branch = null)
```

* Git推送
     * @param {string} projectId - 项目ID
     * @param {string} remote - 远程仓库名（默认origin）
     * @param {string} branch - 分支名（默认当前分支）

---

## async gitPull(projectId, remote = "origin", branch = null)

```javascript
async gitPull(projectId, remote = "origin", branch = null)
```

* Git拉取
     * @param {string} projectId - 项目ID
     * @param {string} remote - 远程仓库名（默认origin）
     * @param {string} branch - 分支名（默认当前分支）

---

## async gitStatus(projectId)

```javascript
async gitStatus(projectId)
```

* 获取Git状态
     * @param {string} projectId - 项目ID

---

## clearCurrentProject()

```javascript
clearCurrentProject()
```

* 清空当前项目

---

## restoreViewMode()

```javascript
restoreViewMode()
```

* 从localStorage恢复视图模式

---

