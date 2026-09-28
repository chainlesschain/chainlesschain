import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const detector = path.join(
  repositoryRoot,
  "scripts",
  "ci",
  "detect-publishable-packages.mjs",
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-workspace-publish-"));
  const scriptDir = path.join(root, "scripts", "ci");
  mkdirSync(scriptDir, { recursive: true });
  copyFileSync(
    detector,
    path.join(scriptDir, "detect-publishable-packages.mjs"),
  );
  const packages = [
    ["agent-protocol", "@chainlesschain/agent-protocol"],
    ["core-db", "@chainlesschain/core-db"],
    ["agent-sdk", "@chainlesschain/agent-sdk"],
    ["context-memory-kernel", "@chainlesschain/context-memory-kernel"],
    ["cli", "chainlesschain"],
    ["vscode-extension", "chainlesschain-ide"],
  ];
  for (const [dir, name] of packages) {
    const packageDir = path.join(root, "packages", dir);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name, version: "9.9.9", private: false }),
    );
  }
  return root;
}

function run(root, overrides = {}) {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts", "ci", "detect-publishable-packages.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_VERSION: "",
        INPUT_FORCE: "false",
        GITHUB_REF: "",
        GITHUB_OUTPUT: "",
        ...overrides,
      },
    },
  );
}

test("generic package tag cannot select CLI, SDK, kernel or IDE", () => {
  const root = fixture();
  try {
    const result = run(root, { GITHUB_REF: "refs/tags/v-packages-test" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFileSync(path.join(root, ".publish-order.txt"), "utf8")
        .trim()
        .split("\n"),
      ["agent-protocol", "core-db"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manual generic publication rejects the IDE extension", () => {
  const root = fixture();
  try {
    const result = run(root, {
      INPUT_VERSION: "chainlesschain-ide@9.9.9",
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /protected.*dedicated CLI or IDE release workflow/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
