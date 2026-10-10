import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  verifyPrivateV4DependencyManifest as verify,
  readPrivateV4DependencyFile as read,
} from "../scripts/windows-node-private-v4-dependencies.mjs";

const options = { workspaceRoots: ["packages/cli", "packages/shared-logger"] };
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const row = (name, text = "export default 1;\n") => ({
  path: name,
  bytes: Buffer.byteLength(text),
  digest: digest(text),
});
function fixture(
  t,
  relative = "node_modules/one/index.js",
  text = "export default 1;\n",
) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-v4-dependencies-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const descriptor = row(relative, text);
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return { root, descriptor, target };
}
for (const name of [
  "node_modules/one/index.js",
  "node_modules/@scope/one/index.js",
  "packages/cli/node_modules/one/index.js",
  "packages/shared-logger/node_modules/@scope/one/index.js",
  "node_modules/one/node_modules/two/index.js",
])
  test(`reads authorized package file ${name}`, (t) => {
    const f = fixture(t, name);
    const manifest = verify({ files: [f.descriptor] }, options);
    assert.equal(manifest.fileCount, 1);
    assert.equal(manifest.totalBytes, f.descriptor.bytes);
    assert.equal(
      read(f.root, f.descriptor, options).toString(),
      "export default 1;\n",
    );
  });
test("empty package file is verified by its real empty SHA256", (t) => {
  const f = fixture(t, "node_modules/one/lib/.gitkeep", "");
  assert.equal(verify({ files: [f.descriptor] }, options).totalBytes, 0);
  assert.equal(read(f.root, f.descriptor, options).length, 0);
  assert.throws(
    () =>
      read(f.root, { ...f.descriptor, digest: digest("not empty") }, options),
    /bytes differ/u,
  );
  assert.throws(() => verify({ files: [] }, options), /nonempty/u);
});
for (const name of [
  "../control/node.exe",
  "node_modules/one/../../control/node.exe",
  "/node_modules/one/index.js",
  "C:/node_modules/one/index.js",
  "node_modules\\one\\index.js",
  "node_modules//one/index.js",
  "node_modules/one/./index.js",
  "node_modules/one/CON.txt",
  "node_modules/one/COM1",
  "node_modules/one/CONIN$",
  "node_modules/one/CLOCK$",
  "node_modules/one/lpt².log",
  "node_modules/one/trailing. ",
  "node_modules/one/alternate:stream",
  "node_modules/one/control\u0000.js",
  "node_modules/one/wild*.js",
  "node_modules/one",
  "node_modules/@scope/one",
  "node_modules/.bin/one",
  "packages/not-authorized/node_modules/one/index.js",
  "packages/cli/src/index.js",
  "control/node_modules/one/index.js",
])
  test(`rejects unauthorized or unsafe dependency path ${JSON.stringify(name)}`, () => {
    assert.throws(() =>
      verify(
        { files: [row(name)], workspaceRoots: ["packages/not-authorized"] },
        options,
      ),
    );
  });
test("manifest cannot grant itself a workspace namespace", () => {
  assert.throws(
    () =>
      verify(
        {
          workspaceRoots: ["packages/other"],
          files: [row("packages/other/node_modules/one/index.js")],
        },
        options,
      ),
    /outside authorized/u,
  );
  assert.throws(
    () => verify({ files: [row("node_modules/one/index.js")] }),
    /trusted workspace/u,
  );
});
test("case aliases and file-directory collisions are rejected", () => {
  assert.throws(
    () =>
      verify(
        {
          files: [
            row("node_modules/one/index.js"),
            row("node_modules/ONE/INDEX.js"),
          ],
        },
        options,
      ),
    /case-aliased/u,
  );
  assert.throws(
    () =>
      verify(
        {
          files: [
            row("node_modules/one/file"),
            row("node_modules/one/file/child"),
          ],
        },
        options,
      ),
    /collides/u,
  );
});
for (const change of [
  { bytes: -1 },
  { bytes: 0.5 },
  { bytes: 128 * 1024 * 1024 + 1 },
  { digest: "sha256:bad" },
])
  test(`rejects invalid descriptor ${JSON.stringify(change)}`, () => {
    assert.throws(() =>
      verify(
        { files: [{ ...row("node_modules/one/index.js"), ...change }] },
        options,
      ),
    );
  });
test("extra bytes cannot masquerade as a valid empty dependency", (t) => {
  const f = fixture(t, "node_modules/one/empty", "");
  fs.writeFileSync(f.target, "extra");
  assert.throws(() => read(f.root, f.descriptor, options), /exact size/u);
});
test("same-sized wrong content fails the pinned digest", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.target, "export default 2;\n");
  assert.throws(() => read(f.root, f.descriptor, options), /bytes differ/u);
});
test("hardlinked source file is rejected", (t) => {
  const f = fixture(t);
  fs.linkSync(f.target, path.join(f.root, "second-link"));
  assert.throws(() => read(f.root, f.descriptor, options), /plain file/u);
});
test("directory substituted for package file is rejected", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.target);
  fs.mkdirSync(f.target);
  assert.throws(() => read(f.root, f.descriptor, options), /plain file/u);
});
test("junction or symlink package parent cannot escape artifact tree", (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  fs.renameSync(f.target, path.join(outside, "index.js"));
  fs.rmdirSync(path.dirname(f.target));
  fs.symlinkSync(
    outside,
    path.dirname(f.target),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => read(f.root, f.descriptor, options), /plain parent/u);
});
test("aliased artifact tree is rejected", (t) => {
  const f = fixture(t);
  const alias = path.join(f.root, "alias");
  fs.symlinkSync(
    path.join(f.root, "node_modules"),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => read(alias, f.descriptor, options));
});
test("concurrent content change during descriptor read is rejected", (t) => {
  const f = fixture(t);
  const original = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    if (!changed) {
      changed = true;
      fs.appendFileSync(f.target, "unexpected extra bytes");
    }
    return original(...args);
  });
  assert.throws(
    () => read(f.root, f.descriptor, options),
    /changed during read/u,
  );
});
test("parent namespace change during read is rejected", (t) => {
  const f = fixture(t);
  const original = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    if (!changed) {
      changed = true;
      fs.utimesSync(path.dirname(f.target), new Date(1), new Date(1));
    }
    return original(...args);
  });
  assert.throws(
    () => read(f.root, f.descriptor, options),
    /parent directory changed/u,
  );
});
