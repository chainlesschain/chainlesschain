# composables

**Source**: `src\renderer\utils\composables.js`

**Generated**: 2026-01-27T06:44:03.901Z

---

## import

```javascript
import
```

* 实用组合式函数集合
 * 提供常用的功能封装，简化组件开发

---

## export function useAsyncData(key, fetchFn, options =

```javascript
export function useAsyncData(key, fetchFn, options =
```

* 使用异步数据
 * 自动处理加载状态、错误和数据获取

---

## export function useDebounce(fn, delay = 300)

```javascript
export function useDebounce(fn, delay = 300)
```

* 使用防抖
 * 延迟执行函数，避免频繁触发

---

## export function useThrottle(fn, interval = 1000)

```javascript
export function useThrottle(fn, interval = 1000)
```

* 使用节流
 * 限制函数执行频率

---

## export function useClipboard()

```javascript
export function useClipboard()
```

* 使用剪贴板
 * 简化复制粘贴操作

---

## export function useLocalStorage(key, defaultValue = null)

```javascript
export function useLocalStorage(key, defaultValue = null)
```

* 使用本地存储
 * 简化 localStorage 操作，支持 JSON

---

## export function useConfirm()

```javascript
export function useConfirm()
```

* 使用确认对话框
 * 简化确认操作

---

## export function usePolling(fn, interval = 5000, options =

```javascript
export function usePolling(fn, interval = 5000, options =
```

* 使用轮询
 * 定期执行函数

---

## export function useOnline()

```javascript
export function useOnline()
```

* 使用在线状态
 * 监听网络连接状态

---

## export function useWindowSize()

```javascript
export function useWindowSize()
```

* 使用窗口大小
 * 响应式窗口尺寸

---

## export function useDownload()

```javascript
export function useDownload()
```

* 使用文件下载
 * 简化文件下载操作

---

## export function useFormValidation(rules)

```javascript
export function useFormValidation(rules)
```

* 使用表单验证
 * 简化表单验证逻辑

---

