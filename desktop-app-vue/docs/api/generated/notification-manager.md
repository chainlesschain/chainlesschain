# notification-manager

**Source**: `src/main/api/notification-manager.js`

**Generated**: 2026-02-15T10:10:53.448Z

---

## const

```javascript
const
```

* API Notification Manager
 * RSS 和 Email 通知管理器
 *
 * v0.20.0: 新增 RSS 和邮件通知功能

---

## setMainWindow(window)

```javascript
setMainWindow(window)
```

* 设置主窗口引用
   * @param {BrowserWindow} window - Electron 主窗口

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用通知

---

## notifyNewArticles(feedTitle, count, items = [])

```javascript
notifyNewArticles(feedTitle, count, items = [])
```

* RSS 新文章通知

---

## notifyNewEmails(accountEmail, count, emails = [])

```javascript
notifyNewEmails(accountEmail, count, emails = [])
```

* 新邮件通知

---

## notifyRSSError(feedTitle, error)

```javascript
notifyRSSError(feedTitle, error)
```

* RSS 同步错误通知

---

## notifyEmailError(accountEmail, error)

```javascript
notifyEmailError(accountEmail, error)
```

* 邮件同步错误通知

---

## notifyEmailSent(to, subject)

```javascript
notifyEmailSent(to, subject)
```

* 邮件发送成功通知

---

## notifyBatch(notifications)

```javascript
notifyBatch(notifications)
```

* 批量通知（避免通知轰炸）

---

## groupNotifications(notifications)

```javascript
groupNotifications(notifications)
```

* 分组通知

---

## getIconPath(type)

```javascript
getIconPath(type)
```

* 获取图标路径

---

## logNotification(type, action, data)

```javascript
logNotification(type, action, data)
```

* 记录通知日志

---

## openRSSReader(feedTitle, items = [])

```javascript
openRSSReader(feedTitle, items = [])
```

* 打开 RSS 阅读器
   * @param {string} feedTitle - Feed 标题
   * @param {Array} items - 新文章列表

---

## openEmailReader(accountEmail, emails = [])

```javascript
openEmailReader(accountEmail, emails = [])
```

* 打开邮件阅读器
   * @param {string} accountEmail - 邮箱账户
   * @param {Array} emails - 新邮件列表

---

## navigateTo(route, params =

```javascript
navigateTo(route, params =
```

* 打开特定路由
   * @param {string} route - 路由路径
   * @param {Object} params - 路由参数

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

