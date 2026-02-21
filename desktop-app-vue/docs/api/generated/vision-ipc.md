# vision-ipc

**Source**: `src/main/ai-engine/vision-ipc.js`

**Generated**: 2026-02-21T22:45:05.323Z

---

## const

```javascript
const
```

* Vision IPC 处理器
 *
 * 负责处理视觉分析相关的前后端通信
 *
 * @module vision-ipc
 * @version 1.0.0

---

## function registerVisionIPC(

```javascript
function registerVisionIPC(
```

* 注册 Vision IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.visionManager - Vision 管理器
 * @param {Object} [dependencies.mainWindow] - 主窗口实例
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC 守卫（用于测试注入）

---

## ipcMain.handle('vision:check-status', async () =>

```javascript
ipcMain.handle('vision:check-status', async () =>
```

* 检查视觉服务状态
   * Channel: 'vision:check-status'

---

## ipcMain.handle('vision:analyze-image', async (event, params) =>

```javascript
ipcMain.handle('vision:analyze-image', async (event, params) =>
```

* 分析图片（通用）
   * Channel: 'vision:analyze-image'
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.type] - 分析类型 (describe|ocr|vqa|analyze)
   * @param {string} [params.prompt] - 自定义提示词
   * @param {string} [params.question] - 问题（VQA 用）
   * @param {Object} [params.options] - 其他选项

---

## ipcMain.handle('vision:describe-image', async (event, params) =>

```javascript
ipcMain.handle('vision:describe-image', async (event, params) =>
```

* 描述图片
   * Channel: 'vision:describe-image'

---

## ipcMain.handle('vision:ocr', async (event, params) =>

```javascript
ipcMain.handle('vision:ocr', async (event, params) =>
```

* OCR 文字识别
   * Channel: 'vision:ocr'

---

## ipcMain.handle('vision:vqa', async (event, params) =>

```javascript
ipcMain.handle('vision:vqa', async (event, params) =>
```

* 视觉问答 (VQA)
   * Channel: 'vision:vqa'

---

## ipcMain.handle('vision:analyze-stream', async (event, params) =>

```javascript
ipcMain.handle('vision:analyze-stream', async (event, params) =>
```

* 流式分析图片
   * Channel: 'vision:analyze-stream'
   * 返回分析 ID，结果通过事件发送

---

## ipcMain.handle('vision:batch-analyze', async (event, params) =>

```javascript
ipcMain.handle('vision:batch-analyze', async (event, params) =>
```

* 批量分析图片
   * Channel: 'vision:batch-analyze'

---

## ipcMain.handle('vision:get-stats', async () =>

```javascript
ipcMain.handle('vision:get-stats', async () =>
```

* 获取统计数据
   * Channel: 'vision:get-stats'

---

## ipcMain.handle('vision:update-config', async (event, config) =>

```javascript
ipcMain.handle('vision:update-config', async (event, config) =>
```

* 更新配置
   * Channel: 'vision:update-config'

---

## ipcMain.handle('vision:clear-cache', async () =>

```javascript
ipcMain.handle('vision:clear-cache', async () =>
```

* 清除缓存
   * Channel: 'vision:clear-cache'

---

## ipcMain.handle('vision:pull-model', async (event, params) =>

```javascript
ipcMain.handle('vision:pull-model', async (event, params) =>
```

* 拉取视觉模型
   * Channel: 'vision:pull-model'

---

