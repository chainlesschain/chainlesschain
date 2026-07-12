/**
 * Subagent contract (P1 "补齐 Subagent 契约") — normalization, inheritance/
 * override precedence, and the tighten-only security invariants. Pure module,
 * no I/O, fully deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  SUBAGENT_PERMISSION_MODES,
  SUBAGENT_EFFORT_LEVELS,
  normalizeCapabilityList,
  normalizeBudget,
  permissionRank,
  tightenPermissionMode,
  normalizeSubagentContract,
  resolveSubagentContract,
  capBudget,
  enforceRecursionLimits,
  resolveIsolationFailClosed,
} from "../../src/lib/subagent-contract.js";

describe("normalizeCapabilityList", () => {
  it("splits comma/space strings, trims, dedupes", () => {
    expect(normalizeCapabilityList("a, b  a c")).toEqual(["a", "b", "c"]);
  });
  it("distinguishes UNSPECIFIED (null) from EXPLICIT-NONE ([])", () => {
    expect(normalizeCapabilityList(null)).toBeNull();
    expect(normalizeCapabilityList(undefined)).toBeNull();
    expect(normalizeCapabilityList("")).toEqual([]); // explicit empty
    expect(normalizeCapabilityList([])).toEqual([]);
  });
});

describe("normalizeBudget", () => {
  it("accepts tokens/cost/time aliases, drops non-positive", () => {
    expect(normalizeBudget({ tokens: 1000, cost: 0.5, time: 60000 })).toEqual({
      tokens: 1000,
      costUsd: 0.5,
      timeMs: 60000,
    });
    expect(normalizeBudget({ tokens: -5, costUsd: 0 })).toBeNull();
    expect(normalizeBudget(null)).toBeNull();
  });
});

describe("permissionRank / tightenPermissionMode", () => {
  it("ranks plan < manual < default < acceptEdits < auto=dontAsk < bypass", () => {
    expect(permissionRank("plan")).toBeLessThan(permissionRank("manual"));
    expect(permissionRank("manual")).toBeLessThan(permissionRank("default"));
    expect(permissionRank("acceptEdits")).toBeLessThan(permissionRank("auto"));
    expect(permissionRank("auto")).toBe(permissionRank("dontAsk"));
    expect(permissionRank("bypassPermissions")).toBeGreaterThan(
      permissionRank("auto"),
    );
  });

  it("TIGHTEN-ONLY: a child cannot widen beyond the parent", () => {
    // parent manual; child asks for bypass → clamped to manual
    expect(tightenPermissionMode("manual", "bypassPermissions")).toBe("manual");
    // parent manual; child asks for plan (more restrictive) → honored
    expect(tightenPermissionMode("manual", "plan")).toBe("plan");
    // parent bypass; child asks acceptEdits → honored (child tightens)
    expect(tightenPermissionMode("bypassPermissions", "acceptEdits")).toBe(
      "acceptEdits",
    );
  });

  it("silent or invalid child request inherits the parent (fail-safe)", () => {
    expect(tightenPermissionMode("manual", null)).toBe("manual");
    expect(tightenPermissionMode("manual", "garbage")).toBe("manual");
    expect(tightenPermissionMode("garbage", "auto")).toBe("default"); // bad parent → default
  });

  it("every declared mode is a known permission mode", () => {
    for (const m of SUBAGENT_PERMISSION_MODES) {
      expect(permissionRank(m)).toBeTypeOf("number");
    }
  });
});

describe("normalizeSubagentContract", () => {
  it("canonicalizes all fields and drops invalid ones to null", () => {
    const c = normalizeSubagentContract({
      permissionMode: "auto",
      skills: "rag, search",
      mcpServers: ["fs"],
      hooks: "",
      memory: "true",
      effort: "max", // synonym → xhigh
      background: "yes",
      context: "fork",
      maxDepth: 3,
      maxChildren: "8",
      budget: { tokens: 5000 },
    });
    expect(c).toEqual({
      permissionMode: "auto",
      skills: ["rag", "search"],
      mcpServers: ["fs"],
      hooks: [], // explicit empty
      memory: true,
      effort: "xhigh",
      background: true,
      context: "fork",
      maxDepth: 3,
      maxChildren: 8,
      budget: { tokens: 5000, costUsd: null, timeMs: null },
    });
  });

  it("invalid enums/values degrade to null (never throw)", () => {
    const c = normalizeSubagentContract({
      permissionMode: "root",
      effort: "ludicrous",
      context: "clone",
      maxDepth: -2,
      background: "maybe",
    });
    expect(c.permissionMode).toBeNull();
    expect(c.effort).toBeNull();
    expect(c.context).toBeNull();
    expect(c.maxDepth).toBeNull();
    expect(c.background).toBeNull(); // unrecognized → unspecified
  });

  it("effort accepts the full vocabulary + synonyms", () => {
    for (const e of SUBAGENT_EFFORT_LEVELS) {
      expect(normalizeSubagentContract({ effort: e }).effort).toBe(e);
    }
    expect(normalizeSubagentContract({ effort: "med" }).effort).toBe("medium");
  });
});

describe("capBudget", () => {
  it("caps each field at the parent's remaining (null = unlimited)", () => {
    expect(
      capBudget({ tokens: 9000, costUsd: 1 }, { tokens: 4000, timeMs: 1000 }),
    ).toEqual({ tokens: 4000, costUsd: 1, timeMs: 1000 });
  });
  it("returns null when neither side constrains anything", () => {
    expect(capBudget(null, null)).toBeNull();
  });
});

describe("resolveSubagentContract — precedence", () => {
  it("spawnArgs > definition > parent for scalar fields", () => {
    const parent = { permissionMode: "auto", effort: "low" };
    const definition = normalizeSubagentContract({ effort: "high" });
    const spawnArgs = normalizeSubagentContract({ effort: "medium" });
    const eff = resolveSubagentContract({ parent, definition, spawnArgs });
    expect(eff.effort).toBe("medium"); // spawn wins
  });

  it("falls back to the definition when spawn is silent, then parent", () => {
    const parent = { effort: "low" };
    const definition = normalizeSubagentContract({ effort: "high" });
    expect(
      resolveSubagentContract({ parent, definition, spawnArgs: null }).effort,
    ).toBe("high");
    expect(
      resolveSubagentContract({ parent, definition: null, spawnArgs: null })
        .effort,
    ).toBe("low"); // inherit parent
  });
});

describe("resolveSubagentContract — security invariants", () => {
  it("permission is tighten-only end-to-end", () => {
    const eff = resolveSubagentContract({
      parent: { permissionMode: "manual" },
      spawnArgs: normalizeSubagentContract({
        permissionMode: "bypassPermissions",
      }),
    });
    expect(eff.permissionMode).toBe("manual"); // widening blocked
  });

  it("capabilities INTERSECT with the parent ceiling (never gain new)", () => {
    const eff = resolveSubagentContract({
      parent: { skills: ["rag", "search"], context: "fork" },
      spawnArgs: normalizeSubagentContract({ skills: "rag, exec, search" }),
    });
    expect(eff.skills.sort()).toEqual(["rag", "search"]); // 'exec' dropped
  });

  it("context:fresh withholds inherited capabilities; fork inherits", () => {
    const parent = { skills: ["rag"], mcpServers: ["fs"], memory: true };
    const fresh = resolveSubagentContract({
      parent,
      spawnArgs: normalizeSubagentContract({ context: "fresh" }),
    });
    expect(fresh.skills).toEqual([]); // withheld
    expect(fresh.mcpServers).toEqual([]);
    expect(fresh.memory).toBe(false);

    const fork = resolveSubagentContract({
      parent,
      spawnArgs: normalizeSubagentContract({ context: "fork" }),
    });
    expect(fork.skills).toEqual(["rag"]); // inherited
    expect(fork.mcpServers).toEqual(["fs"]);
    expect(fork.memory).toBe(true);
  });

  it("memory can never be granted when the parent explicitly denied it", () => {
    const eff = resolveSubagentContract({
      parent: { memory: false },
      spawnArgs: normalizeSubagentContract({ memory: true, context: "fork" }),
    });
    expect(eff.memory).toBe(false);
  });

  it("defaults to fresh isolation (no inherited caps) when unspecified", () => {
    const eff = resolveSubagentContract({
      parent: { skills: ["rag"], memory: true },
    });
    expect(eff.context).toBe("fresh");
    expect(eff.skills).toEqual([]);
    expect(eff.memory).toBe(false);
  });

  it("maxDepth/maxChildren ceilings can only be lowered, never raised", () => {
    const eff = resolveSubagentContract({
      parent: { maxDepth: 3, maxChildren: 5 },
      spawnArgs: normalizeSubagentContract({ maxDepth: 10, maxChildren: 2 }),
    });
    expect(eff.maxDepth).toBe(3); // child tried to raise → clamped to parent
    expect(eff.maxChildren).toBe(2); // child lowered → honored
  });

  it("budget is capped at the parent's remaining", () => {
    const eff = resolveSubagentContract({
      parent: { budgetRemaining: { tokens: 2000 } },
      spawnArgs: normalizeSubagentContract({ budget: { tokens: 9999 } }),
    });
    expect(eff.budget.tokens).toBe(2000);
  });
});

describe("enforceRecursionLimits (fail-closed)", () => {
  it("denies at or beyond the depth cap", () => {
    expect(
      enforceRecursionLimits({ depth: 2, contract: { maxDepth: 2 } }).ok,
    ).toBe(false);
    expect(
      enforceRecursionLimits({ depth: 1, contract: { maxDepth: 2 } }).ok,
    ).toBe(true);
  });

  it("denies at or beyond the breadth cap", () => {
    const r = enforceRecursionLimits({
      spawnedCount: 5,
      contract: { maxChildren: 5 },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/max sub-agents/);
  });

  it("uses the smaller of the contract ceiling and the hard cap", () => {
    // hard cap 3 wins over a looser contract ceiling of 10
    expect(
      enforceRecursionLimits({
        depth: 3,
        contract: { maxDepth: 10 },
        hardDepthCap: 3,
      }).ok,
    ).toBe(false);
  });

  it("is unbounded only when neither source sets a cap", () => {
    expect(enforceRecursionLimits({ depth: 99, spawnedCount: 99 }).ok).toBe(
      true,
    );
  });
});

describe("resolveIsolationFailClosed", () => {
  it("passes through when isolation is not requested", () => {
    expect(resolveIsolationFailClosed({ requested: null }).ok).toBe(true);
  });
  it("FAILS CLOSED when worktree is requested but unavailable", () => {
    const r = resolveIsolationFailClosed({
      requested: "worktree",
      available: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unavailable/);
  });
  it("allows worktree when available", () => {
    expect(
      resolveIsolationFailClosed({ requested: "worktree", available: true }).ok,
    ).toBe(true);
  });
});
