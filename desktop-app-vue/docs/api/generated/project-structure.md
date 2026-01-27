# project-structure

**Source**: `src\main\project\project-structure.js`

**Generated**: 2026-01-27T06:44:03.826Z

---

## const

```javascript
const
```

* 项目文件夹结构管理器
 * 定义和创建不同类型项目的标准目录结构

---

## async createStructure(

```javascript
async createStructure(
```

* 创建项目结构
   * @param {string} projectPath - 项目根路径
   * @param {string} projectType - 项目类型
   * @param {string} projectName - 项目名称
   * @returns {Promise<Object>} 创建结果

---

## getStructure(projectType)

```javascript
getStructure(projectType)
```

* 获取项目结构定义
   * @param {string} projectType - 项目类型
   * @returns {Object} 结构定义

---

## getProjectTypes()

```javascript
getProjectTypes()
```

* 获取所有项目类型
   * @returns {Array} 项目类型列表

---

## async validateStructure(projectPath, projectType)

```javascript
async validateStructure(projectPath, projectType)
```

* 验证项目结构
   * @param {string} projectPath - 项目路径
   * @param {string} projectType - 项目类型
   * @returns {Promise<Object>} 验证结果

---

## addProjectType(type, structure)

```javascript
addProjectType(type, structure)
```

* 添加自定义项目类型
   * @param {string} type - 类型标识
   * @param {Object} structure - 结构定义

---

