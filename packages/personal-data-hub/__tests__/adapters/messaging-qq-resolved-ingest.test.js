"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { QQAdapter } = require("../../lib/adapters/messaging-qq");
const { QQPcAdapter } = require("../../lib/adapters/qq-pc");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const SCOPE = "account:qq:cross-producer";
const MESSAGE_ID = "9007199254740993123";
const CANONICAL_ORIGINAL_ID = `c2c_msg_table:${MESSAGE_ID}`;

function pcRaw() {
  return {
    adapter: "qq-pc",
    kind: "message",
    originalId: `qq-pc:message:${MESSAGE_ID}`,
    producer: "qq-pc/direct",
    capturedAt: 1_750_000_000_000,
    payload: {
      kind: "message",
      tableName: "c2c_msg_table",
      messageId: MESSAGE_ID,
      sequence: "73",
      isGroup: false,
      createdTimeMs: 1_750_000_000_000,
      text: "",
      readState: 0,
      rawRow: { 40001: MESSAGE_ID, 40003: "73" },
      observationProducer: "qq-pc/direct",
    },
  };
}

function androidRaw() {
  return {
    adapter: "messaging-qq",
    kind: "message",
    originalId: `qq:message:msg-${MESSAGE_ID}`,
    producer: "qq-pc/android-snapshot",
    capturedAt: 1_750_000_001_000,
    payload: {
      kind: "message",
      msgId: MESSAGE_ID,
      sequence: "73",
      senderUin: "111",
      peerUin: "222",
      isGroup: false,
      isSend: false,
      text: "decoded Android text",
      readState: 1,
      observationProducer: "qq-pc/android-snapshot",
    },
  };
}

let tmpDir;
let vault;

function openVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

function makeSingleRawAdapter(AdapterClass, raw) {
  const adapter = new AdapterClass();
  adapter.defaultScope = SCOPE;
  adapter.authenticate = async () => ({ ok: true });
  adapter.sync = async function* syncSingleRaw() {
    yield raw;
  };
  return adapter;
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

describe("messaging-qq resolved ingest", () => {
  it("merges Android evidence into the matching QQ NT event", async () => {
    openVault();
    const pcAdapter = makeSingleRawAdapter(QQPcAdapter, pcRaw());
    const androidAdapter = makeSingleRawAdapter(QQAdapter, androidRaw());
    const registry = new AdapterRegistry({ vault });
    registry.register(pcAdapter);
    registry.register(androidAdapter);

    const pcReport = await registry.syncAdapter(pcAdapter.name);
    const androidReport = await registry.syncAdapter(androidAdapter.name);

    expect(pcReport.status).toBe("ok");
    expect(androidReport).toMatchObject({
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
        title: "decoded Android text",
        text: "decoded Android text",
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
        observationProducers: ["qq-pc/direct", "qq-pc/android-snapshot"],
        rawRow: { 40001: MESSAGE_ID, 40003: "73" },
      },
    });
    expect(
      vault.resolveSourceIdentity("event", {
        adapter: "messaging-qq",
        scope: SCOPE,
        originalId: `qq:message:msg-${MESSAGE_ID}`,
      }),
    ).toEqual({
      adapter: "qq-pc",
      scope: SCOPE,
      originalId: CANONICAL_ORIGINAL_ID,
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
    ).toEqual(["qq-pc/android-snapshot", "qq-pc/direct"]);
  });
});
