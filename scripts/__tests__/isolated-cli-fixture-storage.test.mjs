import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("isolated CLI test consumers load with the exact shared storage package", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fixture-storage-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const cli = path.join(scratch, "packages/cli");
  fs.mkdirSync(cli, { recursive: true });
  for (const relative of [
    "package.json",
    "src",
    "__tests__/fixtures/agent-evolution-test-deployment.js",
  ]) {
    fs.cpSync(
      path.join(repo, "packages/cli", relative),
      path.join(cli, relative),
      {
        recursive: true,
      },
    );
  }
  // The bridge's broker also imports semver. Use the real dependency from the
  // installed candidate in CI (or the local CLI for repository tests), so the
  // negative probes specifically diagnose the missing storage package.
  const dependencyRequire = createRequire(
    path.join(
      process.env.CC_FIXTURE_DEPENDENCY_ROOT || path.join(repo, "packages/cli"),
      "package.json",
    ),
  );
  fs.cpSync(
    path.dirname(dependencyRequire.resolve("semver/package.json")),
    path.join(cli, "node_modules/semver"),
    { recursive: true },
  );
  const consumers = [
    [
      "__tests__/fixtures/agent-evolution-test-deployment.js",
      "createTestAgentEvolutionComposition",
    ],
    ["src/lib/secure-fs.js", "ensurePrivateDirectory"],
    ["src/lib/host-adb-bridge.js", "createHostAdbBridge"],
  ];
  function probe(relative, exportedName) {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const module = await import(${JSON.stringify(pathToFileURL(path.join(cli, relative)).href)}); if (typeof module[${JSON.stringify(exportedName)}] !== 'function') throw new Error('Missing consumer export');`,
      ],
      {
        cwd: scratch,
        encoding: "utf8",
        env: {
          ...process.env,
          CHAINLESSCHAIN_HOME: path.join(scratch, "home"),
        },
        timeout: 30_000,
      },
    );
  }
  for (const consumer of consumers) {
    const absent = probe(...consumer);
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /ERR_MODULE_NOT_FOUND.*|Cannot find package/);
    assert.match(absent.stderr, /@chainlesschain\/session-core/, consumer[0]);
  }

  const storage = path.join(cli, "node_modules/@chainlesschain/session-core");
  fs.mkdirSync(storage, { recursive: true });
  for (const relative of ["package.json", "lib"]) {
    fs.cpSync(
      path.join(repo, "packages/session-core", relative),
      path.join(storage, relative),
      {
        recursive: true,
      },
    );
  }
  for (const consumer of consumers) {
    const present = probe(...consumer);
    assert.equal(present.status, 0, `${consumer[0]}: ${present.stderr}`);
  }

  // An incomplete staging operation must still fail rather than resolving a
  // hoisted workspace package or silently replacing the private-storage guard.
  fs.unlinkSync(path.join(storage, "lib/private-storage.js"));
  for (const consumer of consumers) {
    const incomplete = probe(...consumer);
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /private-storage/);
  }
});
