/**
 * Hook Executor Unit Tests
 *
 * Tests for the hook execution engine.
 *
 * @jest-environment node
 */

const { HookExecutor, HookResult } = require("../hook-executor");

// Mock registry
function createMockRegistry(hooks = []) {
  return {
    enabled: true,
    getHooks: (eventName, options = {}) => {
      return hooks.filter((h) => h.event === eventName && (h.enabled !== false));
    },
    updateStats: () => {},
  };
}

describe("HookExecutor", () => {
  let executor;
  let mockRegistry;

  beforeEach(() => {
    mockRegistry = createMockRegistry();
    executor = new HookExecutor(mockRegistry);
  });

  afterEach(() => {
    executor.cancelAll();
  });

  // ========================================
  // Constructor Tests
  // ========================================

  describe("constructor", () => {
    it("should initialize with registry reference", () => {
      expect(executor.registry).toBe(mockRegistry);
    });

    it("should set default options", () => {
      expect(executor.options.defaultTimeout).toBe(30000);
      expect(executor.options.maxConcurrent).toBe(10);
      expect(executor.options.continueOnError).toBe(true);
      expect(executor.options.parallelSamePriority).toBe(false);
    });

    it("should allow custom options", () => {
      const customExecutor = new HookExecutor(mockRegistry, {
        defaultTimeout: 5000,
        continueOnError: false,
      });

      expect(customExecutor.options.defaultTimeout).toBe(5000);
      expect(customExecutor.options.continueOnError).toBe(false);
    });

    it("should initialize empty running hooks map", () => {
      expect(executor.runningHooks).toBeInstanceOf(Map);
      expect(executor.runningHooks.size).toBe(0);
    });

    it("should extend EventEmitter", () => {
      expect(typeof executor.on).toBe("function");
      expect(typeof executor.emit).toBe("function");
    });
  });

  // ========================================
  // HookResult Constants Tests
  // ========================================

  describe("HookResult", () => {
    it("should have CONTINUE result", () => {
      expect(HookResult.CONTINUE).toBe("continue");
    });

    it("should have PREVENT result", () => {
      expect(HookResult.PREVENT).toBe("prevent");
    });

    it("should have MODIFY result", () => {
      expect(HookResult.MODIFY).toBe("modify");
    });

    it("should have ERROR result", () => {
      expect(HookResult.ERROR).toBe("error");
    });
  });

  // ========================================
  // trigger Tests
  // ========================================

  describe("trigger", () => {
    it("should return continue when registry is disabled", async () => {
      mockRegistry.enabled = false;
      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should return continue when no hooks registered", async () => {
      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.totalHooks).toBe(0);
      expect(result.executedHooks).toBe(0);
    });

    it("should execute hook and return continue", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "test-hook",
          type: "async",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.totalHooks).toBe(1);
      expect(result.executedHooks).toBe(1);
      expect(result.prevented).toBe(false);
    });

    it("should prevent operation when hook returns prevent", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "prevent-hook",
          type: "async",
          handler: async () => ({
            result: HookResult.PREVENT,
            reason: "Not allowed",
          }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.prevented).toBe(true);
      expect(result.preventReason).toBe("Not allowed");
    });

    it("should modify data when hook returns modify", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "modify-hook",
          type: "async",
          handler: async () => ({
            result: HookResult.MODIFY,
            data: { modified: true, extra: "value" },
          }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.data.modified).toBe(true);
      expect(result.data.extra).toBe("value");
      expect(result.modifications.modified).toBe(true);
    });

    it("should execute hooks in order", async () => {
      const executionOrder = [];

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "first-hook",
          type: "async",
          priority: 100,
          handler: async () => {
            executionOrder.push("first");
            return { result: HookResult.CONTINUE };
          },
        },
        {
          id: "hook-2",
          event: "PreToolUse",
          name: "second-hook",
          type: "async",
          priority: 500,
          handler: async () => {
            executionOrder.push("second");
            return { result: HookResult.CONTINUE };
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      await executor.trigger("PreToolUse", { toolName: "test" });

      expect(executionOrder).toEqual(["first", "second"]);
    });

    it("should skip non-monitor hooks after prevention", async () => {
      const executionOrder = [];

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "prevent-hook",
          type: "async",
          priority: 100,
          handler: async () => {
            executionOrder.push("prevent");
            return { result: HookResult.PREVENT };
          },
        },
        {
          id: "hook-2",
          event: "PreToolUse",
          name: "normal-hook",
          type: "async",
          priority: 500,
          handler: async () => {
            executionOrder.push("normal");
            return { result: HookResult.CONTINUE };
          },
        },
        {
          id: "hook-3",
          event: "PreToolUse",
          name: "monitor-hook",
          type: "async",
          priority: 1000, // Monitor priority
          handler: async () => {
            executionOrder.push("monitor");
            return { result: HookResult.CONTINUE };
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      await executor.trigger("PreToolUse", { toolName: "test" });

      expect(executionOrder).toEqual(["prevent", "monitor"]);
    });

    it("should continue on error when continueOnError is true", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "error-hook",
          type: "async",
          handler: async () => {
            throw new Error("Test error");
          },
        },
        {
          id: "hook-2",
          event: "PreToolUse",
          name: "continue-hook",
          type: "async",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.executedHooks).toBe(2);
      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
      expect(result.hookResults[1].result).toBe(HookResult.CONTINUE);
    });

    it("should throw error when continueOnError is false", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "error-hook",
          type: "async",
          handler: async () => {
            throw new Error("Critical error");
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry, { continueOnError: false });

      await expect(
        executor.trigger("PreToolUse", { toolName: "test" })
      ).rejects.toThrow("Critical error");
    });

    it("should emit execution-start event", async () => {
      let emittedData = null;
      executor.on("execution-start", (data) => {
        emittedData = data;
      });

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "test-hook",
          type: "async",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);
      executor.on("execution-start", (data) => {
        emittedData = data;
      });

      await executor.trigger("PreToolUse", { toolName: "test" });

      expect(emittedData).not.toBeNull();
      expect(emittedData.eventName).toBe("PreToolUse");
      expect(emittedData.hookCount).toBe(1);
    });

    it("should emit execution-complete event", async () => {
      let emittedData = null;

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "test-hook",
          type: "async",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);
      executor.on("execution-complete", (data) => {
        emittedData = data;
      });

      await executor.trigger("PreToolUse", { toolName: "test" });

      expect(emittedData).not.toBeNull();
      expect(emittedData.eventName).toBe("PreToolUse");
      expect(emittedData.totalHooks).toBe(1);
    });

    it("should emit hook-error event on error", async () => {
      let emittedData = null;

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "error-hook",
          type: "async",
          handler: async () => {
            throw new Error("Test error");
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);
      executor.on("hook-error", (data) => {
        emittedData = data;
      });

      await executor.trigger("PreToolUse", { toolName: "test" });

      expect(emittedData).not.toBeNull();
      expect(emittedData.hookId).toBe("hook-1");
      expect(emittedData.error).toBe("Test error");
    });
  });

  // ========================================
  // _normalizeResult Tests
  // ========================================

  describe("_normalizeResult", () => {
    it("should return continue for null result", () => {
      const result = executor._normalizeResult(null);
      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should return continue for undefined result", () => {
      const result = executor._normalizeResult(undefined);
      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should convert true to continue", () => {
      const result = executor._normalizeResult(true);
      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should convert false to prevent", () => {
      const result = executor._normalizeResult(false);
      expect(result.result).toBe(HookResult.PREVENT);
    });

    it("should handle prevent object", () => {
      const result = executor._normalizeResult({ prevent: true, reason: "Test" });
      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.reason).toBe("Test");
    });

    it("should handle blocked object", () => {
      const result = executor._normalizeResult({ blocked: true, message: "Blocked" });
      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.reason).toBe("Blocked");
    });

    it("should handle modify object", () => {
      const result = executor._normalizeResult({ modify: { key: "value" } });
      expect(result.result).toBe(HookResult.MODIFY);
      expect(result.data).toEqual({ key: "value" });
    });

    it("should handle data object", () => {
      const result = executor._normalizeResult({ data: { modified: true } });
      expect(result.result).toBe(HookResult.MODIFY);
      expect(result.data).toEqual({ modified: true });
    });

    it("should pass through valid result object", () => {
      const result = executor._normalizeResult({
        result: HookResult.PREVENT,
        reason: "Custom",
      });
      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.reason).toBe("Custom");
    });

    it("should wrap unknown object with continue", () => {
      const result = executor._normalizeResult({ custom: "data" });
      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.custom).toBe("data");
    });
  });

  // ========================================
  // _parseCommandOutput Tests
  // ========================================

  describe("_parseCommandOutput", () => {
    it("should return continue for empty output", () => {
      const result = executor._parseCommandOutput("");
      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should return continue for whitespace output", () => {
      const result = executor._parseCommandOutput("   \n  ");
      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should parse JSON output", () => {
      const result = executor._parseCommandOutput(
        '{"result": "prevent", "reason": "Test"}'
      );
      expect(result.result).toBe(HookResult.PREVENT);
      expect(result.reason).toBe("Test");
    });

    it("should treat non-JSON as message", () => {
      const result = executor._parseCommandOutput("Some message");
      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.message).toBe("Some message");
    });

    it("should handle invalid JSON", () => {
      const result = executor._parseCommandOutput("{invalid json}");
      expect(result.result).toBe(HookResult.CONTINUE);
      expect(result.message).toBe("{invalid json}");
    });
  });

  // ========================================
  // cancelHook Tests
  // ========================================

  describe("cancelHook", () => {
    it("should return false for non-existent hook", () => {
      const result = executor.cancelHook("non-existent");
      expect(result).toBe(false);
    });

    it("should cancel running hook", async () => {
      let hookStarted = false;

      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "slow-hook",
          type: "async",
          handler: async ({ signal }) => {
            hookStarted = true;
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 5000);
              signal.addEventListener("abort", () => {
                clearTimeout(timeout);
                reject(new Error("Aborted"));
              });
            });
            return { result: HookResult.CONTINUE };
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const triggerPromise = executor.trigger("PreToolUse", { toolName: "test" });

      // Wait for hook to start
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(hookStarted).toBe(true);

      // Cancel the hook
      const cancelled = executor.cancelHook("hook-1");
      expect(cancelled).toBe(true);

      // Wait for trigger to complete
      const result = await triggerPromise;
      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
    });
  });

  // ========================================
  // cancelAll Tests
  // ========================================

  describe("cancelAll", () => {
    it("should clear all running hooks", () => {
      // Manually add some controllers
      executor.runningHooks.set("hook-1", new AbortController());
      executor.runningHooks.set("hook-2", new AbortController());

      executor.cancelAll();

      expect(executor.runningHooks.size).toBe(0);
    });
  });

  // ========================================
  // getRunningCount Tests
  // ========================================

  describe("getRunningCount", () => {
    it("should return 0 initially", () => {
      expect(executor.getRunningCount()).toBe(0);
    });

    it("should return correct count", () => {
      executor.runningHooks.set("hook-1", new AbortController());
      executor.runningHooks.set("hook-2", new AbortController());

      expect(executor.getRunningCount()).toBe(2);
    });
  });

  // ========================================
  // _generateEventId Tests
  // ========================================

  describe("_generateEventId", () => {
    it("should generate unique event IDs", () => {
      const id1 = executor._generateEventId();
      const id2 = executor._generateEventId();

      expect(id1).not.toBe(id2);
    });

    it("should start with evt_ prefix", () => {
      const id = executor._generateEventId();
      expect(id.startsWith("evt_")).toBe(true);
    });

    it("should include timestamp", () => {
      const id = executor._generateEventId();
      const parts = id.split("_");
      const timestamp = parseInt(parts[1]);

      expect(timestamp).toBeGreaterThan(0);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  // ========================================
  // Timeout Tests
  // ========================================

  describe("timeout handling", () => {
    it("should timeout long-running hooks", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "slow-hook",
          type: "async",
          timeout: 50, // 50ms timeout
          handler: async ({ signal }) => {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 500);
              signal.addEventListener("abort", () => {
                clearTimeout(timeout);
                reject(new Error("Hook execution aborted (timeout)"));
              });
            });
            return { result: HookResult.CONTINUE };
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
      expect(result.hookResults[0].error).toContain("timeout");
    });
  });

  // ========================================
  // Hook Type Tests
  // ========================================

  describe("hook types", () => {
    it("should handle sync hook type", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "sync-hook",
          type: "sync",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should handle async hook type", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "async-hook",
          type: "async",
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { result: HookResult.CONTINUE };
          },
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.result).toBe(HookResult.CONTINUE);
    });

    it("should throw for unknown hook type", async () => {
      mockRegistry = createMockRegistry([
        {
          id: "hook-1",
          event: "PreToolUse",
          name: "unknown-hook",
          type: "unknown",
          handler: async () => ({ result: HookResult.CONTINUE }),
        },
      ]);
      executor = new HookExecutor(mockRegistry);

      const result = await executor.trigger("PreToolUse", { toolName: "test" });

      expect(result.hookResults[0].result).toBe(HookResult.ERROR);
      expect(result.hookResults[0].error).toContain("Unknown hook type");
    });
  });
});
