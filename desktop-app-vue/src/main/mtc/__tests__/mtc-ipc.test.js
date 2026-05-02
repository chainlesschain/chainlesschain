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
  readFederationGovernanceFromDisk,
  readFederationSyncStatsFromDisk,
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

describe("mtc-ipc — readFederationGovernanceFromDisk", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-gov-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty federations list for missing dir", () => {
    const r = readFederationGovernanceFromDisk(path.join(tmpDir, "nope"));
    expect(r).toEqual({ federations: [] });
  });

  it("returns empty federations list for empty dir", () => {
    const r = readFederationGovernanceFromDisk(tmpDir);
    expect(r).toEqual({ federations: [] });
  });

  it("parses jsonl + replays state per federation", () => {
    // Hand-crafted unsigned event — replayGovernanceLog doesn't verify
    // signatures, so we can skip key generation here. Signature
    // round-tripping is covered in core-mtc's own unit tests.
    const create = {
      schema: "mtc-federation-governance/v1",
      fed_id: "fed-x",
      event_type: "create",
      event_id: "00000000-0000-0000-0000-000000000001",
      issued_at: new Date().toISOString(),
      actor_member_id: "alice",
      payload: {
        bootstrap_member_id: "alice",
        bootstrap_pubkey_id: "sha256:alice-pk",
        initial_threshold: 1,
      },
      signature: { alg: "Ed25519", key_id: "sha256:alice-pk", value: "x" },
    };
    fs.writeFileSync(
      path.join(tmpDir, "fed-x.jsonl"),
      JSON.stringify(create) + "\n",
    );

    const r = readFederationGovernanceFromDisk(tmpDir);
    expect(r.federations).toHaveLength(1);
    expect(r.federations[0].fed_id).toBe("fed-x");
    expect(r.federations[0].events_count).toBe(1);
    expect(r.federations[0].state.members).toHaveLength(1);
    expect(r.federations[0].state.members[0].member_id).toBe("alice");
  });

  it("survives malformed jsonl lines", () => {
    fs.writeFileSync(
      path.join(tmpDir, "fed-broken.jsonl"),
      ["{ broken", '{"event_id":"a"}', "another broken"].join("\n"),
    );
    const r = readFederationGovernanceFromDisk(tmpDir);
    expect(r.federations).toHaveLength(1);
    expect(r.federations[0].fed_id).toBe("fed-broken");
    expect(r.federations[0].events_count).toBe(1); // only the valid one
  });
});

describe("mtc-ipc — readFederationSyncStatsFromDisk (v0.10)", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtc-ipc-syncstats-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list for missing dir", () => {
    expect(readFederationSyncStatsFromDisk(path.join(tmpDir, "nope"))).toEqual({
      federations: [],
    });
  });

  it("parses sync-stats.json files written by daemons", () => {
    fs.writeFileSync(
      path.join(tmpDir, "fed-a.sync-stats.json"),
      JSON.stringify({
        federation_id: "fed-a",
        mode: "filesystem",
        last_tick_at: "2026-05-03T10:00:00Z",
        publish: { last_published: 2, total_published: 17 },
        pull: {
          last_appended: 1,
          total_appended: 5,
          last_invalid: 0,
          last_unknown: 0,
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "fed-b.sync-stats.json"),
      JSON.stringify({
        federation_id: "fed-b",
        mode: "libp2p",
        last_tick_at: "2026-05-03T10:01:00Z",
        publish: { last_published: 0, total_published: 3 },
        libp2p: { wire_received: 4, wire_appended: 2 },
      }),
    );

    const r = readFederationSyncStatsFromDisk(tmpDir);
    expect(r.federations).toHaveLength(2);
    const a = r.federations.find((f) => f.fed_id === "fed-a");
    expect(a.mode).toBe("filesystem");
    expect(a.publish.total_published).toBe(17);
    const b = r.federations.find((f) => f.fed_id === "fed-b");
    expect(b.mode).toBe("libp2p");
    expect(b.libp2p.wire_received).toBe(4);
  });

  it("ignores non-sync-stats files in the same dir", () => {
    fs.writeFileSync(path.join(tmpDir, "fed-x.jsonl"), "");
    fs.writeFileSync(path.join(tmpDir, "fed-x.libp2p-pos.json"), "[]");
    fs.writeFileSync(
      path.join(tmpDir, "fed-x.sync-stats.json"),
      JSON.stringify({
        mode: "filesystem",
        last_tick_at: "2026-05-03T10:00:00Z",
      }),
    );
    const r = readFederationSyncStatsFromDisk(tmpDir);
    expect(r.federations).toHaveLength(1);
    expect(r.federations[0].fed_id).toBe("fed-x");
  });

  it("survives malformed json with PARSE_ERROR entry", () => {
    fs.writeFileSync(
      path.join(tmpDir, "fed-broken.sync-stats.json"),
      "{ broken",
    );
    const r = readFederationSyncStatsFromDisk(tmpDir);
    expect(r.federations).toHaveLength(1);
    expect(r.federations[0].available).toBe(false);
    expect(r.federations[0].error).toBe("PARSE_ERROR");
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

  it("registers all 6 channels", () => {
    registerMtcIPC({ ipcMain: fakeIpcMain, configDir: tmpDir });
    expect(handlers.has("mtc:get-audit-status")).toBe(true);
    expect(handlers.has("mtc:get-active-alg")).toBe(true);
    expect(handlers.has("mtc:verify-envelope")).toBe(true);
    expect(handlers.has("mtc:get-bridge-status")).toBe(true);
    expect(handlers.has("mtc:get-federation-governance")).toBe(true);
    expect(handlers.has("mtc:get-federation-sync-stats")).toBe(true);
  });

  it("get-federation-sync-stats returns empty list on empty dir", async () => {
    registerMtcIPC({
      ipcMain: fakeIpcMain,
      configDir: tmpDir,
      governanceDir: path.join(tmpDir, "gov-empty"),
    });
    const r = await handlers.get("mtc:get-federation-sync-stats")();
    expect(r).toEqual({ federations: [] });
  });

  it("get-federation-governance returns empty list on empty dir", async () => {
    registerMtcIPC({
      ipcMain: fakeIpcMain,
      configDir: tmpDir,
      governanceDir: path.join(tmpDir, "gov-empty"),
    });
    const r = await handlers.get("mtc:get-federation-governance")();
    expect(r).toEqual({ federations: [] });
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
