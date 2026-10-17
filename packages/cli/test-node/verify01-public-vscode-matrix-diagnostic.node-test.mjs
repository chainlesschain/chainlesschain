import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  ARTIFACT_PROMPT,
  HOST_VERSION,
  PUBLIC_VSCODE_VERSION,
  publicCliAdapterSource,
} from "../scripts/verify01-public-vscode-matrix-diagnostic.mjs";
const require = createRequire(import.meta.url);
const {
  validateConfig,
} = require("../../vscode-extension/test/extension-host/verify01-run.cjs");

test("adapter delegates protocol arguments and suppresses injected IDE tools only for agent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vscode-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, "cli.cjs"),
    adapter = path.join(root, "adapter.cjs");
  fs.writeFileSync(cli, "console.log(JSON.stringify(process.argv.slice(2)))");
  fs.writeFileSync(adapter, publicCliAdapterSource(process.execPath, cli));
  const invoke = (args) =>
    JSON.parse(
      execFileSync(process.execPath, [adapter, ...args], { encoding: "utf8" }),
    );
  assert.deepEqual(invoke(["--version"]), ["--version"]);
  const original = [
    "agent",
    "--input-format",
    "stream-json",
    "--session-id",
    "real-panel-session",
  ];
  const agent = invoke(original);
  assert.deepEqual(agent.slice(0, original.length), original);
  assert.ok(agent.includes("--no-ide"));
  assert.equal(
    agent[agent.indexOf("--allowed-tools") + 1],
    "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed",
  );
});
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
