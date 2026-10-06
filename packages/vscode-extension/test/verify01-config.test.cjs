"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { main, validateConfig } = require("./extension-host/verify01-run.cjs");
const { validateHostDomRequest } = require("../src/chat/host-dom-relay.js");

function config(root, permissionMode) {
  return {
    sampleId: "first-run-permission-preflight",
    prompt: "Read the fixture and describe it.",
    provider: "volcengine",
    model: "explicit-test-model",
    permissionMode,
    hostVersion: "1.132.0",
    extensionVersion: "0.37.135",
    deadline: Date.now() + 60000,
    ...Object.fromEntries(
      [
        "workspace",
        "captureDir",
        "profileHome",
        "userDataDir",
        "extensionsDir",
      ].map((key) => [key, path.join(root, key)]),
    ),
  };
}

test("live launcher accepts exactly the panel's permission modes without rewriting them", () => {
  const root = path.resolve(os.tmpdir(), "cc-verify01-config-contract");
  for (const mode of ["default", "acceptEdits", "bypassPermissions"]) {
    const candidate = config(root, mode);
    assert.equal(validateConfig(candidate), candidate);
    assert.deepEqual(validateHostDomRequest({ action: "setMode", mode }), {
      action: "setMode",
      mode,
    });
  }
  for (const mode of ["auto", "plan", "ask", "DEFAULT", "bypass", "unknown"]) {
    assert.throws(
      () => validateConfig(config(root, mode)),
      /permissionMode must be/u,
    );
    assert.throws(
      () => validateHostDomRequest({ action: "setMode", mode }),
      /Unsupported host permission mode/u,
    );
  }
});

test("invalid CLI permission alias fails before VSIX lookup, host launch, or capture creation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-verify01-config-"));
  try {
    const file = path.join(root, "config.json");
    const bytes = Buffer.from(JSON.stringify(config(root, "auto")));
    fs.writeFileSync(file, bytes, { flag: "wx" });
    await assert.rejects(
      main([
        "--confirm-live",
        "--config",
        file,
        "--config-digest",
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        "--vsix",
        path.join(root, "must-not-be-read.vsix"),
        "--vsix-digest",
        `sha256:${"0".repeat(64)}`,
      ]),
      /permissionMode must be default, acceptEdits, or bypassPermissions/u,
    );
    assert.deepEqual(fs.readdirSync(root), ["config.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
