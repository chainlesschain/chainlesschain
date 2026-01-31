# video-ipc

**Source**: `src\main\video\video-ipc.js`

**Generated**: 2026-01-27T06:44:03.778Z

---

## const

```javascript
const
```

* 视频处理 IPC
 * 处理视频导入、编辑、转码、分析等操作
 *
 * @module video-ipc
 * @description 视频处理模块，提供视频导入、批量处理、编辑、转码、字幕处理等功能

---

## function registerVideoIPC(

```javascript
function registerVideoIPC(
```

* 注册视频处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.videoImporter - 视频导入器实例
 * @param {Object} dependencies.mainWindow - 主窗口实例（用于进度通知）
 * @param {Object} dependencies.llmManager - LLM 管理器实例（用于AI视频处理）

---

## ipcMain.handle('video:select-files', async () =>

```javascript
ipcMain.handle('video:select-files', async () =>
```

* 选择视频文件

---

## ipcMain.handle('video:import-file', async (_event, filePath, options) =>

```javascript
ipcMain.handle('video:import-file', async (_event, filePath, options) =>
```

* 导入单个视频文件

---

## ipcMain.handle('video:import-files', async (_event, filePaths, options) =>

```javascript
ipcMain.handle('video:import-files', async (_event, filePaths, options) =>
```

* 批量导入视频文件

---

## ipcMain.handle('video:get-video', async (_event, videoId) =>

```javascript
ipcMain.handle('video:get-video', async (_event, videoId) =>
```

* 获取视频信息

---

## ipcMain.handle('video:get-videos', async (_event, options) =>

```javascript
ipcMain.handle('video:get-videos', async (_event, options) =>
```

* 获取视频列表

---

## ipcMain.handle('video:get-analysis', async (_event, videoId) =>

```javascript
ipcMain.handle('video:get-analysis', async (_event, videoId) =>
```

* 获取视频分析

---

## ipcMain.handle('video:get-keyframes', async (_event, videoId) =>

```javascript
ipcMain.handle('video:get-keyframes', async (_event, videoId) =>
```

* 获取关键帧

---

## ipcMain.handle('video:delete-video', async (_event, videoId) =>

```javascript
ipcMain.handle('video:delete-video', async (_event, videoId) =>
```

* 删除视频

---

## ipcMain.handle('video:get-stats', async () =>

```javascript
ipcMain.handle('video:get-stats', async () =>
```

* 获取统计信息

---

## ipcMain.handle('video:convert', async (_event, params) =>

```javascript
ipcMain.handle('video:convert', async (_event, params) =>
```

* 转换视频格式

---

## ipcMain.handle('video:trim', async (_event, params) =>

```javascript
ipcMain.handle('video:trim', async (_event, params) =>
```

* 裁剪视频

---

## ipcMain.handle('video:merge', async (_event, params) =>

```javascript
ipcMain.handle('video:merge', async (_event, params) =>
```

* 合并视频

---

## ipcMain.handle('video:addSubtitles', async (_event, params) =>

```javascript
ipcMain.handle('video:addSubtitles', async (_event, params) =>
```

* 添加字幕

---

## ipcMain.handle('video:generateSubtitles', async (_event, params) =>

```javascript
ipcMain.handle('video:generateSubtitles', async (_event, params) =>
```

* 生成字幕

---

## ipcMain.handle('video:extractAudio', async (_event, params) =>

```javascript
ipcMain.handle('video:extractAudio', async (_event, params) =>
```

* 提取音频

---

## ipcMain.handle('video:generateThumbnail', async (_event, params) =>

```javascript
ipcMain.handle('video:generateThumbnail', async (_event, params) =>
```

* 生成缩略图

---

## ipcMain.handle('video:compress', async (_event, params) =>

```javascript
ipcMain.handle('video:compress', async (_event, params) =>
```

* 压缩视频

---

## ipcMain.handle('video:getInfo', async (_event, videoPath) =>

```javascript
ipcMain.handle('video:getInfo', async (_event, videoPath) =>
```

* 获取视频详细信息

---

## ipcMain.handle('video:applyFilter', async (_event, params) =>

```javascript
ipcMain.handle('video:applyFilter', async (_event, params) =>
```

* 应用单个滤镜

---

## ipcMain.handle('video:applyFilterChain', async (_event, params) =>

```javascript
ipcMain.handle('video:applyFilterChain', async (_event, params) =>
```

* 应用滤镜链

---

## ipcMain.handle('video:separateAudio', async (_event, params) =>

```javascript
ipcMain.handle('video:separateAudio', async (_event, params) =>
```

* 分离音轨

---

## ipcMain.handle('video:replaceAudio', async (_event, params) =>

```javascript
ipcMain.handle('video:replaceAudio', async (_event, params) =>
```

* 替换音轨

---

## ipcMain.handle('video:adjustVolume', async (_event, params) =>

```javascript
ipcMain.handle('video:adjustVolume', async (_event, params) =>
```

* 调节音量

---

## ipcMain.handle('video:addSubtitlesWithPreset', async (_event, params) =>

```javascript
ipcMain.handle('video:addSubtitlesWithPreset', async (_event, params) =>
```

* 使用预设样式添加字幕

---

