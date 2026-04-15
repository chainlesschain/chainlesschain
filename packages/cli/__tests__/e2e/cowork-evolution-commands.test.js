/**
 * E2E tests: New cowork evolution subcommands
 *   cowork learning stats|recommend|failures
 *   cowork workflow list|show|add|remove
 *   cowork share export-template|export-result|import|verify
 *
 * Spawns the real CLI binary and exercises command parsing + happy paths
 * against a temp cwd.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

let tmp;

function run(args, { cwd = tmp, allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  });
  if (!allowFail && result.status !== 0) {
    throw new Error(
      `cc ${args.join(" ")} failed (exit ${result.status})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return result;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cowork-evo-e2e-"));
  mkdirSync(join(tmp, ".chainlesschain", "cowork"), { recursive: true });
});

afterAll(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

// ─── learning ────────────────────────────────────────────────────────

describe("E2E: cowork learning", () => {
  it("stats on empty history prints friendly message", () => {
    const r = run(["cowork", "learning", "stats"]);
    expect(r.stdout).toMatch(/No history yet|No history/i);
  });

  it("stats --json returns []", () => {
    const r = run(["cowork", "learning", "stats", "--json"]);
    expect(JSON.parse(r.stdout.trim())).toEqual([]);
  });

  it("recommend with no history prints null/no recommendation", () => {
    const r = run(["cowork", "learning", "recommend", "do", "something"]);
    expect(r.stdout).toMatch(/No recommendation|No history/i);
  });

  it("failures on empty history prints no-failures", () => {
    const r = run(["cowork", "learning", "failures"]);
    expect(r.stdout).toMatch(/No failures/i);
  });

  it("stats --json reflects seeded history", () => {
    const hist = join(tmp, ".chainlesschain", "cowork", "history.jsonl");
    const records = [
      {
        taskId: "t1",
        status: "completed",
        templateId: "writer",
        templateName: "Writer",
        userMessage: "write a report",
        result: {
          summary: "ok",
          tokenCount: 100,
          iterationCount: 2,
          toolsUsed: ["read"],
        },
      },
      {
        taskId: "t2",
        status: "failed",
        templateId: "writer",
        templateName: "Writer",
        userMessage: "write another",
        result: { summary: "boom" },
      },
    ];
    writeFileSync(
      hist,
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf-8",
    );

    const r = run(["cowork", "learning", "stats", "--json"]);
    const out = JSON.parse(r.stdout.trim());
    expect(out).toHaveLength(1);
    expect(out[0].templateId).toBe("writer");
    expect(out[0].runs).toBe(2);
  });

  it("recommend --json returns object with templateId", () => {
    const r = run([
      "cowork",
      "learning",
      "recommend",
      "--json",
      "write",
      "report",
    ]);
    const rec = JSON.parse(r.stdout.trim());
    expect(rec?.templateId).toBe("writer");
  });

  it("failures --json surfaces failed runs", () => {
    const r = run(["cowork", "learning", "failures", "--json"]);
    const out = JSON.parse(r.stdout.trim());
    expect(out[0].templateId).toBe("writer");
    expect(out[0].failureCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── workflow ────────────────────────────────────────────────────────

describe("E2E: cowork workflow", () => {
  it("list on empty dir prints no-workflows", () => {
    const fresh = mkdtempSync(join(tmpdir(), "cowork-wf-e2e-"));
    try {
      const r = run(["cowork", "workflow", "list"], { cwd: fresh });
      expect(r.stdout).toMatch(/No workflows/i);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("add + list + show + remove round-trip", () => {
    const defFile = join(tmp, "wf.json");
    writeFileSync(
      defFile,
      JSON.stringify({
        id: "wf-e2e",
        name: "E2E Workflow",
        steps: [
          { id: "a", message: "step a" },
          { id: "b", message: "step b", dependsOn: ["a"] },
        ],
      }),
      "utf-8",
    );

    const rAdd = run(["cowork", "workflow", "add", defFile]);
    expect(rAdd.stdout).toMatch(/Saved workflow/i);

    const rList = run(["cowork", "workflow", "list", "--json"]);
    const wfs = JSON.parse(rList.stdout.trim());
    expect(wfs.map((w) => w.id)).toContain("wf-e2e");

    const rShow = run(["cowork", "workflow", "show", "wf-e2e"]);
    const wf = JSON.parse(rShow.stdout.trim());
    expect(wf.steps).toHaveLength(2);

    const rRm = run(["cowork", "workflow", "remove", "wf-e2e"]);
    expect(rRm.stdout).toMatch(/Removed/i);
  });

  it("show on missing workflow exits non-zero", () => {
    const r = run(["cowork", "workflow", "show", "nope"], { allowFail: true });
    expect(r.status).not.toBe(0);
  });
});

// ─── share ───────────────────────────────────────────────────────────

describe("E2E: cowork share", () => {
  it("export-result + verify + import round-trip", () => {
    // Seed one history record so export-result has something to export
    const hist = join(tmp, ".chainlesschain", "cowork", "history.jsonl");
    const existing = existsSync(hist) ? readFileSync(hist, "utf-8") : "";
    writeFileSync(
      hist,
      existing +
        JSON.stringify({
          taskId: "share-task-1",
          status: "completed",
          templateId: "writer",
          templateName: "Writer",
          userMessage: "share me",
          timestamp: "2026-04-15T00:00:00Z",
          result: { summary: "shared", tokenCount: 50 },
        }) +
        "\n",
      "utf-8",
    );

    const pktFile = join(tmp, "share.pkt.json");
    const rExp = run([
      "cowork",
      "share",
      "export-result",
      "share-task-1",
      "--out",
      pktFile,
      "--author",
      "tester",
    ]);
    expect(rExp.stdout).toMatch(/Wrote result packet/i);
    expect(existsSync(pktFile)).toBe(true);

    const rVerify = run(["cowork", "share", "verify", pktFile]);
    expect(rVerify.stdout).toMatch(/Valid result packet/i);

    const rImp = run(["cowork", "share", "import", pktFile]);
    expect(rImp.stdout).toMatch(/Imported result/i);
    const shared = join(
      tmp,
      ".chainlesschain",
      "cowork",
      "shared-results",
      "share-task-1.json",
    );
    expect(existsSync(shared)).toBe(true);
  });

  it("verify fails on corrupted packet", () => {
    const bad = join(tmp, "bad.pkt.json");
    writeFileSync(bad, '{"kind":"template","version":1}', "utf-8");
    const r = run(["cowork", "share", "verify", bad], { allowFail: true });
    expect(r.status).not.toBe(0);
  });

  it("export-result for missing taskId exits non-zero", () => {
    const r = run(
      [
        "cowork",
        "share",
        "export-result",
        "does-not-exist",
        "--out",
        join(tmp, "x.json"),
      ],
      { allowFail: true },
    );
    expect(r.status).not.toBe(0);
  });
});

// ─── help surface ────────────────────────────────────────────────────

describe("E2E: cowork help shows new commands", () => {
  it("cowork --help lists learning, workflow, share, cron", () => {
    const r = run(["cowork", "--help"]);
    expect(r.stdout).toMatch(/learning/);
    expect(r.stdout).toMatch(/workflow/);
    expect(r.stdout).toMatch(/share/);
    expect(r.stdout).toMatch(/cron/);
  });
});
