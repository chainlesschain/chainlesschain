# webide-ipc

**Source**: `src\main\webide\webide-ipc.js`

**Generated**: 2026-01-27T06:44:03.777Z

---

## const

```javascript
const
```

* Web IDE IPC 处理器
 * 负责处理渲染进程和主进程之间的通信

---

## registerHandlers()

```javascript
registerHandlers()
```

* 注册所有 IPC handlers

---

## registerProjectHandlers()

```javascript
registerProjectHandlers()
```

* 注册项目管理相关的 handlers
   * @private

---

## registerPreviewHandlers()

```javascript
registerPreviewHandlers()
```

* 注册预览服务器相关的 handlers
   * @private

---

## registerExportHandlers()

```javascript
registerExportHandlers()
```

* 注册导出功能相关的 handlers
   * @private

---

## async cleanup()

```javascript
async cleanup()
```

* 清理所有活动的服务器

---

