// @vitest-environment node
//
// node env required (real fs + core-mtc primitives).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import nacl from "tweetnacl";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { computeDIDFromPublicKey } = require("../../did/did-signer.js");
const { GovernanceMultiSig } = require("../governance-multisig.js");

function genMember() {
  const kp = nacl.sign.keyPair();
  return {
    did: computeDIDFromPublicKey(kp.publicKey),
    secretKey: Buffer.from(kp.secretKey),
    publicKey: Buffer.from(kp.publicKey),
  };
}

describe("GovernanceMultiSig", () => {
  let tmpDir;
  let mgr;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mofn-"));
    mgr = new GovernanceMultiSig({ rootDir: tmpDir });
    mgr.initialize();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tolerate Windows file locks */
    }
  });

  describe("constructor", () => {
    it("rejects missing rootDir", () => {
      expect(() => new GovernanceMultiSig({})).toThrow(/rootDir/);
    });
  });

  describe("createProposal", () => {
    it("creates proposal record + signatures dir", () => {
      const m = [genMember(), genMember(), genMember()];
      const result = mgr.createProposal({
        communityId: "comm-A",
        proposalId: "prop-rule-1",
        payload: { kind: "rule_change", body: "new rule" },
        members: m.map((x) => x.did),
        threshold: 2,
      });
      expect(result.threshold).toBe(2);
      expect(result.members).toHaveLength(3);
      expect(
        fs.existsSync(
          path.join(tmpDir, "comm-A", "prop-rule-1", "proposal.json"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "comm-A", "prop-rule-1", "signatures")),
      ).toBe(true);
    });

    it("rejects threshold > members.length", () => {
      const m = [genMember()];
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 1 },
          members: m.map((x) => x.did),
          threshold: 5,
        }),
      ).toThrow(/threshold/);
    });

    it("rejects threshold < 1", () => {
      const m = [genMember()];
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 1 },
          members: m.map((x) => x.did),
          threshold: 0,
        }),
      ).toThrow(/threshold/);
    });

    it("rejects empty members list", () => {
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 1 },
          members: [],
          threshold: 1,
        }),
      ).toThrow(/members/);
    });

    it("rejects duplicate members", () => {
      const a = genMember();
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 1 },
          members: [a.did, a.did],
          threshold: 1,
        }),
      ).toThrow(/duplicates/);
    });

    it("rejects malformed DID in members", () => {
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 1 },
          members: ["not-a-did"],
          threshold: 1,
        }),
      ).toThrow(/DID format/);
    });

    it("rejects unsafe communityId / proposalId", () => {
      const m = [genMember()];
      expect(() =>
        mgr.createProposal({
          communityId: "../escape",
          proposalId: "p",
          payload: { x: 1 },
          members: m.map((x) => x.did),
          threshold: 1,
        }),
      ).toThrow(/unsafe/);
    });

    it("refuses to overwrite existing proposal", () => {
      const m = [genMember()];
      mgr.createProposal({
        communityId: "c",
        proposalId: "p",
        payload: { x: 1 },
        members: m.map((x) => x.did),
        threshold: 1,
      });
      expect(() =>
        mgr.createProposal({
          communityId: "c",
          proposalId: "p",
          payload: { x: 2 },
          members: m.map((x) => x.did),
          threshold: 1,
        }),
      ).toThrow(/already exists/);
    });
  });

  describe("addSignature", () => {
    let members;
    beforeEach(() => {
      members = [genMember(), genMember(), genMember()];
      mgr.createProposal({
        communityId: "c",
        proposalId: "p",
        payload: { x: 1 },
        members: members.map((m) => m.did),
        threshold: 2,
      });
    });

    it("records member's signature contribution", () => {
      const status = mgr.addSignature("c", "p", members[0]);
      expect(status.collected).toBe(1);
      expect(status.complete).toBe(false);
      expect(status.signaturesCollected[0].did).toBe(members[0].did);
      expect(
        fs.existsSync(
          path.join(
            tmpDir,
            "c",
            "p",
            "signatures",
            members[0].did.replace(/:/g, "_") + ".json",
          ),
        ),
      ).toBe(true);
    });

    it("idempotent — same DID adding twice is no-op", () => {
      mgr.addSignature("c", "p", members[0]);
      const s2 = mgr.addSignature("c", "p", members[0]);
      expect(s2.collected).toBe(1);
    });

    it("rejects non-member DID", () => {
      const stranger = genMember();
      expect(() => mgr.addSignature("c", "p", stranger)).toThrow(
        /not a member/,
      );
    });

    it("rejects when DID does not match pubkey hash", () => {
      const a = members[0];
      const b = members[1];
      // Forge: claim DID a but ship b's keys
      expect(() =>
        mgr.addSignature("c", "p", {
          did: a.did,
          secretKey: b.secretKey,
          publicKey: b.publicKey,
        }),
      ).toThrow(/mismatch/);
    });

    it("rejects keys with wrong length", () => {
      expect(() =>
        mgr.addSignature("c", "p", {
          did: members[0].did,
          secretKey: Buffer.from("short"),
          publicKey: members[0].publicKey,
        }),
      ).toThrow(/shape required/);
    });

    it("complete:true once collected reaches threshold", () => {
      mgr.addSignature("c", "p", members[0]);
      const s = mgr.addSignature("c", "p", members[1]);
      expect(s.complete).toBe(true);
      expect(s.collected).toBe(2);
    });
  });

  describe("getStatus", () => {
    it("returns proposal + signatures + complete flag", () => {
      const m = [genMember(), genMember()];
      mgr.createProposal({
        communityId: "c",
        proposalId: "p",
        payload: { x: 1 },
        members: m.map((x) => x.did),
        threshold: 2,
      });
      mgr.addSignature("c", "p", m[0]);
      const s = mgr.getStatus("c", "p");
      expect(s.collected).toBe(1);
      expect(s.complete).toBe(false);
      expect(s.threshold).toBe(2);
      expect(s.members).toHaveLength(2);
    });

    it("throws on unknown proposal", () => {
      expect(() => mgr.getStatus("c", "ghost")).toThrow(/not found/);
    });
  });

  describe("finalize", () => {
    let members;
    beforeEach(() => {
      members = [
        genMember(),
        genMember(),
        genMember(),
        genMember(),
        genMember(),
      ];
      mgr.createProposal({
        communityId: "comm-fin",
        proposalId: "prop-fin",
        payload: { kind: "rule_change", text: "no shouting" },
        members: members.map((m) => m.did),
        threshold: 3,
      });
    });

    it("throws when collected < threshold", () => {
      mgr.addSignature("comm-fin", "prop-fin", members[0]);
      expect(() => mgr.finalize("comm-fin", "prop-fin")).toThrow(
        /insufficient/,
      );
    });

    it("3-of-5 happy path: writes landmark, marks finalized", () => {
      mgr.addSignature("comm-fin", "prop-fin", members[0]);
      mgr.addSignature("comm-fin", "prop-fin", members[1]);
      mgr.addSignature("comm-fin", "prop-fin", members[2]);
      const result = mgr.finalize("comm-fin", "prop-fin");
      expect(result.ok).toBe(true);
      expect(result.threshold).toBe(3);
      expect(result.signers).toHaveLength(3);
      expect(result.treeHeadId).toMatch(/^sha256:/);

      const landmark = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, "comm-fin", "prop-fin", "landmark.json"),
          "utf-8",
        ),
      );
      expect(landmark.snapshots[0].signatures).toHaveLength(3);
      expect(landmark.snapshots[0].threshold).toBe(3);
      expect(landmark.trust_anchors).toHaveLength(3);

      const status = mgr.getStatus("comm-fin", "prop-fin");
      expect(status.finalized).toBe(true);
    });

    it("more than threshold contributions: only first M are used (deterministic)", () => {
      // Add 5 signatures even though threshold is 3
      members.forEach((m) => mgr.addSignature("comm-fin", "prop-fin", m));
      const result = mgr.finalize("comm-fin", "prop-fin");
      expect(result.signers).toHaveLength(3);
    });

    it("finalize is idempotent — second call returns same treeHeadId", () => {
      members
        .slice(0, 3)
        .forEach((m) => mgr.addSignature("comm-fin", "prop-fin", m));
      const r1 = mgr.finalize("comm-fin", "prop-fin");
      const r2 = mgr.finalize("comm-fin", "prop-fin");
      expect(r2.alreadyFinalized).toBe(true);
      expect(r2.treeHeadId).toBe(r1.treeHeadId);
    });

    it("addSignature throws after finalize", () => {
      members
        .slice(0, 3)
        .forEach((m) => mgr.addSignature("comm-fin", "prop-fin", m));
      mgr.finalize("comm-fin", "prop-fin");
      expect(() =>
        mgr.addSignature("comm-fin", "prop-fin", members[3]),
      ).toThrow(/finalized/);
    });
  });

  describe("finalize — quorum integrity (defense-in-depth #5)", () => {
    let members;
    const sigDir = () => path.join(tmpDir, "comm-q", "prop-q", "signatures");

    beforeEach(() => {
      members = [genMember(), genMember(), genMember()];
      mgr.createProposal({
        communityId: "comm-q",
        proposalId: "prop-q",
        payload: { kind: "rule_change", text: "x" },
        members: members.map((m) => m.did),
        threshold: 2,
      });
    });

    // Plant a signature file directly on disk (bypassing addSignature's
    // membership/DID checks) to simulate signatures/ directory tampering.
    function plantSig(fileName, signer) {
      fs.writeFileSync(
        path.join(sigDir(), fileName),
        JSON.stringify({
          schema: "governance-multisig-signature/v1",
          did: signer.did,
          secretKey: signer.secretKey.toString("base64"),
          publicKey: signer.publicKey.toString("base64"),
          addedAt: new Date(0).toISOString(),
        }),
        "utf-8",
      );
    }

    it("ignores a stray non-member signature file in the quorum count", () => {
      mgr.addSignature("comm-q", "prop-q", members[0]); // 1 legit
      plantSig("attacker.json", genMember()); // outsider, not a member
      expect(mgr.getStatus("comm-q", "prop-q").collected).toBe(1);
      expect(() => mgr.finalize("comm-q", "prop-q")).toThrow(/insufficient/);
    });

    it("does not double-count the same DID under a different filename", () => {
      mgr.addSignature("comm-q", "prop-q", members[0]); // 1 legit file for A
      plantSig("dup-of-a.json", members[0]); // same DID, different filename
      expect(mgr.getStatus("comm-q", "prop-q").collected).toBe(1);
      expect(() => mgr.finalize("comm-q", "prop-q")).toThrow(/insufficient/);
    });

    it("still finalizes with enough distinct members despite a stray file", () => {
      mgr.addSignature("comm-q", "prop-q", members[0]);
      mgr.addSignature("comm-q", "prop-q", members[1]); // 2 distinct members
      plantSig("attacker.json", genMember()); // stray outsider
      const result = mgr.finalize("comm-q", "prop-q");
      expect(result.ok).toBe(true);
      expect(result.signers).toHaveLength(2); // stray excluded
    });
  });

  describe("listProposals", () => {
    it("returns all proposals for a community with state summary", () => {
      const m = [genMember(), genMember()];
      mgr.createProposal({
        communityId: "comm-L",
        proposalId: "prop-1",
        payload: { x: 1 },
        members: m.map((x) => x.did),
        threshold: 2,
      });
      mgr.createProposal({
        communityId: "comm-L",
        proposalId: "prop-2",
        payload: { y: 2 },
        members: m.map((x) => x.did),
        threshold: 1,
      });
      mgr.addSignature("comm-L", "prop-1", m[0]);

      const list = mgr.listProposals("comm-L");
      const byId = Object.fromEntries(list.map((p) => [p.proposalId, p]));
      expect(byId["prop-1"].collected).toBe(1);
      expect(byId["prop-1"].finalized).toBe(false);
      expect(byId["prop-2"].collected).toBe(0);
    });

    it("returns empty list for unknown community", () => {
      expect(mgr.listProposals("never-existed")).toEqual([]);
    });
  });
});
