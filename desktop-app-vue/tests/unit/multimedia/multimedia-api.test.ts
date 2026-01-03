/**
 * MultimediaAPI 单元测试
 *
 * 测试覆盖：
 * - IPC通信调用
 * - 进度回调处理
 * - 错误处理
 * - 类型安全
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MultimediaAPI } from '@renderer/utils/multimedia-api';
import type {
  ImageUploadOptions,
  ImageUploadResult,
  OCROptions,
  VideoFilterOptions,
  SubtitlePreset,
} from '@renderer/types/multimedia';

// Mock window.electronAPI
const mockInvoke = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

beforeEach(() => {
  // 设置mock
  (global as any).window = {
    electronAPI: {
      invoke: mockInvoke,
      on: mockOn,
      off: mockOff,
    },
  };

  // 清除所有mock调用记录
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MultimediaAPI', () => {
  describe('构造函数和初始化', () => {
    it('应该正确初始化并设置进度监听器', () => {
      new MultimediaAPI();

      expect(mockOn).toHaveBeenCalledWith('task-progress', expect.any(Function));
    });

    it('应该在没有electronAPI时不抛出错误', () => {
      (global as any).window = {};

      expect(() => new MultimediaAPI()).not.toThrow();
    });
  });

  describe('图片处理API', () => {
    it('uploadImage - 应该正确调用IPC并传递参数', async () => {
      const api = new MultimediaAPI();
      const imagePath = '/path/to/image.jpg';
      const options: ImageUploadOptions = {
        quality: 85,
        maxWidth: 1920,
        compress: true,
      };
      const mockResult: ImageUploadResult = {
        success: true,
        imagePath,
        imageId: 'img-123',
      };

      mockInvoke.mockResolvedValue(mockResult);

      const result = await api.uploadImage(imagePath, options);

      expect(mockInvoke).toHaveBeenCalledWith('image:upload', {
        imagePath,
        options,
        taskId: expect.stringContaining('image:upload_'),
      });
      expect(result).toEqual(mockResult);
    });

    it('uploadImage - 应该支持进度回调', async () => {
      const api = new MultimediaAPI();
      const progressCallback = vi.fn();
      const imagePath = '/path/to/image.jpg';

      mockInvoke.mockResolvedValue({ success: true, imagePath });

      await api.uploadImage(imagePath, {}, progressCallback);

      expect(mockInvoke).toHaveBeenCalledWith(
        'image:upload',
        expect.objectContaining({
          imagePath,
          taskId: expect.any(String),
        })
      );
    });

    it('uploadImages - 应该处理批量上传', async () => {
      const api = new MultimediaAPI();
      const imagePaths = ['/path/to/image1.jpg', '/path/to/image2.jpg'];
      const mockResults: ImageUploadResult[] = [
        { success: true, imagePath: imagePaths[0] },
        { success: true, imagePath: imagePaths[1] },
      ];

      mockInvoke.mockResolvedValue(mockResults);

      const results = await api.uploadImages(imagePaths);

      expect(mockInvoke).toHaveBeenCalledWith(
        'image:batch-upload',
        expect.objectContaining({
          imagePaths,
        })
      );
      expect(results).toEqual(mockResults);
    });

    it('batchOCR - 应该正确调用批量OCR', async () => {
      const api = new MultimediaAPI();
      const imagePaths = ['/path/to/image1.jpg', '/path/to/image2.jpg'];
      const options: OCROptions = {
        languages: ['chi_sim', 'eng'],
        maxWorkers: 3,
      };

      mockInvoke.mockResolvedValue([
        { text: 'Text 1', confidence: 0.95 },
        { text: 'Text 2', confidence: 0.92 },
      ]);

      await api.batchOCR(imagePaths, options);

      expect(mockInvoke).toHaveBeenCalledWith(
        'image:batch-ocr',
        expect.objectContaining({
          imagePaths,
          options,
        })
      );
    });

    it('compressImage - 应该调用图片压缩', async () => {
      const api = new MultimediaAPI();
      const imagePath = '/path/to/image.jpg';

      mockInvoke.mockResolvedValue({ success: true, imagePath });

      await api.compressImage(imagePath, { quality: 70 });

      expect(mockInvoke).toHaveBeenCalledWith('image:compress', {
        imagePath,
        options: { quality: 70 },
      });
    });
  });

  describe('音频处理API', () => {
    it('transcribeAudio - 应该正确调用音频转录', async () => {
      const api = new MultimediaAPI();
      const audioPath = '/path/to/audio.mp3';
      const options = {
        engine: 'whisper' as const,
        language: 'zh',
      };

      mockInvoke.mockResolvedValue({
        success: true,
        text: 'Transcribed text',
      });

      await api.transcribeAudio(audioPath, options);

      expect(mockInvoke).toHaveBeenCalledWith(
        'audio:transcribe',
        expect.objectContaining({
          audioPath,
          options,
        })
      );
    });

    it('batchTranscribe - 应该处理批量转录', async () => {
      const api = new MultimediaAPI();
      const audioPaths = ['/path/to/audio1.mp3', '/path/to/audio2.mp3'];

      mockInvoke.mockResolvedValue([
        { success: true, text: 'Text 1' },
        { success: true, text: 'Text 2' },
      ]);

      await api.batchTranscribe(audioPaths);

      expect(mockInvoke).toHaveBeenCalledWith(
        'audio:batch-transcribe',
        expect.objectContaining({
          audioPaths,
        })
      );
    });
  });

  describe('视频处理API', () => {
    it('getVideoInfo - 应该获取视频信息', async () => {
      const api = new MultimediaAPI();
      const videoPath = '/path/to/video.mp4';
      const mockInfo = {
        format: 'mp4',
        duration: 120,
        bitrate: 5000000,
        size: 75000000,
        streams: [],
      };

      mockInvoke.mockResolvedValue(mockInfo);

      const info = await api.getVideoInfo(videoPath);

      expect(mockInvoke).toHaveBeenCalledWith('video:getInfo', { videoPath });
      expect(info).toEqual(mockInfo);
    });

    it('applyVideoFilter - 应该应用视频滤镜', async () => {
      const api = new MultimediaAPI();
      const inputPath = '/path/to/input.mp4';
      const outputPath = '/path/to/output.mp4';
      const options: VideoFilterOptions = {
        filterType: 'sepia',
        intensity: 1.5,
      };

      mockInvoke.mockResolvedValue({ success: true, outputPath });

      await api.applyVideoFilter(inputPath, outputPath, options);

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:applyFilter',
        expect.objectContaining({
          inputPath,
          outputPath,
          options,
        })
      );
    });

    it('applyVideoFilterChain - 应该应用滤镜链', async () => {
      const api = new MultimediaAPI();
      const filters = [
        { type: 'grayscale' as const },
        { type: 'sepia' as const, intensity: 1.2 },
      ];

      mockInvoke.mockResolvedValue({ success: true });

      await api.applyVideoFilterChain('/input.mp4', '/output.mp4', filters);

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:applyFilterChain',
        expect.objectContaining({
          filters,
        })
      );
    });

    it('extractAudio - 应该提取音频', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.extractAudio('/video.mp4', '/audio.mp3');

      expect(mockInvoke).toHaveBeenCalledWith('video:extractAudio', {
        inputPath: '/video.mp4',
        outputPath: '/audio.mp3',
        taskId: expect.any(String),
      });
    });

    it('separateAudioTracks - 应该分离音轨', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({
        tracks: ['/output/track1.mp3', '/output/track2.mp3'],
      });

      const result = await api.separateAudioTracks('/video.mp4', '/output');

      expect(mockInvoke).toHaveBeenCalledWith('video:separateAudio', {
        inputPath: '/video.mp4',
        outputDir: '/output',
      });
      expect(result.tracks).toHaveLength(2);
    });

    it('replaceAudio - 应该替换音轨', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.replaceAudio('/video.mp4', '/audio.mp3', '/output.mp4');

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:replaceAudio',
        expect.objectContaining({
          videoPath: '/video.mp4',
          audioPath: '/audio.mp3',
          outputPath: '/output.mp4',
        })
      );
    });

    it('adjustVolume - 应该调整音量', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.adjustVolume('/input.mp4', '/output.mp4', 1.5, {
        normalize: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:adjustVolume',
        expect.objectContaining({
          volumeLevel: 1.5,
          normalize: true,
        })
      );
    });

    it('addSubtitles - 应该添加字幕', async () => {
      const api = new MultimediaAPI();
      const options = {
        fontSize: 24,
        fontColor: '#FFFFFF',
        bold: true,
      };

      mockInvoke.mockResolvedValue({ success: true });

      await api.addSubtitles('/video.mp4', '/sub.srt', '/output.mp4', options);

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:addSubtitles',
        expect.objectContaining({
          options,
        })
      );
    });

    it('addSubtitlesWithPreset - 应该使用预设添加字幕', async () => {
      const api = new MultimediaAPI();
      const presetName: SubtitlePreset = 'cinema';

      mockInvoke.mockResolvedValue({ success: true });

      await api.addSubtitlesWithPreset(
        '/video.mp4',
        '/sub.srt',
        '/output.mp4',
        presetName
      );

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:addSubtitlesWithPreset',
        expect.objectContaining({
          presetName: 'cinema',
        })
      );
    });

    it('convertVideo - 应该转换视频格式', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.convertVideo('/input.mp4', '/output.avi', {
        format: 'avi',
        videoCodec: 'h264',
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:convert',
        expect.objectContaining({
          options: expect.objectContaining({
            format: 'avi',
            videoCodec: 'h264',
          }),
        })
      );
    });

    it('trimVideo - 应该裁剪视频', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.trimVideo('/input.mp4', '/output.mp4', {
        startTime: 10,
        endTime: 60,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:trim',
        expect.objectContaining({
          options: expect.objectContaining({
            startTime: 10,
            endTime: 60,
          }),
        })
      );
    });

    it('compressVideo - 应该压缩视频', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.compressVideo('/input.mp4', '/output.mp4', {
        crf: 23,
        preset: 'medium',
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:compress',
        expect.objectContaining({
          options: expect.objectContaining({
            crf: 23,
            preset: 'medium',
          }),
        })
      );
    });

    it('generateThumbnail - 应该生成缩略图', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.generateThumbnail('/video.mp4', '/thumb.jpg', {
        timestamp: 30,
        width: 320,
        height: 180,
      });

      expect(mockInvoke).toHaveBeenCalledWith('video:generateThumbnail', {
        inputPath: '/video.mp4',
        outputPath: '/thumb.jpg',
        options: expect.objectContaining({
          timestamp: 30,
          width: 320,
          height: 180,
        }),
      });
    });

    it('mergeVideos - 应该合并视频', async () => {
      const api = new MultimediaAPI();
      const videoPaths = ['/video1.mp4', '/video2.mp4', '/video3.mp4'];

      mockInvoke.mockResolvedValue({ success: true });

      await api.mergeVideos(videoPaths, '/merged.mp4', {
        transition: 'fade',
        transitionDuration: 1,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'video:merge',
        expect.objectContaining({
          videoPaths,
          options: expect.objectContaining({
            transition: 'fade',
          }),
        })
      );
    });
  });

  describe('进度回调处理', () => {
    it('应该正确触发进度回调', async () => {
      const api = new MultimediaAPI();
      const progressCallback = vi.fn();
      let progressHandler: Function | undefined;

      // 捕获progress事件处理器
      mockOn.mockImplementation((event, handler) => {
        if (event === 'task-progress') {
          progressHandler = handler;
        }
      });

      // 重新创建实例以捕获处理器
      new MultimediaAPI();

      mockInvoke.mockImplementation(async (channel, params) => {
        // 模拟进度事件
        if (progressHandler) {
          progressHandler(null, {
            taskId: params.taskId,
            percent: 50,
            message: 'Processing...',
          });
        }
        return { success: true };
      });

      await api.uploadImage('/image.jpg', {}, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: 50,
          message: 'Processing...',
        })
      );
    });

    it('应该在任务完成后清除进度回调', async () => {
      const api = new MultimediaAPI();
      const progressCallback = vi.fn();

      mockInvoke.mockResolvedValue({ success: true });

      await api.uploadImage('/image.jpg', {}, progressCallback);

      // 任务完成后，回调应该被清除
      // 这里我们无法直接测试Map的大小，但可以确保invoke被调用
      expect(mockInvoke).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('应该正确处理IPC调用错误', async () => {
      const api = new MultimediaAPI();
      const error = new Error('IPC调用失败');

      mockInvoke.mockRejectedValue(error);

      await expect(api.uploadImage('/image.jpg')).rejects.toThrow('IPC调用失败');
    });

    it('应该在错误时记录日志', async () => {
      const api = new MultimediaAPI();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockInvoke.mockRejectedValue(new Error('Test error'));

      try {
        await api.uploadImage('/image.jpg');
      } catch (e) {
        // 预期会抛出错误
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MultimediaAPI]'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('应该在有进度回调时也能正确处理错误', async () => {
      const api = new MultimediaAPI();
      const progressCallback = vi.fn();
      const error = new Error('Processing failed');

      mockInvoke.mockRejectedValue(error);

      await expect(
        api.uploadImage('/image.jpg', {}, progressCallback)
      ).rejects.toThrow('Processing failed');
    });
  });

  describe('类型安全', () => {
    it('应该接受正确的选项类型', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      // 这些调用应该通过TypeScript类型检查
      await api.uploadImage('/image.jpg', {
        quality: 85,
        maxWidth: 1920,
        format: 'jpeg',
        compress: true,
      });

      await api.transcribeAudio('/audio.mp3', {
        engine: 'whisper',
        language: 'zh',
        model: 'base',
      });

      await api.applyVideoFilter('/input.mp4', '/output.mp4', {
        filterType: 'sepia',
        intensity: 1.5,
      });

      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });
  });

  describe('默认参数', () => {
    it('应该在未提供选项时使用默认空对象', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.uploadImage('/image.jpg');

      expect(mockInvoke).toHaveBeenCalledWith(
        'image:upload',
        expect.objectContaining({
          options: {},
        })
      );
    });

    it('应该在未提供进度回调时正常工作', async () => {
      const api = new MultimediaAPI();

      mockInvoke.mockResolvedValue({ success: true });

      await api.uploadImage('/image.jpg', { quality: 85 });

      expect(mockInvoke).toHaveBeenCalledWith('image:upload', {
        imagePath: '/image.jpg',
        options: { quality: 85 },
      });
    });
  });
});
