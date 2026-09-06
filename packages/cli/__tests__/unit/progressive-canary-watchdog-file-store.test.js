import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgressiveCanaryWatchdogFileStore } from "../../src/lib/evolution/progressive-canary-watchdog-file-store.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

afterEach(() => vi.restoreAllMocks());

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

  it("publishes only a complete reservation and serializes expired takeover", async () => {
    const { rootDir, planDigest, hostId, store } = await fixture();
    const binding = {
      planDigest,
      incidentDigest: D("atomic-reservation"),
      observedAt: 10_000,
      leaseDurationMs: 5_000,
    };
    const target = join(
      store.rootDir,
      "reservations",
      `${binding.incidentDigest.slice(7)}.json`,
    );
    const rename = fs.renameSync;
    let publications = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === target) {
        const staged = JSON.parse(fs.readFileSync(from, "utf8"));
        expect(staged.incidentDigest).toBe(binding.incidentDigest);
        if (publications === 0) expect(fs.existsSync(target)).toBe(false);
        else
          expect(JSON.parse(fs.readFileSync(target, "utf8")).expiresAt).toBe(
            15_000,
          );
        publications += 1;
      }
      return rename(from, to);
    });
    await expect(store.incidentStore.reserve(binding)).resolves.toMatchObject({
      acquired: true,
    });
    const contenders = await Promise.all(
      Array.from({ length: 8 }, () =>
        createProgressiveCanaryWatchdogFileStore({
          rootDir,
          planDigest,
          hostId,
        }),
      ),
    );
    const results = await Promise.all(
      contenders.map((contender) =>
        contender.incidentStore.reserve({ ...binding, observedAt: 15_001 }),
      ),
    );
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(publications).toBe(2);
  });

  it("preserves the old reservation when staging fsync fails", async () => {
    const { planDigest, store } = await fixture();
    const binding = {
      planDigest,
      incidentDigest: D("failed-takeover"),
      observedAt: 10_000,
      leaseDurationMs: 5_000,
    };
    await store.incidentStore.reserve(binding);
    const target = join(
      store.rootDir,
      "reservations",
      `${binding.incidentDigest.slice(7)}.json`,
    );
    const original = fs.readFileSync(target);
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw new Error("injected fsync failure");
    });
    await expect(
      store.incidentStore.reserve({ ...binding, observedAt: 15_001 }),
    ).rejects.toThrow("injected fsync failure");
    expect(fs.readFileSync(target)).toEqual(original);
    expect(fs.readdirSync(join(store.rootDir, "reservations"))).toEqual([
      `${binding.incidentDigest.slice(7)}.json`,
    ]);
    vi.restoreAllMocks();
    await expect(
      store.incidentStore.reserve({ ...binding, observedAt: 15_001 }),
    ).resolves.toMatchObject({ acquired: true });
  });

  it.each(["{", "null", "[]", '"record"', "true"])(
    "rejects a corrupt reservation (%s) without deleting or replacing its bytes",
    async (content) => {
      const { planDigest, store } = await fixture();
      const binding = {
        planDigest,
        incidentDigest: D("corrupt-reservation"),
        observedAt: 10_000,
        leaseDurationMs: 5_000,
      };
      const target = join(
        store.rootDir,
        "reservations",
        `${binding.incidentDigest.slice(7)}.json`,
      );
      fs.writeFileSync(target, content);
      await expect(store.incidentStore.reserve(binding)).rejects.toThrow(
        content === "{" ? "admissible regular file" : "must contain an object",
      );
      expect(fs.readFileSync(target, "utf8")).toBe(content);
    },
  );

  it("allows identical concurrent commits but rejects a conflicting immutable incident", async () => {
    const { rootDir, planDigest, hostId, store } = await fixture();
    const reopened = await createProgressiveCanaryWatchdogFileStore({
      rootDir,
      planDigest,
      hostId,
    });
    const incident = {
      planDigest,
      incidentDigest: D("immutable-incident"),
      evidence: "original",
    };
    await Promise.all([
      store.incidentStore.commit(incident),
      reopened.incidentStore.commit(incident),
    ]);
    await expect(
      reopened.incidentStore.commit({ ...incident, evidence: "replacement" }),
    ).rejects.toThrow("conflicts with an existing record");
    await expect(store.incidentStore.load(incident)).resolves.toEqual(incident);
  });
});
