# categoryMap

**Source**: `src\renderer\utils\categoryMap.js`

**Generated**: 2026-01-27T06:44:03.902Z

---

## export const categoryMap =

```javascript
export const categoryMap =
```

* 分类名称中英文映射
 * 用于将数据库中的英文category转换为中文显示

---

## export function getCategoryName(category)

```javascript
export function getCategoryName(category)
```

* 获取分类的中文名称
 * @param {string} category - 英文分类名
 * @returns {string} 中文分类名

---

## export function getAllCategories()

```javascript
export function getAllCategories()
```

* 获取所有分类的映射对象
 * @returns {Object} 分类映射对象

---

## export function isProfessionalCategory(category)

```javascript
export function isProfessionalCategory(category)
```

* 检查是否为职业专用分类
 * @param {string} category - 分类名
 * @returns {boolean}

---

