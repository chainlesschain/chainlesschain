"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  SystemDataAndroidAdapter,
  ingestSystemDataAndroidSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/system-data-android");

/**
 * Tests for the Path C ingest helper — staging-file write + syncAdapter call
 * + cleanup. Uses a fake hub.registry that proxies to a real
 * SystemDataAndroidAdapter so we exercise both halves of the pipeline (the
 * adapter's _syncViaSnapshot does fs.readFileSync of the staging path we
 * wrote, then the helper unlinks it after).
 */

let tmpHubDir;
let hub;

beforeEach(() => {
  tmpHubDir = mkdtempSync(join(tmpdir(), "pdh-ingest-"));
  const adapter = new SystemDataAndroidAdapter();
  hub = {
    hubDir: tmpHubDir,
    registry: {
      syncAdapter: vi.fn(async (name, opts) => {
        // Mimic what the real hub does: run the adapter's sync against the
        // staging path the helper wrote.
        const out = { adapter: name, ingested: 0, partitions: {} };
        for await (const raw of adapter.sync(opts)) {
          out.ingested += 1;
          if (raw.kind === "contact")
            out.partitions.contacts = { ingested: (out.partitions.contacts?.ingested || 0) + 1 };
          if (raw.kind === "app")
            out.partitions.apps = { ingested: (out.partitions.apps?.ingested || 0) + 1 };
        }
        return out;
      }),
    },
  };
});

afterEach(() => {
  rmSync(tmpHubDir, { recursive: true, force: true });
});

describe("ingestSystemDataAndroidSnapshot", () => {
  it("writes staging file, runs syncAdapter, cleans up", async () => {
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshottedAt: 1_700_000_000_000,
      contacts: [
        { lookupKey: "ck-1", displayName: "妈妈", phones: ["13800000001"] },
      ],
      apps: [{ packageName: "com.tencent.mm", label: "微信" }],
    };

    const report = await ingestSystemDataAndroidSnapshot(hub, snapshot);

    expect(report.adapter).toBe("system-data-android");
    expect(report.ingested).toBe(2); // 1 contact + 1 app

    // syncAdapter was called with an inputPath under <hubDir>/staging/
    expect(hub.registry.syncAdapter).toHaveBeenCalledTimes(1);
    const [name, opts] = hub.registry.syncAdapter.mock.calls[0];
    expect(name).toBe("system-data-android");
    expect(opts.inputPath).toContain(join(tmpHubDir, "staging"));
    expect(opts.inputPath).toMatch(/system-data-android-\d+.+\.json$/);

    // Staging file was cleaned up afterwards
    expect(existsSync(opts.inputPath)).toBe(false);
  });

  it("rejects snapshot with mismatched schemaVersion", async () => {
    await expect(
      ingestSystemDataAndroidSnapshot(hub, {
        schemaVersion: 99,
        snapshottedAt: 0,
        contacts: [],
        apps: [],
      }),
    ).rejects.toThrow(/schemaVersion 99/);
  });

  it("rejects missing hub.hubDir", async () => {
    await expect(
      ingestSystemDataAndroidSnapshot(
        { registry: hub.registry },
        { schemaVersion: SNAPSHOT_SCHEMA_VERSION, snapshottedAt: 0, contacts: [], apps: [] },
      ),
    ).rejects.toThrow(/hubDir/);
  });

  it("rejects missing snapshot payload", async () => {
    await expect(
      ingestSystemDataAndroidSnapshot(hub, null),
    ).rejects.toThrow(/snapshot payload required/);
  });

  it("cleans up staging file even when syncAdapter throws", async () => {
    hub.registry.syncAdapter = vi.fn(async () => {
      throw new Error("simulated sync failure");
    });
    let leaked = null;
    try {
      await ingestSystemDataAndroidSnapshot(hub, {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        snapshottedAt: 0,
        contacts: [{ lookupKey: "x", displayName: "X" }],
        apps: [],
      });
    } catch (_e) {
      // expected
    }
    leaked = hub.registry.syncAdapter.mock.calls[0]?.[1]?.inputPath;
    expect(leaked).toBeTruthy();
    expect(existsSync(leaked)).toBe(false);
  });

  it("staging file contains the snapshot JSON we passed in", async () => {
    // Capture path before syncAdapter unlinks it
    let captured = null;
    hub.registry.syncAdapter = vi.fn(async (_name, opts) => {
      captured = readFileSync(opts.inputPath, "utf-8");
      return { adapter: "system-data-android", ingested: 0 };
    });
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshottedAt: 1_700_000_000_000,
      contacts: [{ lookupKey: "ck-test", displayName: "Test" }],
      apps: [],
    };
    await ingestSystemDataAndroidSnapshot(hub, snapshot);
    expect(captured).toBeTruthy();
    const parsed = JSON.parse(captured);
    expect(parsed.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(parsed.contacts[0].lookupKey).toBe("ck-test");
  });
});
