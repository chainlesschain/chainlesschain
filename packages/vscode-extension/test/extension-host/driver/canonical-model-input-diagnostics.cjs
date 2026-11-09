"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function runNativeDiagnostic() {
  const config = JSON.parse(
    fs.readFileSync(process.env.CC_CANONICAL_MODEL_INPUT_CONFIG, "utf8"),
  );
  const expected = JSON.parse(
    fs.readFileSync(process.env.CC_CANONICAL_MODEL_INPUT_REPORT, "utf8"),
  );
  const target = vscode.extensions.getExtension(
    "chainlesschain.chainlesschain-ide",
  );
  assert.ok(target);
  const installed = fs.realpathSync(target.extensionPath);
  const extensionRoot = fs.realpathSync(
    process.env.CC_CANONICAL_MODEL_INPUT_EXTENSIONS,
  );
  const relative = path.relative(extensionRoot, installed);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "Target must load from fresh installed VSIX",
  );
  const hash = () =>
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(config.journalPath))
      .digest("hex");
  assert.equal(hash(), config.expectedJournalDigest);
  await target.activate();
  assert.equal(
    vscode.version,
    process.env.CC_CANONICAL_MODEL_INPUT_HOST_VERSION,
  );
  assert.ok(
    (await vscode.commands.getCommands(true)).includes(
      "chainlesschain.session.modelInputs",
    ),
  );
  const link = vscode.Uri.parse(
    `vscode://chainlesschain.chainlesschain-ide/open?session=${encodeURIComponent(config.sessionId)}`,
  );
  await vscode.commands.executeCommand("vscode.open", link);
  // Exercise the registered production command, not the rendering helper with
  // a supplied getSessionId or fabricated CLI result.
  await vscode.commands.executeCommand("chainlesschain.session.modelInputs");
  const deadline = Date.now() + 15000;
  let editor;
  while (Date.now() < deadline) {
    const candidate = vscode.window.activeTextEditor;
    if (
      candidate?.document.languageId === "plaintext" &&
      candidate.document.getText().includes(config.sessionId)
    ) {
      editor = candidate;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    editor,
    "Registered command did not open the real session diagnostic editor",
  );
  const content = editor.document.getText();
  const actual = JSON.parse(content.slice(content.indexOf("{")));
  const { parseModelInputReport } = require(
    path.join(installed, "src/model-input-diagnostics.js"),
  );
  assert.deepEqual(
    actual,
    parseModelInputReport(JSON.stringify(expected), config.sessionId),
  );
  assert.ok(actual.records.length >= 2);
  assert.equal(actual.billingVerified, false);
  for (const record of expected.records)
    assert.ok(content.includes(record.eventHash));
  assert.equal(
    hash(),
    config.expectedJournalDigest,
    "Native diagnostic mutated canonical journal",
  );
  const receipt = {
    schema: "chainlesschain.canonical-model-input-vscode-native/v1",
    status: "passed",
    scope:
      "installed-vsix-production-deep-link-registered-command-real-canonical-cli-and-editor",
    vscodeVersion: vscode.version,
    extensionVersion: target.packageJSON.version,
    realCanonicalSessionCliRead: true,
    realCanonicalSessionJourney: false,
    readOnly: true,
    journalUnchanged: true,
    recordCount: actual.records.length,
    planningCovered: actual.records.some((r) => r.planning?.covered === true),
    sourceMappingCovered: actual.records.every(
      (r) => r.sourceMapping?.covered === true,
    ),
    bodyCovered: actual.records.some((r) => r.bodyCovered === true),
    documentBytes: Buffer.byteLength(content),
    documentDigest: crypto.createHash("sha256").update(content).digest("hex"),
    journalDigest: hash(),
    modelInvokedByIde: false,
  };
  fs.writeFileSync(
    process.env.CC_CANONICAL_MODEL_INPUT_RESULT,
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}

exports.run = async function () {
  let timer;
  try {
    await Promise.race([
      runNativeDiagnostic(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Native canonical diagnostic deadline exceeded")),
          45000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
