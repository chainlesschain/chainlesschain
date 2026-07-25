"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { QQPcAdapter } = require("../../lib/adapters/qq-pc");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const SCOPE = "account:qq-pc:resolved-ingest";
const MESSAGE_ID = "9007199254740993123";
const CANONICAL_ORIGINAL_ID = `c2c_msg_table:${MESSAGE_ID}`;

function directRaw() {
  return {
    adapter: "qq-pc",
    kind: "message",
    originalId: `qq-pc:message:${MESSAGE_ID}`,
    canonicalOriginalId: CANONICAL_ORIGINAL_ID,
    producer: "qq-pc/direct",
    capturedAt: 1_750_000_000_000,
    payload: {
      kind: "message",
      tableName: "c2c_msg_table",
      messageId: MESSAGE_ID,
      sequence: "73",
      peerUin: "222",
      peerUid: "u_peer",
      senderUid: "u_sender",
      senderUin: "111",
      isGroup: false,
      createdTimeMs: 1_750_000_000_000,
      text: "",
      rawRow: {
        40001: MESSAGE_ID,
        40003: "73",
        40800: { type: "Buffer", data: [10, 4, 116, 101, 115, 116] },
      },
      observationProducer: "qq-pc/direct",
    },
  };
}

function sidecarRaw() {
  return {
    adapter: "qq-pc",
    kind: "message",
    originalId: "qq-pc:c2c:111:73",
    canonicalOriginalId: CANONICAL_ORIGINAL_ID,
    producer: "qq-pc/sidecar",
    capturedAt: 1_750_000_001_000,
    payload: {
      kind: "message",
      tableName: "c2c_msg_table",
      messageId: MESSAGE_ID,
      sequence: "73",
      peerUin: "222",
      peerUid: "u_peer",
      senderUid: "u_sender",
      senderUin: "111",
      senderName: "Alice",
      isGroup: false,
      createdTimeMs: 1_750_000_000_000,
      text: "decoded sidecar text",
      readState: 1,
      observationProducer: "qq-pc/sidecar",
    },
  };
}

let tmpDir;
let vault;

function openVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-resolved-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

describe("QQPcAdapter resolved ingest", () => {
  it("merges direct and sidecar evidence while retaining both raw observations", async () => {
    openVault();
    const adapter = new QQPcAdapter();
    adapter.defaultScope = SCOPE;
    adapter.authenticate = async () => ({ ok: true });
    let pendingRaw = directRaw();
    adapter.sync = async function* syncOneObservation() {
      yield pendingRaw;
    };
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const directReport = await registry.syncAdapter(adapter.name);
    pendingRaw = sidecarRaw();
    const sidecarReport = await registry.syncAdapter(adapter.name);

    expect(directReport).toMatchObject({
      status: "ok",
      entityCounts: { events: 1 },
      resolvedConflictCount: 0,
      sourceAliasCount: 1,
      rawObservationCount: 1,
    });
    expect(sidecarReport).toMatchObject({
      status: "ok",
      entityCounts: { events: 1 },
      resolvedConflictCount: 1,
      sourceAliasCount: 1,
      rawObservationCount: 1,
    });

    const events = vault.queryEvents({ adapter: "qq-pc", limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      content: {
        title: "decoded sidecar text",
        text: "decoded sidecar text",
      },
      source: {
        adapter: "qq-pc",
        scope: SCOPE,
        originalId: CANONICAL_ORIGINAL_ID,
      },
      extra: {
        messageId: MESSAGE_ID,
        readState: 1,
        textResolved: true,
        observationProducers: ["qq-pc/direct", "qq-pc/sidecar"],
        rawRow: expect.objectContaining({ 40001: MESSAGE_ID }),
      },
    });

    expect(
      vault
        .queryRawObservations({
          adapter: "qq-pc",
          scope: SCOPE,
          canonicalOriginalId: CANONICAL_ORIGINAL_ID,
        })
        .map((observation) => observation.producer)
        .sort(),
    ).toEqual(["qq-pc/direct", "qq-pc/sidecar"]);
    expect(
      vault
        .queryRawEvents({ adapter: "qq-pc", scope: SCOPE, limit: 10 })
        .map((raw) => raw.originalId)
        .sort(),
    ).toEqual([`qq-pc:message:${MESSAGE_ID}`, "qq-pc:c2c:111:73"].sort());
    expect(vault.stats()).toMatchObject({
      events: 1,
      sourceIdentityAliases: 2,
      rawObservations: 2,
    });
  });

  it("rekeys a pre-upgrade legacy event instead of duplicating it", async () => {
    openVault();
    const legacyOriginalId = `qq-pc:message:${MESSAGE_ID}`;
    vault.putEvent({
      id: "event-pre-upgrade",
      type: "event",
      subtype: "message",
      occurredAt: 1_750_000_000_000,
      content: { title: "(待解析消息体)", text: "" },
      ingestedAt: 1_750_000_000_000,
      source: {
        adapter: "qq-pc",
        adapterVersion: "0.1.0",
        scope: SCOPE,
        originalId: legacyOriginalId,
        capturedAt: 1_750_000_000_000,
        capturedBy: "sqlite",
      },
      extra: {
        platform: "qq",
        source: "pc-nt",
        messageId: MESSAGE_ID,
        textResolved: false,
        observationProducer: "qq-pc/direct",
      },
    });

    const adapter = new QQPcAdapter();
    adapter.defaultScope = SCOPE;
    adapter.authenticate = async () => ({ ok: true });
    const upgradedDirectRaw = directRaw();
    upgradedDirectRaw.payload.text = "decoded direct text";
    adapter.sync = async function* syncDecodedObservation() {
      yield upgradedDirectRaw;
    };
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("ok");
    expect(report.resolvedConflictCount).toBe(1);
    expect(vault.stats().events).toBe(1);
    expect(vault.getEvent("event-pre-upgrade")).toMatchObject({
      content: { text: "decoded direct text" },
      source: { originalId: CANONICAL_ORIGINAL_ID },
    });
  });
});
