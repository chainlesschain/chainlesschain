/**
 * cc loop — E2E (black-box against the real `cc` bin).
 *
 * Spawns `node bin/chainlesschain.js loop ...` as a real child process and
 * asserts on stdout/stderr/exit code — the genuine user journey, including the
 * prompt-mode self-spawn (the loop launching `cc agent -p` via the bin path)
 * and a save → resume round trip through the real session store. No in-process
 * shortcuts; only the public CLI surface is touched.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import {
  sessionPath,
  readEvents,
} from "../../src/harness/jsonl-session-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binScript = join(__dirname, "..", "..", "bin", "chainlesschain.js");
const createdSessions = [];

// Temp dir for throwaway scripts. Exec mode is shell:true, so an inline
// `node -e "process.exit(0)"` hits a POSIX /bin/sh (dash) syntax error on the
// "()" — a script-file path has no shell metachars and runs cross-platform.
const scriptDir = mkdtempSync(join(tmpdir(), "cc-loop-e2e-"));
function writeScript(body) {
  const p = join(scriptDir, `s${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(p, body, "utf-8");
  return p;
}

/** Run the real bin; never throws — returns { status, stdout, stderr }. */
function runCli(args, timeout = 30000) {
  const r = spawnSync(process.execPath, [binScript, "loop", ...args], {
    encoding: "utf-8",
    timeout,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Parse the trailing --json summary out of combined output. */
function summaryOf(out) {
  return JSON.parse(out.slice(out.indexOf("{")));
}

afterAll(() => {
  for (const id of createdSessions) {
    try {
      rmSync(sessionPath(id), { force: true });
    } catch {
      /* best-effort */
    }
  }
  try {
    rmSync(scriptDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("E2E: cc loop — help & validation", () => {
  it("loop --help lists the headline options", () => {
    const { stdout } = runCli(["--help"]);
    for (const f of [
      "--every",
      "--max-iterations",
      "--dynamic",
      "--save",
      "--resume",
    ]) {
      expect(stdout).toContain(f);
    }
  });

  it("exits 1 with a hint when nothing to loop", () => {
    const { status, stderr } = runCli([]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/nothing to loop/);
  });

  it("exits 1 on a bad --every", () => {
    const { status, stderr } = runCli([
      "--every",
      "soon",
      "--",
      "node",
      "-e",
      "0",
    ]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/invalid duration/);
  });
});

describe("E2E: cc loop — exec mode", () => {
  it("runs N times, mirrors the last exit code, emits a JSON summary", () => {
    const { status, stdout } = runCli([
      "--every",
      "1ms",
      "--max-iterations",
      "3",
      "--json",
      "--",
      "node",
      writeScript("process.exit(2);"),
    ]);
    const s = summaryOf(stdout);
    expect(s.iterations).toBe(3);
    expect(s.stoppedBy).toBe("max-iterations");
    expect(s.lastExitCode).toBe(2);
    // Process exit code mirrors the last iteration.
    expect(status).toBe(2);
  });

  it("--until-exit-zero stops as soon as the command passes", () => {
    const { status, stdout } = runCli([
      "--every",
      "1ms",
      "--max-iterations",
      "10",
      "--until-exit-zero",
      "--json",
      "--",
      "node",
      writeScript("process.exit(0);"),
    ]);
    const s = summaryOf(stdout);
    expect(s.iterations).toBe(1);
    expect(s.stoppedBy).toBe("exit-zero");
    expect(status).toBe(0);
  });
});

describe("E2E: cc loop — prompt mode self-spawn", () => {
  it("launches `cc agent -p` via the bin and forwards passthrough flags", () => {
    // Point the agent at an unreachable provider so each iteration fails fast
    // (no LLM needed). We only assert the loop reached the agent path.
    const { stdout } = runCli(
      [
        "--max-iterations",
        "1",
        "--json",
        "review the diff",
        "--provider",
        "openai",
        "--base-url",
        "http://127.0.0.1:9",
        "--api-key",
        "x",
      ],
      45000,
    );
    // The iteration banner shows the reconstructed `cc agent -p` invocation
    // with the prompt and the forwarded flags.
    expect(stdout).toContain("cc agent -p");
    expect(stdout).toContain("review the diff");
    expect(stdout).toContain("--provider");
    const s = summaryOf(stdout);
    expect(s.iterations).toBe(1);
  });
});

describe("E2E: cc loop — save / resume", () => {
  it("persists a loop then resumes it with cumulative counting", () => {
    const id = `cc-loop-e2e-${Math.random().toString(36).slice(2)}`;
    createdSessions.push(id);

    const save = runCli([
      "--save",
      id,
      "--every",
      "1ms",
      "--max-iterations",
      "2",
      "--json",
      "--",
      "node",
      writeScript("process.exit(0);"),
    ]);
    const s1 = summaryOf(save.stdout);
    expect(s1.iterations).toBe(2);
    expect(s1.sessionId).toBe(id);

    const ev1 = readEvents(id);
    expect(ev1.filter((e) => e.type === "loop_config")).toHaveLength(1);
    expect(ev1.filter((e) => e.type === "loop_iteration")).toHaveLength(2);

    const resume = runCli([
      "--resume",
      id,
      "--max-iterations",
      "4",
      "--every",
      "1ms",
      "--json",
    ]);
    const s2 = summaryOf(resume.stdout);
    expect(s2.iterations).toBe(4);
    expect(s2.stoppedBy).toBe("max-iterations");
    expect(
      readEvents(id).filter((e) => e.type === "loop_iteration"),
    ).toHaveLength(4);
  });

  it("exits 1 when resuming a non-existent session", () => {
    const { status, stderr } = runCli(["--resume", "definitely-not-real-xyz"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/no such loop session/);
  });
});
