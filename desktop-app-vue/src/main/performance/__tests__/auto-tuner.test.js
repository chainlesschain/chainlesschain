/**
 * AutoTuner Unit Tests
 *
 * Covers:
 * - Constructor / default state
 * - initialize() with dependencies
 * - _loadDefaultRules() creates 5 built-in rules
 * - getRules() serializable output
 * - enableRule / disableRule toggling
 * - addRule() / removeRule()
 * - evaluate() condition checking and cooldown
 * - manualTune() forces action without condition check
 * - getTuningHistory() limit and ordering
 * - getStats() shape
 * - start() / stop() interval management
 * - 'rule-triggered' event emission
 * - Cooldown hysteresis prevents double-trigger
 * - consecutiveRequired threshold
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-1234") }));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
}));

const { AutoTuner } = require("../auto-tuner.js");

describe("AutoTuner", () => {
  let tuner;

  beforeEach(() => {
    vi.useFakeTimers();
    tuner = new AutoTuner();
  });

  afterEach(() => {
    tuner.stop();
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------------

  describe("constructor", () => {
    it("creates instance with empty rules map and zero stats", () => {
      expect(tuner.rules).toBeInstanceOf(Map);
      expect(tuner.rules.size).toBe(0);
      expect(tuner.history).toEqual([]);
      expect(tuner.running).toBe(false);
      expect(tuner._intervalId).toBeNull();
      expect(tuner._stats.totalEvaluations).toBe(0);
      expect(tuner._stats.totalTriggers).toBe(0);
    });

    it("has default maxHistory of 500", () => {
      expect(tuner.maxHistory).toBe(500);
    });
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("stores dependency references", () => {
      const mockDb = { pragma: vi.fn() };
      const mockCollector = { getSnapshot: vi.fn() };
      const mockMonitor = { getSummary: vi.fn() };

      tuner.initialize({
        database: mockDb,
        performanceCollector: mockCollector,
        performanceMonitor: mockMonitor,
      });

      expect(tuner.deps.database).toBe(mockDb);
      expect(tuner.deps.performanceCollector).toBe(mockCollector);
      expect(tuner.deps.performanceMonitor).toBe(mockMonitor);
    });

    it("loads 5 default rules after initialize()", () => {
      tuner.initialize({});
      expect(tuner.rules.size).toBe(5);
    });

    it("initializes with null dependencies when none provided", () => {
      tuner.initialize({});
      expect(tuner.deps.database).toBeNull();
      expect(tuner.deps.performanceCollector).toBeNull();
      expect(tuner.deps.performanceMonitor).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // _loadDefaultRules()
  // ----------------------------------------------------------------

  describe("_loadDefaultRules()", () => {
    it("creates exactly 5 built-in rules", () => {
      tuner._loadDefaultRules();
      expect(tuner.rules.size).toBe(5);
    });

    it("creates expected built-in rule IDs", () => {
      tuner._loadDefaultRules();
      expect(tuner.rules.has("db-slow-queries")).toBe(true);
      expect(tuner.rules.has("db-vacuum")).toBe(true);
      expect(tuner.rules.has("llm-high-latency")).toBe(true);
      expect(tuner.rules.has("memory-pressure")).toBe(true);
      expect(tuner.rules.has("p2p-connections")).toBe(true);
    });

    it("all default rules are enabled by default", () => {
      tuner._loadDefaultRules();
      for (const rule of tuner.rules.values()) {
        expect(rule.enabled).toBe(true);
      }
    });

    it("all default rules have condition and action functions", () => {
      tuner._loadDefaultRules();
      for (const rule of tuner.rules.values()) {
        expect(typeof rule.condition).toBe("function");
        expect(typeof rule.action).toBe("function");
      }
    });
  });

  // ----------------------------------------------------------------
  // getRules()
  // ----------------------------------------------------------------

  describe("getRules()", () => {
    it("returns array of serializable rule objects", () => {
      tuner._loadDefaultRules();
      const rules = tuner.getRules();

      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBe(5);

      const rule = rules[0];
      expect(typeof rule.id).toBe("string");
      expect(typeof rule.name).toBe("string");
      expect(typeof rule.enabled).toBe("boolean");
      expect(typeof rule.cooldownMs).toBe("number");
      // No functions in serializable output
      expect(rule.condition).toBeUndefined();
      expect(rule.action).toBeUndefined();
    });

    it("includes triggerCount and consecutiveCount fields", () => {
      tuner._loadDefaultRules();
      const rules = tuner.getRules();
      for (const rule of rules) {
        expect(typeof rule.triggerCount).toBe("number");
        expect(typeof rule.consecutiveCount).toBe("number");
      }
    });
  });

  // ----------------------------------------------------------------
  // enableRule() / disableRule()
  // ----------------------------------------------------------------

  describe("enableRule() / disableRule()", () => {
    beforeEach(() => tuner._loadDefaultRules());

    it("disableRule() sets enabled to false", () => {
      const result = tuner.disableRule("memory-pressure");
      expect(result).toBe(true);
      expect(tuner.rules.get("memory-pressure").enabled).toBe(false);
    });

    it("disableRule() resets consecutiveCount to 0", () => {
      const rule = tuner.rules.get("memory-pressure");
      rule.consecutiveCount = 3;
      tuner.disableRule("memory-pressure");
      expect(rule.consecutiveCount).toBe(0);
    });

    it("enableRule() sets enabled back to true", () => {
      tuner.disableRule("memory-pressure");
      const result = tuner.enableRule("memory-pressure");
      expect(result).toBe(true);
      expect(tuner.rules.get("memory-pressure").enabled).toBe(true);
    });

    it("enableRule() returns false for non-existent rule", () => {
      expect(tuner.enableRule("nonexistent-rule")).toBe(false);
    });

    it("disableRule() returns false for non-existent rule", () => {
      expect(tuner.disableRule("nonexistent-rule")).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // addRule() / removeRule()
  // ----------------------------------------------------------------

  describe("addRule() / removeRule()", () => {
    it("addRule() inserts a custom rule into the map", () => {
      tuner.addRule({
        id: "custom-test-rule",
        name: "Custom Test Rule",
        description: "A test rule",
        condition: () => false,
        action: () => "custom action executed",
      });

      expect(tuner.rules.has("custom-test-rule")).toBe(true);
      const rule = tuner.rules.get("custom-test-rule");
      expect(rule.enabled).toBe(true);
      expect(rule.cooldownMs).toBe(10 * 60 * 1000);
      expect(rule.consecutiveRequired).toBe(1);
    });

    it("addRule() throws when id is missing", () => {
      expect(() =>
        tuner.addRule({
          name: "No ID",
          condition: () => false,
          action: () => "",
        }),
      ).toThrow("Rule must have an id");
    });

    it("addRule() throws when condition is not a function", () => {
      expect(() =>
        tuner.addRule({
          id: "bad-rule",
          condition: "not-a-function",
          action: () => "",
        }),
      ).toThrow("Rule must have a condition function");
    });

    it("addRule() throws when action is not a function", () => {
      expect(() =>
        tuner.addRule({
          id: "bad-rule",
          condition: () => false,
          action: "not-a-function",
        }),
      ).toThrow("Rule must have an action function");
    });

    it("removeRule() deletes an existing rule and returns true", () => {
      tuner.addRule({
        id: "removable-rule",
        name: "Removable",
        condition: () => false,
        action: () => "",
      });
      expect(tuner.removeRule("removable-rule")).toBe(true);
      expect(tuner.rules.has("removable-rule")).toBe(false);
    });

    it("removeRule() returns false when rule does not exist", () => {
      expect(tuner.removeRule("ghost-rule")).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // evaluate()
  // ----------------------------------------------------------------

  describe("evaluate()", () => {
    it("increments totalEvaluations on each call", () => {
      tuner.evaluate();
      tuner.evaluate();
      expect(tuner._stats.totalEvaluations).toBe(2);
    });

    it("triggers rule whose condition returns true", () => {
      const actionFn = vi.fn(() => "action result");
      tuner.addRule({
        id: "always-true",
        name: "Always True",
        description: "Fires immediately",
        condition: () => true,
        action: actionFn,
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      tuner.evaluate();

      expect(actionFn).toHaveBeenCalledOnce();
      expect(tuner._stats.totalTriggers).toBe(1);
      expect(tuner.history.length).toBe(1);
    });

    it("does NOT trigger rule whose condition returns false", () => {
      const actionFn = vi.fn();
      tuner.addRule({
        id: "always-false",
        name: "Always False",
        condition: () => false,
        action: actionFn,
      });

      tuner.evaluate();

      expect(actionFn).not.toHaveBeenCalled();
      expect(tuner._stats.totalTriggers).toBe(0);
    });

    it("does NOT trigger disabled rule", () => {
      const actionFn = vi.fn();
      tuner.addRule({
        id: "disabled-rule",
        name: "Disabled",
        condition: () => true,
        action: actionFn,
        cooldownMs: 0,
      });
      tuner.disableRule("disabled-rule");

      tuner.evaluate();

      expect(actionFn).not.toHaveBeenCalled();
    });

    it("emits rule-triggered event when rule fires", () => {
      const listener = vi.fn();
      tuner.on("rule-triggered", listener);

      tuner.addRule({
        id: "emit-test",
        name: "Emit Test",
        condition: () => true,
        action: () => "emitted",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      tuner.evaluate();

      expect(listener).toHaveBeenCalledOnce();
      const entry = listener.mock.calls[0][0];
      expect(entry.ruleId).toBe("emit-test");
      expect(entry.result).toBe("emitted");
    });

    it("respects cooldown — does not re-trigger within cooldownMs", () => {
      const actionFn = vi.fn(() => "action");
      tuner.addRule({
        id: "cooldown-test",
        name: "Cooldown Test",
        condition: () => true,
        action: actionFn,
        cooldownMs: 60000,
        consecutiveRequired: 1,
      });

      tuner.evaluate(); // First trigger
      tuner.evaluate(); // Should be blocked by cooldown

      expect(actionFn).toHaveBeenCalledOnce();
    });

    it("triggers again after cooldown has elapsed", () => {
      const actionFn = vi.fn(() => "action");
      tuner.addRule({
        id: "cooldown-elapsed",
        name: "Cooldown Elapsed",
        condition: () => true,
        action: actionFn,
        cooldownMs: 5000,
        consecutiveRequired: 1,
      });

      tuner.evaluate(); // First trigger
      vi.advanceTimersByTime(6000); // Advance past cooldown
      tuner.evaluate(); // Second trigger should fire

      expect(actionFn).toHaveBeenCalledTimes(2);
    });

    it("requires consecutive hits before triggering (consecutiveRequired = 3)", () => {
      const actionFn = vi.fn(() => "action");
      tuner.addRule({
        id: "consecutive-test",
        name: "Consecutive Test",
        condition: () => true,
        action: actionFn,
        cooldownMs: 0,
        consecutiveRequired: 3,
      });

      tuner.evaluate(); // count = 1, no trigger
      expect(actionFn).not.toHaveBeenCalled();

      tuner.evaluate(); // count = 2, no trigger
      expect(actionFn).not.toHaveBeenCalled();

      tuner.evaluate(); // count = 3, trigger
      expect(actionFn).toHaveBeenCalledOnce();
    });

    it("resets consecutiveCount when condition returns false", () => {
      let conditionResult = true;
      tuner.addRule({
        id: "reset-consecutive",
        name: "Reset Consecutive",
        condition: () => conditionResult,
        action: () => "",
        cooldownMs: 0,
        consecutiveRequired: 3,
      });

      tuner.evaluate(); // count = 1
      conditionResult = false;
      tuner.evaluate(); // count reset to 0
      conditionResult = true;
      tuner.evaluate(); // count = 1 again

      const rule = tuner.rules.get("reset-consecutive");
      expect(rule.consecutiveCount).toBe(1);
    });

    it("uses performanceCollector.getSnapshot() if available", () => {
      const mockSnapshot = { system: { memory: 90 }, llm: {}, ipc: {} };
      const mockCollector = { getSnapshot: vi.fn(() => mockSnapshot) };
      tuner.initialize({ performanceCollector: mockCollector });

      tuner.evaluate();

      expect(mockCollector.getSnapshot).toHaveBeenCalled();
    });

    it("falls back to performanceMonitor.getSummary() when no collector", () => {
      const mockSummary = { system: {}, llm: {}, ipc: {} };
      const mockMonitor = { getSummary: vi.fn(() => mockSummary) };
      tuner.initialize({ performanceMonitor: mockMonitor });

      tuner.evaluate();

      expect(mockMonitor.getSummary).toHaveBeenCalled();
    });

    it("returns array of triggered entries", () => {
      tuner.addRule({
        id: "return-test",
        name: "Return Test",
        condition: () => true,
        action: () => "result",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      const triggered = tuner.evaluate();
      expect(Array.isArray(triggered)).toBe(true);
      expect(triggered.length).toBe(1);
      expect(triggered[0].ruleId).toBe("return-test");
    });
  });

  // ----------------------------------------------------------------
  // manualTune()
  // ----------------------------------------------------------------

  describe("manualTune()", () => {
    it("fires the action regardless of condition or cooldown", () => {
      const actionFn = vi.fn(() => "manual result");
      tuner.addRule({
        id: "manual-rule",
        name: "Manual Rule",
        condition: () => false, // condition would block normal evaluation
        action: actionFn,
        cooldownMs: 999999,
        consecutiveRequired: 99,
      });

      // Set lastTriggered so cooldown would normally block
      tuner.rules.get("manual-rule").lastTriggered = Date.now();

      const entry = tuner.manualTune("manual-rule");

      expect(actionFn).toHaveBeenCalledOnce();
      expect(entry).not.toBeNull();
      expect(entry.ruleId).toBe("manual-rule");
      expect(entry.action).toContain("[Manual]");
      expect(entry.result).toBe("manual result");
    });

    it("returns null when ruleId does not exist", () => {
      const result = tuner.manualTune("ghost-rule");
      expect(result).toBeNull();
    });

    it("increments totalTriggers on manualTune", () => {
      tuner.addRule({
        id: "manual-count",
        name: "Manual Count",
        condition: () => false,
        action: () => "done",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      tuner.manualTune("manual-count");
      expect(tuner._stats.totalTriggers).toBe(1);
    });

    it("emits rule-triggered event on manualTune", () => {
      const listener = vi.fn();
      tuner.on("rule-triggered", listener);

      tuner.addRule({
        id: "manual-emit",
        name: "Manual Emit",
        condition: () => false,
        action: () => "fired",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      tuner.manualTune("manual-emit");
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ----------------------------------------------------------------
  // getTuningHistory()
  // ----------------------------------------------------------------

  describe("getTuningHistory()", () => {
    it("returns empty array when no rules have fired", () => {
      expect(tuner.getTuningHistory()).toEqual([]);
    });

    it("returns history entries in most-recent-first order", () => {
      tuner.addRule({
        id: "hist-rule",
        name: "History Rule",
        condition: () => true,
        action: () => "ok",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      tuner.evaluate();
      vi.advanceTimersByTime(1);
      tuner.evaluate();

      const history = tuner.getTuningHistory(10);
      expect(history.length).toBe(2);
      // Most recent should be first
      expect(history[0].timestamp).toBeGreaterThanOrEqual(history[1].timestamp);
    });

    it("respects the limit parameter", () => {
      tuner.addRule({
        id: "hist-limit-rule",
        name: "History Limit",
        condition: () => true,
        action: () => "ok",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      for (let i = 0; i < 5; i++) {
        tuner.rules.get("hist-limit-rule").lastTriggered = null; // reset cooldown
        tuner.evaluate();
      }

      const history = tuner.getTuningHistory(3);
      expect(history.length).toBe(3);
    });
  });

  // ----------------------------------------------------------------
  // getStats()
  // ----------------------------------------------------------------

  describe("getStats()", () => {
    it("returns object with expected shape", () => {
      const stats = tuner.getStats();
      expect(typeof stats.totalEvaluations).toBe("number");
      expect(typeof stats.totalTriggers).toBe("number");
      expect(typeof stats.isRunning).toBe("boolean");
      expect(typeof stats.rulesCount).toBe("number");
      expect(typeof stats.enabledRulesCount).toBe("number");
      expect(typeof stats.historyCount).toBe("number");
    });

    it("isRunning is false before start()", () => {
      expect(tuner.getStats().isRunning).toBe(false);
    });

    it("isRunning becomes true after start()", () => {
      tuner._loadDefaultRules();
      tuner.start();
      expect(tuner.getStats().isRunning).toBe(true);
    });

    it("rulesCount reflects actual number of rules", () => {
      tuner._loadDefaultRules();
      expect(tuner.getStats().rulesCount).toBe(5);
    });
  });

  // ----------------------------------------------------------------
  // start() / stop()
  // ----------------------------------------------------------------

  describe("start() / stop()", () => {
    it("start() sets running to true", () => {
      tuner._loadDefaultRules();
      tuner.start();
      expect(tuner.running).toBe(true);
    });

    it("start() is idempotent — calling twice does not create two intervals", () => {
      tuner._loadDefaultRules();
      tuner.start();
      const firstIntervalId = tuner._intervalId;
      tuner.start(); // Second call should be a no-op
      expect(tuner._intervalId).toBe(firstIntervalId);
    });

    it("stop() sets running to false and clears interval", () => {
      tuner._loadDefaultRules();
      tuner.start();
      tuner.stop();
      expect(tuner.running).toBe(false);
      expect(tuner._intervalId).toBeNull();
    });

    it("stop() is safe to call when not running", () => {
      expect(() => tuner.stop()).not.toThrow();
    });

    it("evaluate() is called on interval tick after start()", () => {
      const evalSpy = vi.spyOn(tuner, "evaluate");
      tuner._loadDefaultRules();
      tuner.start();

      // start() calls evaluate() immediately (1 call)
      expect(evalSpy).toHaveBeenCalledOnce();

      // Advance by one evalInterval (default 5 min)
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(evalSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ----------------------------------------------------------------
  // Ring buffer (maxHistory)
  // ----------------------------------------------------------------

  describe("history ring buffer", () => {
    it("drops oldest entry when maxHistory is exceeded", () => {
      tuner.maxHistory = 3;
      tuner.addRule({
        id: "overflow-rule",
        name: "Overflow",
        condition: () => true,
        action: () => "ok",
        cooldownMs: 0,
        consecutiveRequired: 1,
      });

      for (let i = 0; i < 5; i++) {
        tuner.rules.get("overflow-rule").lastTriggered = null;
        tuner.evaluate();
      }

      expect(tuner.history.length).toBe(3);
    });
  });
});
