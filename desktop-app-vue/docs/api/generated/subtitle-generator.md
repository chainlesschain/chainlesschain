# subtitle-generator

**Source**: `src\main\speech\subtitle-generator.js`

**Generated**: 2026-01-27T06:44:03.806Z

---

## const

```javascript
const
```

* 字幕生成器
 *
 * 支持生成 SRT 和 VTT 字幕文件
 * 用于音频/视频转录结果的字幕导出

---

## class TimeFormatter

```javascript
class TimeFormatter
```

* 时间格式化工具

---

## static toSRTTime(seconds)

```javascript
static toSRTTime(seconds)
```

* 秒转 SRT 时间格式 (HH:MM:SS,mmm)
   * @param {number} seconds - 秒数
   * @returns {string}

---

## static toVTTTime(seconds)

```javascript
static toVTTTime(seconds)
```

* 秒转 VTT 时间格式 (HH:MM:SS.mmm)
   * @param {number} seconds - 秒数
   * @returns {string}

---

## static parseSRTTime(timeString)

```javascript
static parseSRTTime(timeString)
```

* 解析 SRT 时间字符串
   * @param {string} timeString - SRT 时间字符串
   * @returns {number} 秒数

---

## static parseVTTTime(timeString)

```javascript
static parseVTTTime(timeString)
```

* 解析 VTT 时间字符串
   * @param {string} timeString - VTT 时间字符串
   * @returns {number} 秒数

---

## class SubtitleEntry

```javascript
class SubtitleEntry
```

* 字幕条目

---

## toSRT()

```javascript
toSRT()
```

* 转换为 SRT 格式
   * @returns {string}

---

## toVTT()

```javascript
toVTT()
```

* 转换为 VTT 格式
   * @returns {string}

---

## class SubtitleGenerator

```javascript
class SubtitleGenerator
```

* 字幕生成器类

---

## generateFromText(text, totalDuration, options =

```javascript
generateFromText(text, totalDuration, options =
```

* 从纯文本生成字幕
   * @param {string} text - 转录文本
   * @param {number} totalDuration - 音频总时长（秒）
   * @param {Object} options - 生成选项
   * @returns {Array<SubtitleEntry>}

---

## generateFromSegments(segments)

```javascript
generateFromSegments(segments)
```

* 从带时间戳的转录数据生成字幕
   * @param {Array} segments - 转录段落数据 [{text, start, end}]
   * @returns {Array<SubtitleEntry>}

---

## splitBySentences(text, punctuationMarks)

```javascript
splitBySentences(text, punctuationMarks)
```

* 分割文本为句子
   * @param {string} text - 文本
   * @param {Array} punctuationMarks - 标点符号
   * @returns {Array<string>}

---

## splitIntoLines(text)

```javascript
splitIntoLines(text)
```

* 将长文本分割为多行
   * @param {string} text - 文本
   * @returns {Array<string>}

---

## toSRT(subtitles)

```javascript
toSRT(subtitles)
```

* 导出为 SRT 格式
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目列表
   * @returns {string}

---

## toVTT(subtitles)

```javascript
toVTT(subtitles)
```

* 导出为 VTT 格式
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目列表
   * @returns {string}

---

## parseSRT(srtText)

```javascript
parseSRT(srtText)
```

* 从 SRT 文本解析
   * @param {string} srtText - SRT 文本
   * @returns {Array<SubtitleEntry>}

---

## parseVTT(vttText)

```javascript
parseVTT(vttText)
```

* 从 VTT 文本解析
   * @param {string} vttText - VTT 文本
   * @returns {Array<SubtitleEntry>}

---

## async saveSubtitleFile(subtitles, outputPath, format = 'srt')

```javascript
async saveSubtitleFile(subtitles, outputPath, format = 'srt')
```

* 保存字幕文件
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式 (srt|vtt)
   * @returns {Promise<Object>}

---

## async saveWhisperSubtitle(whisperResponse, outputPath, format = 'srt')

```javascript
async saveWhisperSubtitle(whisperResponse, outputPath, format = 'srt')
```

* 从 Whisper API 响应生成字幕
   * @param {string} whisperResponse - Whisper API 返回的 SRT/VTT 内容
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式
   * @returns {Promise<Object>}

---

## async batchGenerate(transcriptions, outputDir, format = 'srt')

```javascript
async batchGenerate(transcriptions, outputDir, format = 'srt')
```

* 批量生成字幕文件
   * @param {Array} transcriptions - 转录结果列表
   * @param {string} outputDir - 输出目录
   * @param {string} format - 格式
   * @returns {Promise<Array>}

---

## async mergeSubtitles(subtitlePaths, outputPath)

```javascript
async mergeSubtitles(subtitlePaths, outputPath)
```

* 合并多个字幕文件
   * @param {Array<string>} subtitlePaths - 字幕文件路径列表
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>}

---

## adjustTiming(subtitles, offset)

```javascript
adjustTiming(subtitles, offset)
```

* 调整字幕时间轴
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @param {number} offset - 时间偏移（秒，可为负数）
   * @returns {Array<SubtitleEntry>}

---

## filterEmpty(subtitles)

```javascript
filterEmpty(subtitles)
```

* 过滤空白字幕
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @returns {Array<SubtitleEntry>}

---

## reindex(subtitles)

```javascript
reindex(subtitles)
```

* 重新编号字幕
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @returns {Array<SubtitleEntry>}

---

