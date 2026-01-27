# app

**Source**: `src\renderer\stores\app.js`

**Generated**: 2026-01-27T06:44:03.893Z

---

## addFavoriteMenu(menu)

```javascript
addFavoriteMenu(menu)
```

* 添加收藏菜单

---

## removeFavoriteMenu(key)

```javascript
removeFavoriteMenu(key)
```

* 移除收藏菜单

---

## isFavoriteMenu(key)

```javascript
isFavoriteMenu(key)
```

* 检查菜单是否已收藏

---

## toggleFavoriteMenu(menu)

```javascript
toggleFavoriteMenu(menu)
```

* 切换收藏状态

---

## addRecentMenu(menu)

```javascript
addRecentMenu(menu)
```

* 添加到最近访问

---

## clearRecentMenus()

```javascript
clearRecentMenus()
```

* 清空最近访问

---

## pinMenu(menu)

```javascript
pinMenu(menu)
```

* 置顶菜单

---

## unpinMenu(key)

```javascript
unpinMenu(key)
```

* 取消置顶

---

## isPinnedMenu(key)

```javascript
isPinnedMenu(key)
```

* 检查菜单是否已置顶

---

## async saveFavoritesToStorage()

```javascript
async saveFavoritesToStorage()
```

* 保存收藏到存储（优先使用 PreferenceManager，降级到 localStorage）

---

## async saveRecentsToStorage()

```javascript
async saveRecentsToStorage()
```

* 保存最近访问到存储

---

## async savePinnedToStorage()

```javascript
async savePinnedToStorage()
```

* 保存置顶到存储

---

## async loadFavoritesFromStorage()

```javascript
async loadFavoritesFromStorage()
```

* 从存储加载收藏

---

## async loadRecentsFromStorage()

```javascript
async loadRecentsFromStorage()
```

* 从存储加载最近访问

---

## async loadPinnedFromStorage()

```javascript
async loadPinnedFromStorage()
```

* 从存储加载置顶

---

## async initMenuData()

```javascript
async initMenuData()
```

* 初始化菜单数据（异步）

---

## async migrateFromLocalStorage()

```javascript
async migrateFromLocalStorage()
```

* 迁移 localStorage 数据到 PreferenceManager
     * 仅运行一次，迁移完成后删除旧数据

---

