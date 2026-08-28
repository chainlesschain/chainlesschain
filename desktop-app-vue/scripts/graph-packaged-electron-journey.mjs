#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(DESKTOP_ROOT, "..");
const FIXTURE_ROOT = path.join(
  DESKTOP_ROOT,
  "src",
  "main",
  "ai-engine",
  "code-agent",
  "__tests__",
  "fixtures",
  "packaged-electron-graph",
);
const JOURNEY_SCHEMA = "chainlesschain.desktop-packaged-graph-journey/v1";
const EVIDENCE_PLATFORM =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const KEEP = process.argv.includes("--keep");
const ASAR_MODULE_INDEX = process.argv.indexOf("--asar-module");
const ASAR_MODULE =
  ASAR_MODULE_INDEX >= 0 ? process.argv[ASAR_MODULE_INDEX + 1] : null;
const OUTPUT_INDEX = process.argv.indexOf("--output");
const EVIDENCE_OUTPUT =
  OUTPUT_INDEX >= 0 ? process.argv[OUTPUT_INDEX + 1] : null;

if (ASAR_MODULE_INDEX >= 0 && !ASAR_MODULE) {
  throw new Error("--asar-module requires an absolute module path");
}
if (OUTPUT_INDEX >= 0 && !EVIDENCE_OUTPUT) {
  throw new Error("--output requires a file path");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function copyPackage(packageName, destinationRoot) {
  const resolvedEntry = require.resolve(packageName, {
    paths: [DESKTOP_ROOT, REPOSITORY_ROOT],
  });
  let source = path.dirname(resolvedEntry);
  for (;;) {
    const packageJson = path.join(source, "package.json");
    if (fs.existsSync(packageJson)) {
      const metadata = JSON.parse(fs.readFileSync(packageJson, "utf8"));
      if (metadata.name === packageName) break;
    }
    const parent = path.dirname(source);
    if (parent === source) {
      throw new Error(`could not locate package root for ${packageName}`);
    }
    source = parent;
  }
  const destination = path.join(
    destinationRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

async function buildFixture(appDirectory) {
  fs.mkdirSync(appDirectory, { recursive: true });
  for (const name of [
    "package.json",
    "main.cjs",
    "preload.cjs",
    "renderer.html",
  ]) {
    fs.copyFileSync(
      path.join(FIXTURE_ROOT, name),
      path.join(appDirectory, name),
    );
  }
  const production = path.join(appDirectory, "production");
  fs.mkdirSync(production, { recursive: true });
  fs.copyFileSync(
    path.join(
      DESKTOP_ROOT,
      "src",
      "main",
      "ai-engine",
      "code-agent",
      "desktop-graph-run-registry.js",
    ),
    path.join(production, "desktop-graph-run-registry.cjs"),
  );

  await esbuild.build({
    entryPoints: [path.join(DESKTOP_ROOT, "src", "main", "database.js")],
    outfile: path.join(production, "database.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["electron", "lru-cache", "sql.js", "uuid"],
    logLevel: "warning",
  });
  const sessionBundleDirectory = path.join(
    production,
    "ai-engine",
    "code-agent",
  );
  fs.mkdirSync(sessionBundleDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(
      DESKTOP_ROOT,
      "src",
      "main",
      "ai-engine",
      "code-agent",
      "session-state-manager.js",
    ),
    path.join(sessionBundleDirectory, "session-state-manager.cjs"),
  );
  fs.mkdirSync(path.join(production, "utils"), { recursive: true });
  fs.writeFileSync(
    path.join(production, "utils", "logger.js"),
    '"use strict"; module.exports = { logger: { info() {}, warn() {}, error() {}, debug() {} } };\n',
    "utf8",
  );
  const databaseDirectory = path.join(production, "database");
  fs.mkdirSync(databaseDirectory, { recursive: true });
  for (const name of ["database-schema.js", "database-migrations.js"]) {
    fs.copyFileSync(
      path.join(DESKTOP_ROOT, "src", "main", "database", name),
      path.join(databaseDirectory, name),
    );
  }
  fs.cpSync(
    path.join(DESKTOP_ROOT, "src", "main", "database", "migrations"),
    path.join(databaseDirectory, "migrations"),
    { recursive: true, dereference: true, force: true },
  );
  const graphOutput = path.join(
    production,
    "packages",
    "cli",
    "src",
    "lib",
    "app-server",
    "graph-runtime.mjs",
  );
  fs.mkdirSync(path.dirname(graphOutput), { recursive: true });
  await esbuild.build({
    entryPoints: [
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "cli",
        "src",
        "lib",
        "app-server",
        "graph-runtime.js",
      ),
    ],
    outfile: graphOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
  });
  await esbuild.build({
    entryPoints: [
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "cli",
        "src",
        "lib",
        "app-server",
        "rollout-store.js",
      ),
    ],
    outfile: path.join(path.dirname(graphOutput), "rollout-store.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
  });
  const schemaDirectory = path.resolve(
    path.dirname(graphOutput),
    "..",
    "..",
    "generated",
  );
  fs.mkdirSync(schemaDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(
      REPOSITORY_ROOT,
      "packages",
      "cli",
      "src",
      "generated",
      "cc-agent-protocol.schema.json",
    ),
    path.join(schemaDirectory, "cc-agent-protocol.schema.json"),
  );
  const cliPackage = JSON.parse(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages", "cli", "package.json"),
      "utf8",
    ),
  );
  fs.writeFileSync(
    path.join(path.dirname(path.dirname(graphOutput)), "package.json"),
    `${JSON.stringify({ version: cliPackage.version })}\n`,
    "utf8",
  );
  for (const packageName of ["lru-cache", "sql.js", "uuid"]) {
    copyPackage(packageName, appDirectory);
  }
}

function electronLayout(packageDirectory) {
  const electronExecutable = require("electron");
  const electronPackage = require.resolve("electron/package.json");
  const electronDist = path.join(path.dirname(electronPackage), "dist");
  const relativeExecutable = path.relative(electronDist, electronExecutable);
  return {
    source: electronDist,
    executable: path.join(packageDirectory, relativeExecutable),
    resources:
      process.platform === "darwin"
        ? path.join(packageDirectory, "Electron.app", "Contents", "Resources")
        : path.join(packageDirectory, "resources"),
  };
}

function brandPackagedExecutable(layout, packageDirectory) {
  if (process.platform === "win32") {
    const branded = path.join(packageDirectory, "ChainlessChainP13.exe");
    fs.renameSync(layout.executable, branded);
    return { ...layout, executable: branded };
  }
  if (process.platform === "linux") {
    const branded = path.join(packageDirectory, "chainlesschain-p13");
    fs.renameSync(layout.executable, branded);
    return { ...layout, executable: branded };
  }
  const brandedName = "ChainlessChainP13";
  const branded = path.join(
    packageDirectory,
    "Electron.app",
    "Contents",
    "MacOS",
    brandedName,
  );
  fs.renameSync(layout.executable, branded);
  const plist = path.join(
    packageDirectory,
    "Electron.app",
    "Contents",
    "Info.plist",
  );
  const updated = spawnSync(
    "plutil",
    ["-replace", "CFBundleExecutable", "-string", brandedName, plist],
    { encoding: "utf8" },
  );
  if (updated.status !== 0) {
    throw new Error(`branding packaged Electron failed: ${updated.stderr}`);
  }
  return { ...layout, executable: branded };
}

async function assemblePackage(root) {
  const appDirectory = path.join(root, "fixture-app");
  await buildFixture(appDirectory);
  let asar;
  try {
    asar = require(
      ASAR_MODULE || process.env.CC_ELECTRON_ASAR_MODULE || "@electron/asar",
    );
  } catch (cause) {
    const error = new Error(
      "@electron/asar is required; run npm ci in desktop-app-vue before this journey",
    );
    error.cause = cause;
    throw error;
  }
  const packageDirectory = path.join(root, "packaged-electron");
  let layout = electronLayout(packageDirectory);
  fs.cpSync(layout.source, packageDirectory, {
    recursive: true,
    dereference: process.platform !== "darwin",
    // Electron.app frameworks use relative Current/Resources symlinks.
    // cpSync otherwise resolves those links back into node_modules, leaving
    // unsealed files at the framework root that macOS refuses to sign.
    verbatimSymlinks: process.platform === "darwin",
    force: true,
  });
  fs.mkdirSync(layout.resources, { recursive: true });
  fs.rmSync(path.join(layout.resources, "default_app.asar"), { force: true });
  await asar.createPackage(
    appDirectory,
    path.join(layout.resources, "app.asar"),
  );
  layout = brandPackagedExecutable(layout, packageDirectory);

  if (process.platform === "darwin") {
    const signed = spawnSync(
      "codesign",
      [
        "--force",
        "--deep",
        "--sign",
        "-",
        path.join(packageDirectory, "Electron.app"),
      ],
      { encoding: "utf8" },
    );
    if (signed.status !== 0) {
      throw new Error(
        `ad-hoc signing packaged Electron failed: ${signed.stderr}`,
      );
    }
    const verified = spawnSync(
      "codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        path.join(packageDirectory, "Electron.app"),
      ],
      { encoding: "utf8" },
    );
    if (verified.status !== 0) {
      throw new Error(
        `verifying packaged Electron signature failed: ${verified.stderr}`,
      );
    }
  }
  return layout;
}

function launch(executable, mode, stateDirectory, outputPath) {
  const child = spawn(
    executable,
    process.platform === "linux" ? ["--no-sandbox"] : [],
    {
      cwd: path.dirname(executable),
      windowsHide: true,
      env: {
        ...process.env,
        CHAINLESSCHAIN_DISABLE_NATIVE_DB: "1",
        NODE_ENV: "production",
        CC_PACKAGED_GRAPH_MODE: mode,
        CC_PACKAGED_GRAPH_STATE_DIR: stateDirectory,
        CC_PACKAGED_GRAPH_OUTPUT: outputPath,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

async function waitForFile(target, processState, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      return JSON.parse(fs.readFileSync(target, "utf8"));
    }
    if (
      processState.child.exitCode != null ||
      processState.child.signalCode != null
    ) {
      throw new Error(
        `packaged Electron exited before ${path.basename(target)} ` +
          `(code=${processState.child.exitCode}, signal=${processState.child.signalCode})\n` +
          `${processState.stderr()}${processState.stdout()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `timed out waiting for ${target}\n${processState.stderr()}${processState.stdout()}`,
  );
}

async function waitForExit(processState, timeoutMs = 30_000) {
  const { child } = processState;
  if (child.exitCode != null || child.signalCode != null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `timed out waiting for packaged Electron exit\n${processState.stderr()}`,
        ),
      );
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function validateCommon(result, mode) {
  assertion(result.schema === JOURNEY_SCHEMA, `${mode}: schema mismatch`);
  assertion(result.mode === mode, `${mode}: mode mismatch`);
  assertion(
    result.runtime?.isPackaged === true,
    `${mode}: app is not packaged`,
  );
  assertion(
    result.runtime?.asar === true,
    `${mode}: app did not load from ASAR`,
  );
  assertion(Boolean(result.runtime?.electron), `${mode}: Electron ABI missing`);
  assertion(
    Number.isSafeInteger(result.window?.rendererProcessId) &&
      result.window.rendererProcessId > 0,
    `${mode}: renderer process receipt missing`,
  );
  assertion(
    String(result.window?.renderedStatus || "").startsWith(`${mode}:`),
    `${mode}: preload/renderer acknowledgement missing`,
  );
  assertion(DIGEST.test(result.eventHead), `${mode}: event head missing`);
  assertion(
    Object.keys(result.entries || {}).length === 3 &&
      Object.values(result.entries).every(
        (entry) =>
          DIGEST.test(entry.eventHead) &&
          entry.bindingEventHead === entry.eventHead,
      ),
    `${mode}: entry-scoped Graph projections are incomplete`,
  );
  assertion(
    Array.isArray(result.stores) && result.stores.length === 13,
    `${mode}: per-store evidence is incomplete`,
  );
  assertion(
    result.stores.every(
      (store) =>
        typeof store.surface === "string" &&
        typeof store.entryId === "string" &&
        typeof store.store === "string" &&
        DIGEST.test(store.stateDigest),
    ),
    `${mode}: per-store state digest is invalid`,
  );
  assertion(
    DIGEST.test(result.evidenceDigest),
    `${mode}: evidence digest missing`,
  );
  const unsigned = { ...result };
  delete unsigned.evidenceDigest;
  assertion(
    digest(unsigned) === result.evidenceDigest,
    `${mode}: evidence digest mismatch`,
  );
}

function exactCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-p1-3-packaged-electron-"),
  );
  const stateDirectory = path.join(root, "journey-state");
  const rollbackStateDirectory = path.join(root, "rollback-state");
  const writerPath = path.join(stateDirectory, "writer.json");
  const recoveryPath = path.join(stateDirectory, "recover.json");
  const rollbackPath = path.join(rollbackStateDirectory, "rollback.json");
  let writerProcess = null;
  let recoveryProcess = null;
  let rollbackProcess = null;
  try {
    const layout = await assemblePackage(root);
    writerProcess = launch(
      layout.executable,
      "writer",
      stateDirectory,
      writerPath,
    );
    const writer = await waitForFile(writerPath, writerProcess);
    validateCommon(writer, "writer");
    assertion(
      writer.status === "cutpoint_ready",
      "writer cutpoint was not durable",
    );
    assertion(writer.graphStatus === "running", "writer Graph was not active");
    assertion(
      Object.values(writer.entries).every(
        (entry) => entry.graphStatus === "running",
      ),
      "writer did not persist all three entry cutpoints",
    );
    assertion(
      writer.binding?.graphRunId === writer.graphRunId &&
        writer.binding?.eventHead === writer.eventHead,
      "writer Desktop binding was not persisted at the Graph cutpoint",
    );

    assertion(
      writerProcess.child.kill("SIGKILL"),
      "failed to kill packaged writer",
    );
    const killed = await waitForExit(writerProcess);
    assertion(
      killed.code !== 0 || killed.signal != null,
      "packaged writer exited cleanly instead of being killed",
    );
    fs.cpSync(stateDirectory, rollbackStateDirectory, {
      recursive: true,
      dereference: true,
      force: true,
    });

    recoveryProcess = launch(
      layout.executable,
      "recover",
      stateDirectory,
      recoveryPath,
    );
    const recovered = await waitForFile(recoveryPath, recoveryProcess);
    validateCommon(recovered, "recover");
    const recoveredExit = await waitForExit(recoveryProcess);
    assertion(
      recoveredExit.code === 0,
      `packaged recovery exited ${recoveredExit.code}: ${recoveryProcess.stderr()}`,
    );
    assertion(recovered.status === "passed", "packaged recovery did not pass");
    assertion(recovered.graphRunId === writer.graphRunId, "run id changed");
    assertion(recovered.graphStatus === "succeeded", "Graph did not recover");
    assertion(
      Object.values(recovered.entries).every(
        (entry) =>
          entry.graphStatus === "succeeded" &&
          entry.bindingStatus === "succeeded" &&
          typeof entry.recoveredPrompt === "string",
      ),
      "recovery did not settle every Desktop entry GraphRun",
    );
    assertion(
      recovered.authorityGeneration > writer.authorityGeneration,
      "recovery did not fence the killed writer with a higher generation",
    );
    assertion(
      recovered.recoveredPrompt ===
        "resume the exact packaged BrowserWindow durable input",
      "recovery did not hydrate the durable Graph input",
    );
    assertion(
      recovered.binding?.lifecycleStatus === "succeeded" &&
        recovered.binding?.eventHead === recovered.eventHead,
      "recovery did not settle the durable Desktop binding",
    );

    rollbackProcess = launch(
      layout.executable,
      "rollback",
      rollbackStateDirectory,
      rollbackPath,
    );
    const rollback = await waitForFile(rollbackPath, rollbackProcess);
    validateCommon(rollback, "rollback");
    const rollbackExit = await waitForExit(rollbackProcess);
    assertion(
      rollbackExit.code === 0,
      `packaged rollback exited ${rollbackExit.code}: ${rollbackProcess.stderr()}`,
    );
    assertion(
      rollback.graphRunId === writer.graphRunId &&
        rollback.graphStatus === "running",
      "rollback snapshot did not restore the active pre-kill Graph",
    );
    assertion(
      Object.values(rollback.entries).every(
        (entry) => entry.graphStatus === "running",
      ),
      "rollback snapshot changed an entry GraphRun before takeover",
    );
    assertion(
      Array.isArray(rollback.restoredCutpointStores) &&
        rollback.restoredCutpointStores.length === writer.stores.length,
      "rollback did not publish restored cutpoint store evidence",
    );
    const storeKey = (store) =>
      `${store.surface}\0${store.entryId}\0${store.store}`;
    const writerStores = new Map(
      writer.stores.map((store) => [storeKey(store), store]),
    );
    const recoveredStores = new Map(
      recovered.stores.map((store) => [storeKey(store), store]),
    );
    const restoredStores = new Map(
      rollback.restoredCutpointStores.map((store) => [storeKey(store), store]),
    );
    for (const [key, cutpoint] of writerStores) {
      assertion(
        restoredStores.get(key)?.stateDigest === cutpoint.stateDigest,
        `rollback snapshot changed ${key} before takeover`,
      );
      assertion(recoveredStores.has(key), `recovery receipt is missing ${key}`);
    }
    const migrationCutpoints = [...writerStores].map(([key, cutpoint]) => {
      const recoveredStore = recoveredStores.get(key);
      const restoredStore = restoredStores.get(key);
      return {
        surface: cutpoint.surface,
        entryId: cutpoint.entryId,
        store: cutpoint.store,
        cutpointDigest: cutpoint.stateDigest,
        recoveryReceiptDigest: digest({
          schema: "chainlesschain.graph-store-recovery-receipt/v1",
          surface: cutpoint.surface,
          entryId: cutpoint.entryId,
          store: cutpoint.store,
          cutpointDigest: cutpoint.stateDigest,
          recoveredStateDigest: recoveredStore.stateDigest,
          recoveredGraphStatus: recovered.graphStatus,
          recoveredEventHead: recovered.eventHead,
        }),
        rollbackDrillDigest: digest({
          schema: "chainlesschain.graph-store-rollback-receipt/v1",
          surface: cutpoint.surface,
          entryId: cutpoint.entryId,
          store: cutpoint.store,
          cutpointDigest: cutpoint.stateDigest,
          restoredStateDigest: restoredStore.stateDigest,
          restoredGraphStatus: rollback.graphStatus,
          restoredBeforeTakeover: true,
        }),
        rpoLossCount: 0,
        recovered: true,
      };
    });

    const commitSha = exactCommit();
    assertion(
      /^[a-f0-9]{40,64}$/u.test(String(commitSha || "")),
      "packaged evidence could not bind the exact git commit",
    );
    const storeEvidence = {
      schema: "chainlesschain.graph-store-cutover-evidence/v1",
      status: "passed",
      source: "desktop_packaged_electron",
      commitSha,
      platform: EVIDENCE_PLATFORM,
      stores: [...migrationCutpoints].sort(
        (left, right) =>
          left.entryId.localeCompare(right.entryId) ||
          left.store.localeCompare(right.store),
      ),
      sourceReceipts: {
        writerCutpointDigest: writer.evidenceDigest,
        recoveryReceiptDigest: recovered.evidenceDigest,
        rollbackReceiptDigest: rollback.evidenceDigest,
      },
    };
    storeEvidence.evidenceDigest = digest(storeEvidence);
    const evidence = {
      schema: JOURNEY_SCHEMA,
      status: "passed",
      commitSha,
      platform: EVIDENCE_PLATFORM,
      arch: process.arch,
      writerCutpointDigest: writer.evidenceDigest,
      recoveryReceiptDigest: recovered.evidenceDigest,
      rollbackReceiptDigest: rollback.evidenceDigest,
      writerEventHead: writer.eventHead,
      recoveredEventHead: recovered.eventHead,
      writerAuthorityGeneration: writer.authorityGeneration,
      recoveredAuthorityGeneration: recovered.authorityGeneration,
      writerEntryRuns: writer.entries,
      recoveredEntryRuns: recovered.entries,
      rollbackEntryRuns: rollback.entries,
      electronVersion: recovered.runtime.electron,
      nodeVersion: recovered.runtime.node,
      packaged: true,
      asar: true,
      browserWindowRoundTrips: 3,
      migrationCutpoints,
      storeEvidence,
    };
    evidence.evidenceDigest = digest(evidence);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (EVIDENCE_OUTPUT) {
      const target = path.resolve(EVIDENCE_OUTPUT);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, serialized, "utf8");
    } else {
      process.stdout.write(serialized);
    }
  } finally {
    for (const processState of [
      writerProcess,
      recoveryProcess,
      rollbackProcess,
    ]) {
      if (
        processState &&
        processState.child.exitCode == null &&
        processState.child.signalCode == null
      ) {
        processState.child.kill();
        await waitForExit(processState).catch(() => {});
      }
    }
    if (KEEP) {
      process.stderr.write(`kept packaged Electron journey at ${root}\n`);
    } else {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        // Windows can retain the terminated Electron executable handle for a
        // short interval after the child exit event has been observed.
        maxRetries: process.platform === "win32" ? 10 : 0,
        retryDelay: 250,
      });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
