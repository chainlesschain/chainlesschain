/**
 * HookRegistry 单元测试
 *
 * 测试内容：
 * - HookRegistry 类构造函数
 * - register 钩子注册
 * - registerMultiple 批量注册
 * - unregister 钩子注销
 * - getHooks 获取事件钩子
 * - _compileMatcher 匹配器编译
 * - _matchHook 钩子匹配
 * - setEnabled 启用/禁用
 * - getHook 获取钩子信息
 * - listHooks 列出所有钩子
 * - updateStats 更新统计
 * - getStats 获取统计信息
 * - loadFromConfig 从配置加载
 * - clear 清除所有钩子
 * - HookPriority 优先级枚举
 * - HookType 钩子类型枚举
 * - HookEvents 事件类型数组
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  HookRegistry,
  HookPriority,
  HookType,
  HookEvents,
} = require('../hook-registry');

describe('HookPriority', () => {
  it('should have SYSTEM priority as 0', () => {
    expect(HookPriority.SYSTEM).toBe(0);
  });

  it('should have HIGH priority as 100', () => {
    expect(HookPriority.HIGH).toBe(100);
  });

  it('should have NORMAL priority as 500', () => {
    expect(HookPriority.NORMAL).toBe(500);
  });

  it('should have LOW priority as 900', () => {
    expect(HookPriority.LOW).toBe(900);
  });

  it('should have MONITOR priority as 1000', () => {
    expect(HookPriority.MONITOR).toBe(1000);
  });
});

describe('HookType', () => {
  it('should have SYNC type', () => {
    expect(HookType.SYNC).toBe('sync');
  });

  it('should have ASYNC type', () => {
    expect(HookType.ASYNC).toBe('async');
  });

  it('should have COMMAND type', () => {
    expect(HookType.COMMAND).toBe('command');
  });

  it('should have SCRIPT type', () => {
    expect(HookType.SCRIPT).toBe('script');
  });
});

describe('HookEvents', () => {
  it('should include IPC events', () => {
    expect(HookEvents).toContain('PreIPCCall');
    expect(HookEvents).toContain('PostIPCCall');
    expect(HookEvents).toContain('IPCError');
  });

  it('should include tool events', () => {
    expect(HookEvents).toContain('PreToolUse');
    expect(HookEvents).toContain('PostToolUse');
    expect(HookEvents).toContain('ToolError');
  });

  it('should include session events', () => {
    expect(HookEvents).toContain('SessionStart');
    expect(HookEvents).toContain('SessionEnd');
    expect(HookEvents).toContain('PreCompact');
    expect(HookEvents).toContain('PostCompact');
  });

  it('should include agent events', () => {
    expect(HookEvents).toContain('AgentStart');
    expect(HookEvents).toContain('AgentStop');
    expect(HookEvents).toContain('TaskAssigned');
    expect(HookEvents).toContain('TaskCompleted');
  });

  it('should include file events', () => {
    expect(HookEvents).toContain('PreFileAccess');
    expect(HookEvents).toContain('PostFileAccess');
    expect(HookEvents).toContain('FileModified');
  });

  it('should include memory events', () => {
    expect(HookEvents).toContain('MemorySave');
    expect(HookEvents).toContain('MemoryLoad');
  });
});

describe('HookRegistry', () => {
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new HookRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize empty hooks map', () => {
      expect(registry.hooks).toBeInstanceOf(Map);
      expect(registry.hooks.size).toBe(HookEvents.length);
    });

    it('should initialize empty hookById map', () => {
      expect(registry.hookById).toBeInstanceOf(Map);
      expect(registry.hookById.size).toBe(0);
    });

    it('should be enabled by default', () => {
      expect(registry.enabled).toBe(true);
    });

    it('should accept configPath option', () => {
      const reg = new HookRegistry({ configPath: '/path/to/config.json' });
      expect(reg.configPath).toBe('/path/to/config.json');
    });

    it('should initialize stats', () => {
      expect(registry.stats.totalRegistered).toBe(0);
      expect(registry.stats.totalExecutions).toBe(0);
      expect(registry.stats.totalErrors).toBe(0);
      expect(registry.stats.executionsByEvent).toBeDefined();
    });

    it('should initialize event types', () => {
      HookEvents.forEach((event) => {
        expect(registry.hooks.has(event)).toBe(true);
        expect(registry.stats.executionsByEvent[event]).toBe(0);
      });
    });

    it('should be an EventEmitter', () => {
      expect(typeof registry.on).toBe('function');
      expect(typeof registry.emit).toBe('function');
    });
  });

  describe('register', () => {
    it('should register a sync hook', () => {
      const handler = vi.fn();
      const id = registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        type: HookType.SYNC,
        handler,
      });

      expect(id).toBeDefined();
      expect(registry.hookById.has(id)).toBe(true);
    });

    it('should register an async hook', () => {
      const handler = vi.fn();
      const id = registry.register({
        event: 'PostToolUse',
        type: HookType.ASYNC,
        handler,
      });

      expect(registry.hookById.has(id)).toBe(true);
    });

    it('should register a command hook', () => {
      const id = registry.register({
        event: 'SessionStart',
        type: HookType.COMMAND,
        command: 'echo "session started"',
      });

      expect(registry.hookById.has(id)).toBe(true);
    });

    it('should register a script hook', () => {
      const id = registry.register({
        event: 'SessionEnd',
        type: HookType.SCRIPT,
        script: '/path/to/script.js',
      });

      expect(registry.hookById.has(id)).toBe(true);
    });

    it('should throw for invalid event', () => {
      expect(() =>
        registry.register({
          event: 'InvalidEvent',
          handler: vi.fn(),
        })
      ).toThrow('Invalid hook event');
    });

    it('should throw when sync/async hook missing handler', () => {
      expect(() =>
        registry.register({
          event: 'PreToolUse',
          type: HookType.SYNC,
        })
      ).toThrow('require a handler function');
    });

    it('should throw when command hook missing command', () => {
      expect(() =>
        registry.register({
          event: 'PreToolUse',
          type: HookType.COMMAND,
        })
      ).toThrow('require a command string');
    });

    it('should throw when script hook missing script', () => {
      expect(() =>
        registry.register({
          event: 'PreToolUse',
          type: HookType.SCRIPT,
        })
      ).toThrow('require a script path');
    });

    it('should throw for duplicate id', () => {
      registry.register({
        id: 'my-hook',
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      expect(() =>
        registry.register({
          id: 'my-hook',
          event: 'PostToolUse',
          handler: vi.fn(),
        })
      ).toThrow('already exists');
    });

    it('should use default values', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      const hook = registry.hookById.get(id);
      expect(hook.name).toBe('unnamed-hook');
      expect(hook.type).toBe(HookType.ASYNC);
      expect(hook.priority).toBe(HookPriority.NORMAL);
      expect(hook.timeout).toBe(30000);
      expect(hook.enabled).toBe(true);
    });

    it('should store all properties', () => {
      const handler = vi.fn();
      const id = registry.register({
        event: 'PreToolUse',
        name: 'my-hook',
        type: HookType.SYNC,
        priority: HookPriority.HIGH,
        handler,
        timeout: 5000,
        enabled: false,
        description: 'Test hook',
        metadata: { key: 'value' },
      });

      const hook = registry.hookById.get(id);
      expect(hook.name).toBe('my-hook');
      expect(hook.type).toBe(HookType.SYNC);
      expect(hook.priority).toBe(HookPriority.HIGH);
      expect(hook.timeout).toBe(5000);
      expect(hook.enabled).toBe(false);
      expect(hook.description).toBe('Test hook');
      expect(hook.metadata.key).toBe('value');
    });

    it('should sort hooks by priority', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'low',
        priority: HookPriority.LOW,
        handler: vi.fn(),
      });
      registry.register({
        event: 'PreToolUse',
        name: 'high',
        priority: HookPriority.HIGH,
        handler: vi.fn(),
      });
      registry.register({
        event: 'PreToolUse',
        name: 'system',
        priority: HookPriority.SYSTEM,
        handler: vi.fn(),
      });

      const hooks = registry.getHooks('PreToolUse');
      expect(hooks[0].name).toBe('system');
      expect(hooks[1].name).toBe('high');
      expect(hooks[2].name).toBe('low');
    });

    it('should emit hook-registered event', () => {
      const eventHandler = vi.fn();
      registry.on('hook-registered', eventHandler);

      registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      expect(eventHandler).toHaveBeenCalledWith({
        hook: expect.objectContaining({
          event: 'PreToolUse',
        }),
      });
    });

    it('should increment totalRegistered', () => {
      registry.register({ event: 'PreToolUse', handler: vi.fn() });
      registry.register({ event: 'PostToolUse', handler: vi.fn() });

      expect(registry.stats.totalRegistered).toBe(2);
    });

    it('should store registeredAt timestamp', () => {
      const before = Date.now();
      const id = registry.register({ event: 'PreToolUse', handler: vi.fn() });
      const after = Date.now();

      const hook = registry.hookById.get(id);
      expect(hook.registeredAt).toBeGreaterThanOrEqual(before);
      expect(hook.registeredAt).toBeLessThanOrEqual(after);
    });
  });

  describe('registerMultiple', () => {
    it('should register multiple hooks', () => {
      const ids = registry.registerMultiple([
        { event: 'PreToolUse', handler: vi.fn() },
        { event: 'PostToolUse', handler: vi.fn() },
        { event: 'SessionStart', handler: vi.fn() },
      ]);

      expect(ids).toHaveLength(3);
      expect(registry.hookById.size).toBe(3);
    });
  });

  describe('unregister', () => {
    it('should unregister a hook', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      const result = registry.unregister(id);

      expect(result).toBe(true);
      expect(registry.hookById.has(id)).toBe(false);
    });

    it('should remove hook from event list', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      registry.unregister(id);

      expect(registry.getHooks('PreToolUse')).toHaveLength(0);
    });

    it('should return false for unknown hook', () => {
      const result = registry.unregister('unknown-id');
      expect(result).toBe(false);
    });

    it('should emit hook-unregistered event', () => {
      const eventHandler = vi.fn();
      registry.on('hook-unregistered', eventHandler);

      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });
      registry.unregister(id);

      expect(eventHandler).toHaveBeenCalledWith({
        hookId: id,
        hook: expect.any(Object),
      });
    });
  });

  describe('getHooks', () => {
    beforeEach(() => {
      registry.register({
        event: 'PreToolUse',
        name: 'enabled-hook',
        enabled: true,
        handler: vi.fn(),
      });
      registry.register({
        event: 'PreToolUse',
        name: 'disabled-hook',
        enabled: false,
        handler: vi.fn(),
      });
    });

    it('should return enabled hooks by default', () => {
      const hooks = registry.getHooks('PreToolUse');

      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe('enabled-hook');
    });

    it('should return all hooks when enabledOnly is false', () => {
      const hooks = registry.getHooks('PreToolUse', { enabledOnly: false });

      expect(hooks).toHaveLength(2);
    });

    it('should return empty array for unknown event', () => {
      const hooks = registry.getHooks('UnknownEvent');
      expect(hooks).toEqual([]);
    });

    it('should filter by matchContext', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'file-hook',
        matcher: 'file_*',
        handler: vi.fn(),
      });

      const hooks = registry.getHooks('PreToolUse', {
        matchContext: { toolName: 'file_read' },
      });

      expect(hooks.some((h) => h.name === 'file-hook')).toBe(true);
    });
  });

  describe('_compileMatcher', () => {
    it('should return null for no matcher', () => {
      expect(registry._compileMatcher(null)).toBeNull();
      expect(registry._compileMatcher(undefined)).toBeNull();
    });

    it('should return function matcher as-is', () => {
      const fn = () => true;
      expect(registry._compileMatcher(fn)).toBe(fn);
    });

    it('should compile RegExp matcher', () => {
      const matcher = registry._compileMatcher(/^file_/);

      expect(matcher({ toolName: 'file_read' })).toBe(true);
      expect(matcher({ toolName: 'browser_open' })).toBe(false);
    });

    it('should compile string with wildcard', () => {
      const matcher = registry._compileMatcher('file_*');

      expect(matcher({ toolName: 'file_read' })).toBe(true);
      expect(matcher({ toolName: 'file_write' })).toBe(true);
      expect(matcher({ toolName: 'browser_open' })).toBe(false);
    });

    it('should compile string with pipe (OR)', () => {
      const matcher = registry._compileMatcher('Edit|Write');

      expect(matcher({ toolName: 'Edit' })).toBe(true);
      expect(matcher({ toolName: 'Write' })).toBe(true);
      expect(matcher({ toolName: 'Read' })).toBe(false);
    });

    it('should use channel or filePath as fallback', () => {
      const matcher = registry._compileMatcher('ipc:*');

      expect(matcher({ channel: 'ipc:test' })).toBe(true);
      expect(matcher({ filePath: 'ipc:file' })).toBe(true);
    });
  });

  describe('_matchHook', () => {
    it('should return true when no matcher', () => {
      const hook = { matcher: null };
      expect(registry._matchHook(hook, {})).toBe(true);
    });

    it('should call matcher with context', () => {
      const matcher = vi.fn().mockReturnValue(true);
      const hook = { matcher };
      const context = { toolName: 'test' };

      registry._matchHook(hook, context);

      expect(matcher).toHaveBeenCalledWith(context);
    });

    it('should return false on matcher error', () => {
      const hook = {
        name: 'error-hook',
        matcher: () => {
          throw new Error('matcher error');
        },
      };

      expect(registry._matchHook(hook, {})).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('should enable a hook', () => {
      const id = registry.register({
        event: 'PreToolUse',
        enabled: false,
        handler: vi.fn(),
      });

      const result = registry.setEnabled(id, true);

      expect(result).toBe(true);
      expect(registry.hookById.get(id).enabled).toBe(true);
    });

    it('should disable a hook', () => {
      const id = registry.register({
        event: 'PreToolUse',
        enabled: true,
        handler: vi.fn(),
      });

      registry.setEnabled(id, false);

      expect(registry.hookById.get(id).enabled).toBe(false);
    });

    it('should return false for unknown hook', () => {
      const result = registry.setEnabled('unknown', true);
      expect(result).toBe(false);
    });

    it('should emit hook-status-changed event', () => {
      const eventHandler = vi.fn();
      registry.on('hook-status-changed', eventHandler);

      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });
      registry.setEnabled(id, false);

      expect(eventHandler).toHaveBeenCalledWith({
        hookId: id,
        enabled: false,
      });
    });
  });

  describe('getHook', () => {
    it('should return hook info', () => {
      const id = registry.register({
        event: 'PreToolUse',
        name: 'my-hook',
        handler: vi.fn(),
      });

      const hook = registry.getHook(id);

      expect(hook).toBeDefined();
      expect(hook.id).toBe(id);
      expect(hook.name).toBe('my-hook');
    });

    it('should return null for unknown hook', () => {
      expect(registry.getHook('unknown')).toBeNull();
    });

    it('should not include handler function', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      const hook = registry.getHook(id);

      expect(hook.handler).toBeUndefined();
    });
  });

  describe('listHooks', () => {
    beforeEach(() => {
      registry.register({
        event: 'PreToolUse',
        name: 'hook1',
        enabled: true,
        handler: vi.fn(),
      });
      registry.register({
        event: 'PostToolUse',
        name: 'hook2',
        enabled: false,
        handler: vi.fn(),
      });
      registry.register({
        event: 'PreToolUse',
        name: 'hook3',
        enabled: true,
        handler: vi.fn(),
      });
    });

    it('should return all hooks', () => {
      const hooks = registry.listHooks();
      expect(hooks).toHaveLength(3);
    });

    it('should filter by event', () => {
      const hooks = registry.listHooks({ event: 'PreToolUse' });

      expect(hooks).toHaveLength(2);
      hooks.forEach((h) => expect(h.event).toBe('PreToolUse'));
    });

    it('should filter by enabled', () => {
      const hooks = registry.listHooks({ enabledOnly: true });

      expect(hooks).toHaveLength(2);
      hooks.forEach((h) => expect(h.enabled).toBe(true));
    });

    it('should combine filters', () => {
      const hooks = registry.listHooks({
        event: 'PreToolUse',
        enabledOnly: true,
      });

      expect(hooks).toHaveLength(2);
    });
  });

  describe('updateStats', () => {
    it('should update hook stats', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      registry.updateStats(id, { executionTime: 100, success: true });

      const hook = registry.hookById.get(id);
      expect(hook.executionCount).toBe(1);
      expect(hook.totalExecutionTime).toBe(100);
      expect(hook.avgExecutionTime).toBe(100);
      expect(hook.lastExecutedAt).toBeDefined();
    });

    it('should update error count on failure', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      registry.updateStats(id, { executionTime: 50, success: false });

      const hook = registry.hookById.get(id);
      expect(hook.errorCount).toBe(1);
    });

    it('should update global stats', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      registry.updateStats(id, { executionTime: 100, success: true });
      registry.updateStats(id, { executionTime: 200, success: false });

      expect(registry.stats.totalExecutions).toBe(2);
      expect(registry.stats.totalErrors).toBe(1);
      expect(registry.stats.executionsByEvent['PreToolUse']).toBe(2);
    });

    it('should calculate average execution time', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      registry.updateStats(id, { executionTime: 100, success: true });
      registry.updateStats(id, { executionTime: 200, success: true });
      registry.updateStats(id, { executionTime: 300, success: true });

      const hook = registry.hookById.get(id);
      expect(hook.avgExecutionTime).toBe(200);
    });

    it('should handle unknown hook gracefully', () => {
      // Should not throw
      registry.updateStats('unknown', { executionTime: 100, success: true });
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      registry.register({ event: 'PreToolUse', handler: vi.fn() });
      registry.register({ event: 'PostToolUse', enabled: false, handler: vi.fn() });

      const stats = registry.getStats();

      expect(stats.totalRegistered).toBe(2);
      expect(stats.hookCount).toBe(2);
      expect(stats.enabledCount).toBe(1);
      expect(stats.eventTypes).toEqual(HookEvents);
    });
  });

  describe('loadFromConfig', () => {
    // Note: loadFromConfig tests that require fs mocking are covered in integration tests
    // Here we test the behavior when the file doesn't exist

    it('should return false for non-existent config file', async () => {
      const result = await registry.loadFromConfig('/non/existent/path.json');

      expect(result).toBe(false);
    });

    it('should have loadFromConfig method', () => {
      expect(typeof registry.loadFromConfig).toBe('function');
    });
  });

  describe('clear', () => {
    it('should clear all hooks', () => {
      registry.register({ event: 'PreToolUse', handler: vi.fn() });
      registry.register({ event: 'PostToolUse', handler: vi.fn() });

      registry.clear();

      expect(registry.hookById.size).toBe(0);
      expect(registry.getHooks('PreToolUse')).toHaveLength(0);
    });

    it('should reset totalRegistered', () => {
      registry.register({ event: 'PreToolUse', handler: vi.fn() });

      registry.clear();

      expect(registry.stats.totalRegistered).toBe(0);
    });

    it('should emit hooks-cleared event', () => {
      const eventHandler = vi.fn();
      registry.on('hooks-cleared', eventHandler);

      registry.clear();

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('_sanitizeHook', () => {
    it('should not include handler function', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      const hook = registry.hookById.get(id);
      const sanitized = registry._sanitizeHook(hook);

      expect(sanitized.handler).toBeUndefined();
    });

    it('should convert RegExp matcher to string', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
        matcher: /^file_/,
      });

      const hook = registry.hookById.get(id);
      const sanitized = registry._sanitizeHook(hook);

      expect(sanitized.matcher).toBe('/^file_/');
    });

    it('should round avgExecutionTime', () => {
      const id = registry.register({
        event: 'PreToolUse',
        handler: vi.fn(),
      });

      const hook = registry.hookById.get(id);
      hook.avgExecutionTime = 123.456789;

      const sanitized = registry._sanitizeHook(hook);
      expect(sanitized.avgExecutionTime).toBe(123.46);
    });
  });

  describe('_generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = registry._generateId();
      const id2 = registry._generateId();

      expect(id1).not.toBe(id2);
    });

    it('should start with hook_', () => {
      const id = registry._generateId();
      expect(id.startsWith('hook_')).toBe(true);
    });
  });
});
