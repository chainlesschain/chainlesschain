/**
 * Unit tests for audit-mtc lib (Phase 2 audit double-track scaffolding).
 * Pure tmp-dir tests — no CLI subprocess, no global state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getAuditMtcDir,
  loadAuditMtcConfig,
  saveAuditMtcConfig,
  loadOrCreateIssuerKey,
  emitEvent,
  closeBatch,
  reconcileCheck,
  getStatus,
} from "../../../src/lib/audit-mtc.js";
import mtcLib from "@chainlesschain/core-mtc";

const { LandmarkCache, verify, ed25519 } = mtcLib;

describe("audit-mtc lib", () => {
  let configDir;
  let dir;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-mtc-"));
    dir = getAuditMtcDir(configDir);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  describe("config", () => {
    it("returns defaults when no config file exists", () => {
      const cfg = loadAuditMtcConfig(dir);
      expect(cfg.enabled).toBe(false);
      expect(cfg.batch_interval_seconds).toBe(3600);
      expect(cfg.namespace_prefix).toBe("mtc/v1/audit/local");
    });

    it("persists patches and rejects invalid values", () => {
      const updated = saveAuditMtcConfig(dir, {
        enabled: true,
        batch_interval_seconds: 60,
      });
      expect(updated.enabled).toBe(true);
      expect(updated.batch_interval_seconds).toBe(60);
      expect(loadAuditMtcConfig(dir).enabled).toBe(true);
      // Atomic write: no temp sibling left behind in the store dir.
      expect(fs.readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);

      expect(() =>
        saveAuditMtcConfig(dir, { batch_interval_seconds: 0 }),
      ).toThrow();
      expect(() => saveAuditMtcConfig(dir, { enabled: "yes" })).toThrow();
      expect(() => saveAuditMtcConfig(dir, { namespace_prefix: "" })).toThrow();
    });
  });

  describe("issuer key", () => {
    it("creates once and reuses on subsequent calls", () => {
      const k1 = loadOrCreateIssuerKey(dir);
      const k2 = loadOrCreateIssuerKey(dir);
      expect(k1.publicKey.equals(k2.publicKey)).toBe(true);
      expect(k1.pubkeyId).toBe(k2.pubkeyId);
    });
  });

  describe("emitEvent (Track 1: realtime Ed25519)", () => {
    it("refuses to emit when config.enabled=false", () => {
      expect(() =>
        emitEvent(dir, { event_type: "auth", operation: "login" }),
      ).toThrowError(/disabled/);
    });

    it("emits with --force-equivalent (requireEnabled=false) and writes a signed staging file", () => {
      const r = emitEvent(
        dir,
        { event_type: "auth", operation: "login", actor: "alice" },
        { requireEnabled: false },
      );
      expect(r.eventId).toMatch(/^\d{14}-[a-f0-9]{12}$/);
      expect(fs.existsSync(r.path)).toBe(true);
      expect(r.record.body.event_type).toBe("auth");
      expect(r.record.body.actor).toBe("alice");
      expect(r.record.ed25519_sig.alg).toBe("Ed25519");
      expect(r.record.ed25519_sig.sig).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(r.record.content_hash).toMatch(/^sha256:/);
    });

    it("emits when config.enabled=true without forcing", () => {
      saveAuditMtcConfig(dir, { enabled: true });
      const r = emitEvent(dir, { event_type: "data", operation: "export" });
      expect(r.eventId).toBeTruthy();
    });

    it("validates required body fields", () => {
      saveAuditMtcConfig(dir, { enabled: true });
      expect(() => emitEvent(dir, {})).toThrow(/event_type/);
      expect(() => emitEvent(dir, { event_type: "x" })).toThrow(/operation/);
    });
  });

  describe("closeBatch (Track 2: Merkle finality)", () => {
    beforeEach(() => {
      saveAuditMtcConfig(dir, { enabled: true });
    });

    it("returns skipped when staging is empty", () => {
      const r = closeBatch(dir);
      expect(r.skipped).toBe(true);
    });

    it("builds tree, writes manifest + landmark + envelopes, removes staging files", () => {
      const e1 = emitEvent(dir, { event_type: "auth", operation: "login" });
      const e2 = emitEvent(dir, { event_type: "auth", operation: "logout" });
      const e3 = emitEvent(dir, { event_type: "data", operation: "delete" });

      const r = closeBatch(dir);
      expect(r.skipped).toBe(false);
      expect(r.batchId).toBe("000001");
      expect(r.treeSize).toBe(3);
      // Order is staging-dir alphabetical (event_id is time-prefixed), so
      // assert set membership rather than insertion order — same-ms emits
      // tie-break on the random suffix.
      expect(new Set(r.eventIds)).toEqual(
        new Set([e1.eventId, e2.eventId, e3.eventId]),
      );
      expect(r.namespace).toBe("mtc/v1/audit/local/000001");

      // Files in place
      expect(fs.existsSync(path.join(r.batchDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(r.batchDir, "landmark.json"))).toBe(true);
      for (const id of r.eventIds) {
        expect(
          fs.existsSync(path.join(r.batchDir, `envelope-${id}.json`)),
        ).toBe(true);
      }

      // Staging cleaned
      expect(fs.existsSync(e1.path)).toBe(false);
      expect(fs.existsSync(e2.path)).toBe(false);
      expect(fs.existsSync(e3.path)).toBe(false);

      // Cross-process lock around the close section was released (no leftover).
      expect(fs.existsSync(path.join(dir, "batches.lock"))).toBe(false);
    });

    it("envelopes verify against landmark via core-mtc verifier", () => {
      const e = emitEvent(dir, { event_type: "auth", operation: "login" });
      const r = closeBatch(dir);

      const landmark = JSON.parse(
        fs.readFileSync(path.join(r.batchDir, "landmark.json"), "utf-8"),
      );
      const envelope = JSON.parse(
        fs.readFileSync(
          path.join(r.batchDir, `envelope-${e.eventId}.json`),
          "utf-8",
        ),
      );

      const cache = new LandmarkCache({
        signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      });
      cache.ingest(landmark);
      const result = verify(envelope, cache);
      expect(result.ok, result.code).toBe(true);
      expect(result.leaf.subject).toBe(e.eventId);
    });

    it("subsequent closeBatch produces a new sequential batch id", () => {
      emitEvent(dir, { event_type: "x", operation: "y" });
      const r1 = closeBatch(dir);
      expect(r1.batchId).toBe("000001");

      emitEvent(dir, { event_type: "x", operation: "z" });
      const r2 = closeBatch(dir);
      expect(r2.batchId).toBe("000002");
    });

    it("idempotent: re-running close immediately after success is a no-op", () => {
      emitEvent(dir, { event_type: "auth", operation: "login" });
      const r1 = closeBatch(dir);
      expect(r1.skipped).toBe(false);
      const r2 = closeBatch(dir);
      expect(r2.skipped).toBe(true);
    });

    it("salvages a leftover .tmp dir from a previous crash", () => {
      // Create a fake leftover
      const leftover = path.join(dir, "batches", ".000001.tmp");
      fs.mkdirSync(leftover, { recursive: true });
      fs.writeFileSync(path.join(leftover, "garbage.json"), "{}");

      emitEvent(dir, { event_type: "x", operation: "y" });
      const r = closeBatch(dir);
      expect(r.skipped).toBe(false);
      expect(fs.existsSync(leftover)).toBe(false);
      expect(fs.existsSync(r.batchDir)).toBe(true);
    });

    it("custom namespace + issuer override config", () => {
      emitEvent(dir, { event_type: "x", operation: "y" });
      const r = closeBatch(dir, {
        namespace: "mtc/v1/audit/org-acme",
        issuer: "mtca:cc:custom",
      });
      expect(r.namespace).toBe("mtc/v1/audit/org-acme/000001");
      const manifest = JSON.parse(
        fs.readFileSync(path.join(r.batchDir, "manifest.json"), "utf-8"),
      );
      expect(manifest.issuer).toBe("mtca:cc:custom");
    });
  });

  describe("reconcileCheck", () => {
    beforeEach(() => {
      saveAuditMtcConfig(dir, { enabled: true });
    });

    it("returns staging:true when event hasn't been batched yet", () => {
      const e = emitEvent(dir, { event_type: "auth", operation: "login" });
      const r = reconcileCheck(dir, e.eventId);
      expect(r.found).toBe(false);
      expect(r.staging).toBe(true);
    });

    it("returns batch info for a batched event", () => {
      const e1 = emitEvent(dir, { event_type: "auth", operation: "login" });
      const e2 = emitEvent(dir, { event_type: "auth", operation: "logout" });
      closeBatch(dir);

      const r1 = reconcileCheck(dir, e1.eventId);
      expect(r1.found).toBe(true);
      expect(r1.batchId).toBe("000001");
      expect([0, 1]).toContain(r1.leafIndex);
      expect(fs.existsSync(r1.envelopePath)).toBe(true);

      const r2 = reconcileCheck(dir, e2.eventId);
      expect(r2.found).toBe(true);
      expect(r2.batchId).toBe("000001");
      expect(r2.leafIndex).not.toBe(r1.leafIndex);
    });

    it("returns not-found for unknown event ids", () => {
      const r = reconcileCheck(dir, "20260101000000-deadbeefcafe");
      expect(r.found).toBe(false);
      expect(r.staging).toBeFalsy();
    });
  });

  describe("bug-fix regressions", () => {
    beforeEach(() => {
      saveAuditMtcConfig(dir, { enabled: true });
    });

    it("listStagingEvents rejects files with wrong schema", () => {
      // Drop a file masquerading as an event
      const stagingPath = path.join(dir, "staging");
      fs.mkdirSync(stagingPath, { recursive: true });
      fs.writeFileSync(
        path.join(stagingPath, "20260101000000-cafef00ddead.json"),
        JSON.stringify({
          schema: "not-an-event/v1",
          event_id: "20260101000000-cafef00ddead",
        }),
      );
      // And a real one
      const real = emitEvent(dir, { event_type: "x", operation: "y" });

      const r = closeBatch(dir);
      expect(r.skipped).toBe(false);
      // Only the real event should be in the batch
      expect(r.eventIds).toEqual([real.eventId]);
      expect(r.malformed).toHaveLength(1);
      expect(r.malformed[0].error).toMatch(/schema/);
    });

    it("listStagingEvents rejects files where filename != event_id", () => {
      const stagingPath = path.join(dir, "staging");
      fs.mkdirSync(stagingPath, { recursive: true });
      fs.writeFileSync(
        path.join(stagingPath, "20260101000000-mismatched1.json"),
        JSON.stringify({
          schema: "audit-event/v1",
          event_id: "20260202000000-different00",
        }),
      );
      const r = closeBatch(dir);
      expect(r.skipped).toBe(true);
      expect(r.malformed).toHaveLength(1);
      expect(r.malformed[0].error).toMatch(/mismatch/);
    });

    it("getStatus.oldest_queued_at finds first valid record when leading entry is malformed", () => {
      const stagingPath = path.join(dir, "staging");
      fs.mkdirSync(stagingPath, { recursive: true });
      // Alphabetically-first entry is malformed
      fs.writeFileSync(
        path.join(stagingPath, "00000000000000-aaaaaaaaaaaa.json"),
        "{ this is not valid JSON",
      );
      const real = emitEvent(dir, { event_type: "x", operation: "y" });

      const s = getStatus(dir);
      expect(s.staging.count).toBe(2);
      expect(s.staging.malformed).toBe(1);
      expect(s.staging.oldest_queued_at).toBe(real.record.queued_at);
    });

    it("loadOrCreateIssuerKey is consistent across rapid sequential calls (race-safe create)", () => {
      // We can't deterministically simulate true concurrent fs from JS, but we
      // can assert the return value is stable: once any caller has created the
      // key, subsequent calls must return the same key.
      const k1 = loadOrCreateIssuerKey(dir);
      const k2 = loadOrCreateIssuerKey(dir);
      const k3 = loadOrCreateIssuerKey(dir);
      expect(k1.publicKey.equals(k2.publicKey)).toBe(true);
      expect(k2.publicKey.equals(k3.publicKey)).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("snapshots config + queue + last-batch state", () => {
      saveAuditMtcConfig(dir, { enabled: true, batch_interval_seconds: 60 });

      let s = getStatus(dir);
      expect(s.config.enabled).toBe(true);
      expect(s.config.batch_interval_seconds).toBe(60);
      expect(s.staging.count).toBe(0);
      expect(s.batches.count).toBe(0);

      emitEvent(dir, { event_type: "x", operation: "y" });
      emitEvent(dir, { event_type: "x", operation: "z" });
      s = getStatus(dir);
      expect(s.staging.count).toBe(2);
      expect(s.batches.count).toBe(0);

      closeBatch(dir);
      s = getStatus(dir);
      expect(s.staging.count).toBe(0);
      expect(s.batches.count).toBe(1);
      expect(s.batches.last_batch_id).toBe("000001");
      expect(s.batches.last_tree_size).toBe(2);
      expect(s.batches.last_tree_head_id).toMatch(/^sha256:/);
    });
  });
});
