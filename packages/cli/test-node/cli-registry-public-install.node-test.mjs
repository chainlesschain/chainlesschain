import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyCliRegistryInstall } from "../scripts/verify-cli-registry-install.mjs";

const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-public-cli-lock-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = {
    name: "chainlesschain",
    version: "0.166.90",
    dependencies: {
      "@chainlesschain/core-db": "0.1.5",
      "@chainlesschain/session-core": "0.3.13",
    },
  };
  write(path.join(root, "node_modules/chainlesschain/package.json"), expected);
  const lock = { lockfileVersion: 3, packages: {} };
  for (const [name, version] of Object.entries(expected.dependencies)) {
    const relative = `node_modules/${name}`;
    write(path.join(root, relative, "package.json"), {
      name,
      version,
      main: "index.js",
    });
    fs.writeFileSync(
      path.join(root, relative, "index.js"),
      "module.exports = {};\n",
    );
    lock.packages[relative] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${version}.tgz`,
      integrity,
    };
  }
  const save = () => write(path.join(root, "package-lock.json"), lock);
  const pinPublic = () => {
    expected.dist = {
      tarball:
        "https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.90.tgz",
      integrity,
    };
    lock.packages["node_modules/chainlesschain"] = {
      version: expected.version,
      resolved: expected.dist.tarball,
      integrity,
    };
    save();
  };
  save();
  return { root, expected, lock, save, pinPublic };
}

test("local candidates stay local while exact public registry manifests bind the CLI itself", (t) => {
  const f = fixture(t);
  assert.equal(
    verifyCliRegistryInstall(f.root, f.expected).cliSource,
    "immutable-candidate-tarball",
  );
  f.pinPublic();
  const report = verifyCliRegistryInstall(f.root, f.expected);
  assert.equal(report.cliSource, "public-npm-registry-lock");
  assert.deepEqual(report.cliArchive, {
    resolved: f.expected.dist.tarball,
    integrity,
  });
  assert.equal(report.children.length, 2);
});

test("matching installed package names cannot hide a substituted public CLI archive", (t) => {
  for (const [key, value] of [
    ["resolved", "file:../chainlesschain.tgz"],
    ["resolved", "https://registry.npmmirror.com/chainlesschain/-/cli.tgz"],
    [
      "resolved",
      "https://registry.npmjs.org.evil.test/chainlesschain/-/cli.tgz",
    ],
    ["resolved", "https://registry.npmjs.org/chainlesschain/-/older.tgz"],
    ["integrity", `sha512-${Buffer.alloc(64, 8).toString("base64")}`],
    ["integrity", "sha512-YQ=="],
    ["link", true],
    ["version", "0.166.89"],
  ]) {
    const f = fixture(t);
    f.pinPublic();
    f.lock.packages["node_modules/chainlesschain"][key] = value;
    f.save();
    assert.throws(
      () => verifyCliRegistryInstall(f.root, f.expected),
      /public CLI archive/,
    );
  }
});

test("public mode rejects absent lock entries and untrusted metadata without falling back to local", (t) => {
  const f = fixture(t);
  f.pinPublic();
  delete f.lock.packages["node_modules/chainlesschain"];
  f.save();
  assert.throws(
    () => verifyCliRegistryInstall(f.root, f.expected),
    /public CLI archive/,
  );
  for (const dist of [
    null,
    {},
    {
      ...f.expected.dist,
      tarball:
        "https://user:private@registry.npmjs.org/chainlesschain/-/cli.tgz",
    },
    { ...f.expected.dist, tarball: f.expected.dist.tarball + "?token=private" },
    { ...f.expected.dist, tarball: f.expected.dist.tarball + "#fragment" },
    { ...f.expected.dist, integrity: "sha512-YQ==" },
  ]) {
    assert.throws(
      () => verifyCliRegistryInstall(f.root, { ...f.expected, dist }),
      /expected public CLI archive/,
    );
  }
});
