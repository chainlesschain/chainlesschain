/**
 * E2E: canonical coding workflow — CLI inspector.
 *
 * Writes workflow state to a tmp project using the same file layout the
 * desktop-app-vue main process would write, then spawns the real CLI
 * binary with `session workflow` to verify cross-layer consistency.
 *
 * This is the seam between:
 *   desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js (writer)
 *   packages/cli/src/lib/workflow-state-reader.js (reader, driven by session.js)
 *
 * We don't import the desktop writer (ESM ↔ CJS boundary); instead we
 * hand-craft the exact files the writer produces. If the writer's layout
 * ever changes, this test will break and remind us to update the CLI reader.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function runCli(args, options = {}) {
  return execSync(`node "${bin}" ${args}`, {
    encoding: "utf-8",
    timeout: 20000,
    stdio: "pipe",
    ...options,
  });
}

function seedSession(projectRoot, sessionId, state) {
  const dir = join(projectRoot, ".chainlesschain", "sessions", sessionId);
  mkdirSync(dir, { recursive: true });

  if (state.intent) {
    writeFileSync(
      join(dir, "intent.md"),
      `# Intent\n\n**Session:** ${sessionId}\n\n## Goal\n\n${state.intent}\n`,
      "utf-8",
    );
  }
  if (state.plan) {
    const approved = state.planApproved ? "true" : "false";
    writeFileSync(
      join(dir, "plan.md"),
      `---\nsession: ${sessionId}\napproved: ${approved}\nupdated: ${new Date().toISOString()}\n---\n\n# Plan: ${state.plan.title}\n\n## Steps\n\n${state.plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`,
      "utf-8",
    );
  }
  if (state.progress) {
    appendFileSync(
      join(dir, "progress.log"),
      state.progress
        .map((p) => `[${new Date().toISOString()}] ${p}`)
        .join("\n") + "\n",
      "utf-8",
    );
  }
  if (state.stage) {
    writeFileSync(
      join(dir, "mode.json"),
      JSON.stringify(
        { stage: state.stage, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

describe("cc session workflow — E2E", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "cc-wf-e2e-"));
  });
  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("lists an empty project with no sessions", () => {
    const out = runCli(`session workflow --cwd "${projectRoot}"`);
    expect(out).toMatch(/no workflow sessions/i);
  });

  it("lists sessions sorted by updatedAt desc", () => {
    seedSession(projectRoot, "alpha", {
      intent: "build alpha",
      stage: "intent",
    });
    // Small delay to ensure distinct ISO timestamps on both writes
    const past = new Date(Date.now() - 60_000).toISOString();
    mkdirSync(join(projectRoot, ".chainlesschain", "sessions", "beta"), {
      recursive: true,
    });
    writeFileSync(
      join(projectRoot, ".chainlesschain", "sessions", "beta", "intent.md"),
      "# Intent\n\n## Goal\n\nbuild beta\n",
    );
    writeFileSync(
      join(projectRoot, ".chainlesschain", "sessions", "beta", "mode.json"),
      JSON.stringify({ stage: "intent", updatedAt: past }),
    );

    const out = runCli(`session workflow --cwd "${projectRoot}"`);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    // alpha (fresher) should appear before beta
    expect(out.indexOf("alpha")).toBeLessThan(out.indexOf("beta"));
  });

  it("renders plan approval state in JSON mode", () => {
    seedSession(projectRoot, "approved-session", {
      intent: "g",
      plan: { title: "P", steps: ["a", "b"] },
      planApproved: true,
      stage: "plan",
    });
    const out = runCli(`session workflow --cwd "${projectRoot}" --json`);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    const row = parsed.find((r) => r.sessionId === "approved-session");
    expect(row).toBeDefined();
    expect(row.approved).toBe(true);
    expect(row.hasPlan).toBe(true);
    expect(row.stage).toBe("plan");
  });

  it("shows intent + plan + progress tail for a single session", () => {
    seedSession(projectRoot, "deep", {
      intent: "deep look",
      plan: { title: "Plan Deep", steps: ["one", "two", "three"] },
      planApproved: true,
      progress: [
        "[ralph] step one done",
        "[ralph] step two done",
        "[ralph] step three done",
      ],
      stage: "execute",
    });
    const out = runCli(`session workflow deep --cwd "${projectRoot}"`);
    expect(out).toContain("deep look");
    expect(out).toContain("Plan Deep");
    expect(out).toMatch(/step one done/);
    expect(out).toMatch(/step three done/);
  });

  it("returns single-session JSON with full body", () => {
    seedSession(projectRoot, "js-view", {
      intent: "json view",
      plan: { title: "JV", steps: ["x"] },
      planApproved: false,
      stage: "plan",
    });
    const out = runCli(
      `session workflow js-view --cwd "${projectRoot}" --json`,
    );
    const parsed = JSON.parse(out);
    expect(parsed.sessionId).toBe("js-view");
    expect(parsed.intent).toMatch(/json view/);
    expect(parsed.planApproved).toBe(false);
    expect(parsed.plan).toMatch(/# Plan: JV/);
  });

  it("reports a clear message when session id does not exist", () => {
    let caught = null;
    try {
      runCli(`session workflow missing-id --cwd "${projectRoot}"`);
    } catch (err) {
      caught = err;
    }
    // session.js prints an error and exits non-zero OR prints a message.
    // Accept either shape — the important thing is that it doesn't hang
    // and doesn't return success JSON for a nonexistent id.
    const combined =
      (caught?.stdout?.toString() || "") + (caught?.stderr?.toString() || "");
    expect(combined.toLowerCase()).toMatch(/not found|missing|no such/);
  });
});
