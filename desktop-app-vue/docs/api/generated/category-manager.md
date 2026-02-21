# category-manager

**Source**: `src/main/organization/category-manager.js`

**Generated**: 2026-02-21T22:04:25.810Z

---

## class CategoryManager

```javascript
class CategoryManager
```

* 项目分类管理器
 * 提供项目分类的CRUD操作

---

## initializeDefaultCategories(userId = "local-user")

```javascript
initializeDefaultCategories(userId = "local-user")
```

* 初始化默认项目分类
   * @param {string} userId - 用户ID

---

## getProjectCategories(userId = "local-user")

```javascript
getProjectCategories(userId = "local-user")
```

* 获取所有项目分类（树形结构）
   * @param {string} userId - 用户ID
   * @returns {Array} 分类树

---

## getProjectCategoryById(categoryId)

```javascript
getProjectCategoryById(categoryId)
```

* 获取单个项目分类
   * @param {string} categoryId - 分类ID
   * @returns {Object|null} 分类对象

---

## createProjectCategory(categoryData)

```javascript
createProjectCategory(categoryData)
```

* 创建项目分类
   * @param {Object} categoryData - 分类数据
   * @returns {Object} 创建的分类

---

## updateProjectCategory(categoryId, updates)

```javascript
updateProjectCategory(categoryId, updates)
```

* 更新项目分类
   * @param {string} categoryId - 分类ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的分类

---

## deleteProjectCategory(categoryId)

```javascript
deleteProjectCategory(categoryId)
```

* 删除项目分类（软删除）
   * @param {string} categoryId - 分类ID
   * @returns {boolean} 是否删除成功

---

## batchUpdateCategorySort(sortData)

```javascript
batchUpdateCategorySort(sortData)
```

* 批量更新分类排序
   * @param {Array} sortData - 排序数据 [{id, sort_order}, ...]
   * @returns {boolean} 是否成功

---

