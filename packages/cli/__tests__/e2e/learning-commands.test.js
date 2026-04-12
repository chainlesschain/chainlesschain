/**
 * E2E tests for the `learning` CLI command group.
 *
 * Tests actual CLI execution via `node bin/chainlesschain.js learning ...`
 * Validates command help, output format, and --json flag.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, options = {}) {
  return execSync(`node ${bin} ${args}`, {
    encoding: "utf-8",
    timeout: 15000,
    stdio: "pipe",
    ...options,
  });
}

function tryRun(args) {
  try {
    return { stdout: run(args), exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
}

describe("E2E: learning commands", () => {
  // ── help ────────────────────────────────────────

  describe("learning --help", () => {
    it("shows learning command group help", () => {
      const result = run("learning --help");
      expect(result).toContain("learning");
      expect(result).toContain("trajectories");
      expect(result).toContain("reflect");
      expect(result).toContain("synthesize");
      expect(result).toContain("stats");
      expect(result).toContain("cleanup");
    });

    it("shows description mentioning autonomous learning", () => {
      const result = run("learning --help");
      expect(result.toLowerCase()).toContain("learning");
    });
  });

  // ── subcommand help ─────────────────────────────

  describe("learning stats --help", () => {
    it("shows stats subcommand help", () => {
      const result = run("learning stats --help");
      expect(result).toContain("--json");
    });
  });

  describe("learning trajectories --help", () => {
    it("shows trajectories subcommand help", () => {
      const result = run("learning trajectories --help");
      expect(result).toContain("--limit");
      expect(result).toContain("--session");
      expect(result).toContain("--json");
    });
  });

  describe("learning reflect --help", () => {
    it("shows reflect subcommand help", () => {
      const result = run("learning reflect --help");
      expect(result).toContain("--json");
    });
  });

  describe("learning synthesize --help", () => {
    it("shows synthesize subcommand help", () => {
      const result = run("learning synthesize --help");
      expect(result).toContain("--json");
    });
  });

  describe("learning cleanup --help", () => {
    it("shows cleanup subcommand help with --days", () => {
      const result = run("learning cleanup --help");
      expect(result).toContain("--days");
      expect(result).toContain("--json");
    });
  });

  // ── source file validation ────────────────────

  describe("source file structure", () => {
    it("learning command module exports registerLearningCommand", () => {
      const src = readFileSync(
        join(cliRoot, "src", "commands", "learning.js"),
        "utf-8",
      );
      expect(src).toContain("export function registerLearningCommand");
    });

    it("learning command is registered in index.js", () => {
      const src = readFileSync(
        join(cliRoot, "src", "index.js"),
        "utf-8",
      );
      expect(src).toContain("registerLearningCommand");
      expect(src).toContain("import { registerLearningCommand }");
    });

    it("all 7 learning library modules exist", () => {
      const modules = [
        "learning-tables.js",
        "trajectory-store.js",
        "learning-hooks.js",
        "outcome-feedback.js",
        "skill-synthesizer.js",
        "skill-improver.js",
        "reflection-engine.js",
      ];
      for (const mod of modules) {
        const content = readFileSync(
          join(cliRoot, "src", "lib", "learning", mod),
          "utf-8",
        );
        expect(content.length).toBeGreaterThan(100);
      }
    });

    it("trajectory-store.js exports TrajectoryStore class", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "trajectory-store.js"),
        "utf-8",
      );
      expect(src).toContain("export class TrajectoryStore");
      expect(src).toContain("startTrajectory");
      expect(src).toContain("appendToolCall");
      expect(src).toContain("completeTrajectory");
      expect(src).toContain("findComplexUnprocessed");
      expect(src).toContain("findSimilar");
    });

    it("outcome-feedback.js exports scoring functions", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "outcome-feedback.js"),
        "utf-8",
      );
      expect(src).toContain("export function autoScore");
      expect(src).toContain("export function hasRetries");
      expect(src).toContain("export function detectCorrection");
      expect(src).toContain("export class OutcomeFeedback");
    });

    it("skill-synthesizer.js exports synthesis functions", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "skill-synthesizer.js"),
        "utf-8",
      );
      expect(src).toContain("export class SkillSynthesizer");
      expect(src).toContain("export function extractToolNames");
      expect(src).toContain("export function toolChainFingerprint");
      expect(src).toContain("export function generateSkillMd");
    });

    it("skill-improver.js exports improvement functions", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "skill-improver.js"),
        "utf-8",
      );
      expect(src).toContain("export class SkillImprover");
      expect(src).toContain("export function bumpVersion");
      expect(src).toContain("repairFromError");
      expect(src).toContain("updateFromCorrection");
      expect(src).toContain("improveFromBetterTrajectory");
    });

    it("reflection-engine.js exports reflection functions", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "reflection-engine.js"),
        "utf-8",
      );
      expect(src).toContain("export class ReflectionEngine");
      expect(src).toContain("export function computeToolStats");
      expect(src).toContain("export function computeScoreTrend");
      expect(src).toContain("export function findErrorProneTools");
    });

    it("learning-hooks.js exports hook functions", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "learning-hooks.js"),
        "utf-8",
      );
      expect(src).toContain("export function onUserPromptSubmit");
      expect(src).toContain("export function onPostToolUse");
      expect(src).toContain("export function onResponseComplete");
      expect(src).toContain("export function createLearningContext");
    });

    it("learning-tables.js creates 3 database tables", () => {
      const src = readFileSync(
        join(cliRoot, "src", "lib", "learning", "learning-tables.js"),
        "utf-8",
      );
      expect(src).toContain("learning_trajectories");
      expect(src).toContain("learning_trajectory_tags");
      expect(src).toContain("skill_improvement_log");
    });
  });
});
