# http-client

**Source**: `src/main/project/http-client.js`

**Generated**: 2026-02-22T01:23:36.692Z

---

## class ProjectHTTPClient

```javascript
class ProjectHTTPClient
```

* 项目服务HTTP客户端
 * 用于与后端project-service (Spring Boot) 通信

---

## async createProject(createData)

```javascript
async createProject(createData)
```

* 创建项目（支持AI生成）
   * @param {Object} createData - 创建数据
   * @param {string} createData.userPrompt - 用户需求描述（必填）
   * @param {string} createData.projectType - 项目类型 (web/document/data/write)
   * @param {string} createData.templateId - 模板ID（可选）
   * @param {string} createData.name - 项目名称（可选）
   * @param {string} createData.userId - 用户ID
   * @returns {Promise<Object>} 项目数据

---

## async createProjectStream(

```javascript
async createProjectStream(
```

* 流式创建项目（SSE）
   * @param {Object} createData - 创建数据
   * @param {Object} callbacks - 回调函数
   * @param {Function} callbacks.onProgress - 进度回调 (data) => void
   * @param {Function} callbacks.onContent - 内容回调 (data) => void
   * @param {Function} callbacks.onComplete - 完成回调 (data) => void
   * @param {Function} callbacks.onError - 错误回调 (error) => void
   * @returns {Promise<Object>} 返回控制对象 { cancel: Function }

---

## async listProjects(userId, pageNum = 1, pageSize = 100)

```javascript
async listProjects(userId, pageNum = 1, pageSize = 100)
```

* 获取项目列表（分页）
   * @param {string} userId - 用户ID
   * @param {number} pageNum - 页码（从1开始）
   * @param {number} pageSize - 每页数量
   * @returns {Promise<Object>} 分页数据 { records: [], total: 0, ... }

---

## async getProject(projectId)

```javascript
async getProject(projectId)
```

* 获取项目详情
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 项目详情

---

## async updateProject(projectId, updates)

```javascript
async updateProject(projectId, updates)
```

* 更新项目
   * @param {string} projectId - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的项目

---

## async deleteProject(projectId)

```javascript
async deleteProject(projectId)
```

* 删除项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<void>}

---

## async executeTask(taskData)

```javascript
async executeTask(taskData)
```

* 执行项目任务（AI辅助）
   * @param {Object} taskData - 任务数据
   * @param {string} taskData.projectId - 项目ID
   * @param {string} taskData.userPrompt - 用户指令
   * @param {Array} taskData.context - 上下文（可选）
   * @returns {Promise<Object>} 任务执行结果

---

## async healthCheck()

```javascript
async healthCheck()
```

* 健康检查
   * @returns {Promise<Object>} 服务状态

---

## async syncProject(project)

```javascript
async syncProject(project)
```

* 同步项目到后端
   * @param {Object} project - 项目数据
   * @returns {Promise<Object>} 同步结果

---

## async syncProjects(projects)

```javascript
async syncProjects(projects)
```

* 批量同步项目
   * @param {Array} projects - 项目列表
   * @returns {Promise<Object>} 同步结果

---

## setAuthToken(token)

```javascript
setAuthToken(token)
```

* 设置授权Token
   * @param {string} token - JWT token

---

## setBaseURL(newBaseURL)

```javascript
setBaseURL(newBaseURL)
```

* 更新baseURL
   * @param {string} newBaseURL - 新的base URL

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置
   * @returns {Object} 客户端配置

---

## function getProjectHTTPClient(baseURL = null)

```javascript
function getProjectHTTPClient(baseURL = null)
```

* 获取HTTP客户端实例（单例模式）
 * @param {string} baseURL - 可选的base URL
 * @returns {ProjectHTTPClient}

---

