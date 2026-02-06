/**
 * 多媒体API工具类 (TypeScript版本)
 *
 * 封装与主进程的IPC通信，提供简洁的API调用
 * 自动处理进度事件和错误处理
 * 完整的类型安全支持
 */

import { logger } from '@/utils/logger';
import type {
  IMultimediaAPI,
  ProgressCallback,
  ImageUploadOptions,
  ImageUploadResult,
  OCROptions,
  OCRResult,
  ImageCompressOptions,
  AudioTranscribeOptions,
  AudioTranscribeResult,
  VideoInfo,
  VideoFilterOptions,
  VideoProcessResult,
  VideoFilterChainItem,
  VolumeAdjustOptions,
  SubtitleStyleOptions,
  SubtitlePreset,
  VideoConvertOptions,
  VideoTrimOptions,
  VideoCompressOptions,
  ThumbnailOptions,
  VideoMergeOptions,
} from '../types/multimedia';

/**
 * 多媒体API类
 */
class MultimediaAPI implements IMultimediaAPI {
  private progressCallbacks: Map<string, ProgressCallback>;

  constructor() {
    this.progressCallbacks = new Map();
    this.setupProgressListener();
  }

  /**
   * 设置进度监听器
   */
  private setupProgressListener(): void {
    if (window.electronAPI) {
      window.electronAPI.on('task-progress', (event: any, data: any) => {
        const callback = this.progressCallbacks.get(data.taskId);
        if (callback) {
          callback(data);
        }
      });
    }
  }

  /**
   * 调用IPC方法的通用包装
   */
  private async invoke<T = any>(
    channel: string,
    params: Record<string, any> = {},
    onProgress: ProgressCallback | null = null
  ): Promise<T> {
    try {
      if (onProgress) {
        const taskId = `${channel}_${Date.now()}`;
        this.progressCallbacks.set(taskId, onProgress);

        const result = await window.electronAPI!.invoke(channel, {
          ...params,
          taskId,
        });

        this.progressCallbacks.delete(taskId);
        return result;
      }

      return await window.electronAPI!.invoke(channel, params);
    } catch (error) {
      logger.error(`[MultimediaAPI] ${channel} 调用失败:`, error);
      throw error;
    }
  }

  // ==================== 图片处理 API ====================

  /**
   * 上传图片
   */
  async uploadImage(
    imagePath: string,
    options: ImageUploadOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<ImageUploadResult> {
    return this.invoke<ImageUploadResult>(
      'image:upload',
      { imagePath, options },
      onProgress
    );
  }

  /**
   * 批量上传图片
   */
  async uploadImages(
    imagePaths: string[],
    options: ImageUploadOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<ImageUploadResult[]> {
    return this.invoke<ImageUploadResult[]>(
      'image:batch-upload',
      { imagePaths, options },
      onProgress
    );
  }

  /**
   * 批量OCR识别
   */
  async batchOCR(
    imagePaths: string[],
    options: OCROptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<OCRResult[]> {
    return this.invoke<OCRResult[]>(
      'image:batch-ocr',
      { imagePaths, options },
      onProgress
    );
  }

  /**
   * 图片压缩
   */
  async compressImage(
    imagePath: string,
    options: ImageCompressOptions = {}
  ): Promise<ImageUploadResult> {
    return this.invoke<ImageUploadResult>('image:compress', { imagePath, options });
  }

  // ==================== 音频处理 API ====================

  /**
   * 音频转录
   */
  async transcribeAudio(
    audioPath: string,
    options: AudioTranscribeOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<AudioTranscribeResult> {
    return this.invoke<AudioTranscribeResult>(
      'audio:transcribe',
      { audioPath, options },
      onProgress
    );
  }

  /**
   * 批量音频转录
   */
  async batchTranscribe(
    audioPaths: string[],
    options: AudioTranscribeOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<AudioTranscribeResult[]> {
    return this.invoke<AudioTranscribeResult[]>(
      'audio:batch-transcribe',
      { audioPaths, options },
      onProgress
    );
  }

  // ==================== 视频处理 API ====================

  /**
   * 获取视频信息
   */
  async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    return this.invoke<VideoInfo>('video:getInfo', { videoPath });
  }

  /**
   * 应用视频滤镜
   */
  async applyVideoFilter(
    inputPath: string,
    outputPath: string,
    options: VideoFilterOptions = {} as VideoFilterOptions,
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:applyFilter',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 应用视频滤镜链
   */
  async applyVideoFilterChain(
    inputPath: string,
    outputPath: string,
    filters: VideoFilterChainItem[],
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:applyFilterChain',
      { inputPath, outputPath, filters },
      onProgress
    );
  }

  /**
   * 提取音频
   */
  async extractAudio(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:extractAudio',
      { inputPath, outputPath },
      onProgress
    );
  }

  /**
   * 分离音轨
   */
  async separateAudioTracks(
    inputPath: string,
    outputDir: string
  ): Promise<{ tracks: string[] }> {
    return this.invoke<{ tracks: string[] }>('video:separateAudio', {
      inputPath,
      outputDir,
    });
  }

  /**
   * 替换音轨
   */
  async replaceAudio(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:replaceAudio',
      { videoPath, audioPath, outputPath },
      onProgress
    );
  }

  /**
   * 调整音量
   */
  async adjustVolume(
    inputPath: string,
    outputPath: string,
    volumeLevel: number,
    options: Omit<VolumeAdjustOptions, 'volumeLevel'> = {},
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:adjustVolume',
      { inputPath, outputPath, volumeLevel, ...options },
      onProgress
    );
  }

  /**
   * 添加字幕
   */
  async addSubtitles(
    inputPath: string,
    subtitlePath: string,
    outputPath: string,
    options: SubtitleStyleOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:addSubtitles',
      { inputPath, subtitlePath, outputPath, options },
      onProgress
    );
  }

  /**
   * 使用预设添加字幕
   */
  async addSubtitlesWithPreset(
    inputPath: string,
    subtitlePath: string,
    outputPath: string,
    presetName: SubtitlePreset,
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:addSubtitlesWithPreset',
      { inputPath, subtitlePath, outputPath, presetName },
      onProgress
    );
  }

  /**
   * 视频格式转换
   */
  async convertVideo(
    inputPath: string,
    outputPath: string,
    options: VideoConvertOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:convert',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 裁剪视频
   */
  async trimVideo(
    inputPath: string,
    outputPath: string,
    options: VideoTrimOptions,
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:trim',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 压缩视频
   */
  async compressVideo(
    inputPath: string,
    outputPath: string,
    options: VideoCompressOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:compress',
      { inputPath, outputPath, options },
      onProgress
    );
  }

  /**
   * 生成缩略图
   */
  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    options: ThumbnailOptions = {}
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>('video:generateThumbnail', {
      inputPath,
      outputPath,
      options,
    });
  }

  /**
   * 合并视频
   */
  async mergeVideos(
    videoPaths: string[],
    outputPath: string,
    options: VideoMergeOptions = {},
    onProgress: ProgressCallback | null = null
  ): Promise<VideoProcessResult> {
    return this.invoke<VideoProcessResult>(
      'video:merge',
      { videoPaths, outputPath, options },
      onProgress
    );
  }
}

// 创建单例实例
const multimediaAPI = new MultimediaAPI();

export default multimediaAPI;

// 也导出类供需要的场景使用
export { MultimediaAPI };

// 导出类型
export type { IMultimediaAPI };
