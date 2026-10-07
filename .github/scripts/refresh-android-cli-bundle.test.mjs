import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  allowsPinnedVersion,
  hydrationManifest,
  inspectAddon,
  requireDigest,
  stageInstalledCli,
  verifySourceParity,
} from "./refresh-android-cli-bundle.mjs";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "android-refresh-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  return { root, write };
}

function manifests() {
  return {
    cli: {
      name: "chainlesschain",
      version: "0.166.93",
      dependencies: {
        "@chainlesschain/personal-data-hub": "0.4.64",
        "@chainlesschain/core-db": "0.1.5",
      },
    },
    pdh: {
      name: "@chainlesschain/personal-data-hub",
      version: "0.4.64",
      optionalDependencies: { "better-sqlite3-multiple-ciphers": "^12.5.0" },
    },
    core: {
      name: "@chainlesschain/core-db",
      version: "0.1.5",
      optionalDependencies: { "better-sqlite3-multiple-ciphers": "^11.0.0" },
    },
  };
}

test("hydration pins only an in-range PDH cipher without rewriting child contracts", () => {
  const { cli, pdh, core } = manifests();
  const originals = structuredClone({ cli, pdh, core });
  const value = hydrationManifest(cli, pdh, core);
  assert.deepEqual(value.overrides, {
    "@chainlesschain/personal-data-hub@0.4.64": {
      "better-sqlite3-multiple-ciphers": "12.11.1",
    },
  });
  assert.deepEqual({ cli, pdh, core }, originals);
  assert.equal(
    allowsPinnedVersion(
      core.optionalDependencies["better-sqlite3-multiple-ciphers"],
      "12.11.1",
    ),
    false,
  );
});

test("rejects mismatched children, incompatible native ranges and changed fallback contracts", () => {
  const { cli, pdh, core } = manifests();
  assert.throws(() =>
    hydrationManifest(cli, { ...pdh, version: "0.4.65" }, core),
  );
  for (const range of ["^13.0.0", "^12.12.0", "*", "file:../native"])
    assert.throws(
      () =>
        hydrationManifest(
          cli,
          {
            ...pdh,
            optionalDependencies: { "better-sqlite3-multiple-ciphers": range },
          },
          core,
        ),
      /outside PDH/,
    );
  assert.throws(
    () =>
      hydrationManifest(cli, pdh, {
        ...core,
        optionalDependencies: { "better-sqlite3-multiple-ciphers": "^12.0.0" },
      }),
    /fallback contract/,
  );
});

test("caret compatibility respects minor/patch boundaries for version zero", () => {
  assert.equal(allowsPinnedVersion("^0.2.3", "0.2.4"), true);
  assert.equal(allowsPinnedVersion("^0.2.3", "0.3.0"), false);
  assert.equal(allowsPinnedVersion("^0.0.3", "0.0.4"), false);
  assert.equal(allowsPinnedVersion("12.11.1", "12.11.1"), true);
});

test("source parity detects changed C++/JS/manifest bytes and unexpected payloads", (t) => {
  const { root, write } = temporary(t);
  for (const tree of ["registry", "installed"]) {
    write(`${tree}/package.json`, '{"version":"12.11.1"}');
    write(`${tree}/src/binding.cc`, "canonical C++ source");
    write(`${tree}/lib/index.js`, "canonical JS wrapper");
  }
  const registry = path.join(root, "registry"),
    installed = path.join(root, "installed");
  assert.equal(verifySourceParity(registry, installed).files, 3);
  write("installed/src/binding.cc", "modified C++ source");
  assert.throws(
    () => verifySourceParity(registry, installed),
    /registry source changed/,
  );
  write("installed/src/binding.cc", "canonical C++ source");
  write("installed/build/Release/better_sqlite3.node", "verified donor binary");
  assert.throws(() => verifySourceParity(registry, installed), /file set/);
  assert.equal(
    verifySourceParity(registry, installed, { allowExtra: true }).files,
    3,
  );
  write("installed/lib/index.js", "modified wrapper");
  assert.throws(
    () => verifySourceParity(registry, installed, { allowExtra: true }),
    /registry source changed/,
  );
});

test("retained archive/binding identity is a hard checksum gate", (t) => {
  const { write } = temporary(t);
  const file = write("tampered.node", "not the retained binary");
  assert.throws(() => requireDigest(file, "0".repeat(64)), /sha256 mismatch/);
});

function elf({ machine = 183, abi = 147, needed = "libc.so" } = {}) {
  const names = Buffer.from(`\0node_register_module_v${abi}\0${needed}\0`);
  const bytes = Buffer.alloc(512 + names.length);
  bytes.set([127, 69, 76, 70, 2, 1]);
  bytes.writeUInt16LE(3, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeBigUInt64LE(64n, 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(4, 60);
  const section = (index, type, offset, size, link, stride) => {
    const at = 64 + index * 64;
    bytes.writeUInt32LE(type, at + 4);
    bytes.writeBigUInt64LE(BigInt(offset), at + 24);
    bytes.writeBigUInt64LE(BigInt(size), at + 32);
    bytes.writeUInt32LE(link, at + 40);
    bytes.writeBigUInt64LE(BigInt(stride), at + 56);
  };
  section(1, 3, 512, names.length, 0, 0);
  section(2, 11, 320, 48, 1, 24);
  section(3, 6, 368, 32, 1, 16);
  bytes.writeUInt32LE(1, 344);
  bytes[348] = 18;
  bytes.writeUInt16LE(1, 350);
  bytes.writeBigUInt64LE(1n, 368);
  bytes.writeBigUInt64LE(BigInt(names.indexOf(Buffer.from(needed))), 376);
  names.copy(bytes, 512);
  return bytes;
}

test("ELF checks bind Android architecture, registration ABI and Bionic dependencies", () => {
  assert.deepEqual(inspectAddon(elf()).needed, ["libc.so"]);
  assert.throws(() => inspectAddon(elf({ machine: 62 })), /AArch64/);
  assert.throws(() => inspectAddon(elf({ abi: 127 })), /ABI 147/);
  assert.throws(
    () => inspectAddon(elf({ needed: "libc.so.6" })),
    /unsupported Android/,
  );
  assert.throws(
    () => inspectAddon(Buffer.from("node_register_module_v147")),
    /not ELF/,
  );
  const malformed = elf();
  malformed.writeBigUInt64LE(999999n, 40);
  assert.throws(() => inspectAddon(malformed), /offset outside/);
});

test("relocation preserves published CLI bytes and dependency-relative resolution", (t) => {
  const { root, write } = temporary(t);
  write(
    "install/node_modules/chainlesschain/package.json",
    '{"name":"chainlesschain"}',
  );
  write("install/node_modules/chainlesschain/bin/cc.js", "canonical CLI bytes");
  write("install/node_modules/driver/index.js", "hoisted driver");
  write(
    "install/node_modules/child/node_modules/driver/index.js",
    "nested driver",
  );
  write(
    "install/node_modules/.package-lock.json",
    "install-root-specific metadata",
  );
  const packaged = stageInstalledCli(
    path.join(root, "install"),
    path.join(root, "stage"),
  );
  assert.equal(
    fs.readFileSync(path.join(packaged, "bin/cc.js"), "utf8"),
    "canonical CLI bytes",
  );
  assert.equal(
    fs.readFileSync(
      path.join(packaged, "node_modules/child/node_modules/driver/index.js"),
      "utf8",
    ),
    "nested driver",
  );
  assert.equal(
    fs.existsSync(path.join(packaged, "node_modules/chainlesschain")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(packaged, "node_modules/.package-lock.json")),
    false,
  );
  write(
    "install/node_modules/chainlesschain/node_modules/driver/index.js",
    "conflicting driver",
  );
  assert.throws(
    () =>
      stageInstalledCli(
        path.join(root, "install"),
        path.join(root, "other-stage"),
      ),
    /ambiguous dependency flattening/,
  );
});

test("workflow publishes only a successful verified artifact and cannot auto-push", () => {
  const workflow = fs.readFileSync(
    new URL("../workflows/android-cli-bundle-refresh.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /name: cc-cli-tgz/u);
  assert.doesNotMatch(
    workflow,
    /contents: write|git push|npm publish|always\(\)|node-runtime-bundle/u,
  );
});
