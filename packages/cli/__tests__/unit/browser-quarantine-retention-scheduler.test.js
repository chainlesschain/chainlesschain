import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";
import {
  BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA,
  createBrowserQuarantineRetentionAuthority,
} from "../../src/lib/evolution/browser-quarantine-retention-authority.js";
import {
  BROWSER_QUARANTINE_RETENTION_SCHEDULER_DESCRIPTOR_SCHEMA,
  captureBrowserQuarantineRetentionScheduler,
  createBrowserQuarantineRetentionScheduler,
} from "../../src/lib/evolution/browser-quarantine-retention-scheduler.js";

const NOW = Date.parse("2026-09-20T10:00:00.000Z");
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("browser quarantine retention scheduler", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture({ authorizeSweep, runOnStart = true } = {}) {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-browser-retention-scheduler-"),
    );
    roots.push(stateRoot);
    const custody = createBrowserFilesystemQuarantineCustody({
      descriptor: {
        schema: BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
        custodyId: "download-custody-test",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        retentionMs: 60_000,
        custodyMode: "exclusive-stream-fsync",
      },
      stateRoot,
      now: () => NOW,
    });
    const authority = createBrowserQuarantineRetentionAuthority({
      descriptor: {
        schema: BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA,
        authorityId: "browser-quarantine-retention",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        policyRevision: "retention-policy-1",
        maxBatchSize: 10,
        maxGrantTtlMs: 5000,
        auditMode: "authenticated-durable-readback",
        effectMode: "irreversible-expiry-disposal",
      },
      custody,
      authorizeSweep:
        authorizeSweep ??
        (async () => ({
          decision: "allow",
          policyEvidenceRef: "retention-policy-evidence",
          validUntil: new Date(NOW + 1000).toISOString(),
        })),
      recordOutcome: async (request) => ({
        schema: BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA,
        authorityId: "browser-quarantine-retention",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        sweepReceiptDigest: request.sweepReceiptDigest,
        outcomeRequestDigest: request.outcomeRequestDigest,
        auditEventDigest: digest("audit-event"),
        durabilityReceiptDigest: digest("durability"),
        authenticated: true,
        durable: true,
        readbackVerified: true,
        qualifiesForPromotion: false,
      }),
      now: () => NOW,
    });
    const callbacks = [];
    const clearIntervalFn = vi.fn();
    const scheduler = captureBrowserQuarantineRetentionScheduler(
      createBrowserQuarantineRetentionScheduler({
        descriptor: {
          schema: BROWSER_QUARANTINE_RETENTION_SCHEDULER_DESCRIPTOR_SCHEMA,
          schedulerId: "browser-quarantine-retention-scheduler",
          tenantId: "tenant-1",
          handlerArtifactDigest: digest("handler"),
          intervalMs: 60_000,
          runOnStart,
          overlapMode: "skip",
          shutdownMode: "drain",
        },
        authority,
        setIntervalFn: (callback, intervalMs) => {
          callbacks.push({ callback, intervalMs });
          return Object.freeze({ timer: callbacks.length });
        },
        clearIntervalFn,
        now: () => NOW,
      }),
    );
    return { callbacks, clearIntervalFn, scheduler };
  }

  it("runs on start, schedules periodic sweeps, and stops cleanly", async () => {
    const authorizeSweep = vi.fn(async () => ({
      decision: "allow",
      policyEvidenceRef: "retention-policy-evidence",
      validUntil: new Date(NOW + 1000).toISOString(),
    }));
    const { callbacks, clearIntervalFn, scheduler } = await fixture({
      authorizeSweep,
    });

    await expect(scheduler.start()).resolves.toEqual({ status: "started" });
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].intervalMs).toBe(60_000);
    expect(authorizeSweep).toHaveBeenCalledOnce();
    expect(scheduler.inspect()).toMatchObject({
      started: true,
      running: false,
      lastRun: { status: "succeeded", trigger: "startup" },
    });
    callbacks[0].callback();
    await vi.waitFor(() => expect(authorizeSweep).toHaveBeenCalledTimes(2));
    await expect(scheduler.stop()).resolves.toMatchObject({
      status: "stopped",
      lastRun: { status: "succeeded", trigger: "interval" },
    });
    expect(clearIntervalFn).toHaveBeenCalledOnce();
  });

  it("skips overlap and drains an active sweep before stopping", async () => {
    let release;
    const authorizeSweep = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              decision: "allow",
              policyEvidenceRef: "retention-policy-evidence",
              validUntil: new Date(NOW + 1000).toISOString(),
            });
        }),
    );
    const { scheduler } = await fixture({ authorizeSweep, runOnStart: false });
    await scheduler.start();
    const active = scheduler.runNow();
    await vi.waitFor(() => expect(authorizeSweep).toHaveBeenCalledOnce());
    await expect(scheduler.runNow()).resolves.toEqual({
      status: "skipped",
      reason: "already-active",
    });
    const stopping = scheduler.stop();
    expect(scheduler.inspect()).toMatchObject({
      started: false,
      running: true,
    });
    release();
    await expect(active).resolves.toMatchObject({ status: "succeeded" });
    await expect(stopping).resolves.toMatchObject({ status: "stopped" });
    expect(scheduler.inspect()).toMatchObject({
      started: false,
      running: false,
    });
  });
});
