# main-log-listener

**Source**: `src\renderer\utils\main-log-listener.js`

**Generated**: 2026-01-27T06:44:03.897Z

---

## const LOG_STYLES =

```javascript
const LOG_STYLES =
```

* 主进程日志监听器
 *
 * 自动监听从主进程转发过来的日志，并在 DevTools Console 中显示
 * 日志会以特定的样式显示，便于区分主进程和渲染进程的日志
 *
 * @module main-log-listener

---

## export function initMainLogListener()

```javascript
export function initMainLogListener()
```

* 初始化主进程日志监听

---

## export function stopMainLogListener()

```javascript
export function stopMainLogListener()
```

* 停止主进程日志监听

---

## export function isMainLogListenerActive()

```javascript
export function isMainLogListenerActive()
```

* 检查监听器是否已初始化
 * @returns {boolean}

---

