/**
 * TypeScript类型定义测试
 *
 * 这个文件通过TypeScript编译器验证类型定义的正确性
 * 如果类型定义有问题，编译时会报错
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  // 进度相关
  TaskStage,
  ProgressCallback,
  ProgressData,
  TaskTracker,
  // 图片处理
  ImageUploadOptions,
  ImageUploadResult,
  OCROptions,
  OCRResult,
  ImageMetadata,
  // 音频处理
  AudioTranscribeOptions,
  AudioTranscribeResult,
  TranscriptSegment,
  // 视频处理
  VideoFilterType,
  VideoFilterOptions,
  VideoFilterChainItem,
  SubtitlePreset,
  SubtitleStyleOptions,
  VideoInfo,
  VideoProcessResult,
  // API
  IMultimediaAPI,
} from '@renderer/types/multimedia';

describe('Multimedia类型定义', () => {
  describe('进度相关类型', () => {
    it('TaskStage应该是联合类型', () => {
      expectTypeOf<TaskStage>().toEqualTypeOf<
        | 'pending'
        | 'preparing'
        | 'processing'
        | 'finalizing'
        | 'completed'
        | 'failed'
        | 'cancelled'
      >();
    });

    it('ProgressCallback应该是正确的函数类型', () => {
      expectTypeOf<ProgressCallback>().toBeFunction();
      expectTypeOf<ProgressCallback>().parameters.toEqualTypeOf<[ProgressData]>();
      expectTypeOf<ProgressCallback>().returns.toEqualTypeOf<void>();
    });

    it('ProgressData应该包含所有必需字段', () => {
      expectTypeOf<ProgressData>().toHaveProperty('taskId').toBeString();
      expectTypeOf<ProgressData>().toHaveProperty('percent').toBeNumber();
      expectTypeOf<ProgressData>().toHaveProperty('stage').toEqualTypeOf<TaskStage>();
    });

    it('TaskTracker应该有所有必需方法', () => {
      expectTypeOf<TaskTracker>().toHaveProperty('step').toBeFunction();
      expectTypeOf<TaskTracker>().toHaveProperty('setPercent').toBeFunction();
      expectTypeOf<TaskTracker>().toHaveProperty('complete').toBeFunction();
      expectTypeOf<TaskTracker>().toHaveProperty('error').toBeFunction();
    });
  });

  describe('图片处理类型', () => {
    it('ImageUploadOptions应该有可选字段', () => {
      expectTypeOf<ImageUploadOptions>().toMatchTypeOf<{
        quality?: number;
        maxWidth?: number;
        compress?: boolean;
      }>();
    });

    it('ImageUploadResult应该包含必需字段', () => {
      expectTypeOf<ImageUploadResult>().toHaveProperty('success').toBeBoolean();
      expectTypeOf<ImageUploadResult>().toHaveProperty('imagePath').toBeString();
    });

    it('OCROptions languages应该是字符串数组', () => {
      expectTypeOf<OCROptions>().toMatchTypeOf<{
        languages?: string[];
      }>();
    });

    it('OCRResult应该有text和confidence', () => {
      expectTypeOf<OCRResult>().toHaveProperty('text').toBeString();
      expectTypeOf<OCRResult>().toHaveProperty('confidence').toBeNumber();
    });

    it('ImageMetadata应该有尺寸信息', () => {
      expectTypeOf<ImageMetadata>().toHaveProperty('width').toBeNumber();
      expectTypeOf<ImageMetadata>().toHaveProperty('height').toBeNumber();
      expectTypeOf<ImageMetadata>().toHaveProperty('format').toBeString();
    });
  });

  describe('音频处理类型', () => {
    it('AudioTranscribeOptions engine应该是联合类型', () => {
      expectTypeOf<AudioTranscribeOptions>().toMatchTypeOf<{
        engine?: 'whisper' | 'azure' | 'google' | 'baidu';
      }>();
    });

    it('AudioTranscribeOptions model应该是联合类型', () => {
      expectTypeOf<AudioTranscribeOptions>().toMatchTypeOf<{
        model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
      }>();
    });

    it('AudioTranscribeResult应该有text字段', () => {
      expectTypeOf<AudioTranscribeResult>().toHaveProperty('text').toBeString();
      expectTypeOf<AudioTranscribeResult>().toHaveProperty('success').toBeBoolean();
    });

    it('TranscriptSegment应该有时间戳', () => {
      expectTypeOf<TranscriptSegment>().toHaveProperty('start').toBeNumber();
      expectTypeOf<TranscriptSegment>().toHaveProperty('end').toBeNumber();
      expectTypeOf<TranscriptSegment>().toHaveProperty('text').toBeString();
    });
  });

  describe('视频处理类型', () => {
    it('VideoFilterType应该包含所有滤镜类型', () => {
      expectTypeOf<VideoFilterType>().toEqualTypeOf<
        | 'blur'
        | 'sharpen'
        | 'grayscale'
        | 'sepia'
        | 'vignette'
        | 'brightness'
        | 'contrast'
        | 'saturation'
        | 'negative'
        | 'mirror'
        | 'flip'
        | 'vintage'
        | 'cartoon'
      >();
    });

    it('VideoFilterOptions应该有filterType字段', () => {
      expectTypeOf<VideoFilterOptions>().toHaveProperty('filterType').toEqualTypeOf<VideoFilterType>();
    });

    it('VideoFilterChainItem应该有type字段', () => {
      expectTypeOf<VideoFilterChainItem>().toHaveProperty('type').toEqualTypeOf<VideoFilterType>();
      expectTypeOf<VideoFilterChainItem>().toMatchTypeOf<{
        intensity?: number;
      }>();
    });

    it('SubtitlePreset应该是联合类型', () => {
      expectTypeOf<SubtitlePreset>().toEqualTypeOf<
        'default' | 'cinema' | 'minimal' | 'bold'
      >();
    });

    it('SubtitleStyleOptions应该有字体选项', () => {
      expectTypeOf<SubtitleStyleOptions>().toMatchTypeOf<{
        fontName?: string;
        fontSize?: number;
        fontColor?: string;
        bold?: boolean;
      }>();
    });

    it('VideoInfo应该有duration和format', () => {
      expectTypeOf<VideoInfo>().toHaveProperty('duration').toBeNumber();
      expectTypeOf<VideoInfo>().toHaveProperty('format').toBeString();
      expectTypeOf<VideoInfo>().toHaveProperty('streams').toBeArray();
    });

    it('VideoProcessResult应该有success字段', () => {
      expectTypeOf<VideoProcessResult>().toHaveProperty('success').toBeBoolean();
    });
  });

  describe('MultimediaAPI接口', () => {
    it('uploadImage应该返回Promise<ImageUploadResult>', () => {
      expectTypeOf<IMultimediaAPI['uploadImage']>()
        .returns.toEqualTypeOf<Promise<ImageUploadResult>>();
    });

    it('uploadImage应该接受正确的参数', () => {
      expectTypeOf<IMultimediaAPI['uploadImage']>()
        .parameters.toEqualTypeOf<
          [string, ImageUploadOptions?, ProgressCallback?]
        >();
    });

    it('batchOCR应该返回OCR结果数组', () => {
      expectTypeOf<IMultimediaAPI['batchOCR']>()
        .returns.toEqualTypeOf<Promise<OCRResult[]>>();
    });

    it('transcribeAudio应该返回转录结果', () => {
      expectTypeOf<IMultimediaAPI['transcribeAudio']>()
        .returns.toEqualTypeOf<Promise<AudioTranscribeResult>>();
    });

    it('getVideoInfo应该返回视频信息', () => {
      expectTypeOf<IMultimediaAPI['getVideoInfo']>()
        .returns.toEqualTypeOf<Promise<VideoInfo>>();
    });

    it('applyVideoFilter应该接受滤镜选项', () => {
      expectTypeOf<IMultimediaAPI['applyVideoFilter']>()
        .parameters.toMatchTypeOf<
          [string, string, VideoFilterOptions?, ProgressCallback?]
        >();
    });

    it('addSubtitlesWithPreset应该接受预设名称', () => {
      expectTypeOf<IMultimediaAPI['addSubtitlesWithPreset']>()
        .parameter(3)
        .toEqualTypeOf<SubtitlePreset>();
    });
  });

  describe('类型兼容性', () => {
    it('ProgressData应该能用于进度回调', () => {
      const progressData: ProgressData = {
        taskId: 'task-1',
        percent: 50,
        stage: 'processing',
      };

      const callback: ProgressCallback = (data) => {
        expectTypeOf(data).toEqualTypeOf<ProgressData>();
      };

      callback(progressData);
    });

    it('ImageUploadOptions应该能用于API调用', () => {
      const options: ImageUploadOptions = {
        quality: 85,
        maxWidth: 1920,
        format: 'jpeg',
        compress: true,
      };

      expectTypeOf(options).toMatchTypeOf<ImageUploadOptions>();
    });

    it('VideoFilterChainItem数组应该能用于滤镜链', () => {
      const filters: VideoFilterChainItem[] = [
        { type: 'grayscale' },
        { type: 'sepia', intensity: 1.5 },
      ];

      expectTypeOf(filters).toEqualTypeOf<VideoFilterChainItem[]>();
    });
  });

  describe('可选属性', () => {
    it('ProgressData应该允许省略可选字段', () => {
      const minimalData: ProgressData = {
        taskId: 'task-1',
        percent: 0,
        stage: 'pending',
      };

      expectTypeOf(minimalData).toMatchTypeOf<ProgressData>();
    });

    it('ImageUploadOptions应该允许空对象', () => {
      const emptyOptions: ImageUploadOptions = {};
      expectTypeOf(emptyOptions).toMatchTypeOf<ImageUploadOptions>();
    });

    it('VideoFilterOptions应该要求filterType', () => {
      // @ts-expect-error - filterType是必需的
      const invalidOptions: VideoFilterOptions = {
        intensity: 1.5,
      };
    });
  });

  describe('类型推断', () => {
    it('应该能从函数返回值推断类型', () => {
      const mockAPI = {} as IMultimediaAPI;

      const imageResult = mockAPI.uploadImage('/path');
      expectTypeOf(imageResult).toEqualTypeOf<Promise<ImageUploadResult>>();

      const videoInfo = mockAPI.getVideoInfo('/video.mp4');
      expectTypeOf(videoInfo).toEqualTypeOf<Promise<VideoInfo>>();
    });

    it('应该能从数组推断元素类型', () => {
      const filters: VideoFilterChainItem[] = [];

      expectTypeOf(filters[0]).toMatchTypeOf<VideoFilterChainItem | undefined>();
    });

    it('ProgressCallback应该能推断参数类型', () => {
      const callback: ProgressCallback = (data) => {
        expectTypeOf(data.taskId).toBeString();
        expectTypeOf(data.percent).toBeNumber();
        expectTypeOf(data.stage).toEqualTypeOf<TaskStage>();
      };
    });
  });

  describe('联合类型约束', () => {
    it('TaskStage应该只接受预定义的值', () => {
      const validStage: TaskStage = 'processing';
      expectTypeOf(validStage).toEqualTypeOf<TaskStage>();

      // @ts-expect-error - 无效的阶段
      const invalidStage: TaskStage = 'invalid';
    });

    it('VideoFilterType应该只接受预定义的滤镜', () => {
      const validFilter: VideoFilterType = 'sepia';
      expectTypeOf(validFilter).toEqualTypeOf<VideoFilterType>();

      // @ts-expect-error - 无效的滤镜类型
      const invalidFilter: VideoFilterType = 'nonexistent';
    });

    it('SubtitlePreset应该只接受预定义的预设', () => {
      const validPreset: SubtitlePreset = 'cinema';
      expectTypeOf(validPreset).toEqualTypeOf<SubtitlePreset>();

      // @ts-expect-error - 无效的预设
      const invalidPreset: SubtitlePreset = 'custom';
    });
  });
});
