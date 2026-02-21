# web-search-ipc

**Source**: `src/main/utils/web-search-ipc.js`

**Generated**: 2026-02-21T22:45:05.238Z

---

## const

```javascript
const
```

* 联网搜索IPC处理器

---

## function registerWebSearchIPC()

```javascript
function registerWebSearchIPC()
```

* 注册联网搜索IPC handlers

---

## ipcMain.handle("webSearch:search", async (_event, query, options =

```javascript
ipcMain.handle("webSearch:search", async (_event, query, options =
```

* 通用搜索

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* DuckDuckGo搜索

---

## ipcMain.handle("webSearch:bing", async (_event, query, options =

```javascript
ipcMain.handle("webSearch:bing", async (_event, query, options =
```

* Bing搜索

---

## ipcMain.handle("webSearch:format", async (_event, searchResult) =>

```javascript
ipcMain.handle("webSearch:format", async (_event, searchResult) =>
```

* 格式化搜索结果

---

## function unregisterWebSearchIPC()

```javascript
function unregisterWebSearchIPC()
```

* 注销IPC handlers

---

