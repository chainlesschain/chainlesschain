# image-ipc

**Source**: `src/main/image/image-ipc.js`

**Generated**: 2026-02-15T07:37:13.830Z

---

## const

```javascript
const
```

* 图像管理 IPC
 * 处理图像上传、OCR、搜索、AI生成、图像处理等操作
 *
 * @module image-ipc
 * @description 图像管理模块，提供图像上传、OCR识别、AI图像生成、图像处理等功能

---

## function registerImageIPC(

```javascript
function registerImageIPC(
```

* 注册图像管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.imageUploader - 图片上传器实例
 * @param {Object} dependencies.llmManager - LLM 管理器实例（用于 AI 图像生成）
 * @param {Object} dependencies.mainWindow - 主窗口实例（用于进度通知）

---

## ipcMain.handle("image:select-images", async () =>

```javascript
ipcMain.handle("image:select-images", async () =>
```

* 选择图片

---

## ipcMain.handle("image:upload", async (_event, imagePath, options) =>

```javascript
ipcMain.handle("image:upload", async (_event, imagePath, options) =>
```

* 上传图片

---

## ipcMain.handle("image:upload-batch", async (_event, imagePaths, options) =>

```javascript
ipcMain.handle("image:upload-batch", async (_event, imagePaths, options) =>
```

* 批量上传图片

---

## ipcMain.handle("image:ocr", async (_event, imagePath) =>

```javascript
ipcMain.handle("image:ocr", async (_event, imagePath) =>
```

* OCR 识别

---

## ipcMain.handle("image:get", async (_event, imageId) =>

```javascript
ipcMain.handle("image:get", async (_event, imageId) =>
```

* 获取图片信息

---

## ipcMain.handle("image:list", async (_event, options) =>

```javascript
ipcMain.handle("image:list", async (_event, options) =>
```

* 列出图片

---

## ipcMain.handle("image:search", async (_event, query) =>

```javascript
ipcMain.handle("image:search", async (_event, query) =>
```

* 搜索图片

---

## ipcMain.handle("image:delete", async (_event, imageId) =>

```javascript
ipcMain.handle("image:delete", async (_event, imageId) =>
```

* 删除图片

---

## ipcMain.handle("image:get-stats", async () =>

```javascript
ipcMain.handle("image:get-stats", async () =>
```

* 获取统计信息

---

## ipcMain.handle("image:get-supported-formats", async () =>

```javascript
ipcMain.handle("image:get-supported-formats", async () =>
```

* 获取支持的格式

---

## ipcMain.handle("image:get-supported-languages", async () =>

```javascript
ipcMain.handle("image:get-supported-languages", async () =>
```

* 获取支持的语言

---

## ipcMain.handle("image:generateFromText", async (_event, params) =>

```javascript
ipcMain.handle("image:generateFromText", async (_event, params) =>
```

* AI 文生图

---

## ipcMain.handle("image:removeBackground", async (_event, params) =>

```javascript
ipcMain.handle("image:removeBackground", async (_event, params) =>
```

* 移除背景

---

## ipcMain.handle("image:resize", async (_event, params) =>

```javascript
ipcMain.handle("image:resize", async (_event, params) =>
```

* 调整图片大小

---

## ipcMain.handle("image:crop", async (_event, params) =>

```javascript
ipcMain.handle("image:crop", async (_event, params) =>
```

* 裁剪图片

---

## ipcMain.handle("image:enhance", async (_event, params) =>

```javascript
ipcMain.handle("image:enhance", async (_event, params) =>
```

* 增强图片

---

## ipcMain.handle("image:upscale", async (_event, params) =>

```javascript
ipcMain.handle("image:upscale", async (_event, params) =>
```

* 图片超分辨率

---

## ipcMain.handle("image:addWatermark", async (_event, params) =>

```javascript
ipcMain.handle("image:addWatermark", async (_event, params) =>
```

* 添加水印

---

## ipcMain.handle("image:batchProcess", async (_event, params) =>

```javascript
ipcMain.handle("image:batchProcess", async (_event, params) =>
```

* 批量处理图片

---

## ipcMain.handle("image:convertFormat", async (_event, params) =>

```javascript
ipcMain.handle("image:convertFormat", async (_event, params) =>
```

* 转换图片格式

---

## ipcMain.handle("image:createCollage", async (_event, params) =>

```javascript
ipcMain.handle("image:createCollage", async (_event, params) =>
```

* 创建图片拼贴

---

## ipcMain.handle("image:getInfo", async (_event, imagePath) =>

```javascript
ipcMain.handle("image:getInfo", async (_event, imagePath) =>
```

* 获取图片详细信息（使用引擎）

---

