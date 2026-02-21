# webide-manager

**Source**: `src/main/webide/webide-manager.js`

**Generated**: 2026-02-21T22:45:05.237Z

---

## const

```javascript
const
```

* Web IDE 管理器
 * 负责项目保存、加载、导出等核心功能

---

## async initDirectories()

```javascript
async initDirectories()
```

* 初始化目录结构

---

## async saveProject(projectData)

```javascript
async saveProject(projectData)
```

* 保存项目
   * @param {Object} projectData - 项目数据
   * @returns {Promise<Object>} 保存结果

---

## async loadProject(projectId)

```javascript
async loadProject(projectId)
```

* 加载项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 项目数据

---

## async getProjectList()

```javascript
async getProjectList()
```

* 获取所有项目列表
   * @returns {Promise<Object>} 项目列表

---

## async deleteProject(projectId)

```javascript
async deleteProject(projectId)
```

* 删除项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 删除结果

---

## async exportHTML(exportData)

```javascript
async exportHTML(exportData)
```

* 导出项目为 HTML 文件
   * @param {Object} exportData - 导出数据
   * @returns {Promise<Object>} 导出结果

---

## async exportZIP(exportData)

```javascript
async exportZIP(exportData)
```

* 导出项目为 ZIP 压缩包
   * @param {Object} exportData - 导出数据
   * @returns {Promise<Object>} 导出结果

---

## async createZipArchive(sourceDir, outputPath)

```javascript
async createZipArchive(sourceDir, outputPath)
```

* 创建 ZIP 压缩包
   * @private

---

## generateId()

```javascript
generateId()
```

* 生成唯一 ID
   * @private

---

## async checkPathExists(filePath)

```javascript
async checkPathExists(filePath)
```

* 检查路径是否存在
   * @private

---

## getProjectsPath()

```javascript
getProjectsPath()
```

* 获取项目存储路径

---

## getTempPath()

```javascript
getTempPath()
```

* 获取临时文件路径

---

