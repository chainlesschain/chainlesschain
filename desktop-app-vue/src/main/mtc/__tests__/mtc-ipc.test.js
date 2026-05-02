/**
 * Unit tests for the MTC IPC handlers (Phase 4.2).
 *
 * The handlers themselves register to electron's ipcMain — we don't spin up
 * Electron here, so we exercise:
 *   1. The exported pure helpers (readStatusFromDisk / detectActiveAlg /
 *      verifyEnvelopeInProcess) directly against tmp dirs.
 *   2. The registration path with a fake ipcMain to confirm channel names
 *      and that the handlers return the right shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

// mtc-ipc.js is CommonJS (main process) — load via createRequire so this
// ESM test file can interoperate.
const cjsRequire = createRequire(import.meta.url);
const {
  registerMtcIPC,
  readStatusFromDisk,
  readBridgeStatusFromDisk,
  detectActiveAlg,
  verifyEnvelopeInProcess,
  STATUS_DEFAULTS,
  BRIDGE_STATUS_DEFAULTS,
} = cjsRequire("../mtc-ipc.js");

describe("mtc-ipc — readStatusFromDisk", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-status-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns full default shape when audit-mtc dir does not exist", () => {
    const r = readStatusFromDisk(path.join(tmpDir, "nope"));
    expect(r).toEqual(STATUS_DEFAULTS);
  });

  it("merges config.json onto defaults", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        enabled: true,
        batch_interval_seconds: 60,
        namespace_prefix: "mtc/v1/audit/test",
        issuer: "mtca:cc:test",
      }),
    );
    const r = readStatusFromDisk(tmpDir);
    expect(r.config.enabled).toBe(true);
    expect(r.config.batch_interval_seconds).toBe(60);
    expect(r.config.namespace_prefix).toBe("mtc/v1/audit/test");
  });

  it("counts staging events and finds oldest queued_at", () => {
    fs.mkdirSync(path.join(tmpDir, "staging"));
    const ev = (id, qa) =>
      JSON.stringify({
        schema: "audit-event/v1",
        event_id: id,
        queued_at: qa,
      });
    fs.writeFileSync(
      path.join(tmpDir, "staging", "20260501100000-aaa.json"),
      ev("20260501100000-aaa", "2026-05-01T10:00:00Z"),
    );
    fs.writeFileSync(
      path.join(tmpDir, "staging", "20260501090000-bbb.json"),
      ev("20260501090000-bbb", "2026-05-01T09:00:00Z"),
    );
    fs.writeFileSync(
      path.join(tmpDir, "staging", "20260501110000-ccc.json"),
      ev("20260501110000-ccc", "2026-05-01T11:00:00Z"),
    );

    const r = readStatusFromDisk(tmpDir);
    expect(r.staging.count).toBe(3);
    expect(r.staging.malformed).toBe(0);
    expect(r.staging.oldest_queued_at).toBe("2026-05-01T09:00:00Z");
  });

  it("counts malformed staging entries", () => {
    fs.mkdirSync(path.join(tmpDir, "staging"));
    fs.writeFileSync(path.join(tmpDir, "staging", "broken.json"), "{ not json");
    fs.writeFileSync(
      path.join(tmpDir, "staging", "wrong-schema.json"),
      JSON.stringify({ schema: "wrong/v1" }),
    );

    const r = readStatusFromDisk(tmpDir);
    expect(r.staging.count).toBe(2);
    expect(r.staging.malformed).toBe(2);
  });

  it("reads last manifest from batches/", () => {
    const batchDir = path.join(tmpDir, "batches", "000003");
    fs.mkdirSync(batchDir, { recursive: true });
    fs.writeFileSync(
      path.join(batchDir, "manifest.json"),
      JSON.stringify({
        batch_id: "000003",
        tree_size: 12,
        tree_head_id: "sha256:def",
        closed_at: "2026-05-01T11:30:00Z",
      }),
    );
    // earlier batches
    fs.mkdirSync(path.join(tmpDir, "batches", "000001"));
    fs.mkdirSync(path.join(tmpDir, "batches", "000002"));

    const r = readStatusFromDisk(tmpDir);
    expect(r.batches.count).toBe(3);
    expect(r.batches.last_batch_id).toBe("000003");
    expect(r.batches.last_tree_size).toBe(12);
    expect(r.batches.last_tree_head_id).toBe("sha256:def");
    expect(r.batches.last_closed_at).toBe("2026-05-01T11:30:00Z");
  });
});

describe("mtc-ipc — detectActiveAlg", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-alg-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no batches exist", () => {
    expect(detectActiveAlg(tmpDir)).toBeNull();
  });

  it("recognizes Ed25519 from last batch landmark", () => {
    const dir = path.join(tmpDir, "batches", "000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "landmark.json"),
      JSON.stringify({
        snapshots: [{ signature: { alg: "Ed25519" } }],
      }),
    );
    expect(detectActiveAlg(tmpDir)).toBe("ed25519");
  });

  it("recognizes SLH-DSA from last batch landmark", () => {
    const dir = path.join(tmpDir, "batches", "000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "landmark.json"),
      JSON.stringify({
        snapshots: [{ signature: { alg: "SLH-DSA-SHA2-128F" } }],
      }),
    );
    expect(detectActiveAlg(tmpDir)).toBe("slh-dsa-128f");
  });

  it("returns null on malformed landmark", () => {
    const dir = path.join(tmpDir, "batches", "000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "landmark.json"), "{ broken");
    expect(detectActiveAlg(tmpDir)).toBeNull();
  });
});

describe("mtc-ipc — verifyEnvelopeInProcess", () => {
  // Round-trip Ed25519/SLH-DSA crypto is covered in core-mtc's own tests
  // (packages/core-mtc/__tests__/batch.test.js + slh-dsa-signer.test.js).
  // Here we lock down the IPC layer's contract: malformed inputs return
  // structured error shapes, valid inputs return the result object.
  it("throws on malformed landmark — IPC handler catches and surfaces VERIFY_THREW", () => {
    // The IPC handler wraps this call in try/catch (VERIFY_THREW arm).
    // Direct invocation surfaces the throw — that's the plumbing we test
    // (the IPC's "verify-envelope returns VERIFY_THREW" assertion below).
    expect(() => verifyEnvelopeInProcess({}, {})).toThrow();
  });
});

describe("mtc-ipc — readBridgeStatusFromDisk", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-bridge-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when dir does not exist", () => {
    const r = readBridgeStatusFromDisk(path.join(tmpDir, "nope"));
    expect(r).toEqual(BRIDGE_STATUS_DEFAULTS);
  });

  it("reads enabled config from disk", () => {
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        enabled: true,
        mode: "federated",
        alg: "slh-dsa-128f",
        batch_interval_seconds: 600,
      }),
    );
    const r = readBridgeStatusFromDisk(tmpDir);
    expect(r.config.enabled).toBe(true);
    expect(r.config.mode).toBe("federated");
    expect(r.config.alg).toBe("slh-dsa-128f");
    expect(r.config.batch_interval_seconds).toBe(600);
  });

  it("counts trust anchors per chain", () => {
    fs.writeFileSync(
      path.join(tmpDir, "trust-anchors.json"),
      JSON.stringify({
        schema: "mtc-bridge-trust-anchors/v1",
        anchors: {
          ethereum: [
            { pubkey_id: "sha256:e1", alg: "ed25519", issuer: "x" },
            { pubkey_id: "sha256:e2", alg: "ed25519", issuer: "y" },
          ],
          polygon: [
            { pubkey_id: "sha256:p1", alg: "slh-dsa-128f", issuer: "z" },
          ],
        },
      }),
    );
    const r = readBridgeStatusFromDisk(tmpDir);
    expect(r.trust_anchors.chain_count).toBe(2);
    expect(r.trust_anchors.total).toBe(3);
    expect(r.trust_anchors.by_chain.ethereum).toBe(2);
    expect(r.trust_anchors.by_chain.polygon).toBe(1);
  });

  it("counts staged ops + reports latest batch", () => {
    fs.mkdirSync(path.join(tmpDir, "staging"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "staging", "a.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "staging", "b.json"), "{}");
    fs.mkdirSync(path.join(tmpDir, "batches", "ethereum-polygon-000001"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, "batches", "ethereum-polygon-000002"), {
      recursive: true,
    });
    const r = readBridgeStatusFromDisk(tmpDir);
    expect(r.staging.pending).toBe(2);
    expect(r.batches.total).toBe(2);
    expect(r.batches.latest).toBe("ethereum-polygon-000002");
  });

  it("survives malformed config json", () => {
    fs.writeFileSync(path.join(tmpDir, "config.json"), "not json");
    const r = readBridgeStatusFromDisk(tmpDir);
    expect(r.config.enabled).toBe(false); // defaults
  });
});

describe("mtc-ipc — registerMtcIPC", () => {
  let tmpDir;
  let handlers;
  let fakeIpcMain;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-reg-"));
    handlers = new Map();
    fakeIpcMain = {
      handle(channel, fn) {
        handlers.set(channel, fn);
      },
    };
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers all 4 channels", () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    expect(handlers.has("mtc:get-audit-status")).toBe(true);
    expect(handlers.has("mtc:get-active-alg")).toBe(true);
    expect(handlers.has("mtc:verify-envelope")).toBe(true);
    expect(handlers.has("mtc:get-bridge-status")).toBe(true);
  });

  it("get-bridge-status returns default shape on empty dir", async () => {
    registerMtcIPC({
      ipcMain: fakeIpcMain,
      configDir: tmpDir,
      bridgeConfigDir: path.join(tmpDir, "bridge"),
    });
    const r = await handlers.get("mtc:get-bridge-status")();
    expect(r.config.enabled).toBe(false);
    expect(r.config.mode).toBe("independent");
    expect(r.staging.pending).toBe(0);
    expect(r.batches.total).toBe(0);
  });

  it("get-audit-status returns default shape on empty dir", async () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    const r = await handlers.get("mtc:get-audit-status")();
    expect(r.config.enabled).toBe(false);
    expect(r.staging.count).toBe(0);
  });

  it("get-active-alg defaults to ed25519 with no batches", async () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    expect(await handlers.get("mtc:get-active-alg")()).toBe("ed25519");
  });

  it("verify-envelope returns MISSING_INPUT on null inputs", async () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    const r = await handlers.get("mtc:verify-envelope")({}, null, null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MISSING_INPUT");
  });

  it("verify-envelope returns VERIFY_THREW shape on garbage inputs", async () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    const r = await handlers.get("mtc:verify-envelope")(
      {},
      { not: "an envelope" },
      { also: "not a landmark" },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("VERIFY_THREW");
  });
});
