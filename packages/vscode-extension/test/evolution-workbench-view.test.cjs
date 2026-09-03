"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  openEvolutionWorkbench,
  validateEvolutionWorkbenchList,
} = require("../src/ui/evolution-workbench-view.js");

const D = (char) => `sha256:${char.repeat(64)}`;

function candidate(name, { active = false, status = "approved" } = {}) {
  return {
    packetDigest: D(name === "current" ? "a" : name === "previous" ? "b" : "c"),
    candidateId: `candidate:${name}`,
    candidateContentDigest: D(
      name === "current" ? "d" : name === "previous" ? "e" : "f",
    ),
    status,
    validation: { targetRuntimes: ["cli", "vscode"] },
    actualUsage: {
      active,
      receiptCount: 10,
      completed: 9,
      totalCostUsd: 1.25,
    },
    why: { evidence: [{ ref: "artifact:evidence", digest: D("1") }] },
    changes: { unifiedDiff: `+${name}` },
  };
}

function fixture() {
  const current = candidate("current", { active: true });
  const previous = candidate("previous");
  const pending = candidate("pending", { status: "pending" });
  const calls = [];
  const pilot = {
    evolutionWorkbenchList: async (params) => {
      calls.push(["list", params]);
      return {
        projectionDigest: D("9"),
        candidates: [current, previous, pending],
      };
    },
    evolutionWorkbenchCompare: async (params) => {
      calls.push(["compare", params]);
      return { comparisonDigest: D("8") };
    },
    evolutionWorkbenchReview: async (params) => {
      calls.push(["review", params]);
      return { executionDigest: D("7") };
    },
    evolutionWorkbenchRollback: async (params) => {
      calls.push(["rollback", params]);
      return { receiptDigest: D("6") };
    },
  };
  const quickPicks = [];
  const documents = [];
  const vscode = {
    window: {
      showQuickPick: async (items) => {
        const pick = quickPicks.shift();
        if (typeof pick === "function") return pick(items);
        return pick;
      },
      showInputBox: async () => "Reviewed evidence and runtime matrix.",
      showWarningMessage: async (_message, _options, action) => action,
      showInformationMessage: async () => {},
      showTextDocument: async () => {},
    },
    workspace: {
      openTextDocument: async (options) => {
        documents.push(options);
        return options;
      },
    },
  };
  return {
    current,
    previous,
    pending,
    calls,
    pilot,
    quickPicks,
    documents,
    vscode,
  };
}

test("Evolution Workbench IDE shows verified details without a writer", async () => {
  const h = fixture();
  h.quickPicks.push(
    (items) => items.find(({ candidate: value }) => value === h.current),
    (items) => items.find(({ id }) => id === "details"),
  );
  const result = await openEvolutionWorkbench(h.vscode, {
    getPilot: async () => h.pilot,
  });
  assert.equal(result, h.current);
  assert.equal(h.documents.length, 1);
  assert.deepEqual(h.calls, [["list", { limit: 500 }]]);
});

test("Evolution Workbench IDE binds a pending review to exact packet and reason", async () => {
  const h = fixture();
  h.quickPicks.push(
    (items) => items.find(({ candidate: value }) => value === h.pending),
    (items) => items.find(({ id }) => id === "approve"),
  );
  await openEvolutionWorkbench(h.vscode, {
    getPilot: async () => h.pilot,
  });
  assert.deepEqual(h.calls.at(-1), [
    "review",
    {
      packetDigests: [h.pending.packetDigest],
      decision: "approve",
      reason: "Reviewed evidence and runtime matrix.",
    },
  ]);
});

test("Evolution Workbench IDE rolls active content back only to an approved target", async () => {
  const h = fixture();
  h.quickPicks.push(
    (items) => items.find(({ candidate: value }) => value === h.previous),
    (items) => items.find(({ id }) => id === "rollback"),
  );
  await openEvolutionWorkbench(h.vscode, {
    getPilot: async () => h.pilot,
  });
  assert.deepEqual(h.calls.at(-1), [
    "rollback",
    {
      fromPacketDigest: h.current.packetDigest,
      toPacketDigest: h.previous.packetDigest,
      reason: "Reviewed evidence and runtime matrix.",
    },
  ]);
});

test("Evolution Workbench IDE rejects an unverified projection before UI actions", async () => {
  assert.throws(
    () =>
      validateEvolutionWorkbenchList({
        projectionDigest: "not-a-digest",
        candidates: [],
      }),
    /invalid projection/u,
  );
  const h = fixture();
  h.pilot.evolutionWorkbenchList = async () => ({
    projectionDigest: D("9"),
    candidates: [{ status: "approved" }],
  });
  await assert.rejects(
    openEvolutionWorkbench(h.vscode, { getPilot: async () => h.pilot }),
    /invalid candidate/u,
  );
  assert.equal(h.quickPicks.length, 0);
});
