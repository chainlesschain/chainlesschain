"use strict";

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { MockAdapter } = require("../lib/mock-adapter");

let testDir;
let vault;

function openVault() {
  testDir = mkdtempSync(join(tmpdir(), "pdh-deferred-sync-commit-"));
  vault = new LocalVault({
    path: join(testDir, "vault.db"),
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
      // Best-effort cleanup after an assertion failure.
    }
    vault = null;
  }
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  testDir = null;
});

describe("AdapterRegistry deferred sync commits", () => {
  it("runs callbacks only after raw, normalized entities, and checkpoint commit", async () => {
    openVault();
    const adapter = new MockAdapter({
      name: "deferred-commit-success",
      count: 1,
    });
    const baseSync = adapter.sync.bind(adapter);
    let observed = null;
    adapter.sync = async function* sync(opts) {
      opts.deferSyncCommit(() => {
        observed = {
          stats: vault.stats(),
          watermark: vault.getWatermark(adapter.name)?.watermark,
        };
      });
      yield* baseSync(opts);
    };
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("ok");
    expect(observed).toMatchObject({
      stats: { rawEvents: 1, events: 1 },
      watermark: "1",
    });
  });

  it("never runs a registered callback after normalize failure or abort", async () => {
    openVault();
    const failedAdapter = new MockAdapter({
      name: "deferred-commit-failure",
      count: 1,
    });
    const failedSync = failedAdapter.sync.bind(failedAdapter);
    let failureCommits = 0;
    failedAdapter.sync = async function* sync(opts) {
      opts.deferSyncCommit(() => {
        failureCommits += 1;
      });
      yield* failedSync(opts);
    };
    failedAdapter.normalizeShouldThrowAt(0);

    const abortedAdapter = new MockAdapter({
      name: "deferred-commit-abort",
      count: 1,
    });
    const abortedSync = abortedAdapter.sync.bind(abortedAdapter);
    const controller = new AbortController();
    let abortCommits = 0;
    abortedAdapter.sync = async function* sync(opts) {
      opts.deferSyncCommit(() => {
        abortCommits += 1;
      });
      yield* abortedSync(opts);
      controller.abort();
    };

    const registry = new AdapterRegistry({
      vault,
      syncMaxRetries: 0,
    });
    registry.register(failedAdapter);
    registry.register(abortedAdapter);

    const failed = await registry.syncAdapter(failedAdapter.name);
    const aborted = await registry.syncAdapter(abortedAdapter.name, {
      signal: controller.signal,
    });

    // Normalize failures are row-level invalids in the registry's existing
    // report contract, but they still make the attempt ineligible to commit
    // adapter-local progress.
    expect(failed.status).toBe("ok");
    expect(failed.invalidCount).toBe(1);
    expect(aborted.status).toBe("error");
    expect(failureCommits).toBe(0);
    expect(abortCommits).toBe(0);
  });

  it("audits and ignores callback errors after a successful sync", async () => {
    openVault();
    const adapter = new MockAdapter({
      name: "deferred-commit-error",
      count: 1,
    });
    const baseSync = adapter.sync.bind(adapter);
    adapter.sync = async function* sync(opts) {
      opts.deferSyncCommit(() => {
        throw new Error("local sampler commit failed");
      });
      yield* baseSync(opts);
    };
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(1);
    expect(vault.stats()).toMatchObject({ rawEvents: 1, events: 1 });
  });
});
