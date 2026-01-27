# offlineManager

**Source**: `src\renderer\utils\offlineManager.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## import

```javascript
import
```

* 离线模式管理器
 * 检测网络状态并提供离线功能支持

---

## class OfflineManager

```javascript
class OfflineManager
```

* 离线模式管理器

---

## init()

```javascript
init()
```

* 初始化

---

## handleOnline()

```javascript
handleOnline()
```

* 处理上线

---

## handleOffline()

```javascript
handleOffline()
```

* 处理离线

---

## async checkConnection()

```javascript
async checkConnection()
```

* 检查连接

---

## addToQueue(action)

```javascript
addToQueue(action)
```

* 添加到离线队列

---

## async processQueue()

```javascript
async processQueue()
```

* 处理队列

---

## clearQueue()

```javascript
clearQueue()
```

* 清空队列

---

## saveQueue()

```javascript
saveQueue()
```

* 保存队列到本地存储

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

## notifyListeners(event)

```javascript
notifyListeners(event)
```

* 通知监听器

---

## destroy()

```javascript
destroy()
```

* 销毁

---

## export function useOffline()

```javascript
export function useOffline()
```

* 组合式函数：使用离线模式

---

