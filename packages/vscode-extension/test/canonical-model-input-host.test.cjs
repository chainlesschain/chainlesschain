"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  validateSessionConfig,
  isAllowedCanonicalRead,
  createCanonicalReadCli,
} = require("./extension-host/canonical-model-input-contract.cjs");

test("native readback permits only selected-session diagnostic/history queries", () => {
  const id = "canonical-session-1";
  for (const args of [
    ["--version"],
    ["llm", "capabilities", "--json"],
    ["session", "show", id, "--json", "--model-inputs", "--limit", "50"],
    [
      "session",
      "show",
      id,
      "--history",
      "--json",
      "--page-size",
      "100",
      "--before",
      "opaque+cursor",
    ],
    ["session", "show", id, "--json", "--history", "--after", "opaque+cursor"],
    ["session", "show", "--json", "--history", "--page-size", "50", "--", id],
  ])
    assert.equal(isAllowedCanonicalRead(args, id), true, JSON.stringify(args));
  for (const args of [
    ["agent", "--resume", id],
    ["llm", "chat", "--json"],
    ["llm", "capabilities", "--json", "--provider", "private"],
    ["session", "show", "--json", "--history", "--", "foreign"],
    ["session", "show", "--json", "--history", "--", id, "--delete"],
    ["session", "delete", id],
    ["session", "show", "foreign", "--json", "--model-inputs"],
    ["session", "show", id, "--model-inputs"],
    ["session", "show", id, "--json", "--model-inputs", "--history"],
    ["session", "show", id, "--json", "--json", "--model-inputs"],
    ["session", "show", id, "--json", "--model-inputs", "--limit"],
    ["session", "show", id, "--json", "--model-inputs", "--limit", "-1"],
    ["session", "show", id, "--json", "--model-inputs", "--api-key", "private"],
  ])
    assert.equal(isAllowedCanonicalRead(args, id), false, JSON.stringify(args));
});

test("real readback child refuses inference before launching the CLI", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-canonical-read-test-"),
  );
  try {
    const marker = path.join(directory, "launched.json");
    const cli = path.join(directory, "actual-cli.cjs");
    fs.writeFileSync(
      cli,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));process.stdout.write('read completed');`,
    );
    const tracePath = path.join(directory, "trace.jsonl");
    const generated = createCanonicalReadCli({
      directory: path.join(directory, "wrapper"),
      node: process.execPath,
      cli,
      sessionId: "selected",
      tracePath,
    });
    const blocked = spawnSync(
      process.execPath,
      [generated.script, "agent", "--resume", "selected"],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(blocked.status, 73);
    assert.equal(fs.existsSync(marker), false);
    const args = [
      "session",
      "show",
      "selected",
      "--json",
      "--history",
      "--after",
      "cursor 中文 & literal",
    ];
    const read = spawnSync(process.execPath, [generated.script, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(read.status, 0);
    assert.equal(read.stdout, "read completed");
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), args);
    assert.deepEqual(
      fs
        .readFileSync(tracePath, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
        .map((r) => r.allowed),
      [false, true],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native session handoff binds the exact canonical journal and omits extra fields", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-canonical-config-test-"),
  );
  try {
    const journalPath = path.join(directory, "sessions", "selected.jsonl");
    fs.mkdirSync(path.dirname(journalPath));
    fs.writeFileSync(journalPath, "");
    const value = {
      sessionId: "selected",
      sessionHome: directory,
      securityAnchorHome: directory,
      workspaceDir: directory,
      journalPath,
      expectedJournalDigest: "a".repeat(64),
      credential: "never-forward",
    };
    const actual = validateSessionConfig(value);
    assert.equal(actual.credential, undefined);
    assert.throws(
      () => validateSessionConfig({ ...value, sessionId: 123 }),
      /session identity/,
    );
    assert.throws(
      () => validateSessionConfig({ ...value, expectedJournalDigest: null }),
      /commitment/,
    );
    assert.throws(
      () => validateSessionConfig({ ...value, workspaceDir: "relative" }),
      /absolute/,
    );
    const wrong = path.join(directory, "foreign.jsonl");
    fs.writeFileSync(wrong, "");
    assert.throws(
      () => validateSessionConfig({ ...value, journalPath: wrong }),
      /not the selected session/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
