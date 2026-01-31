# notification-manager

**Source**: `src\main\api\notification-manager.js`

**Generated**: 2026-01-27T06:44:03.874Z

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

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

