# notificationManager

**Source**: `src\renderer\utils\notificationManager.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## import

```javascript
import
```

* 通知系统
 * 提供统一的通知管理，支持多种通知类型和持久化

---

## export const NotificationType =

```javascript
export const NotificationType =
```

* 通知类型

---

## export const NotificationPriority =

```javascript
export const NotificationPriority =
```

* 通知优先级

---

## class Notification

```javascript
class Notification
```

* 通知类

---

## class NotificationManager

```javascript
class NotificationManager
```

* 通知管理器

---

## show(options)

```javascript
show(options)
```

* 显示通知

---

## showSystemNotification(notif)

```javascript
showSystemNotification(notif)
```

* 显示系统通知

---

## info(title, message, options =

```javascript
info(title, message, options =
```

* 显示信息通知

---

## success(title, message, options =

```javascript
success(title, message, options =
```

* 显示成功通知

---

## warning(title, message, options =

```javascript
warning(title, message, options =
```

* 显示警告通知

---

## error(title, message, options =

```javascript
error(title, message, options =
```

* 显示错误通知

---

## markAsRead(id)

```javascript
markAsRead(id)
```

* 标记为已读

---

## markAllAsRead()

```javascript
markAllAsRead()
```

* 标记所有为已读

---

## remove(id)

```javascript
remove(id)
```

* 删除通知

---

## clear()

```javascript
clear()
```

* 清空所有通知

---

## clearRead()

```javascript
clearRead()
```

* 清空已读通知

---

## getUnreadCount()

```javascript
getUnreadCount()
```

* 获取未读通知数量

---

## getNotifications(filter =

```javascript
getNotifications(filter =
```

* 获取通知列表

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

## export function useNotifications()

```javascript
export function useNotifications()
```

* 组合式函数：使用通知

---

