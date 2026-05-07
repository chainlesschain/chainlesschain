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
        "mtc.archive.has-stored-webdav-credentials",
        "mtc.governance-mofn.create",
        "mtc.governance-mofn.sign",
        "mtc.governance-mofn.sign-as-self",
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

    describe("has-stored-webdav-credentials (B4-cred-persist v1)", () => {
      it("returns true when sync-credentials reports a saved webdav config", async () => {
        const syncCredentials = {
          hasCredentials: vi.fn().mockReturnValue(true),
        };
        const h = createCommunityMtcHandlers({
          syncCredentials,
        })["mtc.archive.has-stored-webdav-credentials"];
        const r = await h();
        expect(r.success).toBe(true);
        expect(r.hasCredentials).toBe(true);
        expect(syncCredentials.hasCredentials).toHaveBeenCalledWith("webdav");
      });

      it("returns false when no credentials saved yet", async () => {
        const syncCredentials = {
          hasCredentials: vi.fn().mockReturnValue(false),
        };
        const h = createCommunityMtcHandlers({
          syncCredentials,
        })["mtc.archive.has-stored-webdav-credentials"];
        const r = await h();
        expect(r.success).toBe(true);
        expect(r.hasCredentials).toBe(false);
      });

      it("returns clean error envelope when syncCredentials missing", async () => {
        const h = createCommunityMtcHandlers({})[
          "mtc.archive.has-stored-webdav-credentials"
        ];
        const r = await h();
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/syncCredentials not injected/);
      });

      it("never leaks credential material — only boolean", async () => {
        const syncCredentials = {
          hasCredentials: vi.fn().mockReturnValue(true),
        };
        const h = createCommunityMtcHandlers({
          syncCredentials,
        })["mtc.archive.has-stored-webdav-credentials"];
        const r = await h();
        // critical safety invariant
        expect(r).not.toHaveProperty("password");
        expect(r).not.toHaveProperty("url");
        expect(r).not.toHaveProperty("username");
        expect(Object.keys(r).sort()).toEqual(["hasCredentials", "success"]);
      });
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

    describe("sign-as-self (B4-mofn-sign v2)", () => {
      const validIdentity = {
        did: "did:chainlesschain:abc",
        public_key_sign: Buffer.alloc(32, 7).toString("base64"),
        private_key_ref: JSON.stringify({
          sign: Buffer.alloc(64, 8).toString("base64"),
          encrypt: Buffer.alloc(32, 9).toString("base64"),
        }),
      };

      it("resolves identity from didManager + delegates to addSignature", async () => {
        const didMgr = {
          getCurrentIdentity: vi.fn().mockReturnValue(validIdentity),
        };
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
          didManager: didMgr,
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(true);
        expect(r.signerDID).toBe("did:chainlesschain:abc");
        expect(didMgr.getCurrentIdentity).toHaveBeenCalledOnce();
        expect(mofnMock.addSignature).toHaveBeenCalledOnce();
        const [, , signerKeys] = mofnMock.addSignature.mock.calls[0];
        expect(signerKeys.did).toBe("did:chainlesschain:abc");
        expect(Buffer.isBuffer(signerKeys.secretKey)).toBe(true);
        expect(signerKeys.secretKey.length).toBe(64);
        expect(Buffer.isBuffer(signerKeys.publicKey)).toBe(true);
        expect(signerKeys.publicKey.length).toBe(32);
      });

      it("rejects when didManager missing", async () => {
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/didManager not initialized/);
      });

      it("rejects when no current identity (not logged in)", async () => {
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
          didManager: { getCurrentIdentity: () => null },
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/not logged in/);
      });

      it("rejects when identity has no signing keys", async () => {
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
          didManager: {
            getCurrentIdentity: () => ({ did: "did:chainlesschain:nokey" }),
          },
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/missing signing keys/);
      });

      it("rejects when private_key_ref is malformed JSON", async () => {
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
          didManager: {
            getCurrentIdentity: () => ({
              did: "did:chainlesschain:bad",
              public_key_sign: "AAAA",
              private_key_ref: "{not json",
            }),
          },
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/parseable JSON/);
      });

      it("rejects when private_key_ref.sign field missing", async () => {
        const h = createCommunityMtcHandlers({
          governanceMultiSig: mofnMock,
          didManager: {
            getCurrentIdentity: () => ({
              did: "did:chainlesschain:nosign",
              public_key_sign: "AAAA",
              private_key_ref: JSON.stringify({ encrypt: "BBBB" }),
            }),
          },
        })["mtc.governance-mofn.sign-as-self"];
        const r = await h({ communityId: "c", proposalId: "p1" });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/private_key_ref\.sign missing/);
      });
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
