import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const temporaryRoot = fs.realpathSync.native(os.tmpdir());
const roots = [];
const installerSource = fs.readFileSync(
  new URL("../install-electron.cjs", import.meta.url),
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(temporaryRoot, "cc-electron-install-"));
  roots.push(root);
  const workspace = path.join(root, "desktop-app-vue");
  const script = path.join(workspace, "scripts", "install-electron.cjs");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, installerSource);
  return { root, workspace, script };
}

function run(script, cwd) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
  });
}

for (const layout of ["hoisted", "workspace"]) {
  test(`installs Electron from the ${layout} dependency without shell operators`, () => {
    const { root, workspace, script } = fixture();
    const dependencyRoot = layout === "hoisted" ? root : workspace;
    const electron = path.join(dependencyRoot, "node_modules", "electron");
    const marker = path.join(root, "installed.json");
    fs.mkdirSync(electron, { recursive: true });
    fs.writeFileSync(
      path.join(electron, "package.json"),
      '{"name":"electron"}',
    );
    fs.writeFileSync(
      path.join(electron, "install.js"),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({executable:process.execPath}));`,
    );
    const result = run(script, workspace);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(
      JSON.parse(fs.readFileSync(marker, "utf8")).executable,
      process.execPath,
    );
  });
}

test("keeps optional runtime installation nonfatal when Electron is not installed", () => {
  const { workspace, script } = fixture();
  const result = run(script, workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /installer is unavailable/);
});

test("reports a failed installer while retaining the existing best-effort lifecycle contract", () => {
  const { root, workspace, script } = fixture();
  const electron = path.join(root, "node_modules", "electron");
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, "package.json"), '{"name":"electron"}');
  fs.writeFileSync(path.join(electron, "install.js"), "process.exit(17);");
  const result = run(script, workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /installation did not complete \(17\)/);
});

test("the desktop lifecycle uses the portable installer", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.scripts.postinstall,
    "node scripts/install-electron.cjs",
  );
});
