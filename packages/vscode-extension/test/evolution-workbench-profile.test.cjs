"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PROFILE_SCHEMA,
  readWorkbenchProfile,
  createWorkbenchProfileManager,
} = require("../src/evolution-workbench-profile.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-workbench-profile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profilePath = path.join(root, "profile.json");
  const value = {
    schema: PROFILE_SCHEMA,
    mode: "local-test",
    cliPath: path.join(root, "cc.js"),
    cwd: path.join(root, "workspace"),
    stateDirectory: path.join(root, "app-server"),
    env: {
      CHAINLESSCHAIN_HOME: path.join(root, "state"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "anchor"),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: path.join(
        root,
        "descriptor.json",
      ),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: path.join(
        root,
        "public.pem",
      ),
    },
  };
  const write = () => fs.writeFileSync(profilePath, JSON.stringify(value));
  write();
  return { value, profilePath, write };
}

test("profile rejects partial deployment, relative paths, arbitrary environment injection and invalid JSON", (t) => {
  const h = fixture(t);
  assert.equal(readWorkbenchProfile(h.profilePath).mode, "local-test");
  h.value.env.NODE_OPTIONS = "--require attacker.cjs";
  h.write();
  assert.throws(() => readWorkbenchProfile(h.profilePath), /Invalid/);
  delete h.value.env.NODE_OPTIONS;
  const trustRoot = h.value.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  delete h.value.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  h.write();
  assert.throws(() => readWorkbenchProfile(h.profilePath), /Invalid/);
  h.value.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT = trustRoot;
  h.value.cwd = "relative";
  h.write();
  assert.throws(() => readWorkbenchProfile(h.profilePath), /absolute/);
  fs.writeFileSync(h.profilePath, "{");
  assert.throws(() => readWorkbenchProfile(h.profilePath), SyntaxError);
});

test("profile uses a separate process, reuses unchanged configuration and closes on switch/disposal", async (t) => {
  const h = fixture(t);
  const processes = [];
  class Pilot {
    constructor(options) {
      this.options = options;
      this.closed = 0;
      processes.push(this);
    }
    async close() {
      this.closed++;
    }
  }
  const manager = createWorkbenchProfileManager({ Pilot });
  const envBefore = { ...process.env };
  const first = await manager.get(h.profilePath);
  assert.equal(first.workbenchMode, "local-test");
  assert.equal(first.options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(await manager.get(h.profilePath), first);
  h.value.stateDirectory += "-other";
  h.write();
  const second = await manager.get(h.profilePath);
  assert.notEqual(second, first);
  assert.equal(first.closed, 1);
  assert.deepEqual({ ...process.env }, envBefore);
  await manager.close();
  assert.equal(second.closed, 1);
  assert.equal(processes.length, 2);
});
