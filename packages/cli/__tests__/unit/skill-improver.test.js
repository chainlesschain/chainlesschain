/**
 * Unit tests for SkillImprover — iteratively improves SKILL.md files
 * from error feedback, user corrections, and better trajectories.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  TrajectoryStore,
  _deps as trajDeps,
} from "../../src/lib/learning/trajectory-store.js";
import {
  SkillImprover,
  bumpVersion,
  parseSkillFrontmatter,
  rebuildSkillMd,
  isSafeSkillName,
  buildRepairPrompt,
  buildCorrectionPrompt,
  buildImprovementPrompt,
  _deps as impDeps,
} from "../../src/lib/learning/skill-improver.js";

// ── Sample SKILL.md content ─────────────────────────
const SAMPLE_SKILL = `---
name: deploy-app
description: Deploy application
version: 1.0.0
category: auto-learned
tags: [auto-synthesized]
tools: [run_shell]
---

## Procedure
1. Build the app
2. Push to registry
3. Deploy to server

## Pitfalls
- Check env vars first

## Verification
Curl the health endpoint

## Metadata
- Source: trajectory
- Trajectory ID: traj-1
- Confidence: 0.85
`;

function configureTrustedCandidateFs(promises) {
  promises.realpath = vi.fn(async (value) => value);
  promises.lstat = vi.fn(async (value) => {
    const isFile = String(value).endsWith("SKILL.md");
    return {
      size: isFile ? Buffer.byteLength(SAMPLE_SKILL, "utf8") : 0,
      isSymbolicLink: () => false,
      isFile: () => isFile,
      isDirectory: () => !isFile,
    };
  });
}

describe("skill-improver", () => {
  let db;
  let store;
  let idCounter;

  beforeEach(() => {
    db = new MockDatabase();
    idCounter = 0;
    trajDeps.generateId = vi.fn(() => `traj-${++idCounter}`);
    store = new TrajectoryStore(db);
  });

  // ── bumpVersion ───────────────────────────────────

  describe("bumpVersion", () => {
    it("bumps minor version", () => {
      expect(bumpVersion("1.0.0")).toBe("1.1.0");
      expect(bumpVersion("2.3.1")).toBe("2.4.0");
    });

    it("handles null/empty input", () => {
      expect(bumpVersion(null)).toBe("1.1.0");
      expect(bumpVersion("")).toBe("1.1.0");
    });

    it("handles short version strings", () => {
      expect(bumpVersion("1")).toBe("1.1.0");
      expect(bumpVersion("1.0")).toBe("1.1.0");
    });
  });

  // ── parseSkillFrontmatter ─────────────────────────

  describe("parseSkillFrontmatter", () => {
    it("parses YAML frontmatter and body", () => {
      const { meta, body } = parseSkillFrontmatter(SAMPLE_SKILL);
      expect(meta.name).toBe("deploy-app");
      expect(meta.version).toBe("1.0.0");
      expect(meta.category).toBe("auto-learned");
      expect(body).toContain("## Procedure");
    });

    it("returns empty meta for content without frontmatter", () => {
      const { meta, body } = parseSkillFrontmatter(
        "# No frontmatter\nJust text",
      );
      expect(meta).toEqual({});
      expect(body).toBe("# No frontmatter\nJust text");
    });
  });

  // ── rebuildSkillMd ────────────────────────────────

  describe("rebuildSkillMd", () => {
    it("rebuilds from meta + body", () => {
      const result = rebuildSkillMd(
        { name: "test", version: "1.0.0" },
        "\n## Procedure\n1. Step one\n",
      );
      expect(result).toContain("---\nname: test\nversion: 1.0.0\n---");
      expect(result).toContain("## Procedure");
    });

    it("roundtrips parse → rebuild", () => {
      const { meta, body } = parseSkillFrontmatter(SAMPLE_SKILL);
      const rebuilt = rebuildSkillMd(meta, body);
      expect(rebuilt).toContain("name: deploy-app");
      expect(rebuilt).toContain("## Procedure");
    });
  });

  describe("candidate-only safety boundary", () => {
    it("accepts Unicode skill names and rejects path traversal", () => {
      expect(isSafeSkillName("deploy-app")).toBe(true);
      expect(isSafeSkillName("部署应用")).toBe(true);
      expect(isSafeSkillName("../deploy-app")).toBe(false);
      expect(isSafeSkillName("nested/deploy-app")).toBe(false);
    });

    it("is unavailable by default instead of writing the active tree", async () => {
      const readFile = vi.fn(async () => SAMPLE_SKILL);
      const writeFile = vi.fn(async () => {});
      const llm = vi.fn();
      impDeps.fs = {
        promises: { mkdir: vi.fn(async () => {}), readFile, writeFile },
      };
      impDeps.path = { join: (...args) => args.join("/") };
      const improver = new SkillImprover(db, llm, store, {
        skillsDir: "/skills",
      });

      const result = await improver.repairFromError("deploy-app", {
        error: "failed",
      });

      expect(result).toMatchObject({
        improved: false,
        candidateCreated: false,
        status: "unavailable",
      });
      expect(result.reason).toContain("candidate output unavailable");
      expect(readFile).not.toHaveBeenCalled();
      expect(llm).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it.each([
      ["same root", "/skills"],
      ["nested candidate root", "/skills/.candidates"],
      ["candidate parent root", "/"],
    ])("rejects an overlapping %s", async (_label, candidateOutputDir) => {
      const llm = vi.fn();
      const improver = new SkillImprover(db, llm, store, {
        skillsDir: "/skills",
        candidateOutputDir,
      });

      const result = await improver.repairFromError("deploy-app", {
        error: "failed",
      });

      expect(result).toMatchObject({
        improved: false,
        candidateCreated: false,
        status: "unavailable",
      });
      expect(result.reason).toContain("isolated");
      expect(llm).not.toHaveBeenCalled();
    });
  });

  // ── Prompt builders ───────────────────────────────

  describe("buildRepairPrompt", () => {
    it("builds system + user messages", () => {
      const messages = buildRepairPrompt(SAMPLE_SKILL, {
        error: "Command not found: npm",
        userIntent: "deploy",
        toolChain: [{ tool: "run_shell", status: "error" }],
      });
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("skill improvement");
      expect(messages[1].content).toContain("Command not found");
    });
  });

  describe("buildCorrectionPrompt", () => {
    it("builds messages with correction context", () => {
      const messages = buildCorrectionPrompt(SAMPLE_SKILL, {
        userMessage: "Don't use npm, use pnpm instead",
        previousToolChain: [{ tool: "run_shell", args: { cmd: "npm build" } }],
        correctedToolChain: [
          { tool: "run_shell", args: { cmd: "pnpm build" } },
        ],
      });
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain("pnpm");
    });
  });

  describe("buildImprovementPrompt", () => {
    it("builds messages with better trajectory", () => {
      const messages = buildImprovementPrompt(SAMPLE_SKILL, {
        userIntent: "deploy faster",
        outcomeScore: 0.95,
        toolChain: [
          { tool: "run_shell", args: { cmd: "build" }, status: "completed" },
          { tool: "run_shell", args: { cmd: "deploy" }, status: "completed" },
        ],
      });
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain("0.95");
      expect(messages[1].content).toContain("deploy faster");
    });
  });

  // ── SkillImprover.repairFromError ─────────────────

  describe("repairFromError", () => {
    let mockLLM;
    let improver;
    const mockFs = {
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => SAMPLE_SKILL),
      },
    };
    const mockPath = { join: (...args) => args.join("/") };

    beforeEach(() => {
      mockLLM = vi.fn();
      impDeps.fs = mockFs;
      impDeps.path = mockPath;
      vi.clearAllMocks();
      delete mockFs.promises.realpath;
      mockFs.promises.mkdir.mockResolvedValue(undefined);
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      mockFs.promises.readFile.mockResolvedValue(SAMPLE_SKILL);
      configureTrustedCandidateFs(mockFs.promises);

      improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
    });

    it("repairs skill from error and bumps version", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "npm not installed, use npx",
          fixedProcedure: ["Install deps with npx", "Build", "Deploy"],
          newPitfalls: ["Ensure npx is available"],
          confidence: 0.8,
        }),
      );

      const result = await improver.repairFromError("deploy-app", {
        error: "npm: command not found",
        toolChain: [{ tool: "run_shell", status: "error" }],
        userIntent: "deploy",
      });

      expect(result.improved).toBe(false);
      expect(result.candidateCreated).toBe(true);
      expect(result.status).toBe("candidate");
      expect(result.candidatePath).toBe(
        "/candidates/deploy-app/1.1.0/SKILL.md",
      );
      expect(result.reason).toContain("npm not installed");
      expect(mockFs.promises.writeFile).toHaveBeenCalled();
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        "/skills/deploy-app/SKILL.md",
        "utf-8",
      );

      // Check written content has bumped version
      const writtenContent = mockFs.promises.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("version: 1.1.0");
      expect(writtenContent).toContain("Install deps with npx");
      expect(writtenContent).toContain("Ensure npx is available");
    });

    it("returns not improved when skill not found", async () => {
      mockFs.promises.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await improver.repairFromError("nonexistent", {
        error: "fail",
      });
      expect(result.improved).toBe(false);
      expect(result.reason).toBe("skill not found");
    });

    it("returns not improved when LLM says not applicable", async () => {
      mockLLM.mockResolvedValue(JSON.stringify({ not_applicable: true }));

      const result = await improver.repairFromError("deploy-app", {
        error: "random error",
      });
      expect(result.improved).toBe(false);
      expect(result.reason).toContain("not applicable");
    });

    it("returns not improved for low confidence", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "Maybe this",
          fixedProcedure: ["Try something"],
          confidence: 0.2,
        }),
      );

      const result = await improver.repairFromError("deploy-app", {
        error: "ambiguous",
      });
      expect(result.improved).toBe(false);
      expect(result.reason).toBe("low confidence");
    });

    it("logs improvement to skill_improvement_log", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "fixed it",
          fixedProcedure: ["Better step"],
          confidence: 0.9,
        }),
      );

      await improver.repairFromError("deploy-app", { error: "err" });

      const logs = db.data.get("skill_improvement_log") || [];
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const log = logs.find((l) => l.skill_name === "deploy-app");
      expect(log).toBeDefined();
      expect(log.trigger_type).toBe("error_repair");
    });

    it("supports explicit diff-only output without writing any skill tree", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "candidate only",
          fixedProcedure: ["Safer step"],
          confidence: 0.9,
        }),
      );
      improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        diffOnly: true,
      });

      const result = await improver.repairFromError("deploy-app", {
        error: "err",
      });

      expect(result).toMatchObject({
        improved: false,
        candidateCreated: false,
        candidateGenerated: true,
        status: "diff-only",
      });
      expect(result.candidate.content).toContain("Safer step");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
      expect(db.data.get("skill_improvement_log")).toHaveLength(1);
    });

    it("does not report a candidate when persistence fails", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "persist me",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      mockFs.promises.writeFile.mockRejectedValueOnce(new Error("disk full"));

      await expect(
        improver.repairFromError("deploy-app", { error: "err" }),
      ).rejects.toThrow("disk full");
      expect(db.data.get("skill_improvement_log") || []).toHaveLength(0);
    });

    it("does not report success when the audit log write fails", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "audit me",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      const originalPrepare = db.prepare.bind(db);
      vi.spyOn(db, "prepare").mockImplementation((sql) => {
        if (sql.includes("INSERT INTO skill_improvement_log")) {
          throw new Error("audit unavailable");
        }
        return originalPrepare(sql);
      });

      await expect(
        improver.repairFromError("deploy-app", { error: "err" }),
      ).rejects.toThrow("audit unavailable");
      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(1);
    });

    it("rejects a candidate root that resolves to the active tree", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "alias attempt",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      mockFs.promises.realpath = vi.fn(async () => "/skills");

      await expect(
        improver.repairFromError("deploy-app", { error: "err" }),
      ).rejects.toThrow("resolves into the active skill tree");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("rejects a symlink in the candidate skill parent", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "symlink attempt",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      const trustedLstat = mockFs.promises.lstat;
      mockFs.promises.lstat = vi.fn(async (value) => {
        if (value === "/candidates/deploy-app") {
          return {
            size: 0,
            isSymbolicLink: () => true,
            isFile: () => false,
            isDirectory: () => false,
          };
        }
        return trustedLstat(value);
      });

      await expect(
        improver.repairFromError("deploy-app", { error: "err" }),
      ).rejects.toThrow("not a trusted directory");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("verifies the final candidate parent remains under the canonical root", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "parent swap",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      mockFs.promises.realpath = vi.fn(async (value) =>
        value === "/candidates/deploy-app/1.1.0" ? "/skills/deploy-app" : value,
      );

      await expect(
        improver.repairFromError("deploy-app", { error: "err" }),
      ).rejects.toThrow("resolves outside the candidate root");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("creates candidate directories with private permissions", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          diagnosis: "private candidate",
          fixedProcedure: ["New step"],
          confidence: 0.9,
        }),
      );
      const created = new Set();
      mockFs.promises.mkdir.mockImplementation(async (value) => {
        created.add(value);
      });
      mockFs.promises.lstat = vi.fn(async (value) => {
        if (String(value).endsWith("SKILL.md")) {
          return {
            size: Buffer.byteLength(SAMPLE_SKILL, "utf8"),
            isSymbolicLink: () => false,
            isFile: () => true,
            isDirectory: () => false,
          };
        }
        if (!created.has(value)) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return {
          size: 0,
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => true,
        };
      });

      const result = await improver.repairFromError("deploy-app", {
        error: "err",
      });

      expect(result.status).toBe("candidate");
      expect(mockFs.promises.mkdir).toHaveBeenCalledWith("/candidates", {
        recursive: true,
        mode: 0o700,
      });
      expect(mockFs.promises.mkdir).toHaveBeenCalledWith(
        "/candidates/deploy-app",
        { recursive: false, mode: 0o700 },
      );
      expect(mockFs.promises.mkdir).toHaveBeenCalledWith(
        "/candidates/deploy-app/1.1.0",
        { recursive: false, mode: 0o700 },
      );
    });
  });

  // ── SkillImprover.updateFromCorrection ────────────

  describe("updateFromCorrection", () => {
    let mockLLM;
    let improver;
    const mockFs = {
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => SAMPLE_SKILL),
      },
    };
    const mockPath = { join: (...args) => args.join("/") };

    beforeEach(() => {
      mockLLM = vi.fn();
      impDeps.fs = mockFs;
      impDeps.path = mockPath;
      vi.clearAllMocks();
      mockFs.promises.readFile.mockResolvedValue(SAMPLE_SKILL);
      configureTrustedCandidateFs(mockFs.promises);

      improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
    });

    it("updates skill from user correction", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          whatChanged: "Use pnpm instead of npm",
          updatedProcedure: ["Build with pnpm", "Deploy"],
          newPitfalls: ["Always use pnpm in this project"],
          confidence: 0.9,
        }),
      );

      const result = await improver.updateFromCorrection("deploy-app", {
        userMessage: "Use pnpm not npm",
        previousToolChain: [{ tool: "run_shell", args: { cmd: "npm build" } }],
        correctedToolChain: [
          { tool: "run_shell", args: { cmd: "pnpm build" } },
        ],
      });

      expect(result.improved).toBe(false);
      expect(result.candidateCreated).toBe(true);
      expect(result.status).toBe("candidate");
      expect(result.reason).toContain("pnpm");

      const writtenContent = mockFs.promises.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("Build with pnpm");
      expect(writtenContent).toContain("version: 1.1.0");
    });

    it("logs correction to improvement log", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          whatChanged: "changed approach",
          updatedProcedure: ["New step"],
          confidence: 0.7,
        }),
      );

      await improver.updateFromCorrection("deploy-app", {
        userMessage: "wrong approach",
      });

      const logs = db.data.get("skill_improvement_log") || [];
      const log = logs.find((l) => l.trigger_type === "user_correction");
      expect(log).toBeDefined();
    });
  });

  // ── SkillImprover.improveFromBetterTrajectory ─────

  describe("improveFromBetterTrajectory", () => {
    let mockLLM;
    let improver;
    const mockFs = {
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => SAMPLE_SKILL),
      },
    };
    const mockPath = { join: (...args) => args.join("/") };

    beforeEach(() => {
      mockLLM = vi.fn();
      impDeps.fs = mockFs;
      impDeps.path = mockPath;
      vi.clearAllMocks();
      mockFs.promises.readFile.mockResolvedValue(SAMPLE_SKILL);
      configureTrustedCandidateFs(mockFs.promises);

      improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
    });

    it("improves from a higher-scoring trajectory", async () => {
      mockLLM.mockResolvedValue(
        JSON.stringify({
          improvements: "Added caching step for faster builds",
          mergedProcedure: ["Cache deps", "Build", "Deploy"],
          mergedPitfalls: ["Clear cache if build fails"],
          updatedVerification: "Check build time < 30s",
          confidence: 0.85,
        }),
      );

      const result = await improver.improveFromBetterTrajectory("deploy-app", {
        userIntent: "deploy fast",
        outcomeScore: 0.95,
        toolChain: [
          { tool: "run_shell", args: { cmd: "cache" }, status: "completed" },
          { tool: "run_shell", args: { cmd: "build" }, status: "completed" },
        ],
      });

      expect(result.improved).toBe(false);
      expect(result.candidateCreated).toBe(true);
      expect(result.status).toBe("candidate");
      expect(result.reason).toContain("caching");

      const writtenContent = mockFs.promises.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("Cache deps");
      expect(writtenContent).toContain("Clear cache if build fails");
      expect(writtenContent).toContain("Check build time < 30s");
    });

    it("skips when no skill file found", async () => {
      mockFs.promises.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await improver.improveFromBetterTrajectory("nope", {
        outcomeScore: 0.9,
        toolChain: [],
      });
      expect(result.improved).toBe(false);
      expect(result.reason).toBe("skill not found");
    });
  });

  // ── SkillImprover.scanForImprovements ─────────────

  describe("scanForImprovements", () => {
    let mockLLM;
    let improver;
    const mockFs = {
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => SAMPLE_SKILL),
      },
    };
    const mockPath = { join: (...args) => args.join("/") };

    beforeEach(() => {
      mockLLM = vi.fn();
      impDeps.fs = mockFs;
      impDeps.path = mockPath;
      vi.clearAllMocks();
      mockFs.promises.readFile.mockResolvedValue(SAMPLE_SKILL);
      configureTrustedCandidateFs(mockFs.promises);

      improver = new SkillImprover(db, mockLLM, store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });
    });

    it("finds and improves skills with better trajectories available", async () => {
      // Create a synthesized trajectory with moderate score
      const id1 = store.startTrajectory("s1", "deploy");
      store.appendToolCall(id1, {
        tool: "run_shell",
        args: {},
        result: "ok",
        durationMs: 10,
        status: "completed",
      });
      store.completeTrajectory(id1, { finalResponse: "done" });
      store.setOutcomeScore(id1, 0.7, "auto");
      store.markSynthesized(id1, "deploy-app");

      // Create a better trajectory with similar tools
      const id2 = store.startTrajectory("s2", "deploy fast");
      store.appendToolCall(id2, {
        tool: "run_shell",
        args: {},
        result: "ok",
        durationMs: 5,
        status: "completed",
      });
      store.completeTrajectory(id2, { finalResponse: "done faster" });
      store.setOutcomeScore(id2, 0.95, "user");

      mockLLM.mockResolvedValue(
        JSON.stringify({
          improvements: "Faster deployment",
          mergedProcedure: ["Optimized step"],
          mergedPitfalls: [],
          updatedVerification: "Check",
          confidence: 0.8,
        }),
      );

      const result = await improver.scanForImprovements();
      expect(result.improved).toEqual([]);
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.candidates[0]).toMatchObject({
        skillName: "deploy-app",
        status: "candidate",
      });
    });

    it("returns empty when no improvements available", async () => {
      // No synthesized trajectories
      const result = await improver.scanForImprovements();
      expect(result.improved).toHaveLength(0);
      expect(result.candidates).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });

  // ── _callLLM ──────────────────────────────────────

  describe("_callLLM", () => {
    it("returns null when llmChat is null", async () => {
      const imp = new SkillImprover(db, null, store);
      const result = await imp._callLLM([]);
      expect(result).toBeNull();
    });

    it("parses JSON from LLM response", async () => {
      const mockLLM = vi
        .fn()
        .mockResolvedValue('Here is the result: {"name":"test"} done');
      const imp = new SkillImprover(db, mockLLM, store);
      const result = await imp._callLLM([{ role: "user", content: "hi" }]);
      expect(result).toEqual({ name: "test" });
    });

    it("returns null on LLM error", async () => {
      const mockLLM = vi.fn().mockRejectedValue(new Error("timeout"));
      const imp = new SkillImprover(db, mockLLM, store);
      const result = await imp._callLLM([{ role: "user", content: "hi" }]);
      expect(result).toBeNull();
    });

    it("returns null for non-JSON response", async () => {
      const mockLLM = vi.fn().mockResolvedValue("No JSON here at all");
      const imp = new SkillImprover(db, mockLLM, store);
      const result = await imp._callLLM([]);
      expect(result).toBeNull();
    });
  });

  // ── _readSkill / _writeCandidate ──────────────────

  describe("_readSkill / _writeCandidate", () => {
    it("returns null when skillsDir is not set", async () => {
      const imp = new SkillImprover(db, null, store);
      const result = await imp._readSkill("any");
      expect(result).toBeNull();
    });

    it("returns null when file does not exist", async () => {
      impDeps.fs = {
        promises: {
          readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
        },
      };
      impDeps.path = { join: (...args) => args.join("/") };

      const imp = new SkillImprover(db, null, store, { skillsDir: "/s" });
      const result = await imp._readSkill("missing");
      expect(result).toBeNull();
    });

    it("rejects an oversized SKILL.md from metadata before reading or calling the model", async () => {
      const readFile = vi.fn();
      const llm = vi.fn();
      impDeps.fs = {
        promises: {
          lstat: vi.fn(async () => ({
            size: 257,
            isSymbolicLink: () => false,
            isFile: () => true,
          })),
          readFile,
        },
      };
      impDeps.path = { join: (...args) => args.join("/") };
      const imp = new SkillImprover(db, llm, store, {
        skillsDir: "/s",
        diffOnly: true,
        limits: { maxSkillFileBytes: 256 },
      });

      await expect(
        imp.repairFromError("oversized", { error: "ignored" }),
      ).resolves.toEqual({ improved: false, reason: "skill not found" });
      expect(readFile).not.toHaveBeenCalled();
      expect(llm).not.toHaveBeenCalled();
    });

    it("_writeCandidate fails closed without a configured boundary", async () => {
      const mockWrite = vi.fn();
      impDeps.fs = { promises: { mkdir: vi.fn(), writeFile: mockWrite } };

      const imp = new SkillImprover(db, null, store);
      await expect(
        imp._writeCandidate("test", "1.1.0", "content"),
      ).rejects.toThrow("source skill registry unavailable");
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("_writeCandidate fails closed without realpath and lstat support", async () => {
      const writeFile = vi.fn();
      impDeps.fs = {
        promises: { mkdir: vi.fn(), writeFile },
      };
      const imp = new SkillImprover(db, vi.fn(), store, {
        skillsDir: "/skills",
        candidateOutputDir: "/candidates",
      });

      await expect(
        imp._writeCandidate("test", "1.1.0", "content"),
      ).rejects.toThrow("filesystem identity support unavailable");
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
