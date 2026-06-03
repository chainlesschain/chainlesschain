/**
 * Voice/Video Manager 单元测试 - 简化版
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('VoiceVideoManager', () => {
  test('模块应该能够正确导入', async () => {
    const { VoiceVideoManager, CallState, CallType } = await import('../../../src/main/p2p/voice-video-manager.js');

    expect(VoiceVideoManager).toBeDefined();
    expect(CallState).toBeDefined();
    expect(CallType).toBeDefined();
    expect(CallType.AUDIO).toBe('audio');
    expect(CallType.VIDEO).toBe('video');
    expect(CallState.IDLE).toBe('idle');
    expect(CallState.CALLING).toBe('calling');
    expect(CallState.CONNECTED).toBe('connected');
  });

  test('应该能够创建VoiceVideoManager实例', async () => {
    const { VoiceVideoManager } = await import('../../../src/main/p2p/voice-video-manager.js');
    const EventEmitter = (await import('events')).default;

    const mockP2PManager = new EventEmitter();
    mockP2PManager.node = null; // 模拟未初始化的节点

    const manager = new VoiceVideoManager(mockP2PManager, {
      callTimeout: 1000,
      qualityCheckInterval: 500
    });

    expect(manager).toBeDefined();
    expect(manager.sessions).toBeInstanceOf(Map);
    expect(manager.peerSessions).toBeInstanceOf(Map);
    expect(manager.stats).toBeDefined();
    expect(manager.stats.totalCalls).toBe(0);
  });

  test('应该正确初始化配置选项', async () => {
    const { VoiceVideoManager } = await import('../../../src/main/p2p/voice-video-manager.js');
    const EventEmitter = (await import('events')).default;

    const mockP2PManager = new EventEmitter();
    mockP2PManager.node = null;

    const customOptions = {
      callTimeout: 30000,
      qualityCheckInterval: 2000,
      iceServers: [{ urls: 'stun:custom.stun.server:19302' }]
    };

    const manager = new VoiceVideoManager(mockP2PManager, customOptions);

    expect(manager.options.callTimeout).toBe(30000);
    expect(manager.options.qualityCheckInterval).toBe(2000);
    expect(manager.options.iceServers).toEqual(customOptions.iceServers);
  });

  test('应该能够生成唯一的通话ID', async () => {
    const { VoiceVideoManager } = await import('../../../src/main/p2p/voice-video-manager.js');
    const EventEmitter = (await import('events')).default;

    const mockP2PManager = new EventEmitter();
    mockP2PManager.node = null;

    const manager = new VoiceVideoManager(mockP2PManager);

    const callId1 = manager._generateCallId();
    const callId2 = manager._generateCallId();

    expect(callId1).toBeTruthy();
    expect(callId2).toBeTruthy();
    expect(callId1).not.toBe(callId2);
    expect(callId1).toMatch(/^call_\d+_[a-z0-9]+$/);
  });

  test('应该正确初始化统计信息', async () => {
    const { VoiceVideoManager } = await import('../../../src/main/p2p/voice-video-manager.js');
    const EventEmitter = (await import('events')).default;

    const mockP2PManager = new EventEmitter();
    mockP2PManager.node = null;

    const manager = new VoiceVideoManager(mockP2PManager);
    const stats = manager.getStats();

    expect(stats).toMatchObject({
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDuration: 0,
      audioCallsCount: 0,
      videoCallsCount: 0,
      screenShareCount: 0,
      activeCalls: 0,
      totalSessions: 0
    });
  });

  test('应该能够清理资源', async () => {
    const { VoiceVideoManager } = await import('../../../src/main/p2p/voice-video-manager.js');
    const EventEmitter = (await import('events')).default;

    const mockP2PManager = new EventEmitter();
    mockP2PManager.node = null;

    const manager = new VoiceVideoManager(mockP2PManager);

    // 清理应该不会抛出错误
    await expect(manager.cleanup()).resolves.toBeUndefined();

    // 清理后会话应该为空
    expect(manager.sessions.size).toBe(0);
    expect(manager.peerSessions.size).toBe(0);
  });
});
