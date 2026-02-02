/**
 * Hook System Unit Tests
 *
 * @jest-environment node
 */

const { HookSystem, HookRegistry, HookExecutor, HookPriority, HookType, HookResult } = require('../index');

describe('HookRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('register', () => {
    it('should register a hook successfully', () => {
      const hookId = registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => ({ result: HookResult.CONTINUE }),
      });

      expect(hookId).toBeDefined();
      expect(hookId).toMatch(/^hook_/);
    });

    it('should throw error for invalid event', () => {
      expect(() => {
        registry.register({
          event: 'InvalidEvent',
          name: 'test-hook',
          handler: async () => ({}),
        });
      }).toThrow(/Invalid hook event/);
    });

    it('should throw error when handler is missing for async hook', () => {
      expect(() => {
        registry.register({
          event: 'PreToolUse',
          name: 'test-hook',
          type: HookType.ASYNC,
        });
      }).toThrow(/require a handler function/);
    });

    it('should throw error when command is missing for command hook', () => {
      expect(() => {
        registry.register({
          event: 'PreToolUse',
          name: 'test-hook',
          type: HookType.COMMAND,
        });
      }).toThrow(/require a command string/);
    });

    it('should register hooks in priority order', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'low-priority',
        priority: HookPriority.LOW,
        handler: async () => ({}),
      });

      registry.register({
        event: 'PreToolUse',
        name: 'high-priority',
        priority: HookPriority.HIGH,
        handler: async () => ({}),
      });

      const hooks = registry.getHooks('PreToolUse');
      expect(hooks[0].name).toBe('high-priority');
      expect(hooks[1].name).toBe('low-priority');
    });
  });

  describe('unregister', () => {
    it('should unregister a hook successfully', () => {
      const hookId = registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => ({}),
      });

      expect(registry.unregister(hookId)).toBe(true);
      expect(registry.getHook(hookId)).toBeNull();
    });

    it('should return false for non-existent hook', () => {
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('getHooks', () => {
    beforeEach(() => {
      registry.register({
        event: 'PreToolUse',
        name: 'enabled-hook',
        enabled: true,
        handler: async () => ({}),
      });

      registry.register({
        event: 'PreToolUse',
        name: 'disabled-hook',
        enabled: false,
        handler: async () => ({}),
      });
    });

    it('should return only enabled hooks by default', () => {
      const hooks = registry.getHooks('PreToolUse');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe('enabled-hook');
    });

    it('should return all hooks when enabledOnly is false', () => {
      const hooks = registry.getHooks('PreToolUse', { enabledOnly: false });
      expect(hooks).toHaveLength(2);
    });
  });

  describe('matcher', () => {
    it('should match with string pattern', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'file-hook',
        matcher: 'tool_file_*',
        handler: async () => ({}),
      });

      const matchedHooks = registry.getHooks('PreToolUse', {
        matchContext: { toolName: 'tool_file_read' },
      });
      expect(matchedHooks).toHaveLength(1);

      const unmatchedHooks = registry.getHooks('PreToolUse', {
        matchContext: { toolName: 'tool_exec_run' },
      });
      expect(unmatchedHooks).toHaveLength(0);
    });

    it('should match with regex pattern', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'regex-hook',
        matcher: /^tool_(file|data)_/,
        handler: async () => ({}),
      });

      const matchedHooks = registry.getHooks('PreToolUse', {
        matchContext: { toolName: 'tool_file_read' },
      });
      expect(matchedHooks).toHaveLength(1);
    });

    it('should match with pipe pattern', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'pipe-hook',
        matcher: 'Edit|Write|Read',
        handler: async () => ({}),
      });

      const matchedHooks = registry.getHooks('PreToolUse', {
        matchContext: { toolName: 'Edit' },
      });
      expect(matchedHooks).toHaveLength(1);
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable a hook', () => {
      const hookId = registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        enabled: true,
        handler: async () => ({}),
      });

      expect(registry.setEnabled(hookId, false)).toBe(true);

      const hooks = registry.getHooks('PreToolUse');
      expect(hooks).toHaveLength(0);
    });
  });

  describe('listHooks', () => {
    it('should return sanitized hook list', () => {
      registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        description: 'Test description',
        handler: async () => ({}),
      });

      const hooks = registry.listHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe('test-hook');
      expect(hooks[0].description).toBe('Test description');
      // 确保 handler 函数不在返回结果中
      expect(hooks[0].handler).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('should track statistics', () => {
      const hookId = registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => ({}),
      });

      registry.updateStats(hookId, { executionTime: 100, success: true });
      registry.updateStats(hookId, { executionTime: 200, success: false });

      const stats = registry.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.totalErrors).toBe(1);

      const hook = registry.getHook(hookId);
      expect(hook.executionCount).toBe(2);
      expect(hook.errorCount).toBe(1);
      expect(hook.avgExecutionTime).toBe(150);
    });
  });
});

describe('HookExecutor', () => {
  let registry;
  let executor;

  beforeEach(() => {
    registry = new HookRegistry();
    executor = new HookExecutor(registry);
  });

  afterEach(() => {
    executor.cancelAll();
    registry.clear();
  });

  describe('trigger', () => {
    it('should execute hooks and return continue result', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'continue-hook',
        handler: async () => ({ result: HookResult.CONTINUE }),
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.prevented).toBe(false);
      expect(result.executedHooks).toBe(1);
    });

    it('should prevent operation when hook returns prevent', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'prevent-hook',
        handler: async () => ({
          result: HookResult.PREVENT,
          reason: 'Test prevention',
        }),
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.prevented).toBe(true);
      expect(result.preventReason).toBe('Test prevention');
    });

    it('should modify data when hook returns modify', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'modify-hook',
        handler: async ({ data }) => ({
          result: HookResult.MODIFY,
          data: { ...data, modified: true },
        }),
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.data.modified).toBe(true);
      expect(result.modifications.modified).toBe(true);
    });

    it('should execute hooks in priority order', async () => {
      const executionOrder = [];

      registry.register({
        event: 'PreToolUse',
        name: 'low-hook',
        priority: HookPriority.LOW,
        handler: async () => {
          executionOrder.push('low');
          return { result: HookResult.CONTINUE };
        },
      });

      registry.register({
        event: 'PreToolUse',
        name: 'high-hook',
        priority: HookPriority.HIGH,
        handler: async () => {
          executionOrder.push('high');
          return { result: HookResult.CONTINUE };
        },
      });

      await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(executionOrder).toEqual(['high', 'low']);
    });

    it('should skip non-monitor hooks after prevention', async () => {
      const executionOrder = [];

      registry.register({
        event: 'PreToolUse',
        name: 'prevent-hook',
        priority: HookPriority.HIGH,
        handler: async () => {
          executionOrder.push('prevent');
          return { result: HookResult.PREVENT };
        },
      });

      registry.register({
        event: 'PreToolUse',
        name: 'normal-hook',
        priority: HookPriority.NORMAL,
        handler: async () => {
          executionOrder.push('normal');
          return { result: HookResult.CONTINUE };
        },
      });

      registry.register({
        event: 'PreToolUse',
        name: 'monitor-hook',
        priority: HookPriority.MONITOR,
        handler: async () => {
          executionOrder.push('monitor');
          return { result: HookResult.CONTINUE };
        },
      });

      await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(executionOrder).toEqual(['prevent', 'monitor']);
    });

    it('should continue on error when continueOnError is true', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'error-hook',
        priority: HookPriority.HIGH,
        handler: async () => {
          throw new Error('Test error');
        },
      });

      registry.register({
        event: 'PreToolUse',
        name: 'continue-hook',
        priority: HookPriority.LOW,
        handler: async () => ({ result: HookResult.CONTINUE }),
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.executedHooks).toBe(2);
      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
      expect(result.hookResults[1].result).toBe(HookResult.CONTINUE);
    });

    it('should handle boolean return values', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'false-hook',
        handler: async () => ({ prevent: true }),
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.prevented).toBe(true);
    });

    it('should return empty result when no hooks registered', async () => {
      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.totalHooks).toBe(0);
    });

    it('should return empty result when hooks are disabled', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => ({ result: HookResult.CONTINUE }),
      });

      registry.enabled = false;

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.result).toBe(HookResult.CONTINUE);
    });
  });

  describe('timeout', () => {
    it('should timeout long-running hooks', async () => {
      registry.register({
        event: 'PreToolUse',
        name: 'slow-hook',
        timeout: 100,
        handler: async ({ signal }) => {
          // Handler that respects abort signal
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 500);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('Hook execution aborted (timeout)'));
            });
          });
          return { result: HookResult.CONTINUE };
        },
      });

      const result = await executor.trigger('PreToolUse', { toolName: 'test' });

      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
      expect(result.hookResults[0].error).toContain('timeout');
    });
  });

  describe('cancelHook', () => {
    it('should cancel running hook', async () => {
      let hookStarted = false;

      registry.register({
        event: 'PreToolUse',
        name: 'cancellable-hook',
        handler: async ({ signal }) => {
          hookStarted = true;
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 5000);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('Aborted'));
            });
          });
          return { result: HookResult.CONTINUE };
        },
      });

      const hookId = registry.listHooks()[0].id;

      // Start trigger in background
      const triggerPromise = executor.trigger('PreToolUse', { toolName: 'test' });

      // Wait for hook to start
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(hookStarted).toBe(true);

      // Cancel the hook
      const cancelled = executor.cancelHook(hookId);
      expect(cancelled).toBe(true);

      // Wait for trigger to complete
      const result = await triggerPromise;
      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
    });
  });
});

describe('HookSystem', () => {
  let hookSystem;

  beforeEach(async () => {
    hookSystem = new HookSystem({ autoLoadConfig: false });
    await hookSystem.initialize();
  });

  afterEach(() => {
    hookSystem.clear();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(hookSystem.initialized).toBe(true);
    });

    it('should register builtin hooks', () => {
      const hooks = hookSystem.listHooks();
      const builtinHooks = hooks.filter((h) => h.name.startsWith('builtin:'));
      expect(builtinHooks.length).toBeGreaterThan(0);
    });
  });

  describe('API', () => {
    it('should register and trigger hooks', async () => {
      let triggered = false;

      hookSystem.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => {
          triggered = true;
          return { result: HookResult.CONTINUE };
        },
      });

      await hookSystem.trigger('PreToolUse', { toolName: 'test' });

      expect(triggered).toBe(true);
    });

    it('should get event types', () => {
      const eventTypes = hookSystem.getEventTypes();
      expect(eventTypes).toContain('PreToolUse');
      expect(eventTypes).toContain('PostToolUse');
      expect(eventTypes).toContain('SessionStart');
    });

    it('should enable/disable globally', () => {
      hookSystem.setEnabled(false);
      expect(hookSystem.isEnabled()).toBe(false);

      hookSystem.setEnabled(true);
      expect(hookSystem.isEnabled()).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit hook-registered event', async () => {
      const eventPromise = new Promise((resolve) => {
        hookSystem.on('hook-registered', (data) => {
          resolve(data);
        });
      });

      hookSystem.register({
        event: 'PreToolUse',
        name: 'event-test-hook',
        handler: async () => ({}),
      });

      const data = await eventPromise;
      expect(data.hook.name).toBe('event-test-hook');
    });

    it('should emit execution-complete event', async () => {
      hookSystem.register({
        event: 'PreToolUse',
        name: 'test-hook',
        handler: async () => ({ result: HookResult.CONTINUE }),
      });

      const eventPromise = new Promise((resolve) => {
        hookSystem.on('execution-complete', (data) => {
          resolve(data);
        });
      });

      hookSystem.trigger('PreToolUse', { toolName: 'test' });

      const data = await eventPromise;
      expect(data.eventName).toBe('PreToolUse');
      expect(data.executedHooks).toBe(1);
    });
  });
});
