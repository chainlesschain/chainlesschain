import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectNativeToolchain } from "../scripts/verify01-native-toolchain.mjs";
import { readNativeReviewBundle } from "../scripts/verify01-native-review-admission.mjs";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { gzipSync } from "node:zlib";
import { tarBytes, integrity } from "./helpers/verify01-registry-tar.mjs";

const bundle = readNativeReviewBundle();
function registryFixture(t, options) {
  const fixtureValue = fixture(t, options);
  const { root, lock, frozen, write } = fixtureValue;
  const artifacts = [];
  for (const packagePath of Object.keys(lock.packages)) {
    const name = packagePath.slice("node_modules/".length);
    const entries = ["package.json", "index.js"].map((file) => ({
      name: `package/${file}`,
      bytes: fs.readFileSync(path.join(root, packagePath, file)),
    }));
    const tarball = gzipSync(tarBytes(entries));
    lock.packages[packagePath].integrity = integrity(tarball);
    write(`artifacts/${name}.tgz`, tarball);
    artifacts.push({ packagePath, file: `${name}.tgz` });
  }
  frozen.set("package-lock.json", Buffer.from(JSON.stringify(lock)));
  write("package-lock.json", frozen.get("package-lock.json"));
  fixtureValue.options.lockDigest = evalDigest(frozen.get("package-lock.json"));
  fixtureValue.options.registry = {
    root: path.join(root, "artifacts"),
    artifacts,
  };
  return fixtureValue;
}

test("complete registry bytes verify content without granting native execution", (t) => {
  const { options } = registryFixture(t);
  const report = inspectNativeToolchain(options);
  assert.equal(report.registryContentVerified, true);
  assert.equal(report.inventory.registryChecks.length, 3);
  assert.equal(report.inventoryDigest, outcomeDigest(report.inventory));
  assert.equal(report.trusted, false);
  assert.equal(report.nativeAclAssessed, false);
  assert.equal(report.fullReviewPackReady, false);
  assert.ok(
    !report.blockers.includes("REGISTRY_CONTENT_VERIFICATION_REQUIRED"),
  );
  assert.ok(report.blockers.includes("NATIVE_CAPSULE_EXECUTION_NOT_VERIFIED"));
});

test("tarball integrity mismatch cannot be replaced by installed file hashes", (t) => {
  const { options, write } = registryFixture(t);
  write("artifacts/vitest.tgz", "tampered");
  assert.throws(
    () => inspectNativeToolchain(options),
    /tarball integrity differs/,
  );
});

test("registry verification requires the entire installed package population", (t) => {
  const { options } = registryFixture(t);
  options.registry.artifacts.pop();
  assert.throws(
    () => inspectNativeToolchain(options),
    /every installed package/,
  );
});

test("repeating another package's artifact does not fill a missing package", (t) => {
  const { options } = registryFixture(t);
  options.registry.artifacts[1] = options.registry.artifacts[0];
  assert.throws(
    () => inspectNativeToolchain(options),
    /duplicate registry package/,
  );
});

test("installed script modification fails against verified tarball bytes", (t) => {
  const { options, write } = registryFixture(t);
  write("node_modules/vitest/index.js", "modified script");
  assert.throws(
    () => inspectNativeToolchain(options),
    /installed file.*differs/,
  );
});

test("derived addon is not silently exempted from registry byte verification", (t) => {
  const { options } = registryFixture(t, { addon: true });
  assert.throws(() => inspectNativeToolchain(options), /additional files/);
});

test("artifact bindings cannot traverse links or escape the artifact root", (t) => {
  const { options } = registryFixture(t);
  options.registry.artifacts[0].file = "../package-lock.json";
  assert.throws(() => inspectNativeToolchain(options), /unsafe inventory path/);
});
const supportPaths = [
  "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/agent-evolution-test-boundary.js",
];

function fixture(t, { addon = false } = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-toolchain-test-"),
  );
  const original = fs.lstatSync(root, { bigint: true });
  t.after(() => {
    const current = fs.lstatSync(root, { bigint: true });
    assert.equal(current.dev, original.dev);
    assert.equal(current.ino, original.ino);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    fs.rmSync(root, { recursive: true });
  });
  function write(file, bytes) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
  }
  const lock = { lockfileVersion: 3, packages: {} };
  for (const name of ["vitest", "vite", "happy-dom"]) {
    const relative = `node_modules/${name}`;
    lock.packages[relative] = {
      version: "1.0.0",
      resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
      integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    };
    write(
      `${relative}/package.json`,
      JSON.stringify({ name, version: "1.0.0" }),
    );
    // Deliberately executable-looking content must only be read, never imported.
    write(
      `${relative}/index.js`,
      "throw new Error('inventory executed untrusted tool');\n",
    );
  }
  if (addon)
    write(
      "node_modules/vitest/native.node",
      Buffer.from("synthetic addon; never load"),
    );
  const frozen = new Map();
  frozen.set("package-lock.json", Buffer.from(JSON.stringify(lock)));
  for (const relative of supportPaths)
    frozen.set(
      relative,
      Buffer.from(`// synthetic frozen support ${relative}\n`),
    );
  for (const [relative, bytes] of frozen) write(relative, bytes);
  const options = {
    root,
    bundle,
    lockDigest: evalDigest(frozen.get("package-lock.json")),
    readFrozenBlob(commit, relative) {
      assert.equal(commit, bundle.catalog.projectCommit);
      return frozen.get(relative);
    },
  };
  return { root, write, frozen, lock, options };
}

test("bounded read-only inventory binds lock, runtime, files and frozen support without granting execution", (t) => {
  const { options } = fixture(t);
  const report = inspectNativeToolchain(options);
  assert.equal(report.status, "INVENTORIED_NOT_EXECUTABLE");
  assert.equal(report.inventory.packages.length, 3);
  assert.equal(report.inventory.files.length, 6);
  assert.equal(report.inventory.support.length, 5);
  assert.equal(report.inventoryDigest, outcomeDigest(report.inventory));
  assert.equal(report.inventory.runtime.modulesAbi, process.versions.modules);
  for (const key of [
    "registryContentVerified",
    "addonAbiVerified",
    "nativeAclAssessed",
    "fullReviewPackReady",
    "formalSample",
    "providerAssessed",
  ])
    assert.equal(report[key], false);
  assert.deepEqual(inspectNativeToolchain(options), report);
});

test("addon bytes are hashed and ABI remains unverified without loading the binary", (t) => {
  const { options } = fixture(t, { addon: true });
  const report = inspectNativeToolchain(options);
  assert.equal(report.inventory.addons.length, 1);
  assert.ok(report.blockers.includes("ADDON_ABI_NOT_VERIFIED"));
  assert.equal(report.addonAbiVerified, false);
});

test("caller digest cannot replace exact frozen Git lock bytes", (t) => {
  const { options, write, frozen } = fixture(t);
  assert.throws(
    () =>
      inspectNativeToolchain({
        ...options,
        lockDigest: "sha256:" + "0".repeat(64),
      }),
    /pinned lock digest/,
  );
  const changed = Buffer.concat([
    frozen.get("package-lock.json"),
    Buffer.from("\n"),
  ]);
  write("package-lock.json", changed);
  assert.throws(
    () =>
      inspectNativeToolchain({ ...options, lockDigest: evalDigest(changed) }),
    /frozen Git blob/,
  );
});

test("changed frozen setup is rejected without executing it", (t) => {
  const { options, write } = fixture(t);
  write(supportPaths[0], "throw new Error('must not run');\n");
  assert.throws(() => inspectNativeToolchain(options), /test support differs/);
});

for (const change of [
  "version",
  "identity",
  "missing-integrity",
  "linked-lock",
  "unlocked-package",
  "unlocked-file",
]) {
  test(`rejects ${change} rather than promoting a development tree`, (t) => {
    const { options, write, frozen, lock } = fixture(t);
    if (change === "version" || change === "identity")
      write(
        "node_modules/vitest/package.json",
        JSON.stringify({
          name: change === "identity" ? "other" : "vitest",
          version: change === "version" ? "9.0.0" : "1.0.0",
        }),
      );
    if (change === "missing-integrity" || change === "linked-lock") {
      if (change === "missing-integrity")
        delete lock.packages["node_modules/vitest"].integrity;
      else lock.packages["node_modules/vitest"].link = true;
      frozen.set("package-lock.json", Buffer.from(JSON.stringify(lock)));
      write("package-lock.json", frozen.get("package-lock.json"));
      options.lockDigest = evalDigest(frozen.get("package-lock.json"));
    }
    if (change === "unlocked-package")
      write(
        "node_modules/other/package.json",
        JSON.stringify({ name: "other", version: "1.0.0" }),
      );
    if (change === "unlocked-file") write("node_modules/stray.js", "unlocked");
    assert.throws(
      () => inspectNativeToolchain(options),
      /provenance missing|unlocked package/,
    );
  });
}

test("hard-linked package bytes are forbidden", (t) => {
  const { options, root } = fixture(t);
  fs.linkSync(
    path.join(root, "node_modules/vitest/index.js"),
    path.join(root, "node_modules/vitest/linked.js"),
  );
  assert.throws(() => inspectNativeToolchain(options), /file is linked/);
});

test("development dependency junction cannot redirect inventory outside its root", (t) => {
  const { options, root } = fixture(t);
  fs.symlinkSync(
    path.join(root, "node_modules/vitest"),
    path.join(root, "node_modules/external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => inspectNativeToolchain(options), /link or path alias/);
});

test("case-alias package entries are rejected on every filesystem", (t) => {
  const { options, root, write } = fixture(t);
  const directory = path.join(root, "node_modules/vitest");
  write("node_modules/vitest/Case.js", "x");
  assert.doesNotThrow(() => inspectNativeToolchain(options));
  let syntheticEnumeration = false;
  let aliasEnumerations = 0;
  try {
    fs.writeFileSync(path.join(directory, "case.js"), "y", { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const names = fs.readdirSync(directory);
    assert.ok(names.includes("Case.js"));
    assert.ok(!names.includes("case.js"));
    assert.equal(fs.readFileSync(path.join(directory, "Case.js"), "utf8"), "x");
    // Case-folding volumes cannot hold both entries. Exercise the same
    // enumeration guard without allowing the second write to replace bytes.
    syntheticEnumeration = true;
    const readDirectory = fs.readdirSync.bind(fs);
    t.mock.method(fs, "readdirSync", (candidate, ...args) => {
      const entries = readDirectory(candidate, ...args);
      if (candidate !== directory) return entries;
      aliasEnumerations += 1;
      return [...entries, "case.js"];
    });
  }
  assert.throws(() => inspectNativeToolchain(options), /case aliases/);
  if (syntheticEnumeration) assert.equal(aliasEnumerations, 1);
  t.diagnostic(
    `case-alias enumeration: ${syntheticEnumeration ? "case-folding volume" : "distinct physical files"}`,
  );
});

test("reserved device package entries are rejected on every filesystem", (t) => {
  const { options, write } = fixture(t);
  write("node_modules/vitest/CON.json", "x");
  assert.throws(() => inspectNativeToolchain(options), /unsafe inventory path/);
});
