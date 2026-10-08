import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";

const source = fs.readFileSync(
  new URL(
    "../scripts/diagnostics/windows-node-pipe-preload.cjs",
    import.meta.url,
  ),
  "utf8",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = "C:\\capsule with spaces";
const directory = `${root}\\workspace\\adapter`;
const preloadPath = `${directory}\\windows-node-pipe-preload.cjs`;
const addonPath = `${directory}\\windows-node-pipe-adapter.node`;
const manifestPath = `${directory}\\windows-node-pipe-adapter.manifest.json`;
const runtimePath = `${root}\\control\\node.exe`;
const receiptDirectory = `${root}\\scratch\\adapter-receipts`;
const sid = "S-1-15-2-1-2-3-4-5-6-7";
const schema = "chainlesschain/windows-node-pipe-adapter@1";
function fixture(change = () => {}) {
  const runtime = Buffer.from("fixed node executable bytes");
  const addonBytes = Buffer.from("fixed native addon bytes");
  const files = new Map([
    [preloadPath, Buffer.from(source)],
    [runtimePath, runtime],
    [addonPath, addonBytes],
  ]);
  const writes = new Map();
  const listeners = new Map();
  let loads = 0;
  let installs = 0;
  const manifest = {
    schema,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: "22.22.2",
    nodeModuleVersion: "127",
    runtime: { path: "../../control/node.exe", sha256: hash(runtime) },
    addon: { path: "windows-node-pipe-adapter.node", sha256: hash(addonBytes) },
    preload: { path: "windows-node-pipe-preload.cjs", sha256: hash(source) },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const process = {
    platform: "win32",
    arch: "x64",
    versions: { node: "22.22.2", modules: "127" },
    execPath: runtimePath,
    pid: 123,
    ppid: 100,
    env: { CC_WINDOWS_APPCONTAINER_SID: sid, NODE_OPTIONS: "--other-option" },
    once: (event, callback) => listeners.set(event, callback),
  };
  const native = {
    schema,
    experimental: true,
    admissionEligible: false,
    state: 2,
    patches: 2,
    pid: 123,
    appContainerSid: sid,
    capabilityCount: 0,
    inJob: true,
    installError: 0,
    serverMapped: 0,
    clientMapped: 0,
  };
  const metadata = new Map();
  const fakeFs = {
    lstatSync(file) {
      if (file === receiptDirectory) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          ...metadata.get(file),
        };
      }
      assert.ok(files.has(file), `unexpected file ${file}`);
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        size: files.get(file).length,
        dev: 1,
        ino: 10,
        mtimeMs: 0,
        ctimeMs: 0,
        ...metadata.get(file),
      };
    },
    readFileSync(file) {
      assert.ok(files.has(file), `unexpected read ${file}`);
      return files.get(file);
    },
    writeFileSync(file, bytes, options) {
      assert.equal(options.flag, "wx");
      assert.equal(path.win32.dirname(file), receiptDirectory);
      if (writes.has(file)) throw new Error("EEXIST");
      writes.set(file, bytes);
    },
  };
  const settings = {
    manifest,
    process,
    native,
    files,
    metadata,
    writes,
    fakeFs,
  };
  change(settings);
  files.set(manifestPath, Buffer.from(JSON.stringify(manifest)));
  const context = {
    __dirname: directory,
    __filename: preloadPath,
    module: { exports: {} },
    process,
    require(name) {
      if (name === "node:fs") return fakeFs;
      if (name === "node:path") return path;
      if (name === "node:crypto") return { createHash };
      assert.equal(name, addonPath);
      loads += 1;
      return {
        install(expectedSid, expectedPid) {
          assert.equal(expectedSid, sid);
          assert.equal(expectedPid, process.pid);
          installs += 1;
          return JSON.stringify(native);
        },
        snapshot: () => JSON.stringify(native),
      };
    },
  };
  return {
    ...settings,
    listeners,
    load: () => vm.runInNewContext(source, context, { filename: preloadPath }),
    exported: () => context.module.exports,
    counts: () => ({ loads, installs }),
  };
}

test("fixed preload verifies identities and records actual process installation and exit", () => {
  const setup = fixture();
  setup.load();
  assert.deepEqual(setup.counts(), { loads: 1, installs: 1 });
  const installed = JSON.parse(
    setup.writes.get(`${receiptDirectory}\\pipe-adapter-123-installed.json`),
  );
  assert.equal(installed.pid, 123);
  assert.equal(installed.ppid, 100);
  assert.equal(installed.runtimeSha256, setup.manifest.runtime.sha256);
  assert.equal(installed.manifestSha256, hash(setup.files.get(manifestPath)));
  assert.equal(installed.admissionEligible, false);
  setup.native.serverMapped = 3;
  setup.native.clientMapped = 3;
  setup.listeners.get("exit")(0);
  const exited = JSON.parse(
    setup.writes.get(`${receiptDirectory}\\pipe-adapter-123-exit.json`),
  );
  assert.equal(exited.native.serverMapped, 3);
  assert.equal(exited.native.clientMapped, 3);
  assert.equal(exited.exitCode, 0);
});

test("child contract uses fixed runtime/preload and explicitly requires each child receipt", () => {
  const setup = fixture();
  setup.load();
  const contract = setup.exported().childContract();
  assert.equal(contract.executable, runtimePath);
  assert.deepEqual(Array.from(contract.execArgv), ["--require", preloadPath]);
  assert.equal(contract.environment.CC_WINDOWS_APPCONTAINER_SID, sid);
  assert.equal(
    contract.environment.NODE_OPTIONS,
    `--require="${preloadPath.replace(/\\/gu, "/")}"`,
  );
  assert.match(contract.requiredReceipt, /actual child PID/);
  assert.ok(contract.unsupported.includes("NUL"));
  assert.ok(contract.unsupported.includes("realpath"));
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.environment));
  assert.ok(Object.isFrozen(contract.execArgv));
});

test("actual Node NODE_OPTIONS parser loads the contract's quoted path containing spaces", () => {
  const setup = fixture();
  setup.load();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc node options "));
  const workspace = path.join(temporary, "workspace");
  const adapterDirectory = path.join(workspace, "adapter");
  const preload = path.join(adapterDirectory, "windows-node-pipe-preload.cjs");
  try {
    fs.mkdirSync(workspace);
    fs.mkdirSync(adapterDirectory);
    fs.writeFileSync(
      preload,
      "globalThis.__ccParserReceipt = 'actual-preload-loaded';\n",
      { flag: "wx" },
    );
    const nodeOptions = setup
      .exported()
      .childContract()
      .environment.NODE_OPTIONS.replace(
        root.replace(/\\/gu, "/"),
        temporary.replace(/\\/gu, "/"),
      );
    const result = spawnSync(
      process.execPath,
      ["-p", "globalThis.__ccParserReceipt"],
      {
        env: { ...process.env, NODE_OPTIONS: nodeOptions },
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "actual-preload-loaded");
    assert.equal(result.stderr, "");
  } finally {
    if (fs.existsSync(preload)) fs.unlinkSync(preload);
    if (fs.existsSync(adapterDirectory)) fs.rmdirSync(adapterDirectory);
    if (fs.existsSync(workspace)) fs.rmdirSync(workspace);
    fs.rmdirSync(temporary);
  }
});

for (const file of [runtimePath, addonPath, preloadPath]) {
  test(`tampered fixed bytes rejected before loading addon: ${path.win32.basename(file)}`, () => {
    const setup = fixture(({ files }) =>
      files.set(file, Buffer.from("tampered")),
    );
    assert.throws(setup.load, /hash mismatch/);
    assert.deepEqual(setup.counts(), { loads: 0, installs: 0 });
  });
}

for (const [label, change] of [
  [
    "arbitrary addon path",
    ({ manifest }) => (manifest.addon.path = "other.node"),
  ],
  [
    "runtime traversal variant",
    ({ manifest }) => (manifest.runtime.path = "../../../node.exe"),
  ],
  [
    "preload absolute variant",
    ({ manifest }) => (manifest.preload.path = preloadPath),
  ],
  [
    "receipt directory escape",
    ({ manifest }) => (manifest.receiptDirectory = "../../other"),
  ],
  [
    "alternate SID environment",
    ({ manifest }) => (manifest.expectedSidEnvironment = "OTHER_SID"),
  ],
  ["module ABI mismatch", ({ process }) => (process.versions.modules = "128")],
  [
    "Node version mismatch",
    ({ process }) => (process.versions.node = "22.12.0"),
  ],
  [
    "formal admission claim",
    ({ manifest }) => (manifest.admissionEligible = true),
  ],
  [
    "runtime loaded from another path",
    ({ process }) => (process.execPath = "C:\\outside\\node.exe"),
  ],
  [
    "missing supervisor SID",
    ({ process }) => delete process.env.CC_WINDOWS_APPCONTAINER_SID,
  ],
  [
    "malformed SID",
    ({ process }) => (process.env.CC_WINDOWS_APPCONTAINER_SID = "S-1-5-18"),
  ],
  ["unsupported platform", ({ process }) => (process.platform = "linux")],
  ["unsupported architecture", ({ process }) => (process.arch = "arm64")],
  ["linked addon", ({ metadata }) => metadata.set(addonPath, { nlink: 2 })],
  [
    "symlinked addon",
    ({ metadata }) => metadata.set(addonPath, { isSymbolicLink: () => true }),
  ],
  [
    "symlinked receipt directory",
    ({ metadata }) =>
      metadata.set(receiptDirectory, { isSymbolicLink: () => true }),
  ],
]) {
  test(`${label} rejected before native load`, () => {
    const setup = fixture(change);
    assert.throws(setup.load, /Experimental pipe adapter/);
    assert.deepEqual(setup.counts(), { loads: 0, installs: 0 });
  });
}

for (const [key, value] of [
  ["pid", 124],
  ["appContainerSid", "S-1-15-2-99"],
  ["capabilityCount", 1],
  ["inJob", false],
  ["state", 3],
  ["patches", 1],
  ["installError", 5],
  ["admissionEligible", true],
]) {
  test(`mismatched native ${key} receipt rejected`, () => {
    const setup = fixture(({ native }) => (native[key] = value));
    assert.throws(setup.load, /native installation\/token receipt mismatch/);
    assert.equal(setup.writes.size, 0);
  });
}

test("preexisting receipt is preserved and causes fail closed", () => {
  const setup = fixture(({ writes }) =>
    writes.set(
      `${receiptDirectory}\\pipe-adapter-123-installed.json`,
      "retained",
    ),
  );
  assert.throws(setup.load, /EEXIST/);
  assert.equal(
    setup.writes.get(`${receiptDirectory}\\pipe-adapter-123-installed.json`),
    "retained",
  );
});

test("exit does not accept a failed or partial native installation", () => {
  const setup = fixture();
  setup.load();
  setup.native.patches = 1;
  assert.throws(() => setup.listeners.get("exit")(0), /receipt mismatch/);
  assert.equal(setup.writes.size, 1);
});

test("changed guarded-file identity rejects before loading addon", () => {
  const setup = fixture(({ fakeFs, metadata }) => {
    const original = fakeFs.readFileSync;
    fakeFs.readFileSync = (file) => {
      const bytes = original(file);
      if (file === addonPath) metadata.set(file, { ino: 99 });
      return bytes;
    };
  });
  assert.throws(setup.load, /identity changed/);
  assert.deepEqual(setup.counts(), { loads: 0, installs: 0 });
});
