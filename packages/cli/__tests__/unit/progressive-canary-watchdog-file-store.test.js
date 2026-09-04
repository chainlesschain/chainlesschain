import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProgressiveCanaryWatchdogFileStore } from "../../src/lib/evolution/progressive-canary-watchdog-file-store.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "cc-watchdog-store-"));
  const planDigest = D("plan");
  const hostId = "host-a";
  const store = await createProgressiveCanaryWatchdogFileStore({
    rootDir,
    planDigest,
    hostId,
  });
  return { rootDir, planDigest, hostId, store };
}

function heartbeat(planDigest, hostId, sequence, label = "heartbeat") {
  return {
    planDigest,
    hostId,
    sequence,
    receiptDigest: D(`${label}:${sequence}`),
  };
}

describe("progressive Canary watchdog file store", () => {
  it("reopens the latest immutable heartbeat from a fresh store instance", async () => {
    const { rootDir, planDigest, hostId, store } = await fixture();
    await store.publishHeartbeat(heartbeat(planDigest, hostId, 1));
    const latest = heartbeat(planDigest, hostId, 2);
    await store.publishHeartbeat(latest);
    const reopened = await createProgressiveCanaryWatchdogFileStore({
      rootDir,
      planDigest,
      hostId,
    });
    await expect(
      reopened.heartbeatSource.readLatest({ planDigest, hostId }),
    ).resolves.toEqual({
      authenticated: true,
      durable: true,
      receipt: latest,
    });
  });

  it("grants one durable incident reservation across store instances", async () => {
    const { rootDir, planDigest, hostId, store } = await fixture();
    const reopened = await createProgressiveCanaryWatchdogFileStore({
      rootDir,
      planDigest,
      hostId,
    });
    const binding = {
      planDigest,
      incidentDigest: D("incident"),
      observedAt: 10_000,
      leaseDurationMs: 5_000,
    };
    const [first, second] = await Promise.all([
      store.incidentStore.reserve(binding),
      reopened.incidentStore.reserve(binding),
    ]);
    expect([first.acquired, second.acquired].sort()).toEqual([false, true]);
    const takeover = await reopened.incidentStore.reserve({
      ...binding,
      observedAt: 15_001,
    });
    expect(takeover.acquired).toBe(true);
  });

  it("commits an incident once and verifies exact fresh-instance readback", async () => {
    const { rootDir, planDigest, hostId, store } = await fixture();
    const incident = {
      planDigest,
      incidentDigest: D("incident"),
      evidence: { rollbackReceiptDigest: D("rollback") },
    };
    await expect(store.incidentStore.commit(incident)).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      incidentDigest: incident.incidentDigest,
    });
    const reopened = await createProgressiveCanaryWatchdogFileStore({
      rootDir,
      planDigest,
      hostId,
    });
    await expect(
      reopened.incidentStore.load({
        planDigest,
        incidentDigest: incident.incidentDigest,
      }),
    ).resolves.toEqual(incident);
  });
});
