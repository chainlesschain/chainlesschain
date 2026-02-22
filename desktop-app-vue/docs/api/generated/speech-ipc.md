# speech-ipc

**Source**: `src/main/speech/speech-ipc.js`

**Generated**: 2026-02-22T01:23:36.670Z

---

## const

```javascript
const
```

* 语音处理 IPC
 * 处理音频转录、实时录音、字幕生成、音频处理等操作
 *
 * @module speech-ipc
 * @description 语音处理模块，提供音频转录、实时录音、音频增强、字幕生成、命令识别等功能

---

## function registerSpeechIPC(

```javascript
function registerSpeechIPC(
```

* 注册语音处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.initializeSpeechManager - 初始化语音管理器的函数

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 转录音频文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量转录音频文件

---

## ipcMain.handle("speech:select-audio-files", async () =>

```javascript
ipcMain.handle("speech:select-audio-files", async () =>
```

* 选择音频文件

---

## ipcMain.handle("speech:get-config", async () =>

```javascript
ipcMain.handle("speech:get-config", async () =>
```

* 获取配置

---

## ipcMain.handle("speech:update-config", async (_event, config) =>

```javascript
ipcMain.handle("speech:update-config", async (_event, config) =>
```

* 更新配置

---

## ipcMain.handle("speech:set-engine", async (_event, engineType) =>

```javascript
ipcMain.handle("speech:set-engine", async (_event, engineType) =>
```

* 设置识别引擎

---

## ipcMain.handle("speech:get-available-engines", async () =>

```javascript
ipcMain.handle("speech:get-available-engines", async () =>
```

* 获取可用引擎列表

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取转录历史

---

## ipcMain.handle("speech:delete-history", async (_event, id) =>

```javascript
ipcMain.handle("speech:delete-history", async (_event, id) =>
```

* 删除历史记录

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 搜索转录历史

---

## ipcMain.handle("speech:get-audio-file", async (_event, id) =>

```javascript
ipcMain.handle("speech:get-audio-file", async (_event, id) =>
```

* 获取音频文件

---

## ipcMain.handle("speech:list-audio-files", async (_event, options =

```javascript
ipcMain.handle("speech:list-audio-files", async (_event, options =
```

* 列出音频文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 搜索音频文件

---

## ipcMain.handle("speech:delete-audio-file", async (_event, id) =>

```javascript
ipcMain.handle("speech:delete-audio-file", async (_event, id) =>
```

* 删除音频文件

---

## ipcMain.handle("speech:get-stats", async (_event, userId = "local-user") =>

```javascript
ipcMain.handle("speech:get-stats", async (_event, userId = "local-user") =>
```

* 获取统计信息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 降噪音频

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 增强音频

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 为识别增强音频

---

## ipcMain.handle("speech:detect-language", async (_event, audioPath) =>

```javascript
ipcMain.handle("speech:detect-language", async (_event, audioPath) =>
```

* 检测语言

---

## ipcMain.handle("speech:detect-languages", async (_event, audioPaths) =>

```javascript
ipcMain.handle("speech:detect-languages", async (_event, audioPaths) =>
```

* 批量检测语言

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 生成字幕

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 转录并生成字幕

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量生成字幕

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 开始实时录音

---

## let audioDataCounter = 0;

```javascript
let audioDataCounter = 0;
```

* 添加实时音频数据
   * 注意：从渲染进程传来的可能是 ArrayBuffer、Uint8Array 或 Buffer

---

## ipcMain.handle("speech:pause-realtime-recording", async () =>

```javascript
ipcMain.handle("speech:pause-realtime-recording", async () =>
```

* 暂停实时录音

---

## ipcMain.handle("speech:resume-realtime-recording", async () =>

```javascript
ipcMain.handle("speech:resume-realtime-recording", async () =>
```

* 恢复实时录音

---

## ipcMain.handle("speech:stop-realtime-recording", async () =>

```javascript
ipcMain.handle("speech:stop-realtime-recording", async () =>
```

* 停止实时录音

---

## ipcMain.handle("speech:cancel-realtime-recording", async () =>

```javascript
ipcMain.handle("speech:cancel-realtime-recording", async () =>
```

* 取消实时录音

---

## ipcMain.handle("speech:get-realtime-status", async () =>

```javascript
ipcMain.handle("speech:get-realtime-status", async () =>
```

* 获取实时录音状态

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 识别命令

---

## ipcMain.handle("speech:register-command", async (_event, command) =>

```javascript
ipcMain.handle("speech:register-command", async (_event, command) =>
```

* 注册命令

---

## ipcMain.handle("speech:get-all-commands", async () =>

```javascript
ipcMain.handle("speech:get-all-commands", async () =>
```

* 获取所有命令

---

## ipcMain.handle("speech:get-cache-stats", async () =>

```javascript
ipcMain.handle("speech:get-cache-stats", async () =>
```

* 获取缓存统计

---

## ipcMain.handle("speech:clear-cache", async () =>

```javascript
ipcMain.handle("speech:clear-cache", async () =>
```

* 清除缓存

---

## ipcMain.handle("speech:getLanguages", async () =>

```javascript
ipcMain.handle("speech:getLanguages", async () =>
```

* 获取支持的语言列表

---

## ipcMain.handle("speech:getLearningStats", async () =>

```javascript
ipcMain.handle("speech:getLearningStats", async () =>
```

* 获取学习统计

---

## ipcMain.handle("speech:getCommandSuggestions", async () =>

```javascript
ipcMain.handle("speech:getCommandSuggestions", async () =>
```

* 获取命令建议

---

## ipcMain.handle("speech:startRecording", async (event, options =

```javascript
ipcMain.handle("speech:startRecording", async (event, options =
```

* 开始录音 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 逻辑

---

## ipcMain.handle("speech:stopRecording", async () =>

```javascript
ipcMain.handle("speech:stopRecording", async () =>
```

* 停止录音并获取结果 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 逻辑，返回识别结果

---

## ipcMain.handle("speech:cancelRecording", async () =>

```javascript
ipcMain.handle("speech:cancelRecording", async () =>
```

* 取消录音 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 的取消逻辑

---

## ipcMain.handle("speech:exportData", async () =>

```javascript
ipcMain.handle("speech:exportData", async () =>
```

* 导出语音数据

---

## ipcMain.handle("speech:importData", async () =>

```javascript
ipcMain.handle("speech:importData", async () =>
```

* 导入语音数据

---

## ipcMain.handle("speech:resetData", async () =>

```javascript
ipcMain.handle("speech:resetData", async () =>
```

* 重置语音数据

---

