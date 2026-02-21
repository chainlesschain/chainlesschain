/**
 * GitHookRunner Unit Tests
 *
 * @jest-environment node
 */

const { GitHookRunner } = require("../git-hook-runner");

// ---------------------------------------------------------------------------
// Helpers to build mock collaborators
// ---------------------------------------------------------------------------

/**
 * Create a mock SkillRegistry whose getSkill / executeSkill behaviour can be
 * customised per-skill via a `skillMap`.
 *
 * @param {Object<string, Object>} skillMap  skillId -> { skill, executeResult }
 */
function createMockSkillRegistry(skillMap = {}) {
  return {
    getSkill: jest.fn((id) =>
      skillMap[id] ? skillMap[id].skill || { id } : null,
    ),
    executeSkill: jest.fn(async (id, _input, _opts) => {
      if (skillMap[id]?.executeError) {
        throw skillMap[id].executeError;
      }
      return skillMap[id]?.executeResult ?? { success: true };
    }),
  };
}

/**
 * Create a mock HookSystem with a minimal registry that records register() calls.
 */
function createMockHookSystem() {
  const registered = [];
  return {
    registered,
    registry: {
      register: jest.fn((hookDef) => {
        registered.push(hookDef);
        return `hook_${hookDef.name}`;
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHookRunner", () => {
  let runner;
  let registry;

  beforeEach(() => {
    registry = createMockSkillRegistry({
      "lint-and-fix": {
        skill: { id: "lint-and-fix" },
        executeResult: { success: true, issues: [], fixes: [] },
      },
      "code-review": {
        skill: { id: "code-review" },
        executeResult: { success: true, issues: [], fixes: [] },
      },
      "security-audit": {
        skill: { id: "security-audit" },
        executeResult: { success: true, issues: [], fixes: [] },
      },
      "impact-analyzer": {
        skill: { id: "impact-analyzer" },
        executeResult: {
          affectedFiles: ["src/a.js", "src/b.js"],
          suggestedTests: ["test/a.test.js"],
          riskScore: 5,
        },
      },
      "dependency-analyzer": {
        skill: { id: "dependency-analyzer" },
        executeResult: {
          affectedFiles: ["src/b.js", "src/c.js"],
          suggestedTests: ["test/a.test.js", "test/c.test.js"],
          riskScore: 3,
        },
      },
      bugbot: {
        skill: { id: "bugbot" },
        executeResult: {
          fixed: ["test/fail1.test.js"],
          patches: ["patches/fix1.patch"],
        },
      },
      "test-and-fix": {
        skill: { id: "test-and-fix" },
        executeResult: {
          fixed: ["test/fail2.test.js"],
          patches: ["patches/fix2.patch"],
        },
      },
    });

    runner = new GitHookRunner({
      pipelineEngine: {},
      skillRegistry: registry,
    });
  });

  afterEach(() => {
    runner.removeAllListeners();
  });

  // -------------------------------------------------------------------------
  // Construction & Initialization
  // -------------------------------------------------------------------------
  describe("construction and initialization", () => {
    it("should create an instance with default config", () => {
      const r = new GitHookRunner();
      expect(r).toBeInstanceOf(GitHookRunner);
      expect(r.config.preCommitEnabled).toBe(true);
      expect(r.config.impactAnalysisEnabled).toBe(true);
      expect(r.config.autoFixEnabled).toBe(false);
      expect(r.config.maxAutoFixRetries).toBe(3);
    });

    it("should store provided options", () => {
      const engine = { run: jest.fn() };
      const reg = { getSkill: jest.fn() };
      const hookSys = { registry: {} };

      const r = new GitHookRunner({
        pipelineEngine: engine,
        skillRegistry: reg,
        hookSystem: hookSys,
      });

      expect(r.pipelineEngine).toBe(engine);
      expect(r.skillRegistry).toBe(reg);
      expect(r.hookSystem).toBe(hookSys);
    });

    it("should default hookSystem to null when not provided", () => {
      const r = new GitHookRunner();
      expect(r.hookSystem).toBeNull();
    });

    it("should have an empty history on creation", () => {
      expect(runner.history).toEqual([]);
    });

    it("should have the correct default pre-commit skills", () => {
      expect(runner.config.preCommitSkills).toEqual([
        "lint-and-fix",
        "code-review",
        "security-audit",
      ]);
    });

    it("should have the correct default impact skills", () => {
      expect(runner.config.impactSkills).toEqual([
        "impact-analyzer",
        "dependency-analyzer",
      ]);
    });

    it("should have the correct default auto-fix skills", () => {
      expect(runner.config.autoFixSkills).toEqual([
        "bugbot",
        "test-and-fix",
        "lint-and-fix",
      ]);
    });

    it("should be an EventEmitter", () => {
      expect(typeof runner.on).toBe("function");
      expect(typeof runner.emit).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // registerGitHooks
  // -------------------------------------------------------------------------
  describe("registerGitHooks", () => {
    it("should register PreGitCommit and PostGitCommit hooks", () => {
      const hookSystem = createMockHookSystem();
      runner.registerGitHooks(hookSystem);

      expect(hookSystem.registry.register).toHaveBeenCalledTimes(2);

      const names = hookSystem.registered.map((h) => h.name);
      expect(names).toContain("git-hook-runner-pre-commit");
      expect(names).toContain("git-hook-runner-post-commit");
    });

    it("should store the hookSystem reference", () => {
      const hookSystem = createMockHookSystem();
      runner.registerGitHooks(hookSystem);
      expect(runner.hookSystem).toBe(hookSystem);
    });

    it("should handle null hookSystem gracefully", () => {
      expect(() => runner.registerGitHooks(null)).not.toThrow();
      expect(runner.hookSystem).toBeNull();
    });

    it("should handle hookSystem without registry", () => {
      const hookSystem = {};
      expect(() => runner.registerGitHooks(hookSystem)).not.toThrow();
      expect(runner.hookSystem).toBe(hookSystem);
    });

    describe("registered PreGitCommit handler", () => {
      it("should call runPreCommit with changedFiles from context", async () => {
        const hookSystem = createMockHookSystem();
        runner.registerGitHooks(hookSystem);

        const preCommitHook = hookSystem.registered.find(
          (h) => h.name === "git-hook-runner-pre-commit",
        );

        const res = await preCommitHook.handler({
          changedFiles: ["file1.js", "file2.js"],
        });

        expect(res.allowed).toBe(true);
        expect(res.result).toBeDefined();
        expect(res.result.passed).toBe(true);
      });

      it("should return allowed=true when preCommitEnabled is false", async () => {
        runner.config.preCommitEnabled = false;
        const hookSystem = createMockHookSystem();
        runner.registerGitHooks(hookSystem);

        const preCommitHook = hookSystem.registered.find(
          (h) => h.name === "git-hook-runner-pre-commit",
        );

        const res = await preCommitHook.handler({ changedFiles: ["a.js"] });
        expect(res.allowed).toBe(true);
        // Should not have called executeSkill because disabled
        expect(registry.executeSkill).not.toHaveBeenCalled();
      });

      it("should use empty array when context.changedFiles is missing", async () => {
        const hookSystem = createMockHookSystem();
        runner.registerGitHooks(hookSystem);

        const preCommitHook = hookSystem.registered.find(
          (h) => h.name === "git-hook-runner-pre-commit",
        );

        const res = await preCommitHook.handler({});
        expect(res.allowed).toBe(true);
      });
    });

    describe("registered PostGitCommit handler", () => {
      it("should emit post-commit event", async () => {
        const hookSystem = createMockHookSystem();
        runner.registerGitHooks(hookSystem);

        const postCommitHook = hookSystem.registered.find(
          (h) => h.name === "git-hook-runner-post-commit",
        );

        const eventPromise = new Promise((resolve) => {
          runner.on("post-commit", resolve);
        });

        await postCommitHook.handler({ commitHash: "abc123" });
        const eventData = await eventPromise;
        expect(eventData.commitHash).toBe("abc123");
      });
    });
  });

  // -------------------------------------------------------------------------
  // runPreCommit
  // -------------------------------------------------------------------------
  describe("runPreCommit", () => {
    it("should run all default pre-commit skills in order", async () => {
      const result = await runner.runPreCommit(["src/index.js"]);

      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.autoFixes).toEqual([]);
      expect(result.steps).toHaveLength(3);
      expect(result.steps.map((s) => s.skillId)).toEqual([
        "lint-and-fix",
        "code-review",
        "security-audit",
      ]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should pass changedFiles and options to executeSkill", async () => {
      const files = ["a.js", "b.js"];
      await runner.runPreCommit(files, { autoFix: true });

      expect(registry.executeSkill).toHaveBeenCalledWith(
        "lint-and-fix",
        { type: "git-pre-commit", files, autoFix: true },
        { gitHook: true },
      );
    });

    it("should use custom skills when provided in options", async () => {
      const result = await runner.runPreCommit(["src/index.js"], {
        skills: ["lint-and-fix"],
      });

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].skillId).toBe("lint-and-fix");
    });

    it("should collect issues from skill results", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [
              { message: "missing semicolon", severity: "warning", line: 10 },
              { message: "unused variable", severity: "warning", line: 20 },
            ],
            fixes: [],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true, issues: [], fixes: [] },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true, issues: [], fixes: [] },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["src/index.js"]);

      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].source).toBe("lint-and-fix");
      expect(result.issues[0].message).toBe("missing semicolon");
      expect(result.issues[1].source).toBe("lint-and-fix");
    });

    it('should assign default severity "warning" when not present', async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [{ message: "no severity given" }],
            fixes: [],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.issues[0].severity).toBe("warning");
    });

    it("should collect auto-fixes", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [],
            fixes: [{ file: "a.js", type: "semicolon" }],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: {
            success: true,
            fixes: [{ file: "b.js", type: "formatting" }],
          },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js", "b.js"]);
      expect(result.autoFixes).toHaveLength(2);
    });

    it("should fail when a step returns success=false and blocking=true", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: { success: false, blocking: true, issues: [] },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.passed).toBe(false);
    });

    it("should fail when there are error-severity issues", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [{ message: "syntax error", severity: "error" }],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.passed).toBe(false);
    });

    it("should fail when there are critical-severity issues", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: { success: true },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: {
            success: true,
            issues: [{ message: "hardcoded secret", severity: "critical" }],
          },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.passed).toBe(false);
    });

    it("should pass when issues are only warning-severity", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [{ message: "minor style", severity: "warning" }],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(1);
    });

    it("should skip skills that are not found in the registry", async () => {
      // Only lint-and-fix exists; code-review and security-audit are missing
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);

      // Only the found skill should produce a step
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].skillId).toBe("lint-and-fix");
      expect(result.passed).toBe(true);
    });

    it("should handle an empty changed files list", async () => {
      const result = await runner.runPreCommit([]);
      expect(result.passed).toBe(true);
      expect(result.steps).toHaveLength(3);
    });

    it("should set autoFix to true by default in the input", async () => {
      await runner.runPreCommit(["a.js"]);

      const firstCall = registry.executeSkill.mock.calls[0];
      expect(firstCall[1].autoFix).toBe(true);
    });

    it("should respect autoFix=false option", async () => {
      await runner.runPreCommit(["a.js"], { autoFix: false });

      const firstCall = registry.executeSkill.mock.calls[0];
      expect(firstCall[1].autoFix).toBe(false);
    });

    it("should record step durations", async () => {
      const result = await runner.runPreCommit(["a.js"]);

      for (const step of result.steps) {
        expect(typeof step.duration).toBe("number");
        expect(step.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("should record step issueCount and fixCount", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [{ message: "a" }, { message: "b" }],
            fixes: [{ file: "x.js" }],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.steps[0].issueCount).toBe(2);
      expect(result.steps[0].fixCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // runPreCommit – error handling
  // -------------------------------------------------------------------------
  describe("runPreCommit – error handling", () => {
    it("should continue to subsequent skills when one throws", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeError: new Error("Lint crashed"),
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].success).toBe(false);
      expect(result.steps[0].error).toBe("Lint crashed");
      expect(result.steps[1].success).toBe(true);
      expect(result.steps[2].success).toBe(true);
    });

    it("should still pass if a skill throws but no blocking issues", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeError: new Error("Lint crashed"),
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.passed).toBe(true);
    });

    it("should set step duration to 0 when skill throws", async () => {
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeError: new Error("boom"),
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runPreCommit(["a.js"]);
      expect(result.steps[0].duration).toBe(0);
    });

    it("should handle null skillRegistry gracefully", async () => {
      runner.skillRegistry = null;
      const result = await runner.runPreCommit(["a.js"]);

      // getSkill returns undefined, all skills are skipped
      expect(result.steps).toHaveLength(0);
      expect(result.passed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // runImpactAnalysis
  // -------------------------------------------------------------------------
  describe("runImpactAnalysis", () => {
    it("should aggregate affected files from multiple skills", async () => {
      const result = await runner.runImpactAnalysis(["src/a.js"]);

      // impact-analyzer returns [src/a.js, src/b.js]
      // dependency-analyzer returns [src/b.js, src/c.js]
      // After dedup: [src/a.js, src/b.js, src/c.js]
      expect(result.affectedFiles).toEqual(
        expect.arrayContaining(["src/a.js", "src/b.js", "src/c.js"]),
      );
      expect(result.affectedFiles).toHaveLength(3);
    });

    it("should aggregate suggested tests and deduplicate", async () => {
      const result = await runner.runImpactAnalysis(["src/a.js"]);

      // Both skills suggest test/a.test.js; dependency-analyzer also suggests test/c.test.js
      expect(result.suggestedTests).toContain("test/a.test.js");
      expect(result.suggestedTests).toContain("test/c.test.js");
      expect(result.suggestedTests).toHaveLength(2);
    });

    it("should take the maximum riskScore", async () => {
      const result = await runner.runImpactAnalysis(["src/a.js"]);

      // impact-analyzer: 5, dependency-analyzer: 3 => max = 5
      expect(result.riskScore).toBe(5);
    });

    it("should return steps for each executed skill", async () => {
      const result = await runner.runImpactAnalysis(["src/a.js"]);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].skillId).toBe("impact-analyzer");
      expect(result.steps[1].skillId).toBe("dependency-analyzer");
      expect(result.steps[0].success).toBe(true);
    });

    it("should have a duration >= 0", async () => {
      const result = await runner.runImpactAnalysis(["src/a.js"]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should skip skills not found in the registry", async () => {
      registry = createMockSkillRegistry({
        "impact-analyzer": {
          skill: { id: "impact-analyzer" },
          executeResult: {
            affectedFiles: ["x.js"],
            suggestedTests: [],
            riskScore: 2,
          },
        },
        // dependency-analyzer not in registry
      });
      runner.skillRegistry = registry;

      const result = await runner.runImpactAnalysis(["x.js"]);

      expect(result.steps).toHaveLength(1);
      expect(result.affectedFiles).toEqual(["x.js"]);
    });

    it("should handle skill execution errors gracefully", async () => {
      registry = createMockSkillRegistry({
        "impact-analyzer": {
          skill: { id: "impact-analyzer" },
          executeError: new Error("Analysis failed"),
        },
        "dependency-analyzer": {
          skill: { id: "dependency-analyzer" },
          executeResult: {
            affectedFiles: ["src/c.js"],
            suggestedTests: [],
            riskScore: 1,
          },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runImpactAnalysis(["a.js"]);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].success).toBe(false);
      expect(result.steps[0].error).toBe("Analysis failed");
      expect(result.steps[1].success).toBe(true);
      expect(result.affectedFiles).toEqual(["src/c.js"]);
    });

    it("should return empty results when no skills exist", async () => {
      runner.skillRegistry = createMockSkillRegistry({});
      const result = await runner.runImpactAnalysis(["a.js"]);

      expect(result.affectedFiles).toEqual([]);
      expect(result.suggestedTests).toEqual([]);
      expect(result.riskScore).toBe(0);
    });

    it("should handle null skillRegistry gracefully", async () => {
      runner.skillRegistry = null;
      const result = await runner.runImpactAnalysis(["a.js"]);
      expect(result.steps).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // runAutoFix
  // -------------------------------------------------------------------------
  describe("runAutoFix", () => {
    it("should aggregate fixed tests from multiple skills", async () => {
      const result = await runner.runAutoFix([
        "test/fail1.test.js",
        "test/fail2.test.js",
        "test/fail3.test.js",
      ]);

      // bugbot fixes fail1, test-and-fix fixes fail2
      expect(result.fixed).toContain("test/fail1.test.js");
      expect(result.fixed).toContain("test/fail2.test.js");
    });

    it("should track remaining unfixed failures", async () => {
      const result = await runner.runAutoFix([
        "test/fail1.test.js",
        "test/fail2.test.js",
        "test/fail3.test.js",
      ]);

      // fail3 was not fixed by any skill
      expect(result.remaining).toEqual(["test/fail3.test.js"]);
    });

    it("should collect patch files", async () => {
      const result = await runner.runAutoFix([
        "test/fail1.test.js",
        "test/fail2.test.js",
      ]);

      expect(result.patchFiles).toContain("patches/fix1.patch");
      expect(result.patchFiles).toContain("patches/fix2.patch");
    });

    it("should not call later skills when all failures are fixed", async () => {
      // bugbot fixes everything
      registry = createMockSkillRegistry({
        bugbot: {
          skill: { id: "bugbot" },
          executeResult: {
            fixed: ["test/only.test.js"],
            patches: [],
          },
        },
        "test-and-fix": {
          skill: { id: "test-and-fix" },
          executeResult: { fixed: [], patches: [] },
        },
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: { fixed: [], patches: [] },
        },
      });
      runner.skillRegistry = registry;

      await runner.runAutoFix(["test/only.test.js"]);

      // test-and-fix should not be called (remaining is empty after bugbot)
      const calledSkills = registry.executeSkill.mock.calls.map((c) => c[0]);
      expect(calledSkills).toEqual(["bugbot"]);
    });

    it("should pass maxRetries from options", async () => {
      await runner.runAutoFix(["test/fail1.test.js"], { maxRetries: 5 });

      const firstCall = registry.executeSkill.mock.calls[0];
      expect(firstCall[1].maxRetries).toBe(5);
    });

    it("should use config maxAutoFixRetries as default", async () => {
      runner.config.maxAutoFixRetries = 7;
      await runner.runAutoFix(["test/fail1.test.js"]);

      const firstCall = registry.executeSkill.mock.calls[0];
      expect(firstCall[1].maxRetries).toBe(7);
    });

    it("should handle skill execution errors gracefully", async () => {
      registry = createMockSkillRegistry({
        bugbot: {
          skill: { id: "bugbot" },
          executeError: new Error("Bugbot crashed"),
        },
        "test-and-fix": {
          skill: { id: "test-and-fix" },
          executeResult: {
            fixed: ["test/fail1.test.js"],
            patches: [],
          },
        },
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: { fixed: [], patches: [] },
        },
      });
      runner.skillRegistry = registry;

      const result = await runner.runAutoFix(["test/fail1.test.js"]);

      expect(result.steps[0].success).toBe(false);
      expect(result.steps[0].error).toBe("Bugbot crashed");
      expect(result.fixed).toContain("test/fail1.test.js");
    });

    it("should skip skills not found in the registry", async () => {
      runner.skillRegistry = createMockSkillRegistry({
        bugbot: {
          skill: { id: "bugbot" },
          executeResult: { fixed: ["x.test.js"], patches: [] },
        },
        // test-and-fix and lint-and-fix missing
      });

      const result = await runner.runAutoFix(["x.test.js", "y.test.js"]);

      expect(result.fixed).toEqual(["x.test.js"]);
      expect(result.remaining).toEqual(["y.test.js"]);
    });

    it("should return all as remaining when no skills fix anything", async () => {
      runner.skillRegistry = createMockSkillRegistry({});

      const result = await runner.runAutoFix(["a.test.js", "b.test.js"]);

      expect(result.fixed).toEqual([]);
      expect(result.remaining).toEqual(["a.test.js", "b.test.js"]);
    });

    it("should have duration >= 0", async () => {
      const result = await runner.runAutoFix(["test/fail1.test.js"]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Event Emission
  // -------------------------------------------------------------------------
  describe("event emission", () => {
    describe("pre-commit events", () => {
      it("should emit pre-commit-started with changed files", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("pre-commit-started", resolve);
        });

        runner.runPreCommit(["a.js", "b.js"]);

        const data = await eventPromise;
        expect(data.files).toEqual(["a.js", "b.js"]);
      });

      it("should emit pre-commit-completed with full result", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("pre-commit-completed", resolve);
        });

        runner.runPreCommit(["a.js"]);

        const data = await eventPromise;
        expect(data.passed).toBe(true);
        expect(data.issues).toBeDefined();
        expect(data.steps).toBeDefined();
        expect(data.duration).toBeGreaterThanOrEqual(0);
      });
    });

    describe("impact analysis events", () => {
      it("should emit impact-started with files", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("impact-started", resolve);
        });

        runner.runImpactAnalysis(["x.js"]);

        const data = await eventPromise;
        expect(data.files).toEqual(["x.js"]);
      });

      it("should emit impact-completed with result", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("impact-completed", resolve);
        });

        runner.runImpactAnalysis(["x.js"]);

        const data = await eventPromise;
        expect(data.affectedFiles).toBeDefined();
        expect(data.suggestedTests).toBeDefined();
        expect(data.riskScore).toBeDefined();
      });
    });

    describe("auto-fix events", () => {
      it("should emit autofix-started with failures", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("autofix-started", resolve);
        });

        runner.runAutoFix(["fail.test.js"]);

        const data = await eventPromise;
        expect(data.failures).toEqual(["fail.test.js"]);
      });

      it("should emit autofix-completed with result", async () => {
        const eventPromise = new Promise((resolve) => {
          runner.on("autofix-completed", resolve);
        });

        runner.runAutoFix(["test/fail1.test.js"]);

        const data = await eventPromise;
        expect(data.fixed).toBeDefined();
        expect(data.remaining).toBeDefined();
        expect(data.patchFiles).toBeDefined();
      });
    });

    describe("config-updated event", () => {
      it("should emit config-updated when setConfig is called", () => {
        const spy = jest.fn();
        runner.on("config-updated", spy);

        runner.setConfig({ preCommitEnabled: false });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ preCommitEnabled: false }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Configuration get/set
  // -------------------------------------------------------------------------
  describe("getConfig / setConfig", () => {
    it("should return a copy of the current config", () => {
      const config = runner.getConfig();
      expect(config.preCommitEnabled).toBe(true);

      // Modifying the returned copy should not affect internal state
      config.preCommitEnabled = false;
      expect(runner.config.preCommitEnabled).toBe(true);
    });

    it("should update config with setConfig", () => {
      runner.setConfig({ autoFixEnabled: true, maxAutoFixRetries: 10 });

      expect(runner.config.autoFixEnabled).toBe(true);
      expect(runner.config.maxAutoFixRetries).toBe(10);
    });

    it("should merge (not replace) config on setConfig", () => {
      runner.setConfig({ autoFixEnabled: true });

      // Other fields should remain intact
      expect(runner.config.preCommitEnabled).toBe(true);
      expect(runner.config.impactAnalysisEnabled).toBe(true);
      expect(runner.config.preCommitSkills).toEqual([
        "lint-and-fix",
        "code-review",
        "security-audit",
      ]);
    });

    it("should allow overriding skill lists", () => {
      runner.setConfig({ preCommitSkills: ["only-lint"] });
      expect(runner.config.preCommitSkills).toEqual(["only-lint"]);
    });
  });

  // -------------------------------------------------------------------------
  // Hook History Tracking
  // -------------------------------------------------------------------------
  describe("history tracking", () => {
    it("should record pre-commit runs in history", async () => {
      await runner.runPreCommit(["a.js"]);

      expect(runner.history).toHaveLength(1);
      expect(runner.history[0].type).toBe("pre-commit");
      expect(runner.history[0].result.passed).toBe(true);
      expect(typeof runner.history[0].timestamp).toBe("number");
    });

    it("should record impact-analysis runs in history", async () => {
      await runner.runImpactAnalysis(["a.js"]);

      expect(runner.history).toHaveLength(1);
      expect(runner.history[0].type).toBe("impact-analysis");
    });

    it("should record auto-fix runs in history", async () => {
      await runner.runAutoFix(["test.js"]);

      expect(runner.history).toHaveLength(1);
      expect(runner.history[0].type).toBe("auto-fix");
    });

    it("should accumulate history across multiple runs", async () => {
      await runner.runPreCommit(["a.js"]);
      await runner.runImpactAnalysis(["a.js"]);
      await runner.runAutoFix(["test.js"]);

      expect(runner.history).toHaveLength(3);
    });

    it("should cap history at _maxHistory entries", async () => {
      runner._maxHistory = 5;

      for (let i = 0; i < 8; i++) {
        await runner.runPreCommit([`file${i}.js`]);
      }

      expect(runner.history.length).toBeLessThanOrEqual(5);
    });

    it("should keep the most recent entries when capped", async () => {
      runner._maxHistory = 3;

      for (let i = 0; i < 5; i++) {
        await runner.runPreCommit([`file${i}.js`]);
      }

      // The earliest entries should have been pruned
      expect(runner.history).toHaveLength(3);
    });

    describe("getHistory", () => {
      it("should return the last N entries", async () => {
        for (let i = 0; i < 5; i++) {
          await runner.runPreCommit([`file${i}.js`]);
        }

        const last2 = runner.getHistory(2);
        expect(last2).toHaveLength(2);
      });

      it("should default to last 20 entries", async () => {
        for (let i = 0; i < 25; i++) {
          await runner.runPreCommit([`file${i}.js`]);
        }

        const history = runner.getHistory();
        expect(history).toHaveLength(20);
      });

      it("should return all entries when fewer than limit", async () => {
        await runner.runPreCommit(["a.js"]);

        const history = runner.getHistory(100);
        expect(history).toHaveLength(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------
  describe("getStats", () => {
    it("should return zero stats when no runs", () => {
      const stats = runner.getStats();

      expect(stats.totalRuns).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.passRate).toBe(0);
    });

    it("should count total runs", async () => {
      await runner.runPreCommit(["a.js"]);
      await runner.runPreCommit(["b.js"]);
      await runner.runImpactAnalysis(["c.js"]);

      const stats = runner.getStats();
      expect(stats.totalRuns).toBe(3);
    });

    it("should break down counts by type", async () => {
      await runner.runPreCommit(["a.js"]);
      await runner.runPreCommit(["b.js"]);
      await runner.runImpactAnalysis(["c.js"]);
      await runner.runAutoFix(["test.js"]);

      const stats = runner.getStats();
      expect(stats.byType["pre-commit"]).toBe(2);
      expect(stats.byType["impact-analysis"]).toBe(1);
      expect(stats.byType["auto-fix"]).toBe(1);
    });

    it("should calculate average duration", async () => {
      await runner.runPreCommit(["a.js"]);
      await runner.runImpactAnalysis(["b.js"]);

      const stats = runner.getStats();
      expect(typeof stats.avgDurationMs).toBe("number");
      expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should calculate pass rate", async () => {
      // Both will pass since skills return success
      await runner.runPreCommit(["a.js"]);
      await runner.runPreCommit(["b.js"]);

      const stats = runner.getStats();
      expect(stats.passRate).toBe(100);
    });

    it("should account for failed runs in pass rate", async () => {
      // First run passes
      await runner.runPreCommit(["a.js"]);

      // Make second run fail
      registry = createMockSkillRegistry({
        "lint-and-fix": {
          skill: { id: "lint-and-fix" },
          executeResult: {
            success: true,
            issues: [{ message: "error", severity: "error" }],
          },
        },
        "code-review": {
          skill: { id: "code-review" },
          executeResult: { success: true },
        },
        "security-audit": {
          skill: { id: "security-audit" },
          executeResult: { success: true },
        },
      });
      runner.skillRegistry = registry;
      await runner.runPreCommit(["c.js"]);

      const stats = runner.getStats();
      // 1 passed, 1 failed => 50%
      expect(stats.passRate).toBe(50);
    });

    it("should treat impact-analysis and auto-fix as passing (passed is not false)", async () => {
      // These result objects don't have a `passed` field, so `result.passed !== false` is true
      await runner.runImpactAnalysis(["a.js"]);
      await runner.runAutoFix(["test.js"]);

      const stats = runner.getStats();
      expect(stats.passRate).toBe(100);
    });
  });
});
