# activityManager

**Source**: `src\renderer\utils\activityManager.js`

**Generated**: 2026-01-27T06:44:03.902Z

---

## import

```javascript
import
```

* 活动管理器
 * 跟踪用户活动、最近文件、操作历史等

---

## export const ActivityType =

```javascript
export const ActivityType =
```

* 活动类型

---

## class Activity

```javascript
class Activity
```

* 活动类

---

## class ActivityManager

```javascript
class ActivityManager
```

* 活动管理器

---

## record(options)

```javascript
record(options)
```

* 记录活动

---

## isFileActivity(type)

```javascript
isFileActivity(type)
```

* 判断是否为文件相关活动

---

## updateRecentFiles(activity)

```javascript
updateRecentFiles(activity)
```

* 更新最近文件列表

---

## getActivities(filter =

```javascript
getActivities(filter =
```

* 获取活动列表

---

## getRecentFiles(limit = 10)

```javascript
getRecentFiles(limit = 10)
```

* 获取最近文件

---

## getTodayActivities()

```javascript
getTodayActivities()
```

* 获取今日活动

---

## getWeekActivities()

```javascript
getWeekActivities()
```

* 获取本周活动

---

## getStatistics(timeRange = 'today')

```javascript
getStatistics(timeRange = 'today')
```

* 获取活动统计

---

## clear()

```javascript
clear()
```

* 清空活动历史

---

## clearRecentFiles()

```javascript
clearRecentFiles()
```

* 清空最近文件

---

## removeFromRecentFiles(path)

```javascript
removeFromRecentFiles(path)
```

* 从最近文件中移除

---

## addListener(listener)

```javascript
addListener(listener)
```

* 添加监听器

---

## removeListener(listener)

```javascript
removeListener(listener)
```

* 移除监听器

---

## notifyListeners(event, data)

```javascript
notifyListeners(event, data)
```

* 通知监听器

---

## saveToStorage()

```javascript
saveToStorage()
```

* 保存到本地存储

---

## loadFromStorage()

```javascript
loadFromStorage()
```

* 从本地存储加载

---

## exportData()

```javascript
exportData()
```

* 导出活动数据

---

## importData(data)

```javascript
importData(data)
```

* 导入活动数据

---

## export function useActivities()

```javascript
export function useActivities()
```

* 组合式函数：使用活动管理器

---

