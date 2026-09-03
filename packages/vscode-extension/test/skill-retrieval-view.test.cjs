"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildSkillRetrievalArgs,
  openSkillRetrieval,
  parseSkillRetrievalResult,
} = require("../src/ui/skill-retrieval-view.js");
const { runCliResult } = require("../src/chat/introspect-commands.js");

const D = (char) => `sha256:${char.repeat(64)}`;
const ROOT = path.resolve(__dirname, "..");

function result(overrides = {}) {
  const candidate = {
    id: "repair-tests",
    displayName: "Repair tests",
    namespace: "workspace",
    version: "2.0.0",
    digest: D("a"),
    category: "development",
    contextCostTokens: 20,
    score: 0.9,
    scores: { lexical: 1, vector: 0, outcome: 0.5 },
    outcome: { samples: 0, successRate: 0, correctionRate: 0 },
    reason: "bm25=1.000, vector=0.000, outcome=0.500",
  };
  return {
    schema: "chainlesschain.skill-retrieval-result/v1",
    query: "repair tests",
    selected: candidate,
    candidates: [candidate],
    conflicts: [],
    rejected: [],
    vectorAvailable: false,
    outcomeAuthority: {
      schema: "chainlesschain.skill-outcome-transcript-authority/v1",
      status: "verified",
      sourceDigest: D("f"),
      selectedSessionCount: 2,
      receiptCount: 3,
      uniqueReceiptCount: 2,
      attributionEligibleReceiptCount: 2,
      outcomeEligibleReceiptCount: 2,
      duplicateReceiptCount: 1,
      maxSessions: 128,
      maxReceipts: 10_000,
    },
    ...overrides,
  };
}

test("Skill Retrieval IDE builds only the fixed read-only CLI command", () => {
  assert.deepEqual(buildSkillRetrievalArgs("repair tests", { limit: 5 }), [
    "skill",
    "search",
    "repair tests",
    "--limit",
    "5",
    "--json",
  ]);
  assert.throws(
    () => buildSkillRetrievalArgs("repair", { limit: 65 }),
    /invalid or unbounded/u,
  );
});

test("Skill Retrieval IDE command is contributed, registered, and localized", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.ok(
    manifest.contributes.commands.some(
      ({ command }) => command === "chainlesschain.skills.retrieve",
    ),
  );
  const extension = fs.readFileSync(
    path.join(ROOT, "src", "extension.js"),
    "utf8",
  );
  assert.match(
    extension,
    /registerCommand\(\s*"chainlesschain\.skills\.retrieve"/u,
  );
  for (const file of ["package.nls.json", "package.nls.zh-cn.json"]) {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    assert.equal(typeof messages["cmd.skills.retrieve.title"], "string");
    assert.ok(messages["cmd.skills.retrieve.title"].length > 0);
  }
});

test("Skill Retrieval IDE uses the runner's bounded large-result buffer", async () => {
  let captured;
  const response = await runCliResult({
    command: "cc",
    args: ["skill", "search", "repair", "--json"],
    maxBufferBytes: 8 * 1024 * 1024,
    deps: {
      execFile: (command, args, options, callback) => {
        captured = { command, args, options };
        callback(null, "{}", "");
      },
    },
  });
  assert.equal(response.ok, true);
  assert.equal(captured.options.maxBuffer, 8 * 1024 * 1024);
  assert.throws(
    () =>
      runCliResult({
        maxBufferBytes: 8 * 1024 * 1024 + 1,
        deps: { execFile: () => {} },
      }),
    /invalid or unbounded/u,
  );
});

test("Skill Retrieval IDE rejects drift and duplicate candidate evidence", () => {
  const valid = result();
  assert.equal(
    parseSkillRetrievalResult(JSON.stringify(valid)).selected.digest,
    D("a"),
  );
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({
          ...valid,
          selected: { ...valid.selected, id: "drift" },
        }),
      ),
    /unreturned candidate/u,
  );
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({
          ...valid,
          candidates: [valid.selected, valid.selected],
        }),
      ),
    /duplicate candidate/u,
  );
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({ ...valid, selected: null, conflicts: [] }),
      ),
    /without a conflict/u,
  );
  const second = {
    ...valid.selected,
    id: "second",
    displayName: "Second",
    digest: D("b"),
    score: 0.8,
  };
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({
          ...valid,
          selected: second,
          candidates: [valid.selected, second],
        }),
      ),
    /non-leading candidate/u,
  );
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({
          ...valid,
          selected: null,
          conflicts: [
            {
              type: "ambiguous-top-score",
              digests: [D("a"), D("a")],
              margin: 0,
            },
          ],
        }),
      ),
    /invalid conflict/u,
  );
  assert.throws(
    () =>
      parseSkillRetrievalResult(
        JSON.stringify({
          ...valid,
          outcomeAuthority: {
            ...valid.outcomeAuthority,
            outcomeEligibleReceiptCount: 3,
          },
        }),
      ),
    /invalid outcome authority/u,
  );
});

test("Skill Retrieval IDE inspects canonical evidence without executing a Skill", async () => {
  const calls = [];
  const documents = [];
  const vscode = {
    window: {
      showInputBox: async () => "repair tests",
      showQuickPick: async (items) => items[0],
      showInformationMessage: async () => {},
      showWarningMessage: async () => {},
      showTextDocument: async () => {},
    },
    workspace: {
      openTextDocument: async (options) => {
        documents.push(options);
        return options;
      },
    },
  };
  const routed = result();
  const output = await openSkillRetrieval(vscode, {
    command: "chainlesschain",
    cwd: "C:/repo",
    limit: 5,
    runCliResult: async (request) => {
      calls.push(request);
      return { ok: true, stdout: JSON.stringify(routed) };
    },
  });

  assert.equal(output.selected.digest, D("a"));
  assert.deepEqual(calls, [
    {
      command: "chainlesschain",
      args: ["skill", "search", "repair tests", "--limit", "5", "--json"],
      cwd: "C:/repo",
      timeoutMs: 30_000,
      maxBufferBytes: 8 * 1024 * 1024,
    },
  ]);
  assert.equal(documents.length, 1);
  assert.match(documents[0].content, /"executionAuthorized": false/u);
  assert.doesNotMatch(documents[0].content, /run_skill/u);
});

test("Skill Retrieval IDE visibly abstains on canonical conflicts", async () => {
  const warnings = [];
  const conflicted = result({
    selected: null,
    conflicts: [
      { type: "ambiguous-top-score", digests: [D("a"), D("b")], margin: 0 },
    ],
  });
  const vscode = {
    window: {
      showInputBox: async () => "repair tests",
      showQuickPick: async () => null,
      showInformationMessage: async () => {},
      showWarningMessage: async (message) => warnings.push(message),
    },
    workspace: {},
  };
  await openSkillRetrieval(vscode, {
    command: "cc",
    runCliResult: async () => ({
      ok: true,
      stdout: JSON.stringify(conflicted),
    }),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /abstained/u);
});
