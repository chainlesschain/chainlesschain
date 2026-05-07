/**
 * community-mtc-handlers WS handler tests — verifies every B4 IPC
 * handler has a parallel WS topic that returns the same shape (wrapped
 * in {success, ...}) and tolerates null managers cleanly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  createCommunityMtcHandlers,
} = require("../handlers/community-mtc-handlers.js");

function makeBatcherMock() {
  return {
    loadEnvelopeAndLandmark: vi.fn().mockReturnValue({
      found: true,
      origin: "local",
      envelope: { schema: "envelope/v1" },
      landmark: { snapshots: [{ tree_head_id: "th-1" }] },
      treeHeadId: "th-1",
    }),
  };
}

function makeDistMock() {
  return {
    requestEnvelope: vi.fn().mockResolvedValue({ schema: "envelope/v1" }),
  };
}

function makeP2pMock(peers = ["12D3KooWPeer"]) {
  return {
    getConnectedPeers: vi.fn().mockReturnValue(peers),
  };
}

describe("createCommunityMtcHandlers", () => {
  it("registers all expected topics", () => {
    const handlers = createCommunityMtcHandlers({});
    expect(Object.keys(handlers).sort()).toEqual(
      [
        "mtc.envelope.get",
        "mtc.archive.push",
        "mtc.archive.restore",
        "mtc.archive.list",
        "mtc.governance-mofn.create",
        "mtc.governance-mofn.sign",
        "mtc.governance-mofn.status",
        "mtc.governance-mofn.finalize",
        "mtc.governance-mofn.list",
        "mtc.cross-fed-trust.establish",
        "mtc.cross-fed-trust.revoke",
        "mtc.cross-fed-trust.list",
        "mtc.cross-fed-trust.get-trusted-dids",
      ].sort(),
    );
  });

  describe("mtc.envelope.get", () => {
    it("returns local envelope on hit", async () => {
      const batcher = makeBatcherMock();
      const handlers = createCommunityMtcHandlers({
        channelEventBatcher: batcher,
      });
      const r = await handlers["mtc.envelope.get"]({
        communityId: "c",
        messageId: "m",
      });
      expect(r.success).toBe(true);
      expect(r.origin).toBe("local");
      expect(batcher.loadEnvelopeAndLandmark).toHaveBeenCalledWith("c", "m");
    });

    it("falls through to peer-pull when local miss + caches via reload", async () => {
      const batcher = {
        loadEnvelopeAndLandmark: vi
          .fn()
          .mockReturnValueOnce({ found: false }) // first call: not local
          .mockReturnValueOnce({
            found: true,
            origin: "remote",
            envelope: { schema: "envelope/v1" },
            landmark: null,
            treeHeadId: "th-pull",
          }),
      };
      const dist = makeDistMock();
      const p2p = makeP2pMock();
      const h = createCommunityMtcHandlers({
        channelEventBatcher: batcher,
        channelEnvelopeDistribution: dist,
        p2pManager: p2p,
      })["mtc.envelope.get"];
      const r = await h({ communityId: "c", messageId: "m" });
      expect(r.success).toBe(true);
      expect(r.origin).toBe("remote");
      expect(dist.requestEnvelope).toHaveBeenCalledWith(
        "12D3KooWPeer",
        "c",
        "m",
      );
    });

    it("returns success:false with reason when no batcher", async () => {
      const h = createCommunityMtcHandlers({})["mtc.envelope.get"];
      const r = await h({ communityId: "c", messageId: "m" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not initialized/);
    });

    it("returns success:false on missing args", async () => {
      const h = createCommunityMtcHandlers({
        channelEventBatcher: makeBatcherMock(),
      })["mtc.envelope.get"];
      const r = await h({});
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/required/);
    });
  });

  describe("mtc.archive.*", () => {
    it("push delegates to archiver + provider factory", async () => {
      const archiver = {
        push: vi
          .fn()
          .mockResolvedValue({ ok: true, name: "x.zip", bytes: 100 }),
      };
      const factory = vi.fn().mockReturnValue({ putFile: vi.fn() });
      const h = createCommunityMtcHandlers({
        channelEnvelopeArchiver: archiver,
        archiveProviderFactory: factory,
      })["mtc.archive.push"];
      const r = await h({
        communityId: "c",
        providerSpec: { kind: "filesystem", rootDir: "/tmp/x" },
      });
      expect(r.success).toBe(true);
      expect(factory).toHaveBeenCalledWith({
        kind: "filesystem",
        rootDir: "/tmp/x",
      });
      expect(archiver.push).toHaveBeenCalledOnce();
    });

    it("restore delegates", async () => {
      const archiver = {
        restore: vi
          .fn()
          .mockResolvedValue({ ok: true, restored: 3, skipped: 0 }),
      };
      const h = createCommunityMtcHandlers({
        channelEnvelopeArchiver: archiver,
        archiveProviderFactory: () => ({}),
      })["mtc.archive.restore"];
      const r = await h({
        communityId: "c",
        archiveName: "foo.zip",
        providerSpec: { kind: "filesystem", rootDir: "/tmp/x" },
      });
      expect(r.success).toBe(true);
      expect(r.result.restored).toBe(3);
    });

    it("list delegates", async () => {
      const archiver = { list: vi.fn().mockResolvedValue(["a.zip", "b.zip"]) };
      const h = createCommunityMtcHandlers({
        channelEnvelopeArchiver: archiver,
        archiveProviderFactory: () => ({}),
      })["mtc.archive.list"];
      const r = await h({
        communityId: "c",
        providerSpec: { kind: "filesystem", rootDir: "/tmp/x" },
      });
      expect(r.success).toBe(true);
      expect(r.archives).toEqual(["a.zip", "b.zip"]);
    });

    it("returns error when archiveProviderFactory missing", async () => {
      const h = createCommunityMtcHandlers({
        channelEnvelopeArchiver: { push: vi.fn() },
      })["mtc.archive.push"];
      const r = await h({
        communityId: "c",
        providerSpec: { kind: "filesystem", rootDir: "/tmp/x" },
      });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/archiveProviderFactory/);
    });

    it("returns error on missing providerSpec", async () => {
      const h = createCommunityMtcHandlers({
        channelEnvelopeArchiver: { push: vi.fn() },
        archiveProviderFactory: () => ({}),
      })["mtc.archive.push"];
      const r = await h({ communityId: "c" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/provider spec/);
    });
  });

  describe("mtc.governance-mofn.*", () => {
    let mofnMock;
    beforeEach(() => {
      mofnMock = {
        createProposal: vi.fn().mockReturnValue({ proposalId: "p1" }),
        addSignature: vi
          .fn()
          .mockReturnValue({ collected: 1, complete: false }),
        getStatus: vi.fn().mockReturnValue({ collected: 1, complete: false }),
        finalize: vi.fn().mockReturnValue({ ok: true, treeHeadId: "th-fin" }),
        listProposals: vi.fn().mockReturnValue([{ proposalId: "p1" }]),
      };
    });

    it("create delegates", async () => {
      const h = createCommunityMtcHandlers({ governanceMultiSig: mofnMock })[
        "mtc.governance-mofn.create"
      ];
      const r = await h({
        communityId: "c",
        proposalId: "p1",
        payload: { x: 1 },
        members: ["did:chainlesschain:abc"],
        threshold: 1,
      });
      expect(r.success).toBe(true);
      expect(mofnMock.createProposal).toHaveBeenCalledOnce();
    });

    it("sign revives base64 keys to Buffer", async () => {
      const h = createCommunityMtcHandlers({ governanceMultiSig: mofnMock })[
        "mtc.governance-mofn.sign"
      ];
      await h({
        communityId: "c",
        proposalId: "p1",
        signerKeys: {
          did: "did:chainlesschain:abc",
          secretKey: Buffer.alloc(64).toString("base64"),
          publicKey: Buffer.alloc(32).toString("base64"),
        },
      });
      expect(mofnMock.addSignature).toHaveBeenCalledOnce();
      const [, , revivedKeys] = mofnMock.addSignature.mock.calls[0];
      expect(Buffer.isBuffer(revivedKeys.secretKey)).toBe(true);
      expect(revivedKeys.secretKey.length).toBe(64);
      expect(Buffer.isBuffer(revivedKeys.publicKey)).toBe(true);
      expect(revivedKeys.publicKey.length).toBe(32);
    });

    it("sign rejects missing signerKeys", async () => {
      const h = createCommunityMtcHandlers({ governanceMultiSig: mofnMock })[
        "mtc.governance-mofn.sign"
      ];
      const r = await h({ communityId: "c", proposalId: "p1" });
      expect(r.success).toBe(false);
    });

    it("status / finalize / list delegate cleanly", async () => {
      const h = createCommunityMtcHandlers({ governanceMultiSig: mofnMock });
      expect(
        (
          await h["mtc.governance-mofn.status"]({
            communityId: "c",
            proposalId: "p1",
          })
        ).success,
      ).toBe(true);
      expect(
        (
          await h["mtc.governance-mofn.finalize"]({
            communityId: "c",
            proposalId: "p1",
          })
        ).success,
      ).toBe(true);
      expect(
        (await h["mtc.governance-mofn.list"]({ communityId: "c" })).success,
      ).toBe(true);
    });

    it("returns error when governanceMultiSig missing", async () => {
      const r = await createCommunityMtcHandlers({})[
        "mtc.governance-mofn.create"
      ]({});
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not initialized/);
    });
  });

  describe("mtc.cross-fed-trust.*", () => {
    let trustMock;
    beforeEach(() => {
      trustMock = {
        establishTrust: vi
          .fn()
          .mockReturnValue({ remoteCommunityId: "comm-B" }),
        revokeTrust: vi.fn().mockReturnValue(true),
        listTrusted: vi.fn().mockReturnValue([{ remoteCommunityId: "comm-B" }]),
        getTrustedDIDs: vi.fn().mockReturnValue(["did:chainlesschain:abc"]),
      };
    });

    it("establish delegates with localCommunityId stripped from rest", async () => {
      const h = createCommunityMtcHandlers({ crossFedTrust: trustMock })[
        "mtc.cross-fed-trust.establish"
      ];
      const r = await h({
        localCommunityId: "comm-A",
        remoteCommunityId: "comm-B",
        remoteMembers: ["did:chainlesschain:abc"],
      });
      expect(r.success).toBe(true);
      const [localId, args] = trustMock.establishTrust.mock.calls[0];
      expect(localId).toBe("comm-A");
      expect(args.remoteCommunityId).toBe("comm-B");
      expect(args).not.toHaveProperty("localCommunityId");
    });

    it("revoke / list / get-trusted-dids delegate", async () => {
      const h = createCommunityMtcHandlers({ crossFedTrust: trustMock });
      expect(
        (
          await h["mtc.cross-fed-trust.revoke"]({
            localCommunityId: "comm-A",
            remoteCommunityId: "comm-B",
          })
        ).success,
      ).toBe(true);
      const lst = await h["mtc.cross-fed-trust.list"]({
        localCommunityId: "comm-A",
      });
      expect(lst.success).toBe(true);
      expect(lst.records).toHaveLength(1);
      const dids = await h["mtc.cross-fed-trust.get-trusted-dids"]({
        localCommunityId: "comm-A",
      });
      expect(dids.success).toBe(true);
      expect(dids.dids).toEqual(["did:chainlesschain:abc"]);
    });

    it("returns error envelope when crossFedTrust missing", async () => {
      const h = createCommunityMtcHandlers({});
      const r = await h["mtc.cross-fed-trust.establish"]({});
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not initialized/);
    });
  });

  describe("error envelope", () => {
    it("synchronous handler throws are caught + reported", async () => {
      const batcher = {
        loadEnvelopeAndLandmark: vi.fn(() => {
          throw new Error("disk corrupt");
        }),
      };
      const h = createCommunityMtcHandlers({ channelEventBatcher: batcher })[
        "mtc.envelope.get"
      ];
      const r = await h({ communityId: "c", messageId: "m" });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/disk corrupt/);
    });
  });
});
