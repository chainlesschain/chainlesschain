"use strict";

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");
const { generateKeyHex } = require("../../lib/key-providers");
const {
  SystemDataAndroidAdapter,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/system-data-android");

let testDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort cleanup after an assertion failure.
    }
    vault = null;
  }
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  testDir = null;
});

function makeBridge() {
  return {
    caps: () => ({ available: true }),
    invoke: async (method) => {
      if (method === "contacts.query") {
        return {
          contacts: [
            { lookupKey: "contact-1", displayName: "Contact 1" },
            { lookupKey: "contact-2", displayName: "Contact 2" },
          ],
        };
      }
      if (method === "app.list") {
        return { apps: [{ packageName: "com.example.fairness" }] };
      }
      return [];
    },
  };
}

describe("SystemDataAndroidAdapter registry watermark safety", () => {
  it("keeps bounded repeats incomplete and never turns row counts into a checkpoint", async () => {
    testDir = mkdtempSync(join(tmpdir(), "pdh-system-android-watermark-"));
    vault = new LocalVault({
      path: join(testDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();

    const adapter = new SystemDataAndroidAdapter({
      bridgeProvider: makeBridge,
    });
    // Simulate a count watermark left by the pre-v0.4.2 adapter. It remains
    // inert: the adapter ignores it and the registry no longer increments it.
    vault.setWatermark(adapter.name, "", {
      watermark: "999",
      lastSyncedAt: Date.now() - 1_000,
      lastStatus: "ok",
      lastError: null,
    });

    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    const options = {
      useBridge: true,
      sourceIdentity: "registry-fairness-device",
      limit: 1,
      include: {
        contacts: true,
        apps: true,
        sms: false,
        calls: false,
        media: false,
      },
    };

    const reports = [];
    for (let pass = 0; pass < 3; pass += 1) {
      reports.push(await registry.syncAdapter(adapter.name, options));
    }

    for (const report of reports) {
      expect(report.status).toBe("ok");
      expect(report.rawCount).toBe(1);
      expect(report.scope).toBe("");
      expect(report.watermark).toBe("999");
      expect(report.watermarkDeferred).toBe(true);
      expect(report.checkpointCommitted).toBe(false);
    }
    expect(vault.getWatermark(adapter.name, "")).toMatchObject({
      watermark: "999",
      last_status: "ok",
    });

    // The first two bounded runs advance through contacts; the third reaches
    // apps without any durable cursor claim.
    expect(vault.stats()).toMatchObject({
      rawEvents: 3,
      events: 3,
      persons: 2,
      items: 1,
    });
  });

  it("keeps snapshot/live upgrades on one scope without duplicating raw entities", async () => {
    testDir = mkdtempSync(join(tmpdir(), "pdh-system-android-snapshot-"));
    vault = new LocalVault({
      path: join(testDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();

    const adapter = new SystemDataAndroidAdapter({
      bridgeProvider: () => ({
        caps: () => ({ available: true }),
        invoke: async (method) =>
          method === "contacts.query"
            ? {
                contacts: [
                  {
                    lookupKey: "snapshot-contact",
                    displayName: "Snapshot",
                  },
                ],
              }
            : [],
      }),
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "41",
      lastSyncedAt: Date.now() - 1_000,
      lastStatus: "ok",
      lastError: null,
    });
    const snapshotPath = join(testDir, "snapshot.json");
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        contacts: [{ lookupKey: "snapshot-contact", displayName: "Snapshot" }],
        apps: [],
      }),
      "utf8",
    );

    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    const snapshotReport = await registry.syncAdapter(adapter.name, {
      inputPath: snapshotPath,
    });

    expect(snapshotReport.status).toBe("ok");
    expect(snapshotReport.scope).toBe("");
    expect(snapshotReport.watermark).toBe("41");
    expect(snapshotReport.watermarkDeferred).toBe(false);
    expect(snapshotReport.checkpointCommitted).toBe(false);
    expect(vault.getWatermark(adapter.name, "").watermark).toBe("41");

    const liveReport = await registry.syncAdapter(adapter.name, {
      useBridge: true,
      include: {
        contacts: true,
        apps: false,
        sms: false,
        calls: false,
        media: false,
      },
    });

    expect(liveReport.status).toBe("ok");
    expect(liveReport.scope).toBe("");
    expect(liveReport.watermark).toBe("41");
    expect(liveReport.watermarkDeferred).toBe(false);
    expect(liveReport.checkpointCommitted).toBe(true);
    expect(vault.getWatermark(adapter.name, "").watermark).toBe("41");
    expect(vault.stats()).toMatchObject({
      rawEvents: 1,
      events: 1,
      persons: 1,
    });
  });

  it.each(["normalize", "archive"])(
    "replays the first bounded row after a registry %s failure",
    async (failureMode) => {
      testDir = mkdtempSync(
        join(tmpdir(), `pdh-system-android-${failureMode}-`),
      );
      vault = new LocalVault({
        path: join(testDir, "vault.db"),
        key: generateKeyHex(),
        skipAudit: true,
      });
      vault.open();

      const adapter = new SystemDataAndroidAdapter({
        bridgeProvider: makeBridge,
      });
      if (failureMode === "normalize") {
        const normalize = adapter.normalize.bind(adapter);
        let failOnce = true;
        adapter.normalize = (raw) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("normalize failed");
          }
          return normalize(raw);
        };
      } else {
        const putRawEvent = vault.putRawEvent.bind(vault);
        let failOnce = true;
        vault.putRawEvent = (raw) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("archive failed");
          }
          return putRawEvent(raw);
        };
      }

      const registry = new AdapterRegistry({
        vault,
        syncMaxRetries: 0,
      });
      registry.register(adapter);
      const options = {
        useBridge: true,
        sourceIdentity: `registry-${failureMode}-device`,
        limit: 1,
        include: {
          contacts: true,
          apps: false,
          sms: false,
          calls: false,
          media: false,
        },
      };

      const failed = await registry.syncAdapter(adapter.name, options);
      const retry = await registry.syncAdapter(adapter.name, options);

      expect(failed.status).toBe(failureMode === "normalize" ? "ok" : "error");
      if (failureMode === "normalize") {
        expect(failed.invalidCount).toBe(1);
      }
      expect(retry.status).toBe("ok");
      expect(retry.rawCount).toBe(1);
      expect(
        vault
          .queryRawEvents({ adapter: adapter.name })
          .map((raw) => raw.originalId),
      ).toEqual(["android-contact:contact-1"]);
    },
  );

  it("preserves a legacy watermark when the live upgrade sync fails", async () => {
    testDir = mkdtempSync(join(tmpdir(), "pdh-system-android-failure-"));
    vault = new LocalVault({
      path: join(testDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();

    const adapter = new SystemDataAndroidAdapter({
      bridgeProvider: () => ({
        caps: () => ({ available: true }),
        invoke: async () => {
          throw new Error("bridge collection failed");
        },
      }),
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "73",
      lastSyncedAt: Date.now() - 1_000,
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      useBridge: true,
      include: {
        contacts: true,
        apps: false,
        sms: false,
        calls: false,
        media: false,
      },
    });

    expect(report.status).toBe("error");
    expect(report.checkpointCommitted).toBe(false);
    expect(report.watermark).toBe("73");
    expect(vault.getWatermark(adapter.name, "")).toMatchObject({
      watermark: "73",
      last_status: "error",
    });
  });

  it("preserves an explicit override across an ordinary later live sync", async () => {
    testDir = mkdtempSync(join(tmpdir(), "pdh-system-android-override-"));
    vault = new LocalVault({
      path: join(testDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();

    const adapter = new SystemDataAndroidAdapter({
      bridgeProvider: makeBridge,
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "91",
      lastSyncedAt: Date.now() - 1_000,
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const overrideReport = await registry.syncAdapter(adapter.name, {
      useBridge: true,
      sinceWatermark: "caller-cursor",
      include: {
        contacts: false,
        apps: false,
        sms: false,
        calls: false,
        media: false,
      },
    });

    expect(overrideReport.status).toBe("ok");
    expect(overrideReport.collectionSinceWatermark).toBe("caller-cursor");
    expect(overrideReport.watermark).toBe("caller-cursor");

    const ordinaryReport = await registry.syncAdapter(adapter.name, {
      useBridge: true,
      include: {
        contacts: false,
        apps: false,
        sms: false,
        calls: false,
        media: false,
      },
    });
    expect(ordinaryReport.status).toBe("ok");
    expect(ordinaryReport.collectionSinceWatermark).toBe("caller-cursor");
    expect(ordinaryReport.watermark).toBe("caller-cursor");
    expect(vault.getWatermark(adapter.name, "").watermark).toBe(
      "caller-cursor",
    );
  });
});
