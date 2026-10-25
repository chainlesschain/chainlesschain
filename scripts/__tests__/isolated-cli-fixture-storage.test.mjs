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

test("installed composition uses its own native filesystem with source-only test authorities", (t) => {
  const temporary = fs.realpathSync.native(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(temporary, "cc-fixture-native-"));
  t.after(() => {
    if (
      path.dirname(scratch) !== temporary ||
      !path.basename(scratch).startsWith("cc-fixture-native-")
    )
      throw new Error("unsafe native fixture cleanup");
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const source = path.join(scratch, "source/packages/cli");
  const installed = path.join(scratch, "global/node_modules/chainlesschain");
  const dependencyRequire = createRequire(
    path.join(
      process.env.CC_FIXTURE_DEPENDENCY_ROOT || path.join(repo, "packages/cli"),
      "package.json",
    ),
  );
  for (const directory of [source, installed]) {
    for (const relative of ["package.json", "src"])
      fs.cpSync(
        path.join(repo, "packages/cli", relative),
        path.join(directory, relative),
        {
          recursive: true,
        },
      );
    const storage = path.join(
      directory,
      "node_modules/@chainlesschain/session-core",
    );
    for (const relative of ["package.json", "lib"])
      fs.cpSync(
        path.join(repo, "packages/session-core", relative),
        path.join(storage, relative),
        {
          recursive: true,
        },
      );
    fs.cpSync(
      path.dirname(dependencyRequire.resolve("semver/package.json")),
      path.join(directory, "node_modules/semver"),
      { recursive: true },
    );
  }
  const fixtureRelative =
    "__tests__/fixtures/agent-evolution-test-deployment.js";
  fs.cpSync(
    path.join(repo, "packages/cli", fixtureRelative),
    path.join(source, fixtureRelative),
  );
  // Only the installed runtime gets the genuine native package. The checkout
  // fixture cannot borrow it through cwd, NODE_PATH, or a workspace junction.
  fs.cpSync(
    path.dirname(dependencyRequire.resolve("koffi/package.json")),
    path.join(installed, "node_modules/koffi"),
    { recursive: true },
  );
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const fixture = await import(${JSON.stringify(pathToFileURL(path.join(source, fixtureRelative)).href)});
      const { createAgentEvolutionRuntimeComposition } = await import(${JSON.stringify(pathToFileURL(path.join(installed, "src/lib/evolution/agent-evolution-runtime-composition.js")).href)});
      const native = await import(${JSON.stringify(pathToFileURL(path.join(installed, "src/lib/evolution/evolution-windows-directory-durability.js")).href)});
      const sourceRequire = createRequire(${JSON.stringify(path.join(source, "package.json"))});
      assert.throws(() => sourceRequire.resolve('koffi'), { code: 'MODULE_NOT_FOUND' });
      if (process.platform === 'win32') {
        assert.throws(() => fixture.createTestAgentEvolutionComposition(
          createAgentEvolutionRuntimeComposition,
          { runId: 'source-native-negative' },
          ${JSON.stringify(path.join(scratch, "negative-state"))}
        ), error => error.code === 'MODULE_NOT_FOUND' && error.message.includes('koffi'));
      }
      const fsImpl = native.createLocalUiEvolutionFileSystem();
      if (process.platform === 'win32') assert.equal(native.isLocalUiEvolutionFileSystem(fsImpl), true);
      const composition = fixture.createTestAgentEvolutionComposition(
        createAgentEvolutionRuntimeComposition,
        { runId: 'installed-native-positive', fsImpl },
        ${JSON.stringify(path.join(scratch, "positive-state"))}
      );
      await composition.evolutionIngress.start();
      const run = composition.loadRun();
      assert.equal(run.events.length, 1);
      assert.equal(run.projection.status, 'running');
      console.log(JSON.stringify({ nativeFilesystem: true, events: run.events.length }));
    `,
    ],
    {
      cwd: installed,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_PATH: "",
        CHAINLESSCHAIN_HOME: path.join(scratch, "home"),
        CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(scratch, "anchors"),
      },
      timeout: 30_000,
    },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout.trim()), {
    nativeFilesystem: true,
    events: 1,
  });
});
