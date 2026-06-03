/**
 * useGitHooksStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state defaults
 *  - runPreCommit / runImpactAnalysis / runAutoFix: success envelope stores result + returns data
 *  - Three action variants throw on envelope failure and capture error + clear loading
 *  - loadConfig / updateConfig / loadHistory / loadStats: success writes state
 *  - loadConfig etc. swallow thrown errors into error ref (no throw)
 *  - Getters: isPreCommitEnabled + lastResult
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useGitHooksStore } from "../git-hooks";

describe("useGitHooksStore", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("initializes with empty state + defaulted getters", () => {
    const store = useGitHooksStore();
    expect(store.config).toBeNull();
    expect(store.history).toEqual([]);
    expect(store.stats).toEqual({});
    expect(store.preCommitResults).toBeNull();
    expect(store.impactResults).toBeNull();
    expect(store.autoFixResults).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.isPreCommitEnabled).toBe(false);
    expect(store.lastResult).toBeNull();
  });

  it("runPreCommit() success writes preCommitResults + returns data", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        passed: true,
        issues: [],
        autoFixes: [],
        duration: 12,
        steps: [],
      },
    });
    const store = useGitHooksStore();
    const result = await store.runPreCommit(["a.ts"], { strict: true });
    expect(result.passed).toBe(true);
    expect(store.preCommitResults?.passed).toBe(true);
    expect(store.loading).toBe(false);
    expect(invoke).toHaveBeenCalledWith("git-hooks:run-pre-commit", {
      files: ["a.ts"],
      options: { strict: true },
    });
  });

  it("runPreCommit() envelope failure throws with explicit error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "lint failed" });
    const store = useGitHooksStore();
    await expect(store.runPreCommit(["x"])).rejects.toThrow("lint failed");
    expect(store.error).toBe("lint failed");
    expect(store.loading).toBe(false);
  });

  it("runPreCommit() missing envelope throws default message", async () => {
    invoke.mockResolvedValueOnce({ success: false });
    const store = useGitHooksStore();
    await expect(store.runPreCommit([])).rejects.toThrow("Pre-commit failed");
  });

  it("runImpactAnalysis() success stores impactResults", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        affectedFiles: ["b.ts"],
        suggestedTests: ["b.test.ts"],
        riskScore: 0.4,
        duration: 20,
      },
    });
    const store = useGitHooksStore();
    const r = await store.runImpactAnalysis(["b.ts"]);
    expect(r.riskScore).toBe(0.4);
    expect(store.impactResults?.affectedFiles).toEqual(["b.ts"]);
  });

  it("runImpactAnalysis() failure throws + captures error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "no commits" });
    const store = useGitHooksStore();
    await expect(store.runImpactAnalysis([])).rejects.toThrow("no commits");
    expect(store.error).toBe("no commits");
  });

  it("runAutoFix() success stores autoFixResults", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        fixed: ["a"],
        remaining: [],
        patchFiles: ["a.patch"],
        duration: 5,
      },
    });
    const store = useGitHooksStore();
    const r = await store.runAutoFix(["issue-1"]);
    expect(r.fixed).toEqual(["a"]);
    expect(store.autoFixResults?.patchFiles).toEqual(["a.patch"]);
  });

  it("runAutoFix() propagates thrown errors", async () => {
    invoke.mockRejectedValueOnce(new Error("spawn died"));
    const store = useGitHooksStore();
    await expect(store.runAutoFix([])).rejects.toThrow("spawn died");
    expect(store.error).toBe("spawn died");
    expect(store.loading).toBe(false);
  });

  it("loadConfig() success sets config + enables getter", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        preCommitEnabled: true,
        impactAnalysisEnabled: true,
        autoFixEnabled: false,
        maxAutoFixRetries: 3,
        preCommitSkills: [],
        impactSkills: [],
        autoFixSkills: [],
      },
    });
    const store = useGitHooksStore();
    await store.loadConfig();
    expect(store.isPreCommitEnabled).toBe(true);
    expect(store.config?.maxAutoFixRetries).toBe(3);
  });

  it("loadConfig() swallows thrown errors into error ref", async () => {
    invoke.mockRejectedValueOnce(new Error("config missing"));
    const store = useGitHooksStore();
    await expect(store.loadConfig()).resolves.toBeUndefined();
    expect(store.error).toBe("config missing");
    expect(store.config).toBeNull();
  });

  it("updateConfig() writes merged config from envelope", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        preCommitEnabled: false,
        impactAnalysisEnabled: true,
        autoFixEnabled: true,
        maxAutoFixRetries: 5,
        preCommitSkills: [],
        impactSkills: [],
        autoFixSkills: [],
      },
    });
    const store = useGitHooksStore();
    await store.updateConfig({ preCommitEnabled: false });
    expect(store.config?.preCommitEnabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith("git-hooks:set-config", {
      preCommitEnabled: false,
    });
  });

  it("loadHistory() writes history + lastResult getter", async () => {
    const entries = [
      { type: "pre-commit", timestamp: 1, result: { passed: true } },
      { type: "impact", timestamp: 2, result: {} },
    ];
    invoke.mockResolvedValueOnce({ success: true, data: entries });
    const store = useGitHooksStore();
    await store.loadHistory(5);
    expect(store.history).toEqual(entries);
    expect(store.lastResult).toEqual(entries[1]);
    expect(invoke).toHaveBeenCalledWith("git-hooks:get-history", 5);
  });

  it("loadStats() writes stats", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: { totalRuns: 42, passRate: 0.9 },
    });
    const store = useGitHooksStore();
    await store.loadStats();
    expect(store.stats).toEqual({ totalRuns: 42, passRate: 0.9 });
  });

  it("loadStats() swallows envelope non-success (no error surfaced)", async () => {
    invoke.mockResolvedValueOnce({ success: false });
    const store = useGitHooksStore();
    await store.loadStats();
    expect(store.stats).toEqual({});
    expect(store.error).toBeNull();
  });
});
