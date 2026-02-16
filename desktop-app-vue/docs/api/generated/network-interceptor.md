# network-interceptor

**Source**: `src/main/api/network-interceptor.js`

**Generated**: 2026-02-16T22:06:51.513Z

---

## const

```javascript
const
```

* 网络请求拦截器
 * 拦截和管理应用的网络请求

---

## init()

```javascript
init()
```

* 初始化拦截器

---

## handleBeforeRequest(details, callback)

```javascript
handleBeforeRequest(details, callback)
```

* 处理请求前

---

## handleHeadersReceived(details, callback)

```javascript
handleHeadersReceived(details, callback)
```

* 处理响应头

---

## handleCompleted(details)

```javascript
handleCompleted(details)
```

* 处理请求完成

---

## handleError(details)

```javascript
handleError(details)
```

* 处理请求错误

---

## matchRule(rule, details)

```javascript
matchRule(rule, details)
```

* 匹配规则

---

## addRule(rule)

```javascript
addRule(rule)
```

* 添加拦截规则

---

## removeRule(ruleId)

```javascript
removeRule(ruleId)
```

* 移除拦截规则

---

## clearRules()

```javascript
clearRules()
```

* 清空所有规则

---

## getRules()

```javascript
getRules()
```

* 获取所有规则

---

## logRequest(request)

```javascript
logRequest(request)
```

* 记录请求

---

## updateRequestLog(id, updates)

```javascript
updateRequestLog(id, updates)
```

* 更新请求日志

---

## getRequestLog(filter =

```javascript
getRequestLog(filter =
```

* 获取请求日志

---

## clearRequestLog()

```javascript
clearRequestLog()
```

* 清空请求日志

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## setCache(enabled)

```javascript
setCache(enabled)
```

* 设置缓存

---

## async clearCache()

```javascript
async clearCache()
```

* 清除缓存

---

## setUserAgent(userAgent)

```javascript
setUserAgent(userAgent)
```

* 设置用户代理

---

