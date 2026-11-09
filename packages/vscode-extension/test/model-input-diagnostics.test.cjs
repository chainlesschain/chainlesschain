"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildModelInputArgs,
  parseModelInputReport,
  openModelInputDiagnostics,
} = require("../src/model-input-diagnostics.js");
const session = "session-A";
const hash = "a".repeat(64);
function report() {
  return {
    schema: "chainlesschain.session-model-inputs/v1",
    sessionId: session,
    total: 1,
    truncated: false,
    billingVerified: false,
    records: [
      {
        eventHash: hash,
        diagnostic: {
          schema: "chainlesschain.model-input-diagnostic/v1",
          requestId: "11111111-1111-4111-8111-111111111111",
          usageCallId: null,
          phase: "body-prepared",
          stage: "fetch-body",
          attempt: 1,
          bytes: 42,
          bodyCovered: true,
          bodyDigest: hash,
          providerAcceptanceVerified: false,
          billingVerified: false,
          rawBody: "<script>source-secret</script>",
          authorization: "private-token",
        },
      },
    ],
  };
}
function ui() {
  const docs = [],
    errors = [],
    notices = [];
  return {
    docs,
    errors,
    notices,
    workspace: {
      openTextDocument: async (doc) => {
        docs.push(doc);
        return doc;
      },
    },
    window: {
      showTextDocument: async (doc) => doc,
      showInformationMessage: async (text) => notices.push(text),
      showErrorMessage: async (text) => errors.push(text),
    },
  };
}
test("uses the canonical read-only CLI view and rejects command-line injection IDs", () => {
  assert.deepEqual(buildModelInputArgs(session), [
    "session",
    "show",
    session,
    "--json",
    "--model-inputs",
    "--limit",
    "50",
  ]);
  for (const id of ["--help", "a & echo bad", "a/b", "%PATH%", "\n", "", null])
    assert.throws(() => buildModelInputArgs(id));
});
test("projects safe fields and rejects mismatched sessions, unsupported shapes and forged confidence", () => {
  const parsed = parseModelInputReport(JSON.stringify(report()), session);
  assert.equal(parsed.records[0].bodyDigest, hash);
  assert.doesNotMatch(
    JSON.stringify(parsed),
    /source-secret|private-token|rawBody|authorization/,
  );
  for (const mutate of [
    (r) => {
      r.sessionId = "other";
    },
    (r) => {
      r.billingVerified = true;
    },
    (r) => {
      r.records[0].diagnostic.providerAcceptanceVerified = true;
    },
    (r) => {
      r.records[0].diagnostic.requestId = {};
    },
    (r) => {
      r.total = 0;
    },
    (r) => {
      r.records[0].eventHash = "invalid";
    },
    (r) => {
      r.records[0].diagnostic.phase = "raw-request";
    },
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => parseModelInputReport(JSON.stringify(value), session));
  }
  assert.throws(() => parseModelInputReport("not-json", session));
});
test("projects bounded per-source mappings without exposing source payloads", () => {
  const value = report();
  value.records[0].diagnostic.sourceMapping = {
    covered: true,
    reason: "complete",
    sourceCount: 1,
    sourcesTruncated: false,
    protocol: "openai-chat",
    sources: [
      {
        ordinal: 0,
        status: "mapped",
        fragments: [
          {
            path: "/messages/0",
            start: null,
            end: null,
            digest: hash,
            bytes: 12,
            raw: "private source text",
          },
        ],
      },
    ],
  };
  const parsed = parseModelInputReport(JSON.stringify(value), session);
  assert.equal(parsed.records[0].sourceMapping.sources[0].status, "mapped");
  assert.equal(parsed.records[0].sourceMapping.sources[0].fragments[0].bytes, 12);
  assert.doesNotMatch(JSON.stringify(parsed), /private source text|raw/);
  value.records[0].diagnostic.sourceMapping.sources[0].fragments[0].path =
    "/unsafe";
  assert.throws(() => parseModelInputReport(JSON.stringify(value), session));
});
test("displays a text-only snapshot for the current session without unknown raw fields", async () => {
  const vscode = ui(),
    calls = [];
  await openModelInputDiagnostics(vscode, {
    getSessionId: () => session,
    command: "trusted-cc",
    cwd: "project",
    runCliResult: async (request) => {
      calls.push(request);
      return { ok: true, stdout: JSON.stringify(report()) };
    },
  });
  assert.equal(calls[0].command, "trusted-cc");
  assert.equal(calls[0].strictUtf8, true);
  assert.equal(vscode.docs[0].language, "plaintext");
  assert.match(vscode.docs[0].content, /session-A/);
  assert.doesNotMatch(
    vscode.docs[0].content,
    /source-secret|private-token|<script>/,
  );
});
test("never dispatches without an active session and treats empty records as unavailable coverage", async () => {
  const vscode = ui();
  let calls = 0;
  await openModelInputDiagnostics(vscode, {
    getSessionId: () => null,
    runCliResult: async () => {
      calls++;
    },
  });
  assert.equal(calls, 0);
  const value = report();
  value.total = 0;
  value.records = [];
  await openModelInputDiagnostics(vscode, {
    getSessionId: () => session,
    runCliResult: async () => ({ ok: true, stdout: JSON.stringify(value) }),
  });
  assert.equal(vscode.docs.length, 0);
  assert.equal(vscode.notices.length, 2);
});
test("suppresses stale results after a session switch", async () => {
  const vscode = ui();
  let active = session;
  await openModelInputDiagnostics(vscode, {
    getSessionId: () => active,
    runCliResult: async () => {
      active = "session-B";
      return { ok: true, stdout: JSON.stringify(report()) };
    },
  });
  assert.equal(vscode.docs.length, 0);
  assert.equal(vscode.notices.length, 1);
});
test("never displays stdout or stderr from failed, old or malformed CLI output", async () => {
  for (const result of [
    { ok: false, stdout: "private", stderr: "source-secret" },
    { ok: true, stdout: "unsupported-private-output" },
    { ok: true, stdout: JSON.stringify({ ...report(), sessionId: "other" }) },
  ]) {
    const vscode = ui();
    await openModelInputDiagnostics(vscode, {
      getSessionId: () => session,
      runCliResult: async () => result,
    });
    assert.equal(vscode.docs.length, 0);
    assert.equal(vscode.errors.length, 1);
    assert.doesNotMatch(vscode.errors[0], /private|source-secret/);
  }
});
test("contributes an actual command wired to the active conversation", () => {
  const manifest = require("../package.json");
  assert.ok(
    manifest.contributes.commands.some(
      (c) => c.command === "chainlesschain.session.modelInputs",
    ),
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../src/extension.js"),
    "utf8",
  );
  assert.equal(
    /registerCommand\(\s*"chainlesschain.session.modelInputs"/.test(source),
    true,
  );
  assert.match(
    source,
    /getSessionId: \(\) => chatProvider.activeSessionId\(\)/,
  );
});

test("rechecks session ownership after asynchronously creating the document", async () => {
  const vscode = ui();
  let active = session,
    shown = 0;
  vscode.workspace.openTextDocument = async (doc) => {
    active = "session-B";
    return doc;
  };
  vscode.window.showTextDocument = async () => {
    shown++;
  };
  await openModelInputDiagnostics(vscode, {
    getSessionId: () => active,
    runCliResult: async () => ({ ok: true, stdout: JSON.stringify(report()) }),
  });
  assert.equal(shown, 0);
  assert.equal(vscode.notices.length, 1);
});

test("native executable queries preserve exact argv without batch-shell escaping", async () => {
  const { runCliResult } = require("../src/chat/introspect-commands.js");
  const sentinels = ["space and 中文", "& exit 99", "%PATH%", 'quote"caret^'];
  const result = await runCliResult({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      "--",
      ...sentinels,
    ],
    strictUtf8: true,
  });
  assert.equal(result.ok, true, "native query failed");
  assert.deepEqual(JSON.parse(result.stdout), sentinels);
});
