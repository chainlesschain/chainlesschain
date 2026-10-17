import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import {
  ARTIFACT_PROMPT,
  HOST_VERSION,
  PUBLIC_VSCODE_VERSION,
} from "../scripts/verify01-public-vscode-matrix-diagnostic.mjs";
const require = createRequire(import.meta.url);
const {
  validateConfig,
} = require("../../vscode-extension/test/extension-host/verify01-run.cjs");
test("public journey configuration satisfies the real host driver contract", () => {
  const root = path.join(os.tmpdir(), "public-vscode-contract");
  for (const platform of ["linux", "win32", "darwin"]) {
    const config = {
      sampleId: `first-run-${platform}-vscode`,
      prompt: ARTIFACT_PROMPT,
      hostVersion: HOST_VERSION,
      extensionVersion: PUBLIC_VSCODE_VERSION,
      provider: "volcengine",
      model: "deepseek-v4-flash-ga-260731",
      permissionMode: "acceptEdits",
      deadline: Date.now() + 60000,
      ...Object.fromEntries(
        [
          "workspace",
          "captureDir",
          "profileHome",
          "userDataDir",
          "extensionsDir",
        ].map((name) => [name, path.join(root, name)]),
      ),
    };
    assert.equal(validateConfig(config), config);
    assert.ok(config.prompt.length <= 512);
  }
});
