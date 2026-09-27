import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { verifyIdeCliPrerequisite } from "../verify-ide-cli-prerequisite.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
function fixture(t) {
  const temp = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, "cc-ide-prerequisite-test-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync.native(root)), temp);
    assert.ok(path.basename(root).startsWith("cc-ide-prerequisite-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const expected = {
    name: "chainlesschain",
    version: "0.166.77",
    dependencies: {
      "@chainlesschain/core-db": "0.1.5",
      "@chainlesschain/session-core": "0.3.13",
    },
  };
  const installed = structuredClone(expected);
  const install = path.join(root, "install");
  const cliFile = path.join(
    install,
    "node_modules/chainlesschain/package.json",
  );
  write(cliFile, installed);
  const lock = { lockfileVersion: 3, packages: {} };
  for (const [name, version] of [
    [expected.name, expected.version],
    ...Object.entries(expected.dependencies),
  ]) {
    const key = `node_modules/${name}`;
    if (name !== expected.name) {
      write(path.join(install, key, "package.json"), {
        name,
        version,
        main: "index.js",
      });
      fs.writeFileSync(
        path.join(install, key, "index.js"),
        "module.exports = {};\n",
      );
    }
    lock.packages[key] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
      integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    };
  }
  fs.writeFileSync(path.join(root, "cli-version.txt"), expected.version + "\n");
  write(path.join(root, "agent-capabilities.json"), { protocol_version: 1 });
  const save = () => {
    write(path.join(install, "package-lock.json"), lock);
    write(cliFile, installed);
  };
  save();
  return { root, expected, installed, lock, save };
}

test("accepts a matching public CLI and all exact child pins with runnable probes", (t) => {
  const f = fixture(t);
  const result = verifyIdeCliPrerequisite(f.root, f.expected);
  assert.equal(result.version, "0.166.77");
  assert.equal(result.cliSource, "https://registry.npmjs.org");
  assert.equal(result.children.length, 2);
  assert.equal(result.protocolVersion, 1);
});

for (const resolved of [
  "file:../chainlesschain.tgz",
  "https://registry.npmmirror.com/chainlesschain/-/chainlesschain-0.166.77.tgz",
  "https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.76.tgz",
  "https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.166.77.tgz?local=true",
])
  test(`rejects a CLI that is not the exact public archive: ${resolved}`, (t) => {
    const f = fixture(t);
    f.lock.packages["node_modules/chainlesschain"].resolved = resolved;
    f.save();
    assert.throws(
      () => verifyIdeCliPrerequisite(f.root, f.expected),
      /public npm/,
    );
  });

for (const field of ["version", "integrity", "link", "missing"])
  test(`rejects invalid CLI registry evidence: ${field}`, (t) => {
    const f = fixture(t);
    const entry = f.lock.packages["node_modules/chainlesschain"];
    if (field === "missing")
      delete f.lock.packages["node_modules/chainlesschain"];
    else entry[field] = field === "link" ? true : "invalid";
    f.save();
    assert.throws(
      () => verifyIdeCliPrerequisite(f.root, f.expected),
      /registry lock/,
    );
  });

test("rejects a child that resolves locally even when CLI itself came from npm", (t) => {
  const f = fixture(t);
  f.lock.packages["node_modules/@chainlesschain/core-db"].resolved =
    "file:../core-db.tgz";
  f.save();
  assert.throws(
    () => verifyIdeCliPrerequisite(f.root, f.expected),
    /public npm/,
  );
});

test("rejects a differently paired CLI dependency set", (t) => {
  const f = fixture(t);
  f.installed.dependencies["@chainlesschain/unexpected"] = "1.0.0";
  f.save();
  assert.throws(
    () => verifyIdeCliPrerequisite(f.root, f.expected),
    /child dependencies differ/,
  );
});

test("rejects wrong runtime version and invalid capability output", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "cli-version.txt"), "0.166.76\n");
  assert.throws(
    () => verifyIdeCliPrerequisite(f.root, f.expected),
    /version probe/,
  );
  fs.writeFileSync(path.join(f.root, "cli-version.txt"), f.expected.version);
  for (const value of [
    null,
    {},
    { protocol_version: "1" },
    { protocol_version: 0 },
  ]) {
    write(path.join(f.root, "agent-capabilities.json"), value);
    assert.throws(
      () => verifyIdeCliPrerequisite(f.root, f.expected),
      /capability manifest/,
    );
  }
});

test("standalone verifier fails closed and never overwrites a prior receipt", (t) => {
  const f = fixture(t);
  const manifest = path.join(f.root, "paired.json"),
    output = path.join(f.root, "receipt.json");
  write(manifest, f.expected);
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(repo, "scripts/verify-ide-cli-prerequisite.mjs"),
        f.root,
        manifest,
        output,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  assert.equal(run().status, 0);
  const before = fs.readFileSync(output, "utf8");
  assert.equal(run().status, 1);
  assert.equal(fs.readFileSync(output, "utf8"), before);
});

test("both IDE upload routes require the public CLI check with matching release conditions", () => {
  const workflow = fs
    .readFileSync(
      path.join(repo, ".github/workflows/ide-extensions.yml"),
      "utf8",
    )
    .replaceAll("\r\n", "\n");
  const step = (name) => {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.ok(start >= 0, name);
    const end = workflow.indexOf("\n      - ", start + 1);
    return { start, text: workflow.slice(start, end < 0 ? undefined : end) };
  };
  const condition = (s) =>
    s.text
      .match(/if: >-\s*([\s\S]*?)\n {8}(?:uses|env):/u)?.[1]
      .replace(/\s+/gu, " ")
      .trim();
  for (const [guard, publish] of [
    ["Require published CLI before VS Code release", "Publish to Open VSX"],
    [
      "Require published CLI before JetBrains release",
      "Publish to JetBrains Marketplace",
    ],
  ]) {
    const before = step(guard),
      after = step(publish);
    assert.ok(before.start < after.start);
    assert.match(
      before.text,
      /uses: \.\/\.github\/actions\/verify-published-cli/u,
    );
    assert.ok(condition(before));
    assert.equal(condition(before), condition(after));
    assert.doesNotMatch(before.text, /continue-on-error|always\(\)/u);
  }
  assert.ok(
    step("Require published CLI before VS Code release").start <
      step("Publish to VS Code Marketplace").start,
  );
  const action = fs.readFileSync(
    path.join(repo, ".github/actions/verify-published-cli/action.yml"),
    "utf8",
  );
  assert.match(action, /set -euo pipefail/u);
  assert.match(action, /mktemp -d "\$RUNNER_TEMP\//u);
  assert.match(
    action,
    /--registry=https:\/\/registry\.npmjs\.org "chainlesschain@\$VERSION"/u,
  );
  assert.match(
    action,
    /CHAINLESSCHAIN_SECURITY_ANCHOR_HOME="\$PROBE_ROOT\/security"/u,
  );
  assert.ok(
    action.indexOf("npm install") <
      action.indexOf("scripts/verify-ide-cli-prerequisite.mjs"),
  );
  assert.doesNotMatch(action, /npm publish|continue-on-error/u);
});
