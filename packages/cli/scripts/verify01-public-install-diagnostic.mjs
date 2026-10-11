#!/usr/bin/env node
/** Account-free public Linux installation diagnostic; never a formal sample. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import {
  launchLogged,
  requireSuccess,
} from "../../../scripts/lib/verify01-diagnostic-process.mjs";
import { verifyCliRegistryInstall } from "./verify-cli-registry-install.mjs";

const SELF = fileURLToPath(import.meta.url);
const REPOSITORY = path.resolve(path.dirname(SELF), "../../..");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const save = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
export const SOURCE_FILES = [
  "bin/chainlesschain.js",
  "scripts/postinstall.mjs",
  "src/commands/db.js",
  "src/runtime/bootstrap.js",
  "src/lib/sync-cli-db.js",
  "src/commands/eval.js",
  "src/lib/eval/runner.js",
  "src/lib/eval/verify01-execution.js",
];

function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

export function cleanEnvironment(scratch) {
  // Deliberately do not inherit provider keys, npm credentials/config, hooks,
  // NODE_PATH or NODE_OPTIONS. Lifecycle scripts run without account access.
  return {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/local/bin:/usr/bin:/bin`,
    HOME: path.join(scratch, "home"),
    TMPDIR: path.join(scratch, "tmp"),
    CHAINLESSCHAIN_HOME: path.join(scratch, "profile"),
    XDG_CONFIG_HOME: path.join(scratch, "xdg-config"),
    XDG_CACHE_HOME: path.join(scratch, "xdg-cache"),
    npm_config_userconfig: path.join(scratch, "npmrc"),
    npm_config_globalconfig: path.join(scratch, "global-npmrc"),
    npm_config_cache: path.join(scratch, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org",
    npm_config_update_notifier: "false",
    CC_UPDATE_NOTICE: "0",
    CI: "true",
    LANG: "C.UTF-8",
    NO_COLOR: "1",
  };
}

/** Resolve from the consumer, including nested dependencies, never repo cwd. */
export function packageIdentity(installRoot, consumer, name) {
  const root = fs.realpathSync.native(installRoot);
  const require = createRequire(consumer);
  const entry = require.resolve(name);
  assert.equal(fs.realpathSync.native(entry), entry, "linked dependency entry");
  let directory = path.dirname(entry);
  while (inside(root, directory) && directory !== root) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file) && read(file).name === name) {
      assert.equal(
        fs.realpathSync.native(directory),
        directory,
        "linked dependency",
      );
      const manifest = read(file);
      const relative = path.relative(root, directory).split(path.sep).join("/");
      const locked = read(path.join(root, "package-lock.json")).packages?.[
        relative
      ];
      assert.equal(
        locked?.version,
        manifest.version,
        "dependency lock version differs",
      );
      assert.ok(!locked.link, "linked dependency lock");
      assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u);
      const url = new URL(locked.resolved);
      assert.equal(url.origin, "https://registry.npmjs.org");
      assert.ok(!url.username && !url.password && !url.search && !url.hash);
      return {
        name,
        version: manifest.version,
        directory: relative,
        resolved: locked.resolved,
        integrity: locked.integrity,
        entryDigest: digest(fs.readFileSync(entry)),
      };
    }
    directory = path.dirname(directory);
  }
  throw new Error(`dependency outside public installation: ${name}`);
}

export function backendEvidence(installRoot, consumer, backend, cache) {
  const names = {
    "native-cipher": "better-sqlite3-multiple-ciphers",
    native: "better-sqlite3",
    "better-sqlite3": "better-sqlite3",
    wasm: "sql.js",
    "sql.js": "sql.js",
  };
  assert.ok(
    Object.hasOwn(names, backend),
    `unknown SQLite backend: ${backend}`,
  );
  const identity = packageIdentity(installRoot, consumer, names[backend]);
  const native = backend !== "wasm" && backend !== "sql.js";
  const directory = path.join(installRoot, identity.directory);
  const loadedAddons = Object.keys(cache)
    .filter((file) => file.endsWith(".node") && inside(directory, file))
    .map((file) => {
      assert.equal(fs.realpathSync.native(file), file, "linked native addon");
      return {
        path: path.relative(installRoot, file).split(path.sep).join("/"),
        digest: digest(fs.readFileSync(file)),
        bytes: fs.statSync(file).size,
      };
    });
  assert.ok(
    !native || loadedAddons.length > 0,
    "native backend has no actually loaded addon; require(wrapper) is insufficient",
  );
  return { backend, native, package: identity, loadedAddons };
}

/** Each phase runs in a fresh process against the installed product modules. */
export async function probeDatabases({ installRoot, database, phase, marker }) {
  assert.ok(["write", "reopen"].includes(phase));
  assert.match(marker, /^[a-f0-9-]{36}$/u);
  const cliRoot = path.join(installRoot, "node_modules/chainlesschain");
  const bootstrapFile = path.join(cliRoot, "src/runtime/bootstrap.js");
  const vaultFile = path.join(cliRoot, "src/lib/sync-cli-db.js");
  const require = createRequire(bootstrapFile);
  const coreFile = require.resolve("@chainlesschain/core-db");
  const { bootstrap, shutdown } = await import(
    pathToFileURL(bootstrapFile).href
  );
  const { openCliVault } = await import(pathToFileURL(vaultFile).href);
  const ctx = await bootstrap({ dbPath: database });
  assert.ok(
    ctx.db,
    "installed CLI bootstrap did not initialize its core-db database",
  );
  let vault;
  try {
    vault = await openCliVault();
    assert.ok(
      inside(process.env.CHAINLESSCHAIN_HOME, vault.vaultPath),
      "CLI vault escaped the isolated profile",
    );
    const stores = [
      {
        name: "cli-bootstrap-core-db",
        run: (sql, params = []) => ctx.db.prepare(sql).run(...params),
        get: (sql) => ctx.db.prepare(sql).get(),
        file: database,
        consumer: coreFile,
        backend: ctx.db.driver?.type,
      },
      {
        name: "cli-sync-vault",
        run: (sql, params = []) => vault.dbManager.run(sql, params),
        get: (sql) => vault.dbManager.get(sql),
        file: vault.vaultPath,
        consumer: vaultFile,
        backend: vault.backend,
      },
    ];
    const rows = [];
    for (const store of stores) {
      if (phase === "write") {
        store.run(
          "CREATE TABLE verify01_public_install (id INTEGER PRIMARY KEY, marker TEXT NOT NULL, reopened INTEGER NOT NULL)",
        );
        store.run("INSERT INTO verify01_public_install VALUES (1, ?, 0)", [
          marker,
        ]);
      }
      assert.deepEqual(
        store.get(
          "SELECT marker, reopened FROM verify01_public_install WHERE id = 1",
        ),
        { marker, reopened: 0 },
        "persisted row missing or changed",
      );
      if (phase === "reopen") {
        store.run(
          "UPDATE verify01_public_install SET reopened = 1 WHERE id = 1",
        );
        assert.equal(
          store.get("SELECT reopened FROM verify01_public_install WHERE id = 1")
            .reopened,
          1,
        );
      }
      rows.push({
        name: store.name,
        phase,
        rowVerified: true,
        database: store.file,
        ...backendEvidence(
          installRoot,
          store.consumer,
          store.backend,
          require.cache,
        ),
      });
    }
    return {
      phase,
      pid: process.pid,
      node: process.version,
      abi: process.versions.modules,
      coreDb: packageIdentity(
        installRoot,
        bootstrapFile,
        "@chainlesschain/core-db",
      ),
      stores: rows,
    };
  } finally {
    vault?.dbManager.close();
    await shutdown();
  }
}

export function assessProbes(write, reopen) {
  assert.equal(write.phase, "write");
  assert.equal(reopen.phase, "reopen");
  assert.notEqual(write.pid, reopen.pid, "reopen must use a fresh process");
  for (const report of [write, reopen]) {
    assert.deepEqual(
      report.stores.map((row) => row.name),
      ["cli-bootstrap-core-db", "cli-sync-vault"],
    );
    assert.ok(report.stores.every((row) => row.rowVerified === true));
  }
  assert.deepEqual(
    write.stores.map((row) => [row.backend, row.package, row.loadedAddons]),
    reopen.stores.map((row) => [row.backend, row.package, row.loadedAddons]),
    "backend identity changed across reopening",
  );
  return {
    databaseRoundtripPassed: true,
    nativeSqliteVerified: reopen.stores.every((row) => row.native === true),
    wasmFallbackObserved: reopen.stores.some((row) => row.native === false),
  };
}

export async function runDiagnostic({ outputDir, version, releaseSha }) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  assert.match(releaseSha, /^[a-f0-9]{40}$/u);
  fs.mkdirSync(outputDir, { mode: 0o700 }); // Existing evidence must not be overwritten.
  const summary = {
    schema: "chainlesschain.verify01-public-install-diagnostic/v1",
    formalSample: false,
    independentHumanReview: false,
    productionAttested: false,
    billingVerified: false,
    signedProvenanceVerified: false,
    modelCalls: 0,
    lifecycleScriptsEnabled: true,
    version,
    releaseCommit: releaseSha,
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    databaseRoundtripPassed: false,
    nativeSqliteVerified: false,
    status: "failed",
    commands: [],
  };
  let scratch;
  try {
    const git = (args) =>
      execFileSync("git", ["-C", REPOSITORY, ...args], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 16 * 1024 * 1024,
      });
    summary.harnessCommit = git(["rev-parse", "HEAD"]).trim();
    summary.harnessTrackedWorktreeClean =
      git(["status", "--porcelain", "--untracked-files=no"]).trim() === "";
    assert.ok(
      summary.harnessTrackedWorktreeClean,
      "tracked harness worktree is dirty; cannot bind execution to HEAD",
    );
    assert.equal(
      process.platform,
      "linux",
      "Linux public-install diagnostic only",
    );
    assert.equal(process.arch, "x64");
    assert.equal(process.version, "v22.12.0");
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    assert.match(osRelease, /^ID=ubuntu$/mu);
    assert.match(osRelease, /^VERSION_ID="24\.04"$/mu);
    fs.writeFileSync(path.join(outputDir, "os-release.txt"), osRelease, {
      flag: "wx",
    });
    assert.equal(
      git([
        "rev-parse",
        `refs/tags/v-npm-${version.replaceAll(".", "-")}^{commit}`,
      ]).trim(),
      releaseSha,
    );
    scratch = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-verify01-public-install-",
      ),
    );
    const env = cleanEnvironment(scratch);
    for (const directory of [
      "home",
      "tmp",
      "profile",
      "xdg-config",
      "xdg-cache",
      "install",
    ])
      fs.mkdirSync(path.join(scratch, directory), { mode: 0o700 });
    for (const name of ["npmrc", "global-npmrc"])
      fs.writeFileSync(path.join(scratch, name), "", {
        flag: "wx",
        mode: 0o600,
      });
    summary.cleanEnvironmentBeforeInstall = {
      homeEmpty: fs.readdirSync(env.HOME).length === 0,
      profileEmpty: fs.readdirSync(env.CHAINLESSCHAIN_HOME).length === 0,
      npmCacheAbsent: !fs.existsSync(env.npm_config_cache),
      inheritedAccountVariables: false,
    };
    const install = path.join(scratch, "install");
    save(path.join(install, "package.json"), { private: true, type: "module" });
    const npmCli = path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    );
    assert.ok(fs.existsSync(npmCli), "Node distribution's npm CLI is missing");
    const deadline = Date.now() + 15 * 60 * 1000;
    const run = async (name, args, timeoutMs = 60000) => {
      const row = {
        name,
        command: process.execPath,
        args,
        startedAt: new Date().toISOString(),
        passed: false,
      };
      summary.commands.push(row);
      try {
        const result = await requireSuccess(
          launchLogged(process.execPath, args, {
            cwd: install,
            env,
            logFile: path.join(outputDir, `${name}.log`),
          }),
          Math.min(deadline, Date.now() + timeoutMs),
          name,
        );
        Object.assign(row, result, { passed: true });
      } catch (error) {
        row.error = error.message;
        throw error;
      } finally {
        row.finishedAt = new Date().toISOString();
      }
    };
    await run("registry-metadata", [
      npmCli,
      "view",
      `chainlesschain@${version}`,
      "--json",
    ]);
    const metadata = read(path.join(outputDir, "registry-metadata.log"));
    assert.equal(metadata.name, "chainlesschain");
    assert.equal(metadata.version, version);
    await run(
      "npm-install",
      [
        npmCli,
        "install",
        `chainlesschain@${version}`,
        "--ignore-scripts=false",
        "--foreground-scripts",
        "--include=optional",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      10 * 60 * 1000,
    );
    fs.copyFileSync(
      path.join(install, "package-lock.json"),
      path.join(outputDir, "public-package-lock.json"),
      fs.constants.COPYFILE_EXCL,
    );
    summary.installation = verifyCliRegistryInstall(install, metadata);
    const cliRoot = path.join(install, "node_modules/chainlesschain");
    summary.sourceBindings = SOURCE_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(cliRoot, file));
      const committed = Buffer.from(
        git(["show", `${releaseSha}:packages/cli/${file}`]),
      );
      assert.ok(
        bytes.equals(committed),
        `installed public source differs: ${file}`,
      );
      return { file, digest: digest(bytes), bytes: bytes.length };
    });
    summary.cleanProfileBeforeCli =
      fs.readdirSync(env.CHAINLESSCHAIN_HOME).length === 0;
    // npm postinstall may legitimately initialize its own profile. Record this,
    // never turn it into a declaration of a five-stage first-install sample.
    const database = path.join(scratch, "cli-database.sqlite");
    await run("cli-db-init", [
      path.join(cliRoot, "bin/chainlesschain.js"),
      "db",
      "init",
      "--path",
      database,
    ]);
    assert.ok(
      fs.statSync(database).size > 0,
      "CLI init did not create a database",
    );
    const marker = randomUUID();
    for (const phase of ["write", "reopen"]) {
      await run(`database-${phase}`, [
        SELF,
        "--probe",
        phase,
        "--install-root",
        install,
        "--database",
        database,
        "--marker",
        marker,
        "--probe-output",
        path.join(outputDir, `database-${phase}.json`),
      ]);
    }
    Object.assign(
      summary,
      assessProbes(
        read(path.join(outputDir, "database-write.json")),
        read(path.join(outputDir, "database-reopen.json")),
      ),
    );
    summary.status = summary.nativeSqliteVerified
      ? "native-roundtrip-passed"
      : "wasm-fallback-roundtrip-passed";
  } catch (error) {
    summary.error = error.message;
  } finally {
    summary.finishedAt = new Date().toISOString();
    save(path.join(outputDir, "summary.json"), summary);
    // Only this mkdtemp-owned root is removed; all diagnostic receipts survive.
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
  return summary;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "output-dir": { type: "string" },
      version: { type: "string" },
      "release-sha": { type: "string" },
      probe: { type: "string" },
      "install-root": { type: "string" },
      database: { type: "string" },
      marker: { type: "string" },
      "probe-output": { type: "string" },
    },
  });
  if (values.probe) {
    save(
      values["probe-output"],
      await probeDatabases({
        installRoot: values["install-root"],
        database: values.database,
        phase: values.probe,
        marker: values.marker,
      }),
    );
    return;
  }
  assert.ok(
    values["output-dir"] && values.version && values["release-sha"],
    "usage: --output-dir NEW_DIR --version PUBLIC_VERSION --release-sha TAG_COMMIT",
  );
  const summary = await runDiagnostic({
    outputDir: path.resolve(values["output-dir"]),
    version: values.version,
    releaseSha: values["release-sha"],
  });
  console.log(
    JSON.stringify({
      status: summary.status,
      modelCalls: 0,
      formalSample: false,
    }),
  );
  process.exitCode = summary.nativeSqliteVerified
    ? 0
    : summary.databaseRoundtripPassed
      ? 2
      : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
