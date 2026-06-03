/**
 * useAgentsStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: enabledTemplates / disabledTemplates / templatesByType /
 *    totalTemplates / activeInstances / runningInstanceCount /
 *    completedTaskCount / overallSuccessRate (rounded %)
 *  - IPC action (mocked window.electronAPI.invoke): fetchTemplates success/failure
 *  - reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useAgentsStore } from "../agents";
import type { AgentTemplate, AgentInstance, AgentTaskHistory } from "../agents";

function tmpl(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "t1",
    name: "T1",
    type: "research",
    capabilities: "[]",
    tools: "[]",
    version: "1.0.0",
    enabled: true,
    created_at: 1700000000000,
    ...overrides,
  };
}

function inst(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: "i1",
    templateId: "t1",
    templateType: "research",
    status: "idle",
    createdAt: 1700000000000,
    ...overrides,
  };
}

function task(overrides: Partial<AgentTaskHistory> = {}): AgentTaskHistory {
  return { id: "h1", agent_id: "i1", template_type: "research", ...overrides };
}

describe("useAgentsStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useAgentsStore();
      expect(store.templates).toEqual([]);
      expect(store.instances).toEqual([]);
      expect(store.taskHistory).toEqual([]);
      expect(store.currentTemplate).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Template getters
  // -------------------------------------------------------------------------

  describe("template getters", () => {
    it("enabled / disabled split + totalTemplates", () => {
      const store = useAgentsStore();
      store.templates = [
        tmpl({ id: "a", enabled: true }),
        tmpl({ id: "b", enabled: false }),
        tmpl({ id: "c", enabled: true }),
      ];
      expect(store.enabledTemplates.map((t) => t.id)).toEqual(["a", "c"]);
      expect(store.disabledTemplates.map((t) => t.id)).toEqual(["b"]);
      expect(store.totalTemplates).toBe(3);
    });

    it("templatesByType groups by type, defaulting missing type to 'other'", () => {
      const store = useAgentsStore();
      store.templates = [
        tmpl({ id: "a", type: "research" }),
        tmpl({ id: "b", type: "coding" }),
        tmpl({ id: "c", type: "research" }),
        tmpl({ id: "d", type: "" }),
      ];
      const g = store.templatesByType;
      expect(g.research.map((t) => t.id)).toEqual(["a", "c"]);
      expect(g.coding.map((t) => t.id)).toEqual(["b"]);
      expect(g.other.map((t) => t.id)).toEqual(["d"]);
    });
  });

  // -------------------------------------------------------------------------
  // Instance + task getters
  // -------------------------------------------------------------------------

  describe("instance + task getters", () => {
    it("activeInstances includes running + idle; runningInstanceCount only running", () => {
      const store = useAgentsStore();
      store.instances = [
        inst({ id: "a", status: "running" }),
        inst({ id: "b", status: "idle" }),
        inst({ id: "c", status: "completed" }),
        inst({ id: "d", status: "failed" }),
      ];
      expect(store.activeInstances.map((i) => i.id)).toEqual(["a", "b"]);
      expect(store.runningInstanceCount).toBe(1);
    });

    it("completedTaskCount counts success === true", () => {
      const store = useAgentsStore();
      store.taskHistory = [
        task({ id: "h1", success: true }),
        task({ id: "h2", success: false }),
        task({ id: "h3", success: true }),
      ];
      expect(store.completedTaskCount).toBe(2);
    });

    it("overallSuccessRate is the rounded success percentage, 0 when no history", () => {
      const store = useAgentsStore();
      expect(store.overallSuccessRate).toBe(0);
      store.taskHistory = [
        task({ id: "h1", success: true }),
        task({ id: "h2", success: false }),
        task({ id: "h3", success: true }),
      ];
      expect(store.overallSuccessRate).toBe(67); // round(2/3*100)
    });
  });

  // -------------------------------------------------------------------------
  // fetchTemplates + reset
  // -------------------------------------------------------------------------

  describe("fetchTemplates", () => {
    it("loads templates from result.templates on success", async () => {
      const store = useAgentsStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        templates: [tmpl({ id: "x" })],
      });
      await store.fetchTemplates();
      expect(mockInvoke).toHaveBeenCalledWith("agents:template-list");
      expect(store.templates.map((t) => t.id)).toEqual(["x"]);
      expect(store.loading).toBe(false);
    });

    it("sets error on result.success === false", async () => {
      const store = useAgentsStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: "nope" });
      await store.fetchTemplates();
      expect(store.error).toBe("nope");
      expect(store.loading).toBe(false);
    });

    it("captures the message on IPC throw without rethrowing", async () => {
      const store = useAgentsStore();
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      await store.fetchTemplates(); // does not throw
      expect(store.error).toBe("boom");
      expect(store.loading).toBe(false);
    });
  });

  describe("reset", () => {
    it("restores initial state", () => {
      const store = useAgentsStore();
      store.templates = [tmpl()];
      store.error = "x";
      store.reset();
      expect(store.templates).toEqual([]);
      expect(store.error).toBeNull();
    });
  });
});
