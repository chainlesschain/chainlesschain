/**
 * channel-event-batch unit tests — staging → close → envelope lifecycle
 * with real filesystem (tmp dir) + real core-mtc assembleBatch.
 *
 * Covers:
 *   - enqueueEvent: staging file written, idempotent on dup id, unsigned
 *     messages skipped (B4a contract)
 *   - threshold trigger: closes batch automatically when reached
 *   - closeBatch: assembleBatch invoked, manifest+landmark+envelopes
 *     written, staging files cleaned up
 *   - findEnvelope: locates message in staging + in closed batch + returns
 *     {found:false} for unknown
 *   - loadEnvelopeAndLandmark: returns parsed envelope + landmark
 *   - closeAllPending: walks every community subdir
 *   - safety: communityId / messageId filesystem-safety guards
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  computeDIDFromPublicKey,
  signPayloadWithIdentity,
} = require("../../did/did-signer.js");
const {
  ChannelEventBatcher,
  SCHEMA_MANIFEST,
} = require("../channel-event-batch.js");

function makeIdentity(keyPair) {
  return {
    did: computeDIDFromPublicKey(keyPair.publicKey),
    public_key_sign: naclUtil.encodeBase64(keyPair.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(keyPair.secretKey),
      encrypt: naclUtil.encodeBase64(new Uint8Array(32)),
    }),
  };
}

function makeSignedMessage(identity, overrides = {}) {
  const subset = {
    id: overrides.id || "msg-" + Math.random().toString(36).slice(2, 10),
    channel_id: overrides.channel_id || "ch-1",
    sender_did: identity.did,
    content: overrides.content || "hello",
    message_type: "text",
    reply_to: null,
    created_at: overrides.created_at || Date.now(),
  };
  const { sender_pubkey, signature } = signPayloadWithIdentity(
    subset,
    identity,
  );
  return {
    ...subset,
    is_pinned: 0,
    reactions: "{}",
    updated_at: subset.created_at,
    sender_pubkey,
    signature,
  };
}

describe("ChannelEventBatcher", () => {
  let tmpDir;
  let identity;
  let batcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ceb-test-"));
    identity = makeIdentity(nacl.sign.keyPair());
    batcher = new ChannelEventBatcher({
      rootDir: tmpDir,
      getCurrentIdentity: () => identity,
      threshold: 100,
      autoTimer: false,
    });
    batcher.initialize();
  });

  afterEach(() => {
    batcher.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_err) {
      /* tolerate Windows file locks */
    }
  });

  describe("constructor + initialize", () => {
    it("rejects missing rootDir", () => {
      expect(
        () => new ChannelEventBatcher({ getCurrentIdentity: () => ({}) }),
      ).toThrow(/rootDir/);
    });
    it("rejects missing getCurrentIdentity", () => {
      expect(() => new ChannelEventBatcher({ rootDir: tmpDir })).toThrow(
        /getCurrentIdentity/,
      );
    });
    it("creates rootDir on initialize", () => {
      const fresh = path.join(tmpDir, "subdir-fresh");
      const b = new ChannelEventBatcher({
        rootDir: fresh,
        getCurrentIdentity: () => identity,
      });
      b.initialize();
      expect(fs.existsSync(fresh)).toBe(true);
      b.close();
    });
  });

  describe("enqueueEvent", () => {
    it("writes the message to community/staging/<id>.json", () => {
      const msg = makeSignedMessage(identity, { id: "abc123" });
      const result = batcher.enqueueEvent("comm-A", msg);
      expect(result.queued).toBe(true);
      expect(result.stagedCount).toBe(1);
      const stagedFile = path.join(tmpDir, "comm-A", "staging", "abc123.json");
      expect(fs.existsSync(stagedFile)).toBe(true);
      const stored = JSON.parse(fs.readFileSync(stagedFile, "utf-8"));
      expect(stored.id).toBe("abc123");
      expect(stored.signature).toBe(msg.signature);
    });

    it("idempotent — second enqueue of same id is no-op", () => {
      const msg = makeSignedMessage(identity, { id: "dup-1" });
      batcher.enqueueEvent("comm-A", msg);
      const r2 = batcher.enqueueEvent("comm-A", msg);
      expect(r2.queued).toBe(true);
      expect(r2.stagedCount).toBe(1);
    });

    it("skips unsigned messages (B4a contract — no place in audit batch)", () => {
      const result = batcher.enqueueEvent("comm-A", {
        id: "legacy-1",
        channel_id: "ch-1",
        sender_did: identity.did,
        content: "no sig here",
        created_at: Date.now(),
        // no sender_pubkey, no signature
      });
      expect(result.queued).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "comm-A", "staging"))).toBe(false);
    });

    it("rejects non-object input", () => {
      expect(() => batcher.enqueueEvent("comm-A", null)).toThrow(/required/);
      expect(() => batcher.enqueueEvent("comm-A", "string")).toThrow(
        /required/,
      );
    });

    it("rejects messages without id", () => {
      expect(() =>
        batcher.enqueueEvent("comm-A", { sender_pubkey: "x", signature: "y" }),
      ).toThrow(/id required/);
    });
  });

  describe("filesystem safety", () => {
    it("rejects communityId with path separators", () => {
      const msg = makeSignedMessage(identity);
      expect(() => batcher.enqueueEvent("comm-A/../escape", msg)).toThrow(
        /alphanumeric/,
      );
      expect(() => batcher.enqueueEvent("comm A spaces", msg)).toThrow(
        /alphanumeric/,
      );
    });

    it("rejects messageId with path separators", () => {
      const msg = makeSignedMessage(identity, { id: "../escape" });
      expect(() => batcher.enqueueEvent("comm-A", msg)).toThrow(/unsafe/);
    });
  });

  describe("threshold auto-close", () => {
    it("closes a batch automatically when threshold reached", () => {
      const small = new ChannelEventBatcher({
        rootDir: tmpDir,
        getCurrentIdentity: () => identity,
        threshold: 3,
        autoTimer: false,
      });
      small.initialize();

      small.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m1" }));
      small.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m2" }));
      const r3 = small.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "m3" }),
      );

      expect(r3.batchClosed).toBeDefined();
      expect(r3.batchClosed.skipped).toBe(false);
      expect(r3.batchClosed.treeSize).toBe(3);

      const stagingDir = path.join(tmpDir, "comm-A", "staging");
      const remaining = fs
        .readdirSync(stagingDir)
        .filter((n) => n.endsWith(".json"));
      expect(remaining.length).toBe(0);

      small.close();
    });
  });

  describe("closeBatch", () => {
    it("returns {skipped:true} when no events staged", () => {
      const result = batcher.closeBatch("comm-empty");
      expect(result.skipped).toBe(true);
    });

    it("writes manifest + landmark + envelopes; cleans staging", () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "x1" }));
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "x2" }));
      const result = batcher.closeBatch("comm-A");

      expect(result.skipped).toBe(false);
      expect(result.batchId).toMatch(/^\d{6}$/);
      expect(result.treeSize).toBe(2);
      expect(result.namespace).toContain("mtc/v1/channel/comm-A/");

      const batchDir = result.batchDir;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(batchDir, "manifest.json"), "utf-8"),
      );
      expect(manifest.schema).toBe(SCHEMA_MANIFEST);
      expect(manifest.community_id).toBe("comm-A");
      expect(manifest.tree_size).toBe(2);
      expect(manifest.message_ids.sort()).toEqual(["x1", "x2"]);
      expect(manifest.tree_head_id).toBeTruthy();

      const landmark = JSON.parse(
        fs.readFileSync(path.join(batchDir, "landmark.json"), "utf-8"),
      );
      expect(landmark.snapshots).toHaveLength(1);
      expect(landmark.trust_anchors).toHaveLength(1);

      expect(fs.existsSync(path.join(batchDir, "envelope-x1.json"))).toBe(true);
      expect(fs.existsSync(path.join(batchDir, "envelope-x2.json"))).toBe(true);

      const env = JSON.parse(
        fs.readFileSync(path.join(batchDir, "envelope-x1.json"), "utf-8"),
      );
      expect(env.tree_head_id).toBe(manifest.tree_head_id);
      expect(env.inclusion_proof).toBeTruthy();
      expect(env.leaf.message_id).toBe("x1");

      // staging cleaned
      const stagingDir = path.join(tmpDir, "comm-A", "staging");
      const remaining = fs
        .readdirSync(stagingDir)
        .filter((n) => n.endsWith(".json"));
      expect(remaining.length).toBe(0);
    });

    it("issues sequential batch ids", () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "a1" }));
      const r1 = batcher.closeBatch("comm-A");
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "a2" }));
      const r2 = batcher.closeBatch("comm-A");
      expect(r1.batchId).toBe("000001");
      expect(r2.batchId).toBe("000002");
    });

    it("throws when identity has no signing keys", () => {
      const noKeyBatcher = new ChannelEventBatcher({
        rootDir: tmpDir,
        getCurrentIdentity: () => ({ did: "did:chainlesschain:nokeys" }),
        autoTimer: false,
      });
      noKeyBatcher.initialize();
      noKeyBatcher.enqueueEvent(
        "comm-K",
        makeSignedMessage(identity, { id: "needs-keys" }),
      );
      expect(() => noKeyBatcher.closeBatch("comm-K")).toThrow(/missing keys/);
      noKeyBatcher.close();
    });
  });

  describe("findEnvelope", () => {
    it("returns {found:false} for unknown community", () => {
      expect(batcher.findEnvelope("never-existed", "x")).toEqual({
        found: false,
      });
    });

    it("returns {found:true, staging:true} for staged but not closed", () => {
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "stg-1" }),
      );
      const result = batcher.findEnvelope("comm-A", "stg-1");
      expect(result.found).toBe(true);
      expect(result.staging).toBe(true);
      expect(result.file).toContain("staging");
    });

    it("returns batch metadata for closed messages", () => {
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "closed-1" }),
      );
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "closed-2" }),
      );
      batcher.closeBatch("comm-A");

      const result = batcher.findEnvelope("comm-A", "closed-2");
      expect(result.found).toBe(true);
      expect(result.staging).toBeUndefined();
      expect(result.batchId).toBe("000001");
      expect(result.treeHeadId).toBeTruthy();
      expect(result.envelopePath).toContain("envelope-closed-2.json");
      expect(result.leafIndex).toBeGreaterThanOrEqual(0);
    });

    it("returns {found:false} for unknown messageId in known community", () => {
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "exists" }),
      );
      batcher.closeBatch("comm-A");
      expect(batcher.findEnvelope("comm-A", "ghost")).toEqual({ found: false });
    });
  });

  describe("loadEnvelopeAndLandmark", () => {
    it("returns parsed envelope + landmark for closed messages", () => {
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "load-1" }),
      );
      batcher.closeBatch("comm-A");
      const result = batcher.loadEnvelopeAndLandmark("comm-A", "load-1");
      expect(result.found).toBe(true);
      expect(result.envelope).toBeDefined();
      expect(result.envelope.leaf.message_id).toBe("load-1");
      expect(result.landmark).toBeDefined();
      expect(result.landmark.snapshots[0].tree_head_id).toBe(result.treeHeadId);
    });

    it("returns staging shape unchanged when message still in staging", () => {
      batcher.enqueueEvent(
        "comm-A",
        makeSignedMessage(identity, { id: "stg-2" }),
      );
      const result = batcher.loadEnvelopeAndLandmark("comm-A", "stg-2");
      expect(result.staging).toBe(true);
      expect(result.envelope).toBeUndefined();
    });
  });

  describe("B4-cross — onBatchClosed callback + remote landmark/envelope cache", () => {
    it("onBatchClosed fires after closeBatch with full event payload", () => {
      const events = [];
      const unsub = batcher.onBatchClosed((evt) => events.push(evt));
      batcher.enqueueEvent(
        "comm-cb",
        makeSignedMessage(identity, { id: "cb-1" }),
      );
      batcher.enqueueEvent(
        "comm-cb",
        makeSignedMessage(identity, { id: "cb-2" }),
      );
      batcher.closeBatch("comm-cb");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        communityId: "comm-cb",
        treeSize: 2,
      });
      expect(events[0].landmark).toBeDefined();
      expect(events[0].manifest).toBeDefined();
      expect(events[0].batchId).toMatch(/^\d{6}$/);
      expect(events[0].treeHeadId).toBeTruthy();

      // unsubscribe stops further events
      unsub();
      batcher.enqueueEvent(
        "comm-cb",
        makeSignedMessage(identity, { id: "cb-3" }),
      );
      batcher.closeBatch("comm-cb");
      expect(events).toHaveLength(1);
    });

    it("onBatchClosed handler exception swallowed (independence)", () => {
      const ok = vi.fn();
      batcher.onBatchClosed(() => {
        throw new Error("boom");
      });
      batcher.onBatchClosed(ok);
      batcher.enqueueEvent(
        "comm-iso",
        makeSignedMessage(identity, { id: "iso-1" }),
      );
      const result = batcher.closeBatch("comm-iso");
      expect(result.skipped).toBe(false);
      expect(ok).toHaveBeenCalledOnce();
    });

    it("onBatchClosed rejects non-function", () => {
      expect(() => batcher.onBatchClosed("not-a-fn")).toThrow(TypeError);
    });

    it("storeRemoteLandmark + findRemoteLandmark round-trip", () => {
      const fakeLandmark = {
        snapshots: [{ tree_head_id: "sha256:abc-remote" }],
        trust_anchors: [],
      };
      const r = batcher.storeRemoteLandmark(
        "comm-rem",
        "sha256:abc-remote",
        fakeLandmark,
      );
      expect(r.stored).toBe(true);
      expect(r.path).toContain("remote-landmarks");

      const got = batcher.findRemoteLandmark("comm-rem", "sha256:abc-remote");
      expect(got).toEqual(fakeLandmark);

      // idempotent — second store says alreadyExists
      const r2 = batcher.storeRemoteLandmark(
        "comm-rem",
        "sha256:abc-remote",
        fakeLandmark,
      );
      expect(r2.alreadyExists).toBe(true);
    });

    it("findRemoteLandmark returns null for unknown treeHeadId", () => {
      expect(batcher.findRemoteLandmark("comm-rem", "sha256:nope")).toBeNull();
    });

    it("storeRemoteLandmark sanitizes treeHeadId for filesystem (':' → '_')", () => {
      // sha256: prefix has a colon; ensure the file is created without
      // breaking on Windows
      batcher.storeRemoteLandmark("comm-fs", "sha256:colon-test", {
        snapshots: [{ tree_head_id: "x" }],
      });
      const dir = path.join(tmpDir, "comm-fs", "remote-landmarks");
      const files = fs.readdirSync(dir);
      expect(files.length).toBe(1);
      expect(files[0]).not.toContain(":"); // sanitized
    });

    it("storeRemoteEnvelope + findEnvelope (origin=remote) round-trip", () => {
      const fakeEnvelope = {
        schema: "envelope/v1",
        namespace: "mtc/v1/channel/comm-rem/000005",
        tree_head_id: "sha256:remote-th",
        leaf: { kind: "channel-message", message_id: "remote-msg-1" },
        inclusion_proof: { leaf_index: 3, tree_size: 10, audit_path: [] },
      };
      const r = batcher.storeRemoteEnvelope(
        "comm-rem",
        "remote-msg-1",
        fakeEnvelope,
      );
      expect(r.stored).toBe(true);

      const found = batcher.findEnvelope("comm-rem", "remote-msg-1");
      expect(found.found).toBe(true);
      expect(found.origin).toBe("remote");
      expect(found.treeHeadId).toBe("sha256:remote-th");
      expect(found.leafIndex).toBe(3);
    });

    it("storeRemoteEnvelope rejects unsafe messageId", () => {
      expect(() =>
        batcher.storeRemoteEnvelope("comm-rem", "../escape", { x: 1 }),
      ).toThrow(/unsafe/);
    });

    it("loadEnvelopeAndLandmark for remote envelope grabs matching remote landmark", () => {
      const treeHeadId = "sha256:remote-th-2";
      batcher.storeRemoteLandmark("comm-bundle", treeHeadId, {
        snapshots: [{ tree_head_id: treeHeadId }],
      });
      batcher.storeRemoteEnvelope("comm-bundle", "rem-msg-bundle", {
        schema: "envelope/v1",
        tree_head_id: treeHeadId,
        leaf: { message_id: "rem-msg-bundle" },
        inclusion_proof: { leaf_index: 0 },
      });

      const result = batcher.loadEnvelopeAndLandmark(
        "comm-bundle",
        "rem-msg-bundle",
      );
      expect(result.found).toBe(true);
      expect(result.origin).toBe("remote");
      expect(result.envelope.leaf.message_id).toBe("rem-msg-bundle");
      expect(result.landmark.snapshots[0].tree_head_id).toBe(treeHeadId);
    });

    it("loadEnvelopeAndLandmark for remote envelope without landmark returns landmark=null", () => {
      batcher.storeRemoteEnvelope("comm-orphan", "orphan-msg", {
        schema: "envelope/v1",
        tree_head_id: "sha256:never-cached",
        leaf: { message_id: "orphan-msg" },
        inclusion_proof: { leaf_index: 0 },
      });
      const result = batcher.loadEnvelopeAndLandmark(
        "comm-orphan",
        "orphan-msg",
      );
      expect(result.found).toBe(true);
      expect(result.envelope).toBeDefined();
      expect(result.landmark).toBeNull();
    });

    it("local origin tag preserved on findEnvelope for self-batched messages", () => {
      batcher.enqueueEvent(
        "comm-local",
        makeSignedMessage(identity, { id: "self-msg" }),
      );
      batcher.closeBatch("comm-local");
      const found = batcher.findEnvelope("comm-local", "self-msg");
      expect(found.origin).toBe("local");
    });
  });

  describe("closeAllPending", () => {
    it("walks every community subdir", async () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "a1" }));
      batcher.enqueueEvent("comm-B", makeSignedMessage(identity, { id: "b1" }));
      batcher.enqueueEvent("comm-C", makeSignedMessage(identity, { id: "c1" }));

      const results = await batcher.closeAllPending();
      const closedComms = results
        .filter((r) => !r.skipped)
        .map((r) => r.communityId);
      expect(closedComms.sort()).toEqual(["comm-A", "comm-B", "comm-C"]);
    });

    it("skips communities with no staged events", async () => {
      // Create an empty community dir
      fs.mkdirSync(path.join(tmpDir, "comm-empty", "staging"), {
        recursive: true,
      });
      const results = await batcher.closeAllPending();
      const empty = results.find((r) => r.communityId === "comm-empty");
      expect(empty.skipped).toBe(true);
    });
  });
});
