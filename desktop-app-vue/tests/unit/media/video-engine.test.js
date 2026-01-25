/**
 * 视频引擎测试
 * 测试 视频转换、剪辑、合并、字幕生成等功能
 *
 * 注意: 这些测试需要 ffmpeg 安装在系统中
 * 如果 ffmpeg 不可用，测试将被跳过
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { execSync } from "child_process";

// 检查 ffmpeg 是否可用
let ffmpegAvailable = false;
try {
  execSync("ffmpeg -version", { stdio: "ignore" });
  ffmpegAvailable = true;
} catch (error) {
  console.warn(
    "[Video Engine Test] FFmpeg not found, skipping video engine tests",
  );
}

// Mock dependencies - More robust mock with both named and default exports
vi.mock("fluent-ffmpeg", async () => {
  const createMockCommand = () => {
    const cmd = {
      output: vi.fn().mockReturnThis(),
      videoCodec: vi.fn().mockReturnThis(),
      videoBitrate: vi.fn().mockReturnThis(),
      audioBitrate: vi.fn().mockReturnThis(),
      format: vi.fn().mockReturnThis(),
      fps: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      run: vi.fn(),
      setStartTime: vi.fn().mockReturnThis(),
      setDuration: vi.fn().mockReturnThis(),
      inputOptions: vi.fn().mockReturnThis(),
      input: vi.fn().mockReturnThis(),
      outputOptions: vi.fn().mockReturnThis(),
      videoFilters: vi.fn().mockReturnThis(),
      noVideo: vi.fn().mockReturnThis(),
      audioCodec: vi.fn().mockReturnThis(),
      audioChannels: vi.fn().mockReturnThis(),
      size: vi.fn().mockReturnThis(),
      screenshots: vi.fn().mockReturnThis(),
      mergeToFile: vi.fn(),
    };

    // Simulate async events
    cmd.run.mockImplementation(() => {
      setTimeout(() => {
        const endHandler = cmd.on.mock.calls.find(
          (call) => call[0] === "end",
        )?.[1];
        if (endHandler) {
          endHandler();
        }
      }, 0);
      return cmd;
    });

    // Mock mergeToFile for video merging
    cmd.mergeToFile.mockImplementation((outputPath, tempDir) => {
      setTimeout(() => {
        const endHandler = cmd.on.mock.calls.find(
          (call) => call[0] === "end",
        )?.[1];
        if (endHandler) {
          endHandler();
        }
      }, 0);
      return cmd;
    });

    return cmd;
  };

  const mockFfmpeg = vi.fn((input) => createMockCommand());

  mockFfmpeg.ffprobe = vi.fn((path, callback) => {
    // Simulate successful ffprobe
    setTimeout(() => {
      callback(null, {
        format: {
          duration: 120,
          size: 10485760,
          bit_rate: 700000,
          format_name: "mp4,mov,m4a",
        },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            r_frame_rate: "30/1",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            sample_rate: 48000,
            channels: 2,
          },
        ],
      });
    }, 0);
  });

  return { default: mockFfmpeg };
});

vi.mock("fs", () => ({
  default: {
    promises: {
      writeFile: vi.fn(),
      unlink: vi.fn(),
    },
  },
  promises: {
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

describe.skipIf(!ffmpegAvailable)("视频引擎测试", () => {
  let VideoEngine, getVideoEngine;
  let videoEngine;
  let mockFfmpeg;
  let mockFs;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset module cache to clear singleton
    vi.resetModules();

    mockFfmpeg = (await import("fluent-ffmpeg")).default;
    mockFs = await import("fs");

    // Import VideoEngine after mocks and reset
    const module = await import("../../../src/main/engines/video-engine.js");
    VideoEngine = module.VideoEngine;
    getVideoEngine = module.getVideoEngine;

    videoEngine = new VideoEngine();

    // Setup default mock behaviors
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    mockFs.promises.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("基础功能", () => {
    it("should create VideoEngine instance", () => {
      expect(videoEngine).toBeDefined();
      expect(videoEngine).toBeInstanceOf(EventEmitter);
    });

    it("should have supported formats", () => {
      expect(videoEngine.supportedFormats).toEqual([
        "mp4",
        "avi",
        "mov",
        "mkv",
        "flv",
        "webm",
        "wmv",
      ]);
    });

    it("should have supported subtitle formats", () => {
      expect(videoEngine.supportedSubtitleFormats).toEqual([
        "srt",
        "ass",
        "vtt",
      ]);
    });

    it("should have preset configurations", () => {
      expect(videoEngine.presets["1080p"]).toEqual({
        width: 1920,
        height: 1080,
        videoBitrate: "5000k",
        audioBitrate: "192k",
      });

      expect(videoEngine.presets["720p"]).toBeDefined();
      expect(videoEngine.presets["480p"]).toBeDefined();
    });

    it("should have all required methods", () => {
      expect(typeof videoEngine.handleProjectTask).toBe("function");
      expect(typeof videoEngine.convertFormat).toBe("function");
      expect(typeof videoEngine.trimVideo).toBe("function");
      expect(typeof videoEngine.mergeVideos).toBe("function");
      expect(typeof videoEngine.addSubtitles).toBe("function");
      expect(typeof videoEngine.extractAudio).toBe("function");
      expect(typeof videoEngine.generateThumbnail).toBe("function");
      expect(typeof videoEngine.compressVideo).toBe("function");
      expect(typeof videoEngine.getVideoInfo).toBe("function");
    });
  });

  describe("convertFormat", () => {
    it("should convert video format", async () => {
      const result = await videoEngine.convertFormat(
        "/input.avi",
        "/output.mp4",
        { format: "mp4", videoBitrate: "2000k", audioBitrate: "128k" },
      );

      expect(mockFfmpeg).toHaveBeenCalledWith("/input.avi");

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.output).toHaveBeenCalledWith("/output.mp4");
      expect(cmd.videoCodec).toHaveBeenCalledWith("libx264");
      expect(cmd.videoBitrate).toHaveBeenCalledWith("2000k");
      expect(cmd.audioBitrate).toHaveBeenCalledWith("128k");
      expect(cmd.format).toHaveBeenCalledWith("mp4");

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe("/output.mp4");
      expect(result.format).toBe("mp4");
    });

    it("should support custom FPS", async () => {
      await videoEngine.convertFormat("/input.mov", "/output.mp4", {
        fps: 24,
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.fps).toHaveBeenCalledWith(24);
    });

    it("should support custom codec", async () => {
      await videoEngine.convertFormat("/input.avi", "/output.webm", {
        codec: "libvpx",
        format: "webm",
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.videoCodec).toHaveBeenCalledWith("libvpx");
    });

    it("should call progress callback", async () => {
      const onProgress = vi.fn();

      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "progress") {
          handler({ percent: 50 });
        } else if (event === "end") {
          setTimeout(handler, 0);
        }
        return cmd;
      });

      await videoEngine.convertFormat(
        "/input.avi",
        "/output.mp4",
        {},
        onProgress,
      );

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 50 }),
      );
    });

    it("should handle conversion errors", async () => {
      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "error") {
          setTimeout(() => handler(new Error("Conversion failed")), 0);
        }
        return cmd;
      });

      await expect(
        videoEngine.convertFormat("/input.avi", "/output.mp4"),
      ).rejects.toThrow();
    });
  });

  describe("trimVideo", () => {
    it("should trim video by duration", async () => {
      const result = await videoEngine.trimVideo("/input.mp4", "/output.mp4", {
        startTime: "00:00:10",
        duration: "00:00:30",
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.setStartTime).toHaveBeenCalledWith("00:00:10");
      expect(cmd.setDuration).toHaveBeenCalledWith("00:00:30");

      expect(result.success).toBe(true);
      expect(result.startTime).toBe("00:00:10");
      expect(result.duration).toBe("00:00:30");
    });

    it("should trim video by end time", async () => {
      const result = await videoEngine.trimVideo("/input.mp4", "/output.mp4", {
        startTime: "00:00:05",
        endTime: "00:01:00",
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.setStartTime).toHaveBeenCalledWith("00:00:05");
      expect(cmd.inputOptions).toHaveBeenCalledWith(["-to 00:01:00"]);

      expect(result.success).toBe(true);
    });

    it("should call progress callback", async () => {
      const onProgress = vi.fn();

      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "progress") {
          handler({ percent: 75 });
        } else if (event === "end") {
          setTimeout(handler, 0);
        }
        return cmd;
      });

      await videoEngine.trimVideo(
        "/input.mp4",
        "/output.mp4",
        { startTime: "00:00:00", duration: "00:00:10" },
        onProgress,
      );

      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe("mergeVideos", () => {
    it("should merge multiple videos", async () => {
      const videoList = ["/video1.mp4", "/video2.mp4", "/video3.mp4"];

      const result = await videoEngine.mergeVideos(videoList, "/merged.mp4");

      expect(mockFs.promises.writeFile).toHaveBeenCalled();
      expect(mockFs.promises.unlink).toHaveBeenCalled(); // Clean up temp file

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.inputOptions).toHaveBeenCalledWith(["-f concat", "-safe 0"]);
      expect(cmd.outputOptions).toHaveBeenCalledWith("-c copy");

      expect(result.success).toBe(true);
      expect(result.videoCount).toBe(3);
    });

    it("should create concat list file", async () => {
      const videoList = ["/video1.mp4", "/video2.mp4"];

      await videoEngine.mergeVideos(videoList, "/output/merged.mp4");

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("concat_list.txt"),
        expect.stringContaining("/video1.mp4"),
        "utf-8",
      );
    });

    it("should clean up temp file even on error", async () => {
      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "error") {
          setTimeout(() => handler(new Error("Merge failed")), 0);
        }
        return cmd;
      });

      await expect(
        videoEngine.mergeVideos(["/v1.mp4", "/v2.mp4"], "/out.mp4"),
      ).rejects.toThrow();

      expect(mockFs.promises.unlink).toHaveBeenCalled();
    });
  });

  describe("addSubtitles", () => {
    it("should add subtitles to video", async () => {
      const result = await videoEngine.addSubtitles(
        "/input.mp4",
        "/subtitles.srt",
        "/output.mp4",
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.videoFilters).toHaveBeenCalled();

      expect(result.success).toBe(true);
    });

    it("should support custom subtitle styling", async () => {
      await videoEngine.addSubtitles(
        "/input.mp4",
        "/subtitles.srt",
        "/output.mp4",
        {
          fontName: "Arial",
          fontSize: 28,
          fontColor: "yellow",
        },
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.videoFilters).toHaveBeenCalled();
    });

    it("should handle Windows paths correctly", async () => {
      await videoEngine.addSubtitles(
        "C:\\Videos\\input.mp4",
        "C:\\Subtitles\\sub.srt",
        "C:\\Output\\output.mp4",
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      const filterCall = cmd.videoFilters.mock.calls[0][0];

      // Check that backslashes are escaped
      expect(filterCall[0].options.filename).toBeDefined();
    });
  });

  describe("extractAudio", () => {
    it("should extract audio from video", async () => {
      const result = await videoEngine.extractAudio(
        "/input.mp4",
        "/audio.mp3",
        { format: "mp3", bitrate: "192k" },
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.noVideo).toHaveBeenCalled();
      expect(cmd.audioCodec).toHaveBeenCalledWith("libmp3lame");
      expect(cmd.audioBitrate).toHaveBeenCalledWith("192k");
      expect(cmd.format).toHaveBeenCalledWith("mp3");

      expect(result.success).toBe(true);
      expect(result.format).toBe("mp3");
    });

    it("should support custom channels", async () => {
      await videoEngine.extractAudio("/input.mp4", "/audio.mp3", {
        channels: 1, // Mono
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.audioChannels).toHaveBeenCalledWith(1);
    });

    it("should call progress callback", async () => {
      const onProgress = vi.fn();

      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "progress") {
          handler({ percent: 60 });
        } else if (event === "end") {
          setTimeout(handler, 0);
        }
        return cmd;
      });

      await videoEngine.extractAudio(
        "/input.mp4",
        "/audio.mp3",
        {},
        onProgress,
      );

      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe("generateThumbnail", () => {
    it("should generate thumbnail from video", async () => {
      const result = await videoEngine.generateThumbnail(
        "/input.mp4",
        "/thumb.jpg",
        { timeOffset: "00:00:05", size: "320x240" },
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.screenshots).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamps: ["00:00:05"],
          size: "320x240",
        }),
      );

      expect(result.success).toBe(true);
    });

    it("should use default time offset", async () => {
      await videoEngine.generateThumbnail("/input.mp4", "/thumb.jpg");

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.screenshots).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamps: ["00:00:01"],
        }),
      );
    });

    it("should handle thumbnail generation errors", async () => {
      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "error") {
          setTimeout(() => handler(new Error("Screenshot failed")), 0);
        }
        return cmd;
      });

      await expect(
        videoEngine.generateThumbnail("/input.mp4", "/thumb.jpg"),
      ).rejects.toThrow();
    });
  });

  describe("compressVideo", () => {
    it("should compress video with preset", async () => {
      const result = await videoEngine.compressVideo(
        "/input.mp4",
        "/compressed.mp4",
        { preset: "720p", crf: 23 },
      );

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.videoCodec).toHaveBeenCalledWith("libx264");
      expect(cmd.size).toHaveBeenCalledWith("1280x720");
      expect(cmd.outputOptions).toHaveBeenCalledWith([
        "-crf 23",
        "-preset medium",
      ]);

      expect(result.success).toBe(true);
      expect(result.preset).toBe("720p");
    });

    it("should use default CRF if not provided", async () => {
      await videoEngine.compressVideo("/input.mp4", "/output.mp4", {
        preset: "1080p",
      });

      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.outputOptions).toHaveBeenCalledWith(
        expect.arrayContaining(["-crf 23"]),
      );
    });

    it("should call progress callback", async () => {
      const onProgress = vi.fn();

      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "progress") {
          handler({ percent: 80 });
        } else if (event === "end") {
          setTimeout(handler, 0);
        }
        return cmd;
      });

      await videoEngine.compressVideo(
        "/input.mp4",
        "/output.mp4",
        { preset: "480p" },
        onProgress,
      );

      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe("generateSubtitlesWithAI", () => {
    it("should extract audio and generate subtitles", async () => {
      const result = await videoEngine.generateSubtitlesWithAI(
        "/input.mp4",
        "/subtitles.srt",
        { language: "zh" },
      );

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe("/subtitles.srt");
      expect(result.language).toBe("zh");
    });

    it("should clean up temp audio file", async () => {
      await videoEngine.generateSubtitlesWithAI("/input.mp4", "/subtitles.srt");

      expect(mockFs.promises.unlink).toHaveBeenCalled();
    });

    it("should call progress callback at different stages", async () => {
      const onProgress = vi.fn();

      await videoEngine.generateSubtitlesWithAI(
        "/input.mp4",
        "/subtitles.srt",
        {},
        onProgress,
      );

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: 10,
          message: expect.stringContaining("提取音频"),
        }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 100 }),
      );
    });

    it("should clean up temp file even on error", async () => {
      const cmd = mockFfmpeg.mock.results[0]?.value || mockFfmpeg();
      cmd.on.mockImplementation((event, handler) => {
        if (event === "error") {
          setTimeout(() => handler(new Error("Extraction failed")), 0);
        }
        return cmd;
      });

      await expect(
        videoEngine.generateSubtitlesWithAI("/input.mp4", "/subs.srt"),
      ).rejects.toThrow();

      // Should attempt cleanup
      await vi.waitFor(() => {
        expect(mockFs.promises.unlink).toHaveBeenCalled();
      });
    });
  });

  describe("getVideoInfo", () => {
    it("should return video metadata", async () => {
      const info = await videoEngine.getVideoInfo("/video.mp4");

      expect(info.duration).toBe(120);
      expect(info.size).toBe(10485760);
      expect(info.bitrate).toBe(700000);
      expect(info.format).toBe("mp4,mov,m4a");

      expect(info.video).toEqual({
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 30,
      });

      expect(info.audio).toEqual({
        codec: "aac",
        sampleRate: 48000,
        channels: 2,
      });
    });

    it("should handle videos without audio", async () => {
      mockFfmpeg.ffprobe.mockImplementationOnce((path, callback) => {
        callback(null, {
          format: {
            duration: 60,
            size: 5000000,
            bit_rate: 500000,
            format_name: "mp4",
          },
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1280,
              height: 720,
              r_frame_rate: "24/1",
            },
          ],
        });
      });

      const info = await videoEngine.getVideoInfo("/video.mp4");

      expect(info.video).toBeDefined();
      expect(info.audio).toBeNull();
    });

    it("should handle videos without video stream", async () => {
      mockFfmpeg.ffprobe.mockImplementationOnce((path, callback) => {
        callback(null, {
          format: {
            duration: 180,
            size: 3000000,
            bit_rate: 128000,
            format_name: "mp3",
          },
          streams: [
            {
              codec_type: "audio",
              codec_name: "mp3",
              sample_rate: 44100,
              channels: 2,
            },
          ],
        });
      });

      const info = await videoEngine.getVideoInfo("/audio.mp3");

      expect(info.video).toBeNull();
      expect(info.audio).toBeDefined();
    });

    it("should handle ffprobe errors", async () => {
      mockFfmpeg.ffprobe.mockImplementationOnce((path, callback) => {
        callback(new Error("File not found"), null);
      });

      await expect(videoEngine.getVideoInfo("/missing.mp4")).rejects.toThrow();
    });
  });

  describe("handleProjectTask", () => {
    it("should route to correct handler", async () => {
      const tasks = [
        {
          taskType: "convert",
          inputPath: "/in.avi",
          outputPath: "/out.mp4",
          options: {},
        },
        {
          taskType: "trim",
          inputPath: "/in.mp4",
          outputPath: "/out.mp4",
          options: { startTime: "00:00:00", duration: "00:00:10" },
        },
        {
          taskType: "extractAudio",
          inputPath: "/in.mp4",
          outputPath: "/audio.mp3",
          options: {},
        },
        {
          taskType: "generateThumbnail",
          inputPath: "/in.mp4",
          outputPath: "/thumb.jpg",
          options: {},
        },
        {
          taskType: "compress",
          inputPath: "/in.mp4",
          outputPath: "/out.mp4",
          options: { preset: "720p" },
        },
      ];

      for (const task of tasks) {
        const result = await videoEngine.handleProjectTask(task);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
      }
    });

    it("should throw error for unsupported task type", async () => {
      await expect(
        videoEngine.handleProjectTask({
          taskType: "unknown-task",
          inputPath: "/test.mp4",
          outputPath: "/out.mp4",
        }),
      ).rejects.toThrow("不支持的任务类型");
    });
  });

  describe("getVideoEngine - 单例模式", () => {
    it("should return singleton instance", () => {
      const instance1 = getVideoEngine();
      const instance2 = getVideoEngine();

      expect(instance1).toBe(instance2);
    });

    it("should set LLM manager if provided", () => {
      const mockLLMManager = { initialized: true };

      const instance = getVideoEngine(mockLLMManager);

      expect(instance.llmManager).toBe(mockLLMManager);
    });

    it("should not update LLM manager if already set", () => {
      const llm1 = { id: 1 };
      const llm2 = { id: 2 };

      const instance1 = getVideoEngine(llm1);
      expect(instance1.llmManager).toBe(llm1);

      // Subsequent call should return same instance but NOT update llmManager
      // because llmManager is already set
      const instance2 = getVideoEngine(llm2);
      expect(instance2.llmManager).toBe(llm1); // Still llm1, not llm2
      expect(instance1).toBe(instance2); // Same instance
    });
  });

  describe("边界条件和错误处理", () => {
    it("should handle empty video list in merge", async () => {
      await expect(
        videoEngine.mergeVideos([], "/output.mp4"),
      ).rejects.toThrow();
    });

    it("should handle Unicode in file paths", async () => {
      const result = await videoEngine.convertFormat(
        "/视频/输入.mp4",
        "/视频/输出.mp4",
      );

      expect(result.success).toBe(true);
    });

    it("should handle very long video durations", async () => {
      mockFfmpeg.ffprobe.mockImplementationOnce((path, callback) => {
        callback(null, {
          format: {
            duration: 10800, // 3 hours
            size: 1073741824, // 1GB
            bit_rate: 800000,
            format_name: "mp4",
          },
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
              r_frame_rate: "30/1",
            },
          ],
        });
      });

      const info = await videoEngine.getVideoInfo("/long-video.mp4");

      expect(info.duration).toBe(10800);
    });

    it("should handle preset fallback for unknown preset", async () => {
      const result = await videoEngine.compressVideo(
        "/input.mp4",
        "/output.mp4",
        { preset: "unknown-preset" },
      );

      // Should fall back to 720p
      const cmd = mockFfmpeg.mock.results[0].value;
      expect(cmd.size).toHaveBeenCalledWith("1280x720");

      expect(result.success).toBe(true);
    });
  });
});
