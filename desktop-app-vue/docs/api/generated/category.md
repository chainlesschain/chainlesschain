# category

**Source**: `src\renderer\stores\category.js`

**Generated**: 2026-01-27T06:44:03.893Z

---

## export const useCategoryStore = defineStore("category",

```javascript
export const useCategoryStore = defineStore("category",
```

* 项目分类管理Store
 * 管理项目分类的CRUD操作和状态

---

## rootCategories: (state) =>

```javascript
rootCategories: (state) =>
```

* 获取一级分类

---

## getCategoryById: (state) => (categoryId) =>

```javascript
getCategoryById: (state) => (categoryId) =>
```

* 根据ID获取分类

---

## getChildCategories: (state) => (parentId) =>

```javascript
getChildCategories: (state) => (parentId) =>
```

* 获取指定分类的子分类

---

## getCategoryPath: (state) => (categoryId) =>

```javascript
getCategoryPath: (state) => (categoryId) =>
```

* 获取分类的完整路径（面包屑）

---

## primaryCategoriesOptions: (state) =>

```javascript
primaryCategoriesOptions: (state) =>
```

* 获取所有一级分类（用于选择器）

---

## async initializeDefaults(userId = "local-user")

```javascript
async initializeDefaults(userId = "local-user")
```

* 初始化默认分类

---

## async fetchCategories(userId = "local-user")

```javascript
async fetchCategories(userId = "local-user")
```

* 获取所有分类（树形结构）

---

## async fetchCategory(categoryId)

```javascript
async fetchCategory(categoryId)
```

* 获取单个分类

---

## async createCategory(categoryData)

```javascript
async createCategory(categoryData)
```

* 创建分类

---

## async updateCategory(categoryId, updates)

```javascript
async updateCategory(categoryId, updates)
```

* 更新分类

---

## async deleteCategory(categoryId)

```javascript
async deleteCategory(categoryId)
```

* 删除分类

---

## async updateCategorySort(sortData)

```javascript
async updateCategorySort(sortData)
```

* 批量更新分类排序

---

## setSelectedCategory(category)

```javascript
setSelectedCategory(category)
```

* 设置选中的分类

---

## showEditDialog(category = null)

```javascript
showEditDialog(category = null)
```

* 显示分类编辑对话框

---

## hideEditDialog()

```javascript
hideEditDialog()
```

* 隐藏分类编辑对话框

---

## _flattenCategories(categories, result = [])

```javascript
_flattenCategories(categories, result = [])
```

* 辅助方法：将树形结构扁平化

---

## reset()

```javascript
reset()
```

* 重置状态

---

