# loadingManager

**Source**: `src\renderer\utils\loadingManager.js`

**Generated**: 2026-01-27T06:44:03.898Z

---

## import

```javascript
import
```

* 加载状态管理工具
 * 提供统一的加载状态管理和用户反馈

---

## class LoadingState

```javascript
class LoadingState
```

* 加载状态类

---

## start(message = null)

```javascript
start(message = null)
```

* 开始加载

---

## updateProgress(progress)

```javascript
updateProgress(progress)
```

* 更新进度

---

## finish(data = null)

```javascript
finish(data = null)
```

* 完成加载

---

## fail(error)

```javascript
fail(error)
```

* 加载失败

---

## reset()

```javascript
reset()
```

* 重置状态

---

## class LoadingManager

```javascript
class LoadingManager
```

* 加载状态管理器

---

## getState(key, message = '加载中...')

```javascript
getState(key, message = '加载中...')
```

* 创建或获取加载状态

---

## start(key, message = '加载中...')

```javascript
start(key, message = '加载中...')
```

* 开始加载

---

## finish(key, data = null)

```javascript
finish(key, data = null)
```

* 完成加载

---

## fail(key, error)

```javascript
fail(key, error)
```

* 加载失败

---

## updateProgress(key, progress)

```javascript
updateProgress(key, progress)
```

* 更新进度

---

## isLoading(key)

```javascript
isLoading(key)
```

* 检查是否正在加载

---

## reset(key)

```javascript
reset(key)
```

* 重置状态

---

## clear()

```javascript
clear()
```

* 清除所有状态

---

## export function useLoading(key, message = '加载中...')

```javascript
export function useLoading(key, message = '加载中...')
```

* 组合式函数：使用加载状态

---

## export async function withLoading(key, fn, options =

```javascript
export async function withLoading(key, fn, options =
```

* 异步操作包装器
 * 自动管理加载状态

---

## export async function withBatchLoading(operations, options =

```javascript
export async function withBatchLoading(operations, options =
```

* 批量加载包装器
 * 管理多个并发加载操作

---

## export function withDebounceLoading(key, fn, delay = 300)

```javascript
export function withDebounceLoading(key, fn, delay = 300)
```

* 防抖加载包装器
 * 防止重复触发加载

---

## export function withThrottleLoading(key, fn, interval = 1000)

```javascript
export function withThrottleLoading(key, fn, interval = 1000)
```

* 节流加载包装器
 * 限制加载频率

---

## export function useAsyncData(key, fetchFn, options =

```javascript
export function useAsyncData(key, fetchFn, options =
```

* 组合式函数：使用异步数据
 * 结合加载状态和数据获取

---

