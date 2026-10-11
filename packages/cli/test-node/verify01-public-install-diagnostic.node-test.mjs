import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  cleanEnvironment,
  packageIdentity,
  backendEvidence,
  assessProbes,
  runDiagnostic,
} from "../scripts/verify01-public-install-diagnostic.mjs";

const script = fileURLToPath(
  new URL("../scripts/verify01-public-install-diagnostic.mjs", import.meta.url),
);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const json = (file, value) => write(file, JSON.stringify(value));
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-public-install-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = { packages: {} };
  function pkg(relative, name, version, source = "module.exports = {};") {
    const directory = path.join(root, relative);
    json(path.join(directory, "package.json"), {
      name,
      version,
      main: "index.cjs",
    });
    write(path.join(directory, "index.cjs"), source);
    lock.packages[relative] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/package-${version}.tgz`,
      integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
    };
    json(path.join(root, "package-lock.json"), lock);
    return path.join(directory, "index.cjs");
  }
  const consumer = pkg(
    "node_modules/chainlesschain",
    "chainlesschain",
    "0.166.97",
  );
  return { root, consumer, pkg, lock };
}

test("child environment carries no account credentials, npm overrides or injected runtime hooks", () => {
  const env = cleanEnvironment(path.resolve("diagnostic-private"));
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "CHAINLESSCHAIN_HOME",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "npm_config_userconfig",
      "npm_config_globalconfig",
      "npm_config_cache",
      "npm_config_registry",
      "npm_config_update_notifier",
      "CC_UPDATE_NOTICE",
      "CI",
      "LANG",
      "NO_COLOR",
    ].sort(),
  );
  assert.notEqual(env.HOME, env.CHAINLESSCHAIN_HOME);
  assert.equal(env.npm_config_registry, "https://registry.npmjs.org");
});

test("package provenance resolves from the actual core-db consumer, including nested driver versions", (t) => {
  const f = fixture(t);
  f.pkg("node_modules/better-sqlite3", "better-sqlite3", "12.11.1");
  const core = f.pkg(
    "node_modules/@chainlesschain/core-db",
    "@chainlesschain/core-db",
    "0.1.5",
  );
  f.pkg(
    "node_modules/@chainlesschain/core-db/node_modules/better-sqlite3",
    "better-sqlite3",
    "11.10.0",
  );
  assert.equal(
    packageIdentity(f.root, f.consumer, "better-sqlite3").version,
    "12.11.1",
  );
  assert.equal(
    packageIdentity(f.root, core, "better-sqlite3").version,
    "11.10.0",
  );
  f.lock.packages[
    "node_modules/@chainlesschain/core-db/node_modules/better-sqlite3"
  ].version = "12.11.1";
  json(path.join(f.root, "package-lock.json"), f.lock);
  assert.throws(
    () => packageIdentity(f.root, core, "better-sqlite3"),
    /lock version differs/,
  );
});

test("requiring a native JS wrapper does not count as loading or executing SQLite", (t) => {
  const f = fixture(t);
  f.pkg("node_modules/better-sqlite3", "better-sqlite3", "12.11.1");
  const require = createRequire(f.consumer);
  require("better-sqlite3");
  assert.throws(
    () => backendEvidence(f.root, f.consumer, "native", require.cache),
    /no actually loaded addon/,
  );
  assert.throws(
    () => backendEvidence(f.root, f.consumer, "unknown", require.cache),
    /unknown SQLite backend/,
  );
});

test("WASM identity is explicit and never reported as native verification", (t) => {
  const f = fixture(t);
  f.pkg("node_modules/sql.js", "sql.js", "1.14.1");
  const evidence = backendEvidence(f.root, f.consumer, "wasm", {});
  assert.equal(evidence.native, false);
  assert.equal(evidence.package.name, "sql.js");
  assert.deepEqual(evidence.loadedAddons, []);
});

test("assessment requires different processes, both stores, matching backends and actual row checks", () => {
  const stores = ["cli-bootstrap-core-db", "cli-sync-vault"].map((name) => ({
    name,
    rowVerified: true,
    backend: "wasm",
    native: false,
    package: { name: "sql.js", version: "1.14.1" },
    loadedAddons: [],
  }));
  const writeReport = { phase: "write", pid: 1, stores };
  const reopened = { phase: "reopen", pid: 2, stores: structuredClone(stores) };
  assert.deepEqual(assessProbes(writeReport, reopened), {
    databaseRoundtripPassed: true,
    nativeSqliteVerified: false,
    wasmFallbackObserved: true,
  });
  assert.throws(
    () => assessProbes(writeReport, { ...reopened, pid: 1 }),
    /fresh process/,
  );
  assert.throws(() => assessProbes(writeReport, { ...reopened, stores: [] }));
  reopened.stores[0].rowVerified = false;
  assert.throws(() => assessProbes(writeReport, reopened));
  reopened.stores[0].rowVerified = true;
  reopened.stores[0].backend = "native";
  assert.throws(
    () => assessProbes(writeReport, reopened),
    /backend identity changed/,
  );
});

test("process probes exercise persisted writes and reject lost rows (fixture, not real SQLite evidence)", (t) => {
  const f = fixture(t);
  f.pkg(
    "node_modules/@chainlesschain/core-db",
    "@chainlesschain/core-db",
    "0.1.5",
  );
  f.pkg("node_modules/sql.js", "sql.js", "1.14.1");
  const cli = path.dirname(f.consumer);
  json(path.join(cli, "package.json"), {
    name: "chainlesschain",
    version: "0.166.97",
    type: "module",
  });
  // Deliberately simple file-backed fake: validates diagnostic control flow,
  // while actual SQLite execution belongs to the public Actions job.
  write(
    path.join(cli, "src/runtime/store.js"),
    `
    import fs from 'node:fs';
    export function store(file) {
      return { run(sql, params=[]) {
        if (sql.startsWith('INSERT')) fs.writeFileSync(file, JSON.stringify({marker:params[0],reopened:0}));
        if (sql.startsWith('UPDATE')) { const row=JSON.parse(fs.readFileSync(file)); row.reopened=1; fs.writeFileSync(file,JSON.stringify(row)); }
      }, get(sql) { const row=JSON.parse(fs.readFileSync(file)); return sql.startsWith('SELECT reopened')?{reopened:row.reopened}:row; }, close() {} };
    }
  `,
  );
  write(
    path.join(cli, "src/runtime/bootstrap.js"),
    `
    import {store} from './store.js';
    export async function bootstrap({dbPath}) {const db=store(dbPath);return {db:{driver:{type:'wasm'},prepare(sql){return {run(...params){return db.run(sql,params)},get(){return db.get(sql)}}}}};}
    export async function shutdown() {}
  `,
  );
  write(
    path.join(cli, "src/lib/sync-cli-db.js"),
    `
    import path from 'node:path'; import {store} from '../runtime/store.js';
    export async function openCliVault(){const vaultPath=path.join(process.env.CHAINLESSCHAIN_HOME,'vault.db'); return {vaultPath,backend:'sql.js',dbManager:store(vaultPath)}}
  `,
  );
  const profile = path.join(f.root, "profile");
  fs.mkdirSync(profile);
  const database = path.join(f.root, "database");
  const run = (phase, output) =>
    execFileSync(
      process.execPath,
      [
        script,
        "--probe",
        phase,
        "--install-root",
        f.root,
        "--database",
        database,
        "--marker",
        "12345678-1234-1234-1234-123456789abc",
        "--probe-output",
        output,
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          CHAINLESSCHAIN_HOME: profile,
          NODE_OPTIONS: "",
          NODE_PATH: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const first = path.join(f.root, "write.json"),
    second = path.join(f.root, "reopen.json");
  run("write", first);
  run("reopen", second);
  assert.equal(
    assessProbes(
      JSON.parse(fs.readFileSync(first)),
      JSON.parse(fs.readFileSync(second)),
    ).wasmFallbackObserved,
    true,
  );
  fs.unlinkSync(database);
  assert.throws(() => run("reopen", path.join(f.root, "lost.json")));
  assert.equal(fs.existsSync(path.join(f.root, "lost.json")), false);
});

test("existing output evidence is never overwritten", async (t) => {
  const f = fixture(t);
  const sentinel = path.join(f.root, "summary.json");
  fs.writeFileSync(sentinel, "original evidence");
  await assert.rejects(
    runDiagnostic({
      outputDir: f.root,
      version: "0.166.97",
      releaseSha: "a".repeat(40),
    }),
    /EEXIST/,
  );
  assert.equal(fs.readFileSync(sentinel, "utf8"), "original evidence");
});
