# backend-integration.patch

**Source**: `src/main/api/backend-integration.patch.js`

**Generated**: 2026-02-16T22:06:51.513Z

---

## const

```javascript
const
```

* Backend Service Integration Patch
 *
 * 在主进程index.js中添加以下代码来集成后端服务管理器
 *
 * 修改步骤：
 * 1. 在文件顶部导入后端服务管理器
 * 2. 在 setupApp() 中添加 will-quit 事件监听
 * 3. 在 onReady() 开始时启动后端服务
 * 4. 添加IPC处理程序用于服务状态查询

---

