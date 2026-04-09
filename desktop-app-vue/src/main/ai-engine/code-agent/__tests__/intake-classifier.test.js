import { describe, it, expect } from "vitest";

const {
  classifyIntake,
  bucketByBoundary,
  countDistinctScopes,
  collectTaskScopes,
  MONOREPO_BOUNDARIES,
} = require("../intake-classifier.js");

describe("intake-classifier helpers", () => {
  it("bucketByBoundary recognizes monorepo boundaries", () => {
    expect(bucketByBoundary("desktop-app-vue/src/main/ai-engine/foo.js")).toBe(
      "desktop-app-vue/src/main",
    );
    expect(bucketByBoundary("desktop-app-vue/src/renderer/pages/x.vue")).toBe(
      "desktop-app-vue/src/renderer",
    );
    expect(bucketByBoundary("packages/cli/src/commands/foo.js")).toBe(
      "packages/cli/src",
    );
  });

  it("bucketByBoundary normalizes backslashes and leading slashes", () => {
    expect(bucketByBoundary("\\desktop-app-vue\\src\\main\\index.js")).toBe(
      "desktop-app-vue/src/main",
    );
  });

  it("bucketByBoundary falls back to first two segments", () => {
    expect(bucketByBoundary("foo/bar/baz.ts")).toBe("foo/bar");
    expect(bucketByBoundary("only")).toBe("only");
    expect(bucketByBoundary("")).toBeNull();
    expect(bucketByBoundary(null)).toBeNull();
  });

  it("countDistinctScopes counts unique boundaries", () => {
    expect(
      countDistinctScopes([
        "desktop-app-vue/src/main/a.js",
        "desktop-app-vue/src/main/b.js",
        "desktop-app-vue/src/renderer/c.vue",
      ]),
    ).toBe(2);
    expect(countDistinctScopes([])).toBe(0);
  });

  it("collectTaskScopes dedupes across tasks", () => {
    const scopes = collectTaskScopes({
      tasks: [
        { id: "t1", scopePaths: ["desktop-app-vue/src/main"] },
        {
          id: "t2",
          scopePaths: [
            "desktop-app-vue/src/main",
            "desktop-app-vue/src/renderer",
          ],
        },
        { id: "t3" }, // no scopePaths
      ],
    });
    expect(scopes.sort()).toEqual(
      ["desktop-app-vue/src/main", "desktop-app-vue/src/renderer"].sort(),
    );
  });

  it("exposes the canonical boundary list", () => {
    expect(MONOREPO_BOUNDARIES).toContain("desktop-app-vue/src/main");
    expect(MONOREPO_BOUNDARIES).toContain("packages/cli/src");
  });
});

describe("classifyIntake — scope-based decision", () => {
  it("single scope → ralph with high confidence", () => {
    const res = classifyIntake({
      request: "fix the logger initialization",
      scopePaths: ["desktop-app-vue/src/main/utils/logger.js"],
    });
    expect(res.decision).toBe("ralph");
    expect(res.confidence).toBe("high");
    expect(res.scopeCount).toBe(1);
    expect(res.boundaries).toEqual(["desktop-app-vue/src/main"]);
    expect(res.recommendedConcurrency).toBe(1);
    expect(res.suggestedRoles).toContain("executor");
  });

  it("two scopes → team with high confidence + role hints", () => {
    const res = classifyIntake({
      request: "add IPC + Pinia store for workflow sessions",
      scopePaths: [
        "desktop-app-vue/src/main/ai-engine/code-agent/x.js",
        "desktop-app-vue/src/renderer/stores/x.ts",
      ],
    });
    expect(res.decision).toBe("team");
    expect(res.confidence).toBe("high");
    expect(res.scopeCount).toBe(2);
    expect(res.boundaries.sort()).toEqual(
      ["desktop-app-vue/src/main", "desktop-app-vue/src/renderer"].sort(),
    );
    expect(res.suggestedRoles).toEqual(
      expect.arrayContaining(["executor/main", "executor/ui"]),
    );
    expect(res.complexity).toBe("complex");
  });

  it("text-only multi-module hint → team with low confidence", () => {
    const res = classifyIntake({
      request:
        "Wire the main process and renderer together for the new session panel",
    });
    expect(res.decision).toBe("team");
    expect(res.confidence).toBe("low");
    expect(res.signals).toEqual(
      expect.arrayContaining([expect.stringContaining("modules")]),
    );
  });

  it("cross-cutting phrase without scopes → team low confidence", () => {
    const res = classifyIntake({
      request: "Update error handling across all modules in the monorepo",
    });
    expect(res.decision).toBe("team");
    expect(res.confidence).toBe("low");
    expect(res.signals).toEqual(
      expect.arrayContaining(["cross-cutting phrase in request"]),
    );
  });

  it("trivial phrase → ralph regardless of length", () => {
    const res = classifyIntake({ request: "Fix a typo in the README" });
    expect(res.decision).toBe("ralph");
    expect(res.confidence).toBe("high");
    expect(res.complexity).toBe("trivial");
    expect(res.signals).toContain("trivial edit");
  });

  it("empty input → ralph moderate (no signal)", () => {
    const res = classifyIntake({});
    expect(res.decision).toBe("ralph");
    expect(res.confidence).toBe("medium");
    expect(res.scopeCount).toBe(0);
    expect(res.complexity).toBe("simple");
  });

  it("tasks.json payload is used for scope evidence", () => {
    const res = classifyIntake({
      request: "ship the thing",
      tasks: {
        tasks: [
          {
            id: "t1",
            scopePaths: ["desktop-app-vue/src/main/a.js"],
          },
          {
            id: "t2",
            scopePaths: ["backend/project-service/src/foo.java"],
          },
        ],
      },
    });
    expect(res.decision).toBe("team");
    expect(res.scopeCount).toBe(2);
    expect(res.boundaries.sort()).toEqual(
      ["backend/project-service", "desktop-app-vue/src/main"].sort(),
    );
  });

  it("fileHints are merged with scopePaths", () => {
    const res = classifyIntake({
      request: "refactor",
      scopePaths: ["desktop-app-vue/src/main/a.js"],
      fileHints: ["docs/adr.md"],
    });
    expect(res.scopeCount).toBe(2);
    expect(res.decision).toBe("team");
  });

  it("testHeavy request biases suggestedRoles toward tester", () => {
    const res = classifyIntake({
      request: "Add unit tests for the session state manager",
      scopePaths: ["desktop-app-vue/src/main/ai-engine/code-agent/x.js"],
    });
    expect(res.decision).toBe("ralph");
    expect(res.testHeavy).toBe(true);
    expect(res.suggestedRoles).toContain("tester/unit");
  });

  it("team decision with testHeavy adds tester role", () => {
    const res = classifyIntake({
      request: "Add integration tests and expand test coverage",
      scopePaths: [
        "desktop-app-vue/src/main/a.js",
        "desktop-app-vue/tests/integration/b.test.js",
      ],
    });
    expect(res.decision).toBe("team");
    expect(res.testHeavy).toBe(true);
    expect(res.suggestedRoles).toEqual(
      expect.arrayContaining(["executor/main", "tester/unit"]),
    );
  });

  it("recommendedConcurrency honours the concurrency cap", () => {
    const res = classifyIntake({
      request: "big refactor",
      scopePaths: [
        "desktop-app-vue/src/main/a.js",
        "desktop-app-vue/src/renderer/b.ts",
        "backend/project-service/c.java",
        "packages/cli/src/d.js",
      ],
      concurrency: 2,
    });
    expect(res.decision).toBe("team");
    expect(res.scopeCount).toBe(4);
    expect(res.recommendedConcurrency).toBe(2); // clamped by user's cap
  });

  it("recommendedConcurrency defaults to 3 and clamps at 6", () => {
    const res = classifyIntake({
      request: "touch everything",
      scopePaths: [
        "desktop-app-vue/src/main/a.js",
        "desktop-app-vue/src/renderer/b.ts",
        "backend/project-service/c.java",
      ],
    });
    expect(res.recommendedConcurrency).toBe(3);
  });

  it("includes reason string for UI display", () => {
    const res = classifyIntake({
      request: "only touch main",
      scopePaths: ["desktop-app-vue/src/main/index.js"],
    });
    expect(res.reason).toMatch(/single scope/);
    expect(res.reason).toMatch(/desktop-app-vue\/src\/main/);
  });

  it("ignores non-array scopePaths gracefully", () => {
    const res = classifyIntake({
      request: "fix",
      scopePaths: "not-an-array",
    });
    expect(res.scopeCount).toBe(0);
    expect(res.decision).toBe("ralph");
  });
});
