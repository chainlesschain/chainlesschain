/**
 * 多媒体功能TypeScript类型定义
 *
 * 提供完整的类型安全支持，涵盖：
 * - 进度事件类型
 * - IPC通信接口
 * - 组件Props类型
 * - 处理选项类型
 */

// ==================== 进度相关类型 ====================

/**
 * 任务阶段
 */
export type TaskStage =
  | 'pending'      // 等待中
  | 'preparing'    // 准备中
  | 'processing'   // 处理中
  | 'finalizing'   // 收尾中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'cancelled';   // 已取消

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: ProgressData) => void;

/**
 * 进度数据接口
 */
export interface ProgressData {
  taskId: string;
  title?: string;
  description?: string;
  percent: number;
  stage: TaskStage;
  message?: string;
  current?: number;
  total?: number;
  startTime?: number;
  duration?: number;
  error?: string;
  result?: any;
  parentTaskId?: string;
  childTasks?: string[];
}

/**
 * 任务追踪器接口
 */
export interface TaskTracker {
  step: (message: string, increment?: number) => void;
  setPercent: (percent: number, message?: string) => void;
  setStage: (stage: TaskStage, message?: string) => void;
  complete: (result?: any) => void;
  error: (error: Error | string) => void;
  cancel: (reason?: string) => void;
}

// ==================== 图片处理类型 ====================

/**
 * 图片上传选项
 */
export interface ImageUploadOptions {
  /** 压缩质量 (1-100) */
  quality?: number;
  /** 最大宽度 (像素) */
  maxWidth?: number;
  /** 最大高度 (像素) */
  maxHeight?: number;
  /** 输出格式 */
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  /** 是否压缩 */
  compress?: boolean;
  /** 是否生成缩略图 */
  generateThumbnail?: boolean;
  /** 是否执行OCR识别 */
  performOCR?: boolean;
  /** 是否添加到知识库 */
  addToKnowledge?: boolean;
  /** 知识库项目ID */
  projectId?: string;
}

/**
 * 图片压缩选项
 */
export interface ImageCompressOptions {
  /** 压缩质量 (1-100) */
  quality?: number;
  /** 最大宽度 */
  maxWidth?: number;
  /** 最大高度 */
  maxHeight?: number;
  /** 输出格式 */
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  /** 是否保留元数据 */
  preserveMetadata?: boolean;
}

/**
 * OCR选项
 */
export interface OCROptions {
  /** 识别语言列表 */
  languages?: string[];
  /** 最大并发Worker数 */
  maxWorkers?: number;
  /** OCR引擎 */
  engine?: 'tesseract' | 'paddleocr' | 'azure';
  /** 识别模式 */
  mode?: 'fast' | 'accurate';
}

/**
 * 图片上传结果
 */
export interface ImageUploadResult {
  success: boolean;
  imagePath: string;
  imageId?: string;
  thumbnailPath?: string;
  ocrResult?: OCRResult;
  metadata?: ImageMetadata;
  error?: string;
}

/**
 * OCR识别结果
 */
export interface OCRResult {
  text: string;
  confidence: number;
  language?: string;
  blocks?: OCRBlock[];
}

/**
 * OCR文本块
 */
export interface OCRBlock {
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * 图片元数据
 */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
  orientation?: number;
  exif?: Record<string, any>;
}

// ==================== 音频处理类型 ====================

/**
 * 音频转录选项
 */
export interface AudioTranscribeOptions {
  /** 转录引擎 */
  engine?: 'whisper' | 'azure' | 'google' | 'baidu';
  /** 语言代码 */
  language?: string;
  /** Whisper模型大小 */
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  /** 是否翻译为英文 */
  translate?: boolean;
  /** 时间戳粒度 */
  timestampGranularity?: 'word' | 'segment';
}

/**
 * 音频转录结果
 */
export interface AudioTranscribeResult {
  success: boolean;
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptSegment[];
  error?: string;
}

/**
 * 转录片段
 */
export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

// ==================== 视频处理类型 ====================

/**
 * 视频滤镜类型
 */
export type VideoFilterType =
  | 'blur'       // 模糊
  | 'sharpen'    // 锐化
  | 'grayscale'  // 黑白
  | 'sepia'      // 怀旧
  | 'vignette'   // 暗角
  | 'brightness' // 亮度
  | 'contrast'   // 对比度
  | 'saturation' // 饱和度
  | 'negative'   // 负片
  | 'mirror'     // 镜像
  | 'flip'       // 翻转
  | 'vintage'    // 复古
  | 'cartoon';   // 卡通

/**
 * 视频滤镜选项
 */
export interface VideoFilterOptions {
  /** 滤镜类型 */
  filterType: VideoFilterType;
  /** 强度 (0-2，默认1) */
  intensity?: number;
  /** 自定义滤镜参数 */
  customFilters?: string[];
}

/**
 * 视频滤镜链项
 */
export interface VideoFilterChainItem {
  type: VideoFilterType;
  intensity?: number;
}

/**
 * 字幕预设名称
 */
export type SubtitlePreset = 'default' | 'cinema' | 'minimal' | 'bold';

/**
 * 字幕样式选项
 */
export interface SubtitleStyleOptions {
  /** 字体名称 */
  fontName?: string;
  /** 字体大小 */
  fontSize?: number;
  /** 字体颜色 (十六进制) */
  fontColor?: string;
  /** 描边颜色 */
  outlineColor?: string;
  /** 描边宽度 */
  outlineWidth?: number;
  /** 是否粗体 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
  /** 位置 */
  position?: 'top' | 'middle' | 'bottom';
  /** 垂直边距 */
  marginV?: number;
  /** 阴影深度 */
  shadowDepth?: number;
  /** 发光效果 */
  glowEffect?: boolean;
}

/**
 * 视频转换选项
 */
export interface VideoConvertOptions {
  /** 输出格式 */
  format?: 'mp4' | 'avi' | 'mov' | 'mkv' | 'webm';
  /** 视频编解码器 */
  videoCodec?: 'h264' | 'h265' | 'vp9' | 'av1';
  /** 音频编解码器 */
  audioCodec?: 'aac' | 'mp3' | 'opus' | 'vorbis';
  /** 比特率 */
  bitrate?: string;
  /** 帧率 */
  fps?: number;
  /** 分辨率 */
  resolution?: string;
}

/**
 * 视频裁剪选项
 */
export interface VideoTrimOptions {
  /** 起始时间 (秒) */
  startTime: number;
  /** 结束时间 (秒) */
  endTime?: number;
  /** 持续时间 (秒) */
  duration?: number;
}

/**
 * 视频压缩选项
 */
export interface VideoCompressOptions {
  /** 目标大小 (MB) */
  targetSize?: number;
  /** CRF质量 (0-51，越小质量越高) */
  crf?: number;
  /** 预设 */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
  /** 是否两次编码 */
  twoPass?: boolean;
}

/**
 * 音量调节选项
 */
export interface VolumeAdjustOptions {
  /** 音量级别 (0-2，1为原始音量) */
  volumeLevel: number;
  /** 是否归一化 */
  normalize?: boolean;
  /** 目标响度 (LUFS) */
  targetLoudness?: number;
}

/**
 * 缩略图选项
 */
export interface ThumbnailOptions {
  /** 时间点 (秒) */
  timestamp?: number;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 输出格式 */
  format?: 'jpeg' | 'png';
}

/**
 * 视频合并选项
 */
export interface VideoMergeOptions {
  /** 转场效果 */
  transition?: 'fade' | 'dissolve' | 'wipe' | 'none';
  /** 转场时长 (秒) */
  transitionDuration?: number;
}

/**
 * 视频信息
 */
export interface VideoInfo {
  format: string;
  duration: number;
  bitrate: number;
  size: number;
  streams: VideoStream[];
  metadata?: Record<string, any>;
}

/**
 * 视频流信息
 */
export interface VideoStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle';
  codec_name: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sample_rate?: number;
  channels?: number;
}

/**
 * 视频处理结果
 */
export interface VideoProcessResult {
  success: boolean;
  outputPath?: string;
  duration?: number;
  error?: string;
}

// ==================== 错误恢复类型 ====================

/**
 * 检查点数据
 */
export interface CheckpointData {
  taskId: string;
  progress: number;
  timestamp: number;
  data?: any;
  retryCount?: number;
}

/**
 * 可恢复处理器选项
 */
export interface ResumableProcessorOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟 (毫秒) */
  retryDelay?: number;
  /** 检查点保存间隔 (百分比) */
  checkpointInterval?: number;
  /** 检查点过期时间 (毫秒) */
  checkpointExpiry?: number;
  /** 是否自动清理 */
  autoCleanup?: boolean;
}

/**
 * 处理器函数类型
 */
export type ProcessorFunction = (
  currentProgress: number,
  options: {
    onProgress: (progress: number, data?: any) => Promise<void>;
    checkpoint?: CheckpointData;
  }
) => Promise<any>;

// ==================== 进度发射器类型 ====================

/**
 * 进度发射器选项
 */
export interface ProgressEmitterOptions {
  /** 节流间隔 (毫秒) */
  throttleInterval?: number;
  /** 主窗口对象 */
  mainWindow?: any;
  /** 是否启用IPC转发 */
  enableIPCForwarding?: boolean;
}

/**
 * 任务元数据
 */
export interface TaskMetadata {
  taskId: string;
  title: string;
  description?: string;
  parentTaskId?: string;
  totalSteps?: number;
  estimatedDuration?: number;
}

// ==================== 组件Props类型 ====================

/**
 * ProgressMonitor组件Props
 */
export interface ProgressMonitorProps {
  /** 最多保留的已完成任务数 */
  maxCompletedTasks?: number;
}

/**
 * MediaProcessor组件Props
 */
export interface MediaProcessorProps {
  /** 默认激活的Tab */
  defaultActiveTab?: 'image' | 'audio' | 'ocr';
}

/**
 * VideoEditor组件Props
 */
export interface VideoEditorProps {
  /** 默认激活的Tab */
  defaultActiveTab?: 'filters' | 'audio' | 'subtitles' | 'basic';
}

// ==================== API接口类型 ====================

/**
 * MultimediaAPI类接口
 */
export interface IMultimediaAPI {
  // 图片处理
  uploadImage(
    imagePath: string,
    options?: ImageUploadOptions,
    onProgress?: ProgressCallback
  ): Promise<ImageUploadResult>;

  uploadImages(
    imagePaths: string[],
    options?: ImageUploadOptions,
    onProgress?: ProgressCallback
  ): Promise<ImageUploadResult[]>;

  batchOCR(
    imagePaths: string[],
    options?: OCROptions,
    onProgress?: ProgressCallback
  ): Promise<OCRResult[]>;

  compressImage(
    imagePath: string,
    options?: ImageCompressOptions
  ): Promise<ImageUploadResult>;

  // 音频处理
  transcribeAudio(
    audioPath: string,
    options?: AudioTranscribeOptions,
    onProgress?: ProgressCallback
  ): Promise<AudioTranscribeResult>;

  batchTranscribe(
    audioPaths: string[],
    options?: AudioTranscribeOptions,
    onProgress?: ProgressCallback
  ): Promise<AudioTranscribeResult[]>;

  // 视频处理
  getVideoInfo(videoPath: string): Promise<VideoInfo>;

  applyVideoFilter(
    inputPath: string,
    outputPath: string,
    options?: VideoFilterOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  applyVideoFilterChain(
    inputPath: string,
    outputPath: string,
    filters: VideoFilterChainItem[],
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  extractAudio(
    inputPath: string,
    outputPath: string,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  separateAudioTracks(
    inputPath: string,
    outputDir: string
  ): Promise<{ tracks: string[] }>;

  replaceAudio(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  adjustVolume(
    inputPath: string,
    outputPath: string,
    volumeLevel: number,
    options?: VolumeAdjustOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  addSubtitles(
    inputPath: string,
    subtitlePath: string,
    outputPath: string,
    options?: SubtitleStyleOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  addSubtitlesWithPreset(
    inputPath: string,
    subtitlePath: string,
    outputPath: string,
    presetName: SubtitlePreset,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  convertVideo(
    inputPath: string,
    outputPath: string,
    options?: VideoConvertOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  trimVideo(
    inputPath: string,
    outputPath: string,
    options: VideoTrimOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  compressVideo(
    inputPath: string,
    outputPath: string,
    options?: VideoCompressOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;

  generateThumbnail(
    inputPath: string,
    outputPath: string,
    options?: ThumbnailOptions
  ): Promise<VideoProcessResult>;

  mergeVideos(
    videoPaths: string[],
    outputPath: string,
    options?: VideoMergeOptions,
    onProgress?: ProgressCallback
  ): Promise<VideoProcessResult>;
}

// ==================== 工具类型 ====================

/**
 * 深度只读类型
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * 深度部分类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 提取Promise返回类型
 */
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

/**
 * 函数参数类型
 */
export type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never;

/**
 * 函数返回类型
 */
export type FunctionReturn<T> = T extends (...args: any[]) => infer R ? R : never;
