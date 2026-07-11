/**
 * Managed CLI runtime — install / rollback / resolve orchestration.
 *
 * Thin, still `vscode`-free layer over src/managed-cli.js that sequences the
 * real steps (fetch registry meta → download tarball → verify integrity →
 * extract → write shims → update state). Network IO is ALWAYS injected
 * (`io.fetchJson`, `io.fetchBuffer` — extension.js supplies its https
 * helpers); filesystem defaults to node:fs but is injectable for tests.
 *
 * Every write lands under the caller-supplied rootDir
 * (`<globalStorage>/managed-cli` in production) — nothing else on the machine
 * is touched, and a failed install never updates current.json (the previous
 * install, if any, stays active).
 */

"use strict";

const path = require("node:path");
const {
  registryMetaUrl,
  planManagedInstall,
  verifyTarball,
  extractPackage,
  parseStateJson,
  nextState,
  rollbackPlan,
  packageBinEntry,
  resolveManagedBinary,
  buildLauncherScripts,
  shimName,
  commandForSpawn,
  STATE_FILE,
} = require("./managed-cli");

function _defaultFs() {
  return require("node:fs");
}

/** Read + parse current.json (null when absent/corrupt — never throws). */
function readManagedState(rootDir, fs = _defaultFs()) {
  try {
    const p = path.join(rootDir, STATE_FILE);
    if (!fs.existsSync(p)) return null;
    return parseStateJson(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Write both launcher shims for `entry` and chmod the POSIX one. */
function _writeShims(rootDir, entry, fs) {
  const scripts = buildLauncherScripts({ entryPath: entry });
  if (scripts.error) return { error: scripts.error };
  for (const s of [scripts.windows, scripts.posix]) {
    const p = path.join(rootDir, s.name);
    fs.writeFileSync(p, s.content, "utf-8");
    if (s.mode && typeof fs.chmodSync === "function") {
      try {
        fs.chmodSync(p, s.mode);
      } catch {
        /* Windows has no exec bit — best-effort */
      }
    }
  }
  return {};
}

/**
 * Resolve an existing managed install to a spawnable command, or null.
 * Used as the `getManaged` candidate source in cli-binary resolution — it
 * must be cheap (state read + a few existsSync), no spawning, no network.
 * @returns {{command:string, version:string, entry:string}|null}
 */
function resolveManagedCommand(rootDir, opts = {}) {
  const fs = opts.fs || _defaultFs();
  const platform = opts.platform || process.platform;
  if (!rootDir) return null;
  const state = readManagedState(rootDir, fs);
  const resolved = resolveManagedBinary(rootDir, state, {
    exists: (p) => fs.existsSync(p),
    readJson: (p) => {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        return null;
      }
    },
  });
  if (!resolved) return null;
  const shim = path.join(rootDir, shimName(platform));
  if (!fs.existsSync(shim)) return null; // install/rollback always writes shims
  return {
    command: commandForSpawn(shim, platform),
    version: resolved.version,
    entry: resolved.entry,
  };
}

/**
 * Download + verify + extract + activate a managed CLI copy.
 * @param {{
 *   rootDir:string,
 *   requestedVersion?:string,           // default "latest"
 *   floorVersion?:string|null,          // reject anything below (version-check floor)
 *   io:{
 *     fetchJson:(url:string)=>Promise<object|null>,
 *     fetchBuffer:(url:string)=>Promise<Buffer|null>,
 *     fs?:object, now?:()=>number, platform?:string,
 *     report?:(step:string)=>void,
 *   }
 * }} p
 * @returns {Promise<{ok:true, version:string, entry:string, command:string}
 *                  |{ok:false, step:string, error:string, detail?:object}>}
 */
async function runManagedInstall({
  rootDir,
  requestedVersion = "latest",
  floorVersion = null,
  io = {},
} = {}) {
  const fs = io.fs || _defaultFs();
  const now = io.now || Date.now;
  const platform = io.platform || process.platform;
  const report = io.report || (() => {});
  if (!rootDir) return { ok: false, step: "plan", error: "no-root-dir" };
  if (
    typeof io.fetchJson !== "function" ||
    typeof io.fetchBuffer !== "function"
  ) {
    return { ok: false, step: "plan", error: "no-fetch-io" };
  }

  report("resolve");
  let meta = null;
  try {
    meta = await io.fetchJson(registryMetaUrl(requestedVersion));
  } catch {
    meta = null;
  }
  const plan = planManagedInstall({
    requestedVersion,
    registryMeta: meta,
    floorVersion,
  });
  if (!plan.ok)
    return { ok: false, step: "plan", error: plan.error, detail: plan };

  report("download");
  let tgz = null;
  try {
    tgz = await io.fetchBuffer(plan.tarballUrl);
  } catch {
    tgz = null;
  }
  if (!tgz || !tgz.length) {
    return { ok: false, step: "download", error: "download-failed" };
  }

  report("verify");
  const verified = verifyTarball(tgz, plan.integrity);
  if (!verified.ok) {
    return {
      ok: false,
      step: "verify",
      error: "integrity-mismatch",
      detail: verified,
    };
  }

  report("extract");
  const extraction = extractPackage(tgz);
  if (extraction.error) {
    return { ok: false, step: "extract", error: extraction.error };
  }

  report("install");
  const prevState = readManagedState(rootDir, fs);
  const versionDir = path.join(rootDir, plan.version);
  try {
    // A re-install of the same version starts from a clean slate.
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
    }
    for (const d of extraction.dirs) {
      fs.mkdirSync(path.join(versionDir, ...d.split("/")), { recursive: true });
    }
    for (const f of extraction.files) {
      const target = path.join(versionDir, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.data); // raw bytes — NOT a string write
    }
  } catch (err) {
    return {
      ok: false,
      step: "install",
      error:
        "write-failed:" + String((err && err.message) || err).slice(0, 120),
    };
  }

  // Locate the real bin entry from the freshly extracted package.json.
  const pkgFile = extraction.files.find(
    (f) => f.path === "package/package.json",
  );
  let pkg = null;
  try {
    pkg = pkgFile ? JSON.parse(pkgFile.data.toString("utf-8")) : null;
  } catch {
    pkg = null;
  }
  const binRel = packageBinEntry(pkg);
  if (!binRel) return { ok: false, step: "install", error: "no-bin-entry" };
  const entry = path.join(
    versionDir,
    "package",
    ...binRel.split("/").filter((s) => s && s !== "."),
  );
  if (!fs.existsSync(entry)) {
    return { ok: false, step: "install", error: "bin-entry-missing" };
  }

  const shims = _writeShims(rootDir, entry, fs);
  if (shims.error) return { ok: false, step: "install", error: shims.error };

  // State write is LAST — any earlier failure leaves the old install active.
  const state = nextState({
    version: plan.version,
    previousState: prevState,
    now: now(),
  });
  fs.writeFileSync(
    path.join(rootDir, STATE_FILE),
    JSON.stringify(state, null, 2),
    "utf-8",
  );

  const shim = path.join(rootDir, shimName(platform));
  return {
    ok: true,
    version: plan.version,
    entry,
    command: commandForSpawn(shim, platform),
  };
}

/**
 * One-step rollback to state.previousVersion (must still be on disk).
 * @returns {{ok:true, version:string, command:string}
 *          |{ok:false, reason:"no-state"|"no-previous"|"previous-missing"|"broken-previous"}}
 */
function runManagedRollback({ rootDir, io = {} } = {}) {
  const fs = io.fs || _defaultFs();
  const now = io.now || Date.now;
  const platform = io.platform || process.platform;
  if (!rootDir) return { ok: false, reason: "no-state" };
  const state = readManagedState(rootDir, fs);
  const plan = rollbackPlan(
    state,
    (v) => fs.existsSync(path.join(rootDir, v, "package")),
    { now: now() },
  );
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const resolved = resolveManagedBinary(rootDir, plan.newState, {
    exists: (p) => fs.existsSync(p),
    readJson: (p) => {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        return null;
      }
    },
  });
  if (!resolved) return { ok: false, reason: "broken-previous" };
  const shims = _writeShims(rootDir, resolved.entry, fs);
  if (shims.error) return { ok: false, reason: "broken-previous" };
  fs.writeFileSync(
    path.join(rootDir, STATE_FILE),
    JSON.stringify(plan.newState, null, 2),
    "utf-8",
  );
  const shim = path.join(rootDir, shimName(platform));
  return {
    ok: true,
    version: plan.version,
    command: commandForSpawn(shim, platform),
  };
}

module.exports = {
  readManagedState,
  resolveManagedCommand,
  runManagedInstall,
  runManagedRollback,
};
