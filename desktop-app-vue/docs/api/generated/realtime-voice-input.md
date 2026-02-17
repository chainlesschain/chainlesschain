# realtime-voice-input

**Source**: `src/main/speech/realtime-voice-input.js`

**Generated**: 2026-02-17T10:13:18.187Z

---

## const

```javascript
const
```

* 实时语音输入模块
 *
 * 提供麦克风实时录音和转录功能
 * 支持流式识别和即时反馈

---

## class RealtimeVoiceInput extends EventEmitter

```javascript
class RealtimeVoiceInput extends EventEmitter
```

* 实时语音输入类

---

## async startRecording(options =

```javascript
async startRecording(options =
```

* 开始录音
   * @param {Object} options - 录音选项
   * @returns {Promise<void>}

---

## addAudioData(audioData)

```javascript
addAudioData(audioData)
```

* 添加音频数据
   * @param {Buffer} audioData - PCM音频数据

---

## startChunkProcessing()

```javascript
startChunkProcessing()
```

* 启动chunk处理

---

## async processCurrentChunk()

```javascript
async processCurrentChunk()
```

* 处理当前chunk

---

## pause()

```javascript
pause()
```

* 暂停录音

---

## resume()

```javascript
resume()
```

* 恢复录音

---

## async stopRecording()

```javascript
async stopRecording()
```

* 停止录音
   * @returns {Promise<Object>} 最终结果

---

## cancel()

```javascript
cancel()
```

* 取消录音

---

## getFullTranscript()

```javascript
getFullTranscript()
```

* 获取完整转录文本
   * @returns {string}

---

## async savePCMAsWav(pcmData)

```javascript
async savePCMAsWav(pcmData)
```

* 将 PCM Buffer 保存为 WAV 文件
   * @param {Buffer} pcmData - 16-bit PCM 数据
   * @returns {Promise<string>} 临时 WAV 文件路径

---

## async cleanupTempFile(filePath)

```javascript
async cleanupTempFile(filePath)
```

* 删除临时文件
   * @param {string} filePath - 文件路径

---

## calculateVolume(audioData)

```javascript
calculateVolume(audioData)
```

* 计算音频音量
   * @param {Buffer} audioData - PCM数据
   * @returns {number} 音量 (0-1)

---

## getStatus()

```javascript
getStatus()
```

* 获取录音状态
   * @returns {Object}

---

