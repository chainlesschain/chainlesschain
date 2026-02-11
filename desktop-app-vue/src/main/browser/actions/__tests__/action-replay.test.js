/**
 * ActionReplay 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { ActionReplay, ReplayState, ReplayMode, getActionReplay } = require('../action-replay');

describe('ActionReplay', () => {
  let replay;
  let mockBrowserEngine;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBrowserEngine = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('mock screenshot')),
      navigate: vi.fn().mockResolvedValue({ success: true }),
      takeSnapshot: vi.fn().mockResolvedValue({ elements: [] })
    };

    replay = new ActionReplay(mockBrowserEngine, {
      defaultSpeed: 1.0,
      stopOnError: true
    });
  });

  afterEach(() => {
    replay.reset();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultReplay = new ActionReplay();

      expect(defaultReplay.config.defaultSpeed).toBe(1.0);
      expect(defaultReplay.config.stopOnError).toBe(true);
      expect(defaultReplay.state).toBe(ReplayState.IDLE);
    });

    it('should accept custom config', () => {
      expect(replay.config.defaultSpeed).toBe(1.0);
      expect(replay.config.stopOnError).toBe(true);
    });
  });

  describe('registerExecutor', () => {
    it('should register custom executor', () => {
      const customExecutor = vi.fn().mockResolvedValue({ success: true });
      replay.registerExecutor('custom', customExecutor);

      expect(replay.executors.get('custom')).toBe(customExecutor);
    });
  });

  describe('load', () => {
    it('should load actions successfully', () => {
      const actions = [
        { type: 'click', x: 100, y: 200 },
        { type: 'type', text: 'hello' }
      ];

      const result = replay.load(actions, { targetId: 'tab_123' });

      expect(result.success).toBe(true);
      expect(result.actionCount).toBe(2);
      expect(replay.actionQueue.length).toBe(2);
      expect(replay.currentSession).toBeDefined();
    });

    it('should throw when loading while playing', async () => {
      replay.load([{ type: 'wait', duration: 10000 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;

      expect(() => replay.load([{ type: 'click' }])).toThrow('Cannot load while playing');
    });

    it('should emit loaded event', () => {
      const handler = vi.fn();
      replay.on('loaded', handler);

      replay.load([{ type: 'click', x: 100, y: 200 }]);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('play', () => {
    it('should throw when no actions loaded', async () => {
      await expect(replay.play()).rejects.toThrow('No actions loaded');
    });

    it('should throw when already playing', async () => {
      replay.load([{ type: 'wait', duration: 100 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;

      await expect(replay.play()).rejects.toThrow('Already playing');
    });

    it('should emit started event', async () => {
      const handler = vi.fn();
      replay.on('started', handler);

      replay.load([{ type: 'wait', duration: 10 }], { targetId: 'tab_123' });
      await replay.play();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('should pause active playback', () => {
      replay.load([{ type: 'wait', duration: 1000 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;

      const result = replay.pause();

      expect(result.success).toBe(true);
      expect(replay.state).toBe(ReplayState.PAUSED);
    });

    it('should throw when not playing', () => {
      expect(() => replay.pause()).toThrow('Not playing');
    });

    it('should emit paused event', () => {
      const handler = vi.fn();
      replay.on('paused', handler);

      replay.load([{ type: 'wait', duration: 1000 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;
      replay.pause();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should resume paused playback', () => {
      replay.state = ReplayState.PAUSED;

      const result = replay.resume();

      expect(result.success).toBe(true);
      expect(replay.state).toBe(ReplayState.PLAYING);
    });

    it('should throw when not paused', () => {
      expect(() => replay.resume()).toThrow('Not paused');
    });
  });

  describe('stop', () => {
    it('should stop playback', () => {
      replay.load([{ type: 'wait', duration: 1000 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;

      const result = replay.stop();

      expect(result.success).toBe(true);
      expect(replay.state).toBe(ReplayState.IDLE);
    });

    it('should return success when already stopped', () => {
      const result = replay.stop();

      expect(result.success).toBe(true);
      expect(result.reason).toBe('Already stopped');
    });
  });

  describe('step', () => {
    it('should execute single step', async () => {
      replay.load([
        { type: 'wait', duration: 10 },
        { type: 'wait', duration: 10 }
      ], { targetId: 'tab_123' });

      const result = await replay.step();

      expect(result.success).toBe(true);
      expect(result.index).toBe(0);
      expect(replay.currentIndex).toBe(1);
    });

    it('should throw when playing', async () => {
      replay.state = ReplayState.PLAYING;

      await expect(replay.step()).rejects.toThrow('Can only step when paused or idle');
    });

    it('should return failure when no more actions', async () => {
      replay.load([{ type: 'wait', duration: 10 }], { targetId: 'tab_123' });
      await replay.step();

      const result = await replay.step();

      expect(result.success).toBe(false);
      expect(result.reason).toBe('No more actions');
    });
  });

  describe('breakpoints', () => {
    it('should set breakpoint', () => {
      replay.setBreakpoint(5);

      expect(replay.breakpoints.has(5)).toBe(true);
    });

    it('should remove breakpoint', () => {
      replay.setBreakpoint(5);
      replay.removeBreakpoint(5);

      expect(replay.breakpoints.has(5)).toBe(false);
    });

    it('should clear all breakpoints', () => {
      replay.setBreakpoint(1);
      replay.setBreakpoint(2);
      replay.setBreakpoint(3);

      replay.clearBreakpoints();

      expect(replay.breakpoints.size).toBe(0);
    });
  });

  describe('jumpTo', () => {
    it('should jump to valid index', () => {
      replay.load([
        { type: 'click', x: 100, y: 200 },
        { type: 'click', x: 200, y: 300 },
        { type: 'click', x: 300, y: 400 }
      ], { targetId: 'tab_123' });

      const result = replay.jumpTo(2);

      expect(result.success).toBe(true);
      expect(replay.currentIndex).toBe(2);
    });

    it('should throw for invalid index', () => {
      replay.load([{ type: 'click', x: 100, y: 200 }], { targetId: 'tab_123' });

      expect(() => replay.jumpTo(5)).toThrow('Invalid index');
      expect(() => replay.jumpTo(-1)).toThrow('Invalid index');
    });

    it('should throw when playing', () => {
      replay.load([{ type: 'click', x: 100, y: 200 }], { targetId: 'tab_123' });
      replay.state = ReplayState.PLAYING;

      expect(() => replay.jumpTo(0)).toThrow('Cannot jump while playing');
    });
  });

  describe('setSpeed', () => {
    it('should set valid speed', () => {
      replay.setSpeed(2.0);

      expect(replay.speed).toBe(2.0);
    });

    it('should throw for invalid speed', () => {
      expect(() => replay.setSpeed(0)).toThrow('Speed must be positive');
      expect(() => replay.setSpeed(-1)).toThrow('Speed must be positive');
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      replay.load([{ type: 'click', x: 100, y: 200 }], { targetId: 'tab_123' });

      const status = replay.getStatus();

      expect(status.state).toBe(ReplayState.IDLE);
      expect(status.totalActions).toBe(1);
      expect(status.currentIndex).toBe(0);
    });
  });

  describe('getActions', () => {
    it('should return loaded actions', () => {
      replay.load([
        { type: 'click', x: 100, y: 200 },
        { type: 'type', text: 'hello' }
      ], { targetId: 'tab_123' });

      const actions = replay.getActions();

      expect(actions.length).toBe(2);
      expect(actions[0].type).toBe('click');
      expect(actions[1].type).toBe('type');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      replay.load([{ type: 'click', x: 100, y: 200 }], { targetId: 'tab_123' });
      replay.setBreakpoint(0);
      replay.currentIndex = 5;

      replay.reset();

      expect(replay.actionQueue.length).toBe(0);
      expect(replay.currentIndex).toBe(0);
      expect(replay.currentSession).toBeNull();
      expect(replay.breakpoints.size).toBe(0);
      expect(replay.state).toBe(ReplayState.IDLE);
    });
  });

  describe('getActionReplay singleton', () => {
    it('should return same instance', () => {
      const replay1 = getActionReplay();
      const replay2 = getActionReplay();

      expect(replay1).toBe(replay2);
    });
  });

  describe('ReplayState constants', () => {
    it('should have all states defined', () => {
      expect(ReplayState.IDLE).toBe('idle');
      expect(ReplayState.PLAYING).toBe('playing');
      expect(ReplayState.PAUSED).toBe('paused');
      expect(ReplayState.STEPPING).toBe('stepping');
      expect(ReplayState.COMPLETED).toBe('completed');
      expect(ReplayState.ERROR).toBe('error');
    });
  });

  describe('ReplayMode constants', () => {
    it('should have all modes defined', () => {
      expect(ReplayMode.NORMAL).toBe('normal');
      expect(ReplayMode.FAST).toBe('fast');
      expect(ReplayMode.SLOW).toBe('slow');
      expect(ReplayMode.STEP_BY_STEP).toBe('step');
      expect(ReplayMode.INSTANT).toBe('instant');
    });
  });
});
