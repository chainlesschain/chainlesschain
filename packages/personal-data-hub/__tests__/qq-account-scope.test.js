"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { QQAdapter } = require("../lib/adapters/messaging-qq");
const { QQPcAdapter } = require("../lib/adapters/qq-pc");
const {
  createQqAccountScope,
  createQqPathScope,
} = require("../lib/qq-source-identity");
const { AdapterRegistry } = require("../lib/registry");

let tmpDir;

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

describe("QQ cross-adapter account scope", () => {
  it("uses one scope for Android snapshots and QQ PC with the same verified UIN", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-scope-"));
    const snapshotPath = path.join(tmpDir, "qq-snapshot.json");
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        account: { qq: "10001" },
        events: [],
      }),
    );
    const registry = new AdapterRegistry({ vault: {} });
    const android = new QQAdapter();
    const pc = new QQPcAdapter({ qqUin: "10001" });
    const expected = createQqAccountScope("10001");

    expect(registry._resolveScope(android, { inputPath: snapshotPath })).toBe(
      expected,
    );
    expect(
      registry._resolveScope(pc, {
        inputPath: path.join(tmpDir, "nt_msg.db"),
        qqUin: "10001",
      }),
    ).toBe(expected);
    expect(registry._resolveScope(pc, { dbPath: "nt_msg.db" })).toBe(expected);
  });

  it("uses a path hash only when QQ PC has no verified account identity", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-path-scope-"));
    const dbPath = path.join(tmpDir, "nt_msg.db");
    const registry = new AdapterRegistry({ vault: {} });
    const pc = new QQPcAdapter();

    const scope = registry._resolveScope(pc, { inputPath: dbPath });

    expect(scope).toBe(createQqPathScope(path.resolve(dbPath)));
    expect(scope).toMatch(/^account:qq-pc-profile:[0-9a-f]{32}$/u);
    expect(scope).not.toContain(tmpDir);
    expect(scope).not.toBe(createQqAccountScope("10001"));
  });
});
