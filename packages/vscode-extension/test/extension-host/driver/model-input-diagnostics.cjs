"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vscode = require("vscode");
exports.run = async function () {
  const directory = process.env.CC_MODEL_INPUT_HOST_DIR;
  const node = process.env.CC_MODEL_INPUT_NODE;
  assert.ok(directory && node);
  const target = vscode.extensions.getExtension(
    "chainlesschain.chainlesschain-ide",
  );
  assert.ok(target, "Target extension is installed in this development host");
  await target.activate();
  assert.ok(
    (await vscode.commands.getCommands(true)).includes(
      "chainlesschain.session.modelInputs",
    ),
  );
  const { openModelInputDiagnostics } = require(
    path.join(target.extensionPath, "src/model-input-diagnostics.js"),
  );
  const { runCliResult } = require(
    path.join(target.extensionPath, "src/chat/introspect-commands.js"),
  );
  const sessionId = "native-model-input-session";
  const hash = "a".repeat(64);
  const report = {
    schema: "chainlesschain.session-model-inputs/v1",
    sessionId,
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
          attempt: 1,
          stage: "fetch-body",
          bytes: 42,
          bodyCovered: true,
          bodyDigest: hash,
          billingVerified: false,
          providerAcceptanceVerified: false,
          rawBody: "PRIVATE-SOURCE-MUST-NOT-RENDER",
        },
      },
    ],
  };
  const args = [
    "session",
    "show",
    sessionId,
    "--json",
    "--model-inputs",
    "--limit",
    "50",
  ];
  const shim = path.join(directory, "read-only-cli-fixture.cjs");
  fs.writeFileSync(
    shim,
    "const assert=require('node:assert/strict');assert.deepEqual(process.argv.slice(2)," +
      JSON.stringify(args) +
      ");process.stdout.write(" +
      JSON.stringify(JSON.stringify(report)) +
      ");",
    { flag: "wx" },
  );
  const testUi = {
    workspace: vscode.workspace,
    window: {
      showTextDocument: vscode.window.showTextDocument,
      showErrorMessage: async (message) => {
        throw new Error(message);
      },
      showInformationMessage: async (message) => {
        throw new Error(message);
      },
    },
  };
  const editor = await openModelInputDiagnostics(testUi, {
    getSessionId: () => sessionId,
    cwd: directory,
    runCliResult: async (request) => {
      const outcome = await runCliResult({
        ...request,
        command: node,
        args: [shim, ...request.args],
      });
      fs.writeFileSync(
        path.join(directory, "cli-result.json"),
        JSON.stringify(outcome, null, 2),
        { flag: "wx" },
      );
      return outcome;
    },
  });
  assert.ok(editor?.document);
  assert.equal(editor.document.languageId, "plaintext");
  const content = editor.document.getText();
  assert.ok(content.includes(sessionId));
  assert.ok(content.includes(hash));
  assert.ok(!content.includes("PRIVATE-SOURCE"));
  assert.equal(
    vscode.window.activeTextEditor.document.uri.toString(),
    editor.document.uri.toString(),
  );
  fs.writeFileSync(
    path.join(directory, "host-result.json"),
    JSON.stringify(
      {
        schema: "chainlesschain.model-input-native-host/v1",
        status: "passed",
        scope:
          "real-vscode-command-registration-editor-and-cli-process-fixture",
        realCanonicalSessionJourney: false,
        vscodeVersion: vscode.version,
        extensionPath: target.extensionPath,
        languageId: editor.document.languageId,
        cliArgs: args,
        documentBytes: Buffer.byteLength(content),
        documentDigest: crypto
          .createHash("sha256")
          .update(content)
          .digest("hex"),
        rawSourceExcluded: true,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
};
