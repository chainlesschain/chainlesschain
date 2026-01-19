/**
 * 字幕生成器
 *
 * 支持生成 SRT 和 VTT 字幕文件
 * 用于音频/视频转录结果的字幕导出
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 时间格式化工具
 */
class TimeFormatter {
  /**
   * 秒转 SRT 时间格式 (HH:MM:SS,mmm)
   * @param {number} seconds - 秒数
   * @returns {string}
   */
  static toSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * 秒转 VTT 时间格式 (HH:MM:SS.mmm)
   * @param {number} seconds - 秒数
   * @returns {string}
   */
  static toVTTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * 解析 SRT 时间字符串
   * @param {string} timeString - SRT 时间字符串
   * @returns {number} 秒数
   */
  static parseSRTTime(timeString) {
    const [time, ms] = timeString.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(ms) / 1000;
  }

  /**
   * 解析 VTT 时间字符串
   * @param {string} timeString - VTT 时间字符串
   * @returns {number} 秒数
   */
  static parseVTTTime(timeString) {
    const [time, ms] = timeString.split('.');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(ms) / 1000;
  }
}

/**
 * 字幕条目
 */
class SubtitleEntry {
  constructor(index, startTime, endTime, text) {
    this.index = index;
    this.startTime = startTime;  // 秒
    this.endTime = endTime;      // 秒
    this.text = text;
  }

  /**
   * 转换为 SRT 格式
   * @returns {string}
   */
  toSRT() {
    return `${this.index}\n${TimeFormatter.toSRTTime(this.startTime)} --> ${TimeFormatter.toSRTTime(this.endTime)}\n${this.text}\n`;
  }

  /**
   * 转换为 VTT 格式
   * @returns {string}
   */
  toVTT() {
    return `${TimeFormatter.toVTTTime(this.startTime)} --> ${TimeFormatter.toVTTTime(this.endTime)}\n${this.text}\n`;
  }
}

/**
 * 字幕生成器类
 */
class SubtitleGenerator {
  constructor(config = {}) {
    this.config = {
      maxCharsPerLine: 42,        // 每行最大字符数
      maxLinesPerSubtitle: 2,     // 每条字幕最大行数
      minDuration: 1.0,           // 最小显示时长（秒）
      maxDuration: 7.0,           // 最大显示时长（秒）
      charsPerSecond: 15,         // 每秒阅读字符数
      segmentOnPunctuation: true, // 是否在标点符号处分段
      ...config,
    };
  }

  /**
   * 从纯文本生成字幕
   * @param {string} text - 转录文本
   * @param {number} totalDuration - 音频总时长（秒）
   * @param {Object} options - 生成选项
   * @returns {Array<SubtitleEntry>}
   */
  generateFromText(text, totalDuration, options = {}) {
    const {
      wordsPerMinute = 150,       // 平均语速（字/分钟）
      punctuationMarks = ['。', '！', '？', '.', '!', '?', '\n'],
    } = options;

    // 按标点分句
    let sentences = this.splitBySentences(text, punctuationMarks);

    // 移除空句子
    sentences = sentences.filter(s => s.trim().length > 0);

    if (sentences.length === 0) {
      return [];
    }

    const subtitles = [];
    let currentTime = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      const charCount = sentence.length;

      // 计算这句话的时长（基于字符数和阅读速度）
      const duration = Math.max(
        this.config.minDuration,
        Math.min(charCount / this.config.charsPerSecond, this.config.maxDuration)
      );

      // 如果超过总时长，调整
      const endTime = Math.min(currentTime + duration, totalDuration);

      // 分行（如果需要）
      const lines = this.splitIntoLines(sentence);

      subtitles.push(new SubtitleEntry(
        i + 1,
        currentTime,
        endTime,
        lines.join('\n')
      ));

      currentTime = endTime;
    }

    return subtitles;
  }

  /**
   * 从带时间戳的转录数据生成字幕
   * @param {Array} segments - 转录段落数据 [{text, start, end}]
   * @returns {Array<SubtitleEntry>}
   */
  generateFromSegments(segments) {
    const subtitles = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const lines = this.splitIntoLines(segment.text);

      subtitles.push(new SubtitleEntry(
        i + 1,
        segment.start,
        segment.end,
        lines.join('\n')
      ));
    }

    return subtitles;
  }

  /**
   * 分割文本为句子
   * @param {string} text - 文本
   * @param {Array} punctuationMarks - 标点符号
   * @returns {Array<string>}
   */
  splitBySentences(text, punctuationMarks) {
    const sentences = [];
    let currentSentence = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      currentSentence += char;

      if (punctuationMarks.includes(char)) {
        sentences.push(currentSentence);
        currentSentence = '';
      }
    }

    // 添加剩余文本
    if (currentSentence.trim().length > 0) {
      sentences.push(currentSentence);
    }

    return sentences;
  }

  /**
   * 将长文本分割为多行
   * @param {string} text - 文本
   * @returns {Array<string>}
   */
  splitIntoLines(text) {
    const words = text.split('');  // 中文按字符分，英文需要特殊处理
    const lines = [];
    let currentLine = '';

    for (const char of words) {
      if (currentLine.length + 1 > this.config.maxCharsPerLine) {
        lines.push(currentLine);
        currentLine = char;

        if (lines.length >= this.config.maxLinesPerSubtitle) {
          break;
        }
      } else {
        currentLine += char;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * 导出为 SRT 格式
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目列表
   * @returns {string}
   */
  toSRT(subtitles) {
    return subtitles.map(sub => sub.toSRT()).join('\n');
  }

  /**
   * 导出为 VTT 格式
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目列表
   * @returns {string}
   */
  toVTT(subtitles) {
    let content = 'WEBVTT\n\n';
    content += subtitles.map(sub => sub.toVTT()).join('\n');
    return content;
  }

  /**
   * 从 SRT 文本解析
   * @param {string} srtText - SRT 文本
   * @returns {Array<SubtitleEntry>}
   */
  parseSRT(srtText) {
    const subtitles = [];
    const blocks = srtText.split('\n\n').filter(b => b.trim());

    for (const block of blocks) {
      const lines = block.split('\n');

      if (lines.length >= 3) {
        const index = parseInt(lines[0]);
        const [startTime, endTime] = lines[1].split(' --> ');
        const text = lines.slice(2).join('\n');

        subtitles.push(new SubtitleEntry(
          index,
          TimeFormatter.parseSRTTime(startTime),
          TimeFormatter.parseSRTTime(endTime),
          text
        ));
      }
    }

    return subtitles;
  }

  /**
   * 从 VTT 文本解析
   * @param {string} vttText - VTT 文本
   * @returns {Array<SubtitleEntry>}
   */
  parseVTT(vttText) {
    const subtitles = [];

    // 移除 WEBVTT 头部
    const content = vttText.replace(/^WEBVTT\n+/, '');
    const blocks = content.split('\n\n').filter(b => b.trim());

    let index = 1;
    for (const block of blocks) {
      const lines = block.split('\n');

      if (lines.length >= 2) {
        const [startTime, endTime] = lines[0].split(' --> ');
        const text = lines.slice(1).join('\n');

        subtitles.push(new SubtitleEntry(
          index++,
          TimeFormatter.parseVTTTime(startTime),
          TimeFormatter.parseVTTTime(endTime),
          text
        ));
      }
    }

    return subtitles;
  }

  /**
   * 保存字幕文件
   * @param {Array<SubtitleEntry>} subtitles - 字幕条目
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式 (srt|vtt)
   * @returns {Promise<Object>}
   */
  async saveSubtitleFile(subtitles, outputPath, format = 'srt') {
    try {
      let content;

      if (format.toLowerCase() === 'srt') {
        content = this.toSRT(subtitles);
      } else if (format.toLowerCase() === 'vtt') {
        content = this.toVTT(subtitles);
      } else {
        throw new Error(`不支持的字幕格式: ${format}`);
      }

      await fs.writeFile(outputPath, content, 'utf-8');

      console.log(`[SubtitleGenerator] 字幕已保存: ${outputPath}`);

      return {
        success: true,
        outputPath: outputPath,
        format: format,
        subtitleCount: subtitles.length,
      };
    } catch (error) {
      console.error('[SubtitleGenerator] 保存字幕失败:', error);
      throw error;
    }
  }

  /**
   * 从 Whisper API 响应生成字幕
   * @param {string} whisperResponse - Whisper API 返回的 SRT/VTT 内容
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式
   * @returns {Promise<Object>}
   */
  async saveWhisperSubtitle(whisperResponse, outputPath, format = 'srt') {
    try {
      await fs.writeFile(outputPath, whisperResponse, 'utf-8');

      console.log(`[SubtitleGenerator] Whisper 字幕已保存: ${outputPath}`);

      return {
        success: true,
        outputPath: outputPath,
        format: format,
      };
    } catch (error) {
      console.error('[SubtitleGenerator] 保存 Whisper 字幕失败:', error);
      throw error;
    }
  }

  /**
   * 批量生成字幕文件
   * @param {Array} transcriptions - 转录结果列表
   * @param {string} outputDir - 输出目录
   * @param {string} format - 格式
   * @returns {Promise<Array>}
   */
  async batchGenerate(transcriptions, outputDir, format = 'srt') {
    const results = [];

    for (const transcription of transcriptions) {
      try {
        const { text, duration, fileName } = transcription;
        const baseName = path.basename(fileName, path.extname(fileName));
        const outputPath = path.join(outputDir, `${baseName}.${format}`);

        // 生成字幕
        const subtitles = this.generateFromText(text, duration);

        // 保存文件
        const result = await this.saveSubtitleFile(subtitles, outputPath, format);

        results.push({
          success: true,
          fileName: fileName,
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          fileName: transcription.fileName,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * 合并多个字幕文件
   * @param {Array<string>} subtitlePaths - 字幕文件路径列表
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>}
   */
  async mergeSubtitles(subtitlePaths, outputPath) {
    try {
      const allSubtitles = [];
      let timeOffset = 0;

      for (const subtitlePath of subtitlePaths) {
        const content = await fs.readFile(subtitlePath, 'utf-8');
        const ext = path.extname(subtitlePath).toLowerCase();

        let subtitles;
        if (ext === '.srt') {
          subtitles = this.parseSRT(content);
        } else if (ext === '.vtt') {
          subtitles = this.parseVTT(content);
        } else {
          throw new Error(`不支持的字幕格式: ${ext}`);
        }

        // 调整时间偏移
        for (const subtitle of subtitles) {
          subtitle.startTime += timeOffset;
          subtitle.endTime += timeOffset;
          subtitle.index = allSubtitles.length + 1;
          allSubtitles.push(subtitle);
        }

        // 更新时间偏移为最后一条字幕的结束时间
        if (subtitles.length > 0) {
          timeOffset = subtitles[subtitles.length - 1].endTime;
        }
      }

      // 保存合并后的字幕
      const format = path.extname(outputPath).toLowerCase().slice(1);
      await this.saveSubtitleFile(allSubtitles, outputPath, format);

      return {
        success: true,
        outputPath: outputPath,
        totalSubtitles: allSubtitles.length,
        sourceFiles: subtitlePaths.length,
      };
    } catch (error) {
      console.error('[SubtitleGenerator] 合并字幕失败:', error);
      throw error;
    }
  }

  /**
   * 调整字幕时间轴
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @param {number} offset - 时间偏移（秒，可为负数）
   * @returns {Array<SubtitleEntry>}
   */
  adjustTiming(subtitles, offset) {
    return subtitles.map(subtitle => {
      return new SubtitleEntry(
        subtitle.index,
        Math.max(0, subtitle.startTime + offset),
        Math.max(0, subtitle.endTime + offset),
        subtitle.text
      );
    });
  }

  /**
   * 过滤空白字幕
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @returns {Array<SubtitleEntry>}
   */
  filterEmpty(subtitles) {
    return subtitles.filter(subtitle => subtitle.text.trim().length > 0);
  }

  /**
   * 重新编号字幕
   * @param {Array<SubtitleEntry>} subtitles - 字幕列表
   * @returns {Array<SubtitleEntry>}
   */
  reindex(subtitles) {
    return subtitles.map((subtitle, index) => {
      subtitle.index = index + 1;
      return subtitle;
    });
  }
}

module.exports = {
  SubtitleGenerator,
  SubtitleEntry,
  TimeFormatter,
};
