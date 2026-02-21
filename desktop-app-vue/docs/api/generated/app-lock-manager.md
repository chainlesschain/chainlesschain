# app-lock-manager

**Source**: `src/main/system/app-lock-manager.js`

**Generated**: 2026-02-21T22:45:05.247Z

---

## const

```javascript
const
```

* 应用锁定管理器
 * 提供应用锁定和解锁功能，保护隐私

---

## loadConfig()

```javascript
loadConfig()
```

* 加载配置

---

## saveConfig()

```javascript
saveConfig()
```

* 保存配置

---

## setPassword(password)

```javascript
setPassword(password)
```

* 设置密码

---

## verifyPassword(password)

```javascript
verifyPassword(password)
```

* 验证密码

---

## hashPassword(password)

```javascript
hashPassword(password)
```

* 哈希密码

---

## lock()

```javascript
lock()
```

* 锁定应用

---

## unlock(password)

```javascript
unlock(password)
```

* 解锁应用

---

## isAppLocked()

```javascript
isAppLocked()
```

* 检查是否已锁定

---

## hasPassword()

```javascript
hasPassword()
```

* 检查是否设置了密码

---

## changePassword(oldPassword, newPassword)

```javascript
changePassword(oldPassword, newPassword)
```

* 更改密码

---

## removePassword(password)

```javascript
removePassword(password)
```

* 移除密码

---

## setLockTimeout(timeout)

```javascript
setLockTimeout(timeout)
```

* 设置自动锁定超时

---

## setAutoLock(enabled)

```javascript
setAutoLock(enabled)
```

* 启用/禁用自动锁定

---

## startActivityMonitor()

```javascript
startActivityMonitor()
```

* 启动活动监控

---

## stopActivityMonitor()

```javascript
stopActivityMonitor()
```

* 停止活动监控

---

## recordActivity()

```javascript
recordActivity()
```

* 记录用户活动

---

## getStatus()

```javascript
getStatus()
```

* 获取状态

---

## destroy()

```javascript
destroy()
```

* 销毁管理器

---

