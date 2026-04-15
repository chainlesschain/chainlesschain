/**
 * Integration tests: Cowork Evolution v0.46.0 modules working together on
 * a real filesystem (temp dir). No LLM calls — runTask is stubbed — but all
 * marketplace ↔ template-registry ↔ workflow ↔ share ↔ learning interactions
 * run against real JSON/JSONL files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  saveUserTemplate,
  listUserTemplates,
  toShareableTemplate,
  _deps as marketplaceDeps,
} from "../../src/lib/cowork-template-marketplace.js";
import {
  setUserTemplates,
  getTemplate,
} from "../../src/lib/cowork-task-templates.js";
import {
  saveWorkflow,
  executeWorkflow,
  listWorkflows,
  _deps as workflowDeps,
} from "../../src/lib/cowork-workflow.js";
import {
  exportTemplatePacket,
  exportResultPacket,
  writePacket,
  readPacket,
  importTemplatePacket,
  importResultPacket,
  findHistoryRecord,
  _deps as shareDeps,
} from "../../src/lib/cowork-share.js";
import {
  loadHistory,
  computeTemplateStats,
  recommendTemplate,
  summarizeFailures,
  _deps as learningDeps,
} from "../../src/lib/cowork-learning.js";
import {
  parseCron,
  validateCron,
  addSchedule,
  loadSchedules,
  CoworkCronScheduler,
  _deps as cronDeps,
} from "../../src/lib/cowork-cron.js";

// ─── Setup ───────────────────────────────────────────────────────────────────

let tmpDir;

function seedHistory(cwd, records) {
  const dir = join(cwd, ".chainlesschain", "cowork");
  const { mkdirSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(dir, "history.jsonl"), body, "utf-8");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cowork-evo-"));
  // Reset all _deps to native fs (in case a previous unit test mutated them)
  const fs = require("node:fs");
  for (const dep of [
    marketplaceDeps,
    workflowDeps,
    shareDeps,
    learningDeps,
    cronDeps,
  ]) {
    if ("existsSync" in dep) dep.existsSync = fs.existsSync;
    if ("mkdirSync" in dep) dep.mkdirSync = fs.mkdirSync;
    if ("readFileSync" in dep) dep.readFileSync = fs.readFileSync;
    if ("writeFileSync" in dep) dep.writeFileSync = fs.writeFileSync;
    if ("readdirSync" in dep) dep.readdirSync = fs.readdirSync;
    if ("unlinkSync" in dep) dep.unlinkSync = fs.unlinkSync;
    if ("appendFileSync" in dep) dep.appendFileSync = fs.appendFileSync;
  }
  shareDeps.now = () => "2026-04-15T12:00:00Z";
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir))
    rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_TEMPLATE = {
  id: "itest-writer",
  name: "Integration Writer",
  category: "writing",
  acceptsFiles: true,
  fileTypes: [".md"],
  mode: "agent",
  systemPromptExtension: "Write concise prose.",
};

// ─── Marketplace ↔ Template Registry ─────────────────────────────────────────

describe("marketplace → template registry", () => {
  it("installed user templates are resolvable via getTemplate()", () => {
    saveUserTemplate(tmpDir, SAMPLE_TEMPLATE);
    const templates = listUserTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    setUserTemplates(templates);
    const resolved = getTemplate("itest-writer");
    expect(resolved.id).toBe("itest-writer");
    expect(resolved.systemPromptExtension).toBe("Write concise prose.");
    // Cleanup: reset user-templates so other tests aren't polluted
    setUserTemplates([]);
  });

  it("unknown templateId falls back to free mode", () => {
    setUserTemplates([]);
    const free = getTemplate("definitely-not-installed");
    expect(free.id).toBe("free");
  });
});

// ─── Share round-trip on real filesystem ────────────────────────────────────

describe("share: export → transfer → import", () => {
  it("template packet round-trips through disk and back into the marketplace", () => {
    const srcCwd = join(tmpDir, "src");
    const dstCwd = join(tmpDir, "dst");
    require("node:fs").mkdirSync(srcCwd, { recursive: true });
    require("node:fs").mkdirSync(dstCwd, { recursive: true });

    // Build packet from a raw template (as if sharing a built-in)
    const packet = exportTemplatePacket(SAMPLE_TEMPLATE, { author: "alice" });
    const packetFile = join(tmpDir, "tpl.pkt.json");
    writePacket(packetFile, packet);

    // Other user reads & imports
    const read = readPacket(packetFile);
    expect(read.kind).toBe("template");
    importTemplatePacket(dstCwd, read);

    const dstTemplates = listUserTemplates(dstCwd);
    expect(dstTemplates.map((t) => t.id)).toContain("itest-writer");
  });

  it("result packet round-trips and lands in shared-results/", () => {
    const record = {
      taskId: "task-alpha",
      status: "completed",
      templateId: "itest-writer",
      templateName: "Integration Writer",
      userMessage: "draft outline",
      timestamp: "2026-04-14T10:00:00Z",
      result: {
        summary: "drafted 5 sections",
        tokenCount: 420,
        iterationCount: 3,
      },
    };
    const packet = exportResultPacket(record);
    const file = join(tmpDir, "res.pkt.json");
    writePacket(file, packet);

    const read = readPacket(file);
    const { file: outPath, taskId } = importResultPacket(tmpDir, read);
    expect(taskId).toBe("task-alpha");
    expect(existsSync(outPath)).toBe(true);
    const body = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(body.payload.result.summary).toBe("drafted 5 sections");
  });

  it("findHistoryRecord locates real JSONL entries", () => {
    seedHistory(tmpDir, [
      {
        taskId: "tA",
        status: "completed",
        templateId: "x",
        result: { summary: "ok" },
      },
      {
        taskId: "tB",
        status: "failed",
        templateId: "y",
        result: { summary: "err" },
      },
    ]);
    const rec = findHistoryRecord(tmpDir, "tB");
    expect(rec.status).toBe("failed");
  });

  it("corrupted packet on disk is rejected by readPacket", () => {
    const file = join(tmpDir, "bad.pkt.json");
    writeFileSync(file, '{"kind":"template","version":1}', "utf-8");
    expect(() => readPacket(file)).toThrow(/Invalid|checksum|missing/);
  });
});

// ─── Learning reads real history JSONL ──────────────────────────────────────

describe("learning over real history.jsonl", () => {
  it("computes stats and recommendations from real file", () => {
    seedHistory(tmpDir, [
      {
        taskId: "1",
        status: "completed",
        templateId: "writer",
        templateName: "Writer",
        userMessage: "write weekly report",
        result: {
          summary: "ok",
          tokenCount: 100,
          iterationCount: 2,
          toolsUsed: ["read"],
        },
      },
      {
        taskId: "2",
        status: "completed",
        templateId: "writer",
        templateName: "Writer",
        userMessage: "weekly report for team",
        result: {
          summary: "ok",
          tokenCount: 120,
          iterationCount: 2,
          toolsUsed: ["read", "write"],
        },
      },
      {
        taskId: "3",
        status: "failed",
        templateId: "coder",
        templateName: "Coder",
        userMessage: "refactor parser",
        result: { summary: "timeout" },
      },
    ]);
    const history = loadHistory(tmpDir);
    expect(history).toHaveLength(3);

    const stats = computeTemplateStats(history);
    const writer = stats.find((s) => s.templateId === "writer");
    expect(writer.runs).toBe(2);
    expect(writer.successRate).toBe(1);

    const rec = recommendTemplate("weekly report draft", history);
    expect(rec?.templateId).toBe("writer");

    const failures = summarizeFailures(history);
    expect(failures[0].templateId).toBe("coder");
  });

  it("empty history yields empty stats", () => {
    const history = loadHistory(tmpDir);
    expect(history).toEqual([]);
    expect(computeTemplateStats(history)).toEqual([]);
    expect(recommendTemplate("anything", history)).toBeNull();
  });
});

// ─── Workflow executes with stubbed runner, writes real history ──────────────

describe("workflow end-to-end (stubbed runner)", () => {
  it("saves workflow, executes it, appends to workflow-history.jsonl", async () => {
    const wf = {
      id: "pipeline-1",
      name: "Fetch-then-summarize",
      steps: [
        { id: "fetch", message: "find items" },
        {
          id: "sum",
          message: "summarize: ${step.fetch.summary}",
          dependsOn: ["fetch"],
        },
      ],
    };
    saveWorkflow(tmpDir, wf);
    expect(listWorkflows(tmpDir).map((w) => w.id)).toContain("pipeline-1");

    const seen = [];
    workflowDeps.runTask = async ({ userMessage }) => {
      seen.push(userMessage);
      return {
        taskId: `t-${seen.length}`,
        status: "completed",
        result: { summary: `output for: ${userMessage}` },
      };
    };

    const result = await executeWorkflow({ workflow: wf, cwd: tmpDir });
    expect(result.status).toBe("completed");
    expect(seen[0]).toBe("find items");
    expect(seen[1]).toBe("summarize: output for: find items");

    const histFile = join(
      tmpDir,
      ".chainlesschain",
      "cowork",
      "workflow-history.jsonl",
    );
    expect(existsSync(histFile)).toBe(true);
    const histBody = readFileSync(histFile, "utf-8").trim();
    expect(JSON.parse(histBody).workflowId).toBe("pipeline-1");
  });

  it("halts on failure by default, continueOnError lets later steps run", async () => {
    const wf = {
      id: "p2",
      name: "halts",
      steps: [
        { id: "a", message: "a" },
        { id: "b", message: "b", dependsOn: ["a"] },
      ],
    };
    let calls = 0;
    workflowDeps.runTask = async () => {
      calls++;
      return {
        taskId: `t-${calls}`,
        status: calls === 1 ? "failed" : "completed",
        result: { summary: calls === 1 ? "boom" : "ok" },
      };
    };
    const r1 = await executeWorkflow({ workflow: wf, cwd: tmpDir });
    expect(r1.status).toBe("failed");
    expect(calls).toBe(1);

    calls = 0;
    const r2 = await executeWorkflow({
      workflow: wf,
      cwd: tmpDir,
      continueOnError: true,
    });
    expect(r2.status).toBe("partial");
    expect(calls).toBe(2);
  });
});

// ─── Cron persists + parses + schedules ──────────────────────────────────────

describe("cron end-to-end (without starting scheduler)", () => {
  it("validates expressions and round-trips through real JSONL", () => {
    expect(validateCron("0 9 * * 1-5")).toBeNull(); // null = valid
    expect(typeof validateCron("bogus")).toBe("string"); // string = error

    const entry = addSchedule(tmpDir, {
      cron: "*/15 * * * *",
      templateId: null,
      userMessage: "check status",
      files: [],
    });
    expect(entry.id).toBeTruthy();
    const schedules = loadSchedules(tmpDir);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].cron).toBe("*/15 * * * *");
  });

  it("parseCron returns a matcher that respects dow 7↔0 equivalence", () => {
    const matchSun0 = parseCron("0 0 * * 0");
    const matchSun7 = parseCron("0 0 * * 7");
    // Pick a Sunday at midnight
    const sunday = new Date("2026-04-12T00:00:00"); // 2026-04-12 is Sunday
    expect(matchSun0(sunday)).toBe(true);
    expect(matchSun7(sunday)).toBe(true);
    // And a Monday should not match either
    const monday = new Date("2026-04-13T00:00:00");
    expect(matchSun0(monday)).toBe(false);
    expect(matchSun7(monday)).toBe(false);
  });
});
