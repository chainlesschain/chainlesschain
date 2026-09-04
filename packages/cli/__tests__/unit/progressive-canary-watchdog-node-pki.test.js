import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createProgressiveCanaryWatchdogPlan } from "../../src/lib/evolution/progressive-canary-external-watchdog.js";
import {
  createNodeProgressiveCanaryExternalRollbackAuthority,
  createNodeProgressiveCanaryHeartbeatAuthority,
  progressiveCanaryPublicKeySpkiDigest,
} from "../../src/lib/evolution/progressive-canary-watchdog-node-pki.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function fixture() {
  const heartbeatKeys = generateKeyPairSync("ed25519");
  const rollbackKeys = generateKeyPairSync("ed25519");
  const plan = createProgressiveCanaryWatchdogPlan({
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    descriptorDigest: D("descriptor"),
    baselineDigest: D("lkg"),
    hostId: "host-a",
    leaseDurationMs: 5_000,
    heartbeatAuthority: {
      id: "heartbeat-a",
      revision: 1,
      handlerDigest: D("heartbeat-handler"),
      publicKeySpkiDigest: progressiveCanaryPublicKeySpkiDigest(
        heartbeatKeys.publicKey,
      ),
    },
    rollbackAuthority: {
      id: "rollback-a",
      revision: 1,
      handlerDigest: D("rollback-handler"),
      publicKeySpkiDigest: progressiveCanaryPublicKeySpkiDigest(
        rollbackKeys.publicKey,
      ),
    },
  });
  return { plan, heartbeatKeys, rollbackKeys };
}

describe("progressive Canary watchdog Node PKI", () => {
  it("verifies a host-process heartbeat using only its plan-pinned public key", async () => {
    const { plan, heartbeatKeys } = fixture();
    const host = createNodeProgressiveCanaryHeartbeatAuthority({
      plan,
      privateKey: heartbeatKeys.privateKey,
      publicKey: heartbeatKeys.publicKey,
      now: () => 1_000,
    });
    const watchdog = createNodeProgressiveCanaryHeartbeatAuthority({
      plan,
      publicKey: heartbeatKeys.publicKey,
      now: () => 99_000,
    });
    const receipt = await host.issue({
      sequence: 7,
      stage: "active-probation",
      activeStateDigest: D("candidate"),
    });
    await expect(watchdog.verify(receipt)).resolves.toEqual(receipt);
    await expect(
      watchdog.verify({ ...receipt, sequence: 8 }),
    ).rejects.toThrow();
  });

  it("signs and verifies externally read-back kill and LKG effects", async () => {
    const { plan, rollbackKeys } = fixture();
    const killHost = vi.fn(async (request) => ({
      authenticated: true,
      durable: true,
      incidentDigest: request.incidentDigest,
      hostId: request.hostId,
      processAbsent: true,
      effectDigest: D(`kill:${request.incidentDigest}`),
    }));
    const rollbackToBaseline = vi.fn(async (request) => ({
      authenticated: true,
      durable: true,
      incidentDigest: request.incidentDigest,
      baselineDigest: request.baselineDigest,
      activeStateDigest: D(`active:${request.baselineDigest}`),
      effectDigest: D(`rollback:${request.incidentDigest}`),
    }));
    const authority = createNodeProgressiveCanaryExternalRollbackAuthority({
      plan,
      privateKey: rollbackKeys.privateKey,
      publicKey: rollbackKeys.publicKey,
      killHost,
      rollbackToBaseline,
    });
    const result = await authority.engage({
      incidentDigest: D("incident"),
      heartbeatReceiptDigest: D("heartbeat"),
      observedAt: 9_000,
    });
    expect(result.killReceipt.publicKeySpkiDigest).toBe(
      plan.rollbackAuthority.publicKeySpkiDigest,
    );
    expect(result.rollbackReceipt.baselineDigest).toBe(plan.baselineDigest);
    expect(killHost).toHaveBeenCalledBefore(rollbackToBaseline);
  });

  it("rejects a public-key substitution before any authority is created", () => {
    const { plan, heartbeatKeys } = fixture();
    const replacement = generateKeyPairSync("ed25519");
    expect(() =>
      createNodeProgressiveCanaryHeartbeatAuthority({
        plan,
        privateKey: heartbeatKeys.privateKey,
        publicKey: replacement.publicKey,
      }),
    ).toThrow("does not match the watchdog plan");
  });
});
