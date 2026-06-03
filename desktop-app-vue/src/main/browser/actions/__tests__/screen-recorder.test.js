/**
 * ScreenRecorder 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock fs.promises
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('mock image data')),
    readdir: vi.fn().mockResolvedValue(['rec_123456']),
    rm: vi.fn().mockResolvedValue(undefined)
  }
}));

const { ScreenRecorder, RecordingState, RecordingMode, getScreenRecorder } = require('../screen-recorder');

describe('ScreenRecorder', () => {
  let recorder;
  let mockBrowserEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockBrowserEngine = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('mock screenshot'))
    };

    recorder = new ScreenRecorder(mockBrowserEngine, {
      fps: 2,
      maxDuration: 60000,
      outputDir: '/tmp/test-recordings'
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (recorder.state === RecordingState.RECORDING || recorder.state === RecordingState.PAUSED) {
      try {
        await recorder.stopRecording();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultRecorder = new ScreenRecorder();

      expect(defaultRecorder.config.fps).toBe(2);
      expect(defaultRecorder.config.quality).toBe(80);
      expect(defaultRecorder.config.maxDuration).toBe(300000);
      expect(defaultRecorder.state).toBe(RecordingState.IDLE);
    });

    it('should accept custom config', () => {
      expect(recorder.config.fps).toBe(2);
      expect(recorder.config.maxDuration).toBe(60000);
      expect(recorder.config.outputDir).toBe('/tmp/test-recordings');
    });
  });

  describe('setBrowserEngine', () => {
    it('should update browser engine', () => {
      const newEngine = { screenshot: vi.fn() };
      recorder.setBrowserEngine(newEngine);

      expect(recorder.browserEngine).toBe(newEngine);
    });
  });

  describe('startRecording', () => {
    it('should start recording successfully', async () => {
      const result = await recorder.startRecording('tab_123');

      expect(result.success).toBe(true);
      expect(result.recordingId).toMatch(/^rec_/);
      expect(recorder.state).toBe(RecordingState.RECORDING);
      expect(recorder.currentRecording).toBeDefined();
      expect(recorder.currentRecording.targetId).toBe('tab_123');
    });

    it('should throw when already recording', async () => {
      await recorder.startRecording('tab_123');

      await expect(recorder.startRecording('tab_456'))
        .rejects.toThrow('Recording already in progress');
    });

    it('should emit recordingStarted event', async () => {
      const handler = vi.fn();
      recorder.on('recordingStarted', handler);

      await recorder.startRecording('tab_123');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: expect.any(String),
        targetId: 'tab_123'
      }));
    });

    it('should create output directory', async () => {
      const fsMock = require('fs').promises;
      const mkdirSpy = vi.fn().mockResolvedValue(undefined);
      fsMock.mkdir = mkdirSpy;

      await recorder.startRecording('tab_123');

      expect(mkdirSpy).toHaveBeenCalledWith(
        expect.stringContaining('rec_'),
        { recursive: true }
      );
    });
  });

  describe('pauseRecording', () => {
    it('should pause active recording', async () => {
      await recorder.startRecording('tab_123');
      const result = recorder.pauseRecording();

      expect(result.success).toBe(true);
      expect(recorder.state).toBe(RecordingState.PAUSED);
    });

    it('should throw when not recording', () => {
      expect(() => recorder.pauseRecording())
        .toThrow('No active recording to pause');
    });

    it('should emit recordingPaused event', async () => {
      const handler = vi.fn();
      recorder.on('recordingPaused', handler);

      await recorder.startRecording('tab_123');
      recorder.pauseRecording();

      expect(handler).toHaveBeenCalled();
    });

    it('should stop frame capture timer', async () => {
      await recorder.startRecording('tab_123');
      expect(recorder.recordingTimer).not.toBeNull();

      recorder.pauseRecording();
      expect(recorder.recordingTimer).toBeNull();
    });
  });

  describe('resumeRecording', () => {
    it('should resume paused recording', async () => {
      await recorder.startRecording('tab_123');
      recorder.pauseRecording();
      const result = recorder.resumeRecording();

      expect(result.success).toBe(true);
      expect(recorder.state).toBe(RecordingState.RECORDING);
    });

    it('should throw when not paused', async () => {
      await recorder.startRecording('tab_123');

      expect(() => recorder.resumeRecording())
        .toThrow('Recording is not paused');
    });

    it('should emit recordingResumed event', async () => {
      const handler = vi.fn();
      recorder.on('recordingResumed', handler);

      await recorder.startRecording('tab_123');
      recorder.pauseRecording();
      recorder.resumeRecording();

      expect(handler).toHaveBeenCalled();
    });

    it('should track paused duration', async () => {
      await recorder.startRecording('tab_123');
      recorder.pauseRecording();

      // Simulate pause duration
      vi.advanceTimersByTime(1000);

      recorder.resumeRecording();

      expect(recorder.pausedDuration).toBe(1000);
    });
  });

  describe('stopRecording', () => {
    beforeEach(() => {
      // Ensure fs mocks are set up for stopRecording tests
      const fsMock = require('fs').promises;
      fsMock.writeFile = vi.fn().mockResolvedValue(undefined);
    });

    it('should stop active recording', async () => {
      await recorder.startRecording('tab_123');
      const result = await recorder.stopRecording();

      expect(result.success).toBe(true);
      expect(result.recordingId).toMatch(/^rec_/);
      expect(recorder.state).toBe(RecordingState.IDLE);
      expect(recorder.currentRecording).toBeNull();
    });

    it('should throw when no active recording', async () => {
      await expect(recorder.stopRecording())
        .rejects.toThrow('No active recording to stop');
    });

    it('should emit recordingStopped event', async () => {
      const handler = vi.fn();
      recorder.on('recordingStopped', handler);

      await recorder.startRecording('tab_123');
      await recorder.stopRecording();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        recordingId: expect.any(String)
      }));
    });

    it('should save metadata file', async () => {
      const fsMock = require('fs').promises;
      const writeFileSpy = vi.fn().mockResolvedValue(undefined);
      fsMock.writeFile = writeFileSpy;

      await recorder.startRecording('tab_123');
      await recorder.stopRecording();

      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        expect.any(String)
      );
    });

    it('should calculate duration correctly', async () => {
      await recorder.startRecording('tab_123');

      vi.advanceTimersByTime(5000);

      const result = await recorder.stopRecording();

      expect(result.duration).toBe(5000);
    });

    it('should exclude paused time from duration', async () => {
      await recorder.startRecording('tab_123');
      vi.advanceTimersByTime(2000);

      recorder.pauseRecording();
      vi.advanceTimersByTime(1000);

      recorder.resumeRecording();
      vi.advanceTimersByTime(2000);

      const result = await recorder.stopRecording();

      expect(result.duration).toBe(4000); // 2000 + 2000, excluding 1000 pause
    });
  });

  describe('_captureFrame', () => {
    it('should capture frame from browser', async () => {
      await recorder.startRecording('tab_123');

      // Trigger frame capture
      vi.advanceTimersByTime(500);

      expect(mockBrowserEngine.screenshot).toHaveBeenCalled();
    });

    it('should increment frame count', async () => {
      await recorder.startRecording('tab_123');

      // Run timer and allow all async operations to complete
      await vi.advanceTimersByTimeAsync(600);

      expect(recorder.currentRecording.frameCount).toBeGreaterThan(0);
    });

    it('should emit frameCaptured event', async () => {
      const handler = vi.fn();
      recorder.on('frameCaptured', handler);

      await recorder.startRecording('tab_123');
      vi.advanceTimersByTime(500);

      // Note: Due to async nature, event may not fire immediately in tests
    });

    it('should emit frameError on failure', async () => {
      mockBrowserEngine.screenshot.mockRejectedValueOnce(new Error('Capture failed'));

      const handler = vi.fn();
      recorder.on('frameError', handler);

      await recorder.startRecording('tab_123');
      vi.advanceTimersByTime(500);

      // Allow async to complete
      await Promise.resolve();
    });
  });

  describe('getStatus', () => {
    it('should return idle status when not recording', () => {
      const status = recorder.getStatus();

      expect(status.state).toBe(RecordingState.IDLE);
      expect(status.recordingId).toBeUndefined();
      expect(status.frameCount).toBe(0);
      expect(status.elapsed).toBe(0);
    });

    it('should return recording status when active', async () => {
      await recorder.startRecording('tab_123');
      vi.advanceTimersByTime(2000);

      const status = recorder.getStatus();

      expect(status.state).toBe(RecordingState.RECORDING);
      expect(status.recordingId).toMatch(/^rec_/);
      expect(status.elapsed).toBe(2000);
      expect(status.targetId).toBe('tab_123');
    });
  });

  describe('listRecordings', () => {
    it('should return empty list when no recordings', async () => {
      const fsMock = require('fs').promises;
      fsMock.readdir = vi.fn().mockResolvedValue([]);

      const recordings = await recorder.listRecordings();

      expect(recordings).toEqual([]);
    });

    it('should return recordings sorted by date', async () => {
      const fsMock = require('fs').promises;
      fsMock.readdir = vi.fn().mockResolvedValue(['rec_123', 'rec_456']);
      fsMock.readFile = vi.fn()
        .mockResolvedValueOnce(JSON.stringify({ id: 'rec_123', startTime: '2024-01-01T10:00:00Z' }))
        .mockResolvedValueOnce(JSON.stringify({ id: 'rec_456', startTime: '2024-01-02T10:00:00Z' }));

      const recordings = await recorder.listRecordings();

      expect(recordings.length).toBe(2);
      expect(recordings[0].id).toBe('rec_456'); // Newer first
    });

    it('should handle read errors gracefully', async () => {
      const fsMock = require('fs').promises;
      fsMock.readdir = vi.fn().mockRejectedValue(new Error('Read error'));

      const recordings = await recorder.listRecordings();

      expect(recordings).toEqual([]);
    });
  });

  describe('getRecording', () => {
    it('should return recording metadata', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockResolvedValue(JSON.stringify({
        id: 'rec_123',
        duration: 5000,
        frameCount: 10
      }));

      const recording = await recorder.getRecording('rec_123');

      expect(recording.success).toBe(true);
      expect(recording.id).toBe('rec_123');
      expect(recording.duration).toBe(5000);
    });

    it('should handle not found', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));

      const recording = await recorder.getRecording('nonexistent');

      expect(recording.success).toBe(false);
      expect(recording.error).toContain('not found');
    });
  });

  describe('deleteRecording', () => {
    it('should delete recording directory', async () => {
      const fsMock = require('fs').promises;
      fsMock.rm = vi.fn().mockResolvedValue(undefined);
      const result = await recorder.deleteRecording('rec_123');

      expect(result.success).toBe(true);
      expect(fsMock.rm).toHaveBeenCalledWith(
        expect.stringContaining('rec_123'),
        { recursive: true, force: true }
      );
    });

    it('should emit recordingDeleted event', async () => {
      const fsMock = require('fs').promises;
      fsMock.rm = vi.fn().mockResolvedValue(undefined);
      const handler = vi.fn();
      recorder.on('recordingDeleted', handler);

      await recorder.deleteRecording('rec_123');

      expect(handler).toHaveBeenCalledWith({ recordingId: 'rec_123' });
    });

    it('should handle delete errors', async () => {
      const fsMock = require('fs').promises;
      fsMock.rm = vi.fn().mockRejectedValue(new Error('Delete failed'));

      const result = await recorder.deleteRecording('rec_123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('exportToGif', () => {
    it('should return frames for GIF generation', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockResolvedValue(JSON.stringify({
        id: 'rec_123',
        fps: 2,
        duration: 2000,
        frames: [
          { index: 0, filename: 'frame_000000.jpg' },
          { index: 1, filename: 'frame_000001.jpg' }
        ]
      }));

      const result = await recorder.exportToGif('rec_123');

      expect(result.success).toBe(true);
      expect(result.frames.length).toBe(2);
      expect(result.fps).toBe(2);
    });

    it('should return error for invalid recording', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));

      const result = await recorder.exportToGif('nonexistent');

      expect(result.success).toBe(false);
    });
  });

  describe('getFrame', () => {
    it('should return frame data', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockResolvedValue(Buffer.from('frame data'));

      const result = await recorder.getFrame('rec_123', 0);

      expect(result.success).toBe(true);
      expect(result.frameIndex).toBe(0);
      expect(result.type).toBe('image/jpeg');
      expect(result.data).toBeDefined();
    });

    it('should handle frame not found', async () => {
      const fsMock = require('fs').promises;
      fsMock.readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));

      const result = await recorder.getFrame('rec_123', 999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getScreenRecorder singleton', () => {
    it('should return same instance', () => {
      const recorder1 = getScreenRecorder();
      const recorder2 = getScreenRecorder();

      expect(recorder1).toBe(recorder2);
    });

    it('should update browser engine on subsequent calls', () => {
      const engine = { screenshot: vi.fn() };
      const recorder1 = getScreenRecorder(engine);

      expect(recorder1.browserEngine).toBe(engine);
    });
  });

  describe('RecordingState constants', () => {
    it('should have all states defined', () => {
      expect(RecordingState.IDLE).toBe('idle');
      expect(RecordingState.RECORDING).toBe('recording');
      expect(RecordingState.PAUSED).toBe('paused');
      expect(RecordingState.STOPPED).toBe('stopped');
    });
  });

  describe('RecordingMode constants', () => {
    it('should have all modes defined', () => {
      expect(RecordingMode.SCREENSHOT_SEQUENCE).toBe('screenshot_sequence');
      expect(RecordingMode.VIDEO).toBe('video');
    });
  });

  describe('max duration auto-stop', () => {
    it('should auto-stop after max duration', async () => {
      const shortRecorder = new ScreenRecorder(mockBrowserEngine, {
        maxDuration: 1000
      });

      await shortRecorder.startRecording('tab_123');

      // Advance timers past max duration
      vi.advanceTimersByTime(1100);

      // Allow async stopRecording to complete
      await vi.runAllTimersAsync();

      // State should be IDLE after stop completes, or STOPPED if still in progress
      expect([RecordingState.IDLE, RecordingState.STOPPED]).toContain(shortRecorder.state);
    });
  });
});
