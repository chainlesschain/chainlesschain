# design-manager

**Source**: `src/main/design/design-manager.js`

**Generated**: 2026-02-17T10:13:18.249Z

---

## const

```javascript
const
```

* 设计项目管理器
 * 负责管理设计项目、画板和设计元素的 CRUD 操作

---

## async createDesignProject(projectData)

```javascript
async createDesignProject(projectData)
```

* 创建设计项目
   * @param {Object} projectData - 项目数据
   * @returns {Promise<Object>} 创建的项目

---

## async getDesignProject(projectId)

```javascript
async getDesignProject(projectId)
```

* 获取设计项目
   * @param {string} projectId - 项目 ID
   * @returns {Promise<Object>} 项目信息

---

## async updateDesignProject(projectId, updates)

```javascript
async updateDesignProject(projectId, updates)
```

* 更新设计项目
   * @param {string} projectId - 项目 ID
   * @param {Object} updates - 更新数据

---

## async deleteDesignProject(projectId)

```javascript
async deleteDesignProject(projectId)
```

* 删除设计项目
   * @param {string} projectId - 项目 ID

---

## async createArtboard(artboardData)

```javascript
async createArtboard(artboardData)
```

* 创建画板
   * @param {Object} artboardData - 画板数据
   * @returns {Promise<string>} 画板 ID

---

## async getProjectArtboards(projectId)

```javascript
async getProjectArtboards(projectId)
```

* 获取项目的所有画板
   * @param {string} projectId - 项目 ID
   * @returns {Promise<Array>} 画板列表

---

## async getArtboard(artboardId)

```javascript
async getArtboard(artboardId)
```

* 获取画板详情（包含所有对象）
   * @param {string} artboardId - 画板 ID
   * @returns {Promise<Object>} 画板信息和对象列表

---

## async updateArtboard(artboardId, updates)

```javascript
async updateArtboard(artboardId, updates)
```

* 更新画板
   * @param {string} artboardId - 画板 ID
   * @param {Object} updates - 更新数据

---

## async deleteArtboard(artboardId)

```javascript
async deleteArtboard(artboardId)
```

* 删除画板
   * @param {string} artboardId - 画板 ID

---

## async addObject(objectData)

```javascript
async addObject(objectData)
```

* 添加设计对象
   * @param {Object} objectData - 对象数据
   * @returns {Promise<string>} 对象 ID

---

## async getArtboardObjects(artboardId)

```javascript
async getArtboardObjects(artboardId)
```

* 获取画板的所有对象
   * @param {string} artboardId - 画板 ID
   * @returns {Promise<Array>} 对象列表

---

## async updateObject(objectId, updates)

```javascript
async updateObject(objectId, updates)
```

* 更新对象
   * @param {string} objectId - 对象 ID
   * @param {Object} updates - 更新数据

---

## async deleteObject(objectId)

```javascript
async deleteObject(objectId)
```

* 删除对象
   * @param {string} objectId - 对象 ID

---

## async reorderObjects(objectIds)

```javascript
async reorderObjects(objectIds)
```

* 批量更新对象顺序
   * @param {Array} objectIds - 对象 ID 列表（按新顺序）

---

## async saveArtboard(artboardId, objects)

```javascript
async saveArtboard(artboardId, objects)
```

* 保存画板（批量更新所有对象）
   * @param {string} artboardId - 画板 ID
   * @param {Array} objects - 对象列表（包含完整的 fabric_json）

---

