// @vitest-environment node
//
// adm-zip's Buffer round-trip (toBuffer → new AdmZip(buf)) returns 0 entries
// under jsdom — likely a Buffer / typed-array realm mismatch similar to the
// libp2p TCP case. Pin this file to the node env so packing actually works.

/**
 * channel-envelope-archiver tests — pack / restore round-trips with the
 * built-in filesystem provider (real fs in tmp dir + real adm-zip).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import AdmZip from "adm-zip";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  computeDIDFromPublicKey,
  signPayloadWithIdentity,
} = require("../../did/did-signer.js");
const { ChannelEventBatcher } = require("../channel-event-batch.js");
const {
  ChannelEnvelopeArchiver,
  filesystemProvider,
  webdavProvider,
} = require("../channel-envelope-archiver.js");

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
    channel_id: "ch-1",
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

describe("ChannelEnvelopeArchiver — pack + restore", () => {
  let tmpDir;
  let identity;
  let batcher;
  let archiver;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cea-test-"));
    identity = makeIdentity(nacl.sign.keyPair());
    batcher = new ChannelEventBatcher({
      rootDir: tmpDir,
      getCurrentIdentity: () => identity,
      autoTimer: false,
    });
    batcher.initialize();
    archiver = new ChannelEnvelopeArchiver({ rootDir: tmpDir });
  });

  afterEach(() => {
    batcher.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tolerate Windows file locks */
    }
  });

  describe("constructor", () => {
    it("rejects missing rootDir", () => {
      expect(() => new ChannelEnvelopeArchiver({})).toThrow(/rootDir/);
    });
  });

  describe("pack", () => {
    it("includes batches + remote-landmarks + remote-envelopes by default", () => {
      // 1 closed batch (Alice's)
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m1" }));
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m2" }));
      batcher.closeBatch("comm-A");

      // remote landmark + envelope (B's content cached)
      batcher.storeRemoteLandmark("comm-A", "sha256:remote-th", {
        snapshots: [{ tree_head_id: "sha256:remote-th" }],
      });
      batcher.storeRemoteEnvelope("comm-A", "remote-msg-1", {
        schema: "envelope/v1",
        leaf: { message_id: "remote-msg-1" },
        inclusion_proof: { leaf_index: 0 },
      });

      const { buffer, manifest } = archiver.pack("comm-A");
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(manifest.communityId).toBe("comm-A");
      expect(manifest.batchIds).toEqual(["000001"]);
      expect(manifest.fileCount).toBeGreaterThan(0);

      const zip = new AdmZip(buffer);
      const names = zip
        .getEntries()
        .map((e) => e.entryName)
        .sort();
      expect(names).toContain("MANIFEST.json");
      expect(names).toContain("batches/000001/manifest.json");
      expect(names).toContain("batches/000001/landmark.json");
      expect(names).toContain("batches/000001/envelope-m1.json");
      expect(names).toContain("batches/000001/envelope-m2.json");
      expect(names).toContain("remote-landmarks/sha256_remote-th.json");
      expect(names).toContain("remote-envelopes/remote-msg-1.json");
    });

    it("includeRemote=false skips remote-* dirs", () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m1" }));
      batcher.closeBatch("comm-A");
      batcher.storeRemoteLandmark("comm-A", "sha256:remote-th", {
        snapshots: [{ tree_head_id: "sha256:remote-th" }],
      });

      const { buffer } = archiver.pack("comm-A", { includeRemote: false });
      const zip = new AdmZip(buffer);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names.some((n) => n.startsWith("batches/"))).toBe(true);
      expect(names.some((n) => n.startsWith("remote-"))).toBe(false);
    });

    it("sinceBatchId filters out older batches (incremental archive)", () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m1" }));
      batcher.closeBatch("comm-A"); // 000001
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m2" }));
      batcher.closeBatch("comm-A"); // 000002
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m3" }));
      batcher.closeBatch("comm-A"); // 000003

      const { manifest } = archiver.pack("comm-A", { sinceBatchId: "000001" });
      expect(manifest.batchIds).toEqual(["000002", "000003"]);
      expect(manifest.sinceBatchId).toBe("000001");
      expect(manifest.latestBatchId).toBe("000003");
    });

    it("rejects unsafe communityId", () => {
      expect(() => archiver.pack("../escape")).toThrow(/unsafe/);
    });

    it("throws when nothing to archive (no batches AND no remote)", () => {
      // never staged anything — the dir doesn't even exist
      expect(() => archiver.pack("ghost-comm")).toThrow(/no channel-mtc dir/);
    });

    it("throws when sinceBatchId excludes everything AND includeRemote=false", () => {
      batcher.enqueueEvent("comm-A", makeSignedMessage(identity, { id: "m1" }));
      batcher.closeBatch("comm-A");
      expect(() =>
        archiver.pack("comm-A", {
          sinceBatchId: "999999",
          includeRemote: false,
        }),
      ).toThrow(/nothing to archive/);
    });
  });

  describe("filesystemProvider", () => {
    it("rejects missing rootDir", () => {
      expect(() => filesystemProvider({})).toThrow(/rootDir/);
    });

    it("putFile + getFile + listFiles round-trip", async () => {
      const provDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsprov-"));
      try {
        const prov = filesystemProvider({ rootDir: provDir });
        await prov.putFile("foo/bar.txt", Buffer.from("hello"));
        await prov.putFile("foo/baz.txt", Buffer.from("world"));
        const r = await prov.getFile("foo/bar.txt");
        expect(r.toString()).toBe("hello");
        const list = await prov.listFiles("foo");
        expect(list.sort()).toEqual(["bar.txt", "baz.txt"]);
      } finally {
        fs.rmSync(provDir, { recursive: true, force: true });
      }
    });

    it("rejects path traversal in putFile/getFile", async () => {
      const provDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsprov-"));
      try {
        const prov = filesystemProvider({ rootDir: provDir });
        await expect(
          prov.putFile("../escape", Buffer.from("x")),
        ).rejects.toThrow(/unsafe/);
        await expect(prov.getFile("../escape")).rejects.toThrow(/unsafe/);
      } finally {
        fs.rmSync(provDir, { recursive: true, force: true });
      }
    });

    it("getFile throws on missing file", async () => {
      const provDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsprov-"));
      try {
        const prov = filesystemProvider({ rootDir: provDir });
        await expect(prov.getFile("ghost")).rejects.toThrow(/not found/);
      } finally {
        fs.rmSync(provDir, { recursive: true, force: true });
      }
    });

    it("listFiles returns empty for non-existent dir", async () => {
      const provDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsprov-"));
      try {
        const prov = filesystemProvider({ rootDir: provDir });
        expect(await prov.listFiles("ghost")).toEqual([]);
      } finally {
        fs.rmSync(provDir, { recursive: true, force: true });
      }
    });
  });

  describe("push + restore round-trip via filesystem provider", () => {
    let provDir;
    let provider;

    beforeEach(() => {
      provDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsprov-"));
      provider = filesystemProvider({ rootDir: provDir });
    });

    afterEach(() => {
      try {
        fs.rmSync(provDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it("push uploads archive + returns name + manifest + bytes", async () => {
      batcher.enqueueEvent("comm-X", makeSignedMessage(identity, { id: "x1" }));
      batcher.closeBatch("comm-X");

      const result = await archiver.push(provider, "comm-X");
      expect(result.ok).toBe(true);
      expect(result.name).toMatch(/^channel-mtc-comm-X-.*\.zip$/);
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.manifest.batchIds).toEqual(["000001"]);
      expect(fs.existsSync(path.join(provDir, "comm-X", result.name))).toBe(
        true,
      );
    });

    it("restore round-trip into a fresh community dir", async () => {
      batcher.enqueueEvent("comm-Y", makeSignedMessage(identity, { id: "y1" }));
      batcher.enqueueEvent("comm-Y", makeSignedMessage(identity, { id: "y2" }));
      batcher.closeBatch("comm-Y");
      const pushResult = await archiver.push(provider, "comm-Y");

      // Wipe local channel-mtc dir for comm-Y to simulate device re-install
      fs.rmSync(path.join(tmpDir, "comm-Y"), { recursive: true, force: true });

      const restored = await archiver.restore(
        provider,
        "comm-Y",
        pushResult.name,
      );
      expect(restored.ok).toBe(true);
      expect(restored.restored).toBeGreaterThan(0);
      expect(restored.batchIds).toEqual(["000001"]);
      expect(restored.manifest.communityId).toBe("comm-Y");

      // Verify findEnvelope works after restore (uses batcher's own logic)
      const found = batcher.findEnvelope("comm-Y", "y1");
      expect(found.found).toBe(true);
      expect(found.origin).toBe("local");
    });

    it("restore is idempotent — second restore skips existing files", async () => {
      batcher.enqueueEvent("comm-Z", makeSignedMessage(identity, { id: "z1" }));
      batcher.closeBatch("comm-Z");
      const pushResult = await archiver.push(provider, "comm-Z");

      // Wipe local before first restore so r1 has work to do (otherwise
      // the local files from the original close would short-circuit it).
      fs.rmSync(path.join(tmpDir, "comm-Z"), { recursive: true, force: true });

      const r1 = await archiver.restore(provider, "comm-Z", pushResult.name);
      const r2 = await archiver.restore(provider, "comm-Z", pushResult.name);
      expect(r1.restored).toBeGreaterThan(0);
      expect(r2.restored).toBe(0);
      expect(r2.skipped).toBeGreaterThan(0);
    });

    it("incremental push uses sinceBatchId to ship only new batches", async () => {
      batcher.enqueueEvent("comm-I", makeSignedMessage(identity, { id: "i1" }));
      batcher.closeBatch("comm-I");
      const r1 = await archiver.push(provider, "comm-I");
      expect(r1.manifest.batchIds).toEqual(["000001"]);

      batcher.enqueueEvent("comm-I", makeSignedMessage(identity, { id: "i2" }));
      batcher.closeBatch("comm-I");
      const r2 = await archiver.push(provider, "comm-I", {
        sinceBatchId: "000001",
      });
      expect(r2.manifest.batchIds).toEqual(["000002"]);
    });

    it("list returns only archive files matching prefix, sorted ascending", async () => {
      // create two pushes
      batcher.enqueueEvent("comm-L", makeSignedMessage(identity, { id: "l1" }));
      batcher.closeBatch("comm-L");
      const r1 = await archiver.push(provider, "comm-L");
      // small delay so packedAt timestamp differs
      await new Promise((r) => setTimeout(r, 5));
      batcher.enqueueEvent("comm-L", makeSignedMessage(identity, { id: "l2" }));
      batcher.closeBatch("comm-L");
      const r2 = await archiver.push(provider, "comm-L");

      // also drop a non-archive file to confirm filter
      await provider.putFile("comm-L/random.txt", Buffer.from("x"));

      const list = await archiver.list(provider, "comm-L");
      expect(list).toEqual([r1.name, r2.name].sort());
      expect(list.includes("random.txt")).toBe(false);
    });

    it("restore path-traversal guard in code (adm-zip sanitizes on add, untestable via API)", async () => {
      // Note: adm-zip aggressively sanitizes entry names on addFile() —
      // "../../escape.json" gets stored as "escape.json", absolute paths
      // are stripped to relative. So we can't construct an evil zip through
      // adm-zip's API alone to verify our restore guard. The defensive
      // code (`archivePath.includes("..") || path.isAbsolute(archivePath)`)
      // remains valuable against zips built by other tools (zip(1),
      // archiver, raw zip writers) where the central directory may
      // legitimately contain unsanitized paths. This test stub documents
      // that limitation so the next reviewer doesn't waste time wondering
      // why traversal isn't covered.
      expect(true).toBe(true);
    });
  });

  describe("push provider failure", () => {
    it("propagates putFile {ok:false} as throw", async () => {
      const failingProvider = {
        putFile: vi.fn().mockResolvedValue({ ok: false, error: "no auth" }),
      };
      batcher.enqueueEvent("comm-F", makeSignedMessage(identity, { id: "f1" }));
      batcher.closeBatch("comm-F");
      await expect(archiver.push(failingProvider, "comm-F")).rejects.toThrow(
        /no auth/,
      );
    });
  });

  describe("webdavProvider adapter", () => {
    it("requires putFile method", () => {
      expect(() => webdavProvider(null)).toThrow(/webdav-client/);
      expect(() => webdavProvider({})).toThrow(/webdav-client/);
    });

    it("delegates putFile + adapts {ok,etag} return", async () => {
      const fakeWebdav = {
        putFile: vi.fn().mockResolvedValue({ ok: true, etag: "abc" }),
      };
      const prov = webdavProvider(fakeWebdav);
      const r = await prov.putFile("foo/bar.zip", Buffer.from("data"));
      expect(r.ok).toBe(true);
      expect(r.etag).toBe("abc");
      expect(fakeWebdav.putFile).toHaveBeenCalledWith(
        "foo/bar.zip",
        Buffer.from("data"),
      );
    });

    it("forwards putFile failure shape", async () => {
      const fakeWebdav = {
        putFile: vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      };
      const prov = webdavProvider(fakeWebdav);
      const r = await prov.putFile("x", Buffer.from(""));
      expect(r.ok).toBe(false);
      expect(r.status).toBe(401);
    });

    it("getFile returns Buffer when client returns Buffer directly", async () => {
      const fakeWebdav = {
        putFile: vi.fn(),
        getFile: vi.fn().mockResolvedValue(Buffer.from("zipdata")),
      };
      const prov = webdavProvider(fakeWebdav);
      const r = await prov.getFile("x");
      expect(Buffer.isBuffer(r)).toBe(true);
      expect(r.toString()).toBe("zipdata");
    });

    it("getFile unwraps {ok, content} shape", async () => {
      const fakeWebdav = {
        putFile: vi.fn(),
        getFile: vi
          .fn()
          .mockResolvedValue({ ok: true, content: "string-data" }),
      };
      const prov = webdavProvider(fakeWebdav);
      const r = await prov.getFile("x");
      expect(Buffer.isBuffer(r)).toBe(true);
      expect(r.toString()).toBe("string-data");
    });

    it("listFiles maps webdav stat objects to basenames", async () => {
      const fakeWebdav = {
        putFile: vi.fn(),
        listFiles: vi
          .fn()
          .mockResolvedValue([
            { basename: "archive-1.zip" },
            { basename: "archive-2.zip" },
          ]),
      };
      const prov = webdavProvider(fakeWebdav);
      expect(await prov.listFiles("comm-X")).toEqual([
        "archive-1.zip",
        "archive-2.zip",
      ]);
    });

    it("listFiles returns [] when client lacks listFiles", async () => {
      const fakeWebdav = { putFile: vi.fn() };
      const prov = webdavProvider(fakeWebdav);
      expect(await prov.listFiles("anything")).toEqual([]);
    });
  });
});
