import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/zkp-engine.js";

describe("ZKP Engine V2 Surface", () => {
  beforeEach(() => M._resetStateZkpEngineV2());

  describe("enums", () => {
    it("circuit maturity has 4 states", () =>
      expect(Object.keys(M.ZKP_CIRCUIT_MATURITY_V2)).toHaveLength(4));
    it("proof lifecycle has 5 states", () =>
      expect(Object.keys(M.ZKP_PROOF_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.ZKP_CIRCUIT_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.ZKP_PROOF_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveZkpCircuitsPerOwnerV2", () => {
      M.setMaxActiveZkpCircuitsPerOwnerV2(25);
      expect(M.getMaxActiveZkpCircuitsPerOwnerV2()).toBe(25);
    });
    it("setMaxPendingZkpProofsPerCircuitV2", () => {
      M.setMaxPendingZkpProofsPerCircuitV2(40);
      expect(M.getMaxPendingZkpProofsPerCircuitV2()).toBe(40);
    });
    it("setZkpCircuitIdleMsV2", () => {
      M.setZkpCircuitIdleMsV2(3600000);
      expect(M.getZkpCircuitIdleMsV2()).toBe(3600000);
    });
    it("setZkpProofStuckMsV2", () => {
      M.setZkpProofStuckMsV2(60000);
      expect(M.getZkpProofStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveZkpCircuitsPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setZkpProofStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingZkpProofsPerCircuitV2(8.7);
      expect(M.getMaxPendingZkpProofsPerCircuitV2()).toBe(8);
    });
  });

  describe("circuit lifecycle", () => {
    it("register", () => {
      const c = M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      expect(c.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      const c = M.activateZkpCircuitV2("c1");
      expect(c.status).toBe("active");
      expect(c.activatedAt).toBeTruthy();
    });
    it("deprecate active→deprecated", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      M.activateZkpCircuitV2("c1");
      expect(M.deprecateZkpCircuitV2("c1").status).toBe("deprecated");
    });
    it("recovery deprecated→active preserves activatedAt", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      const c = M.activateZkpCircuitV2("c1");
      M.deprecateZkpCircuitV2("c1");
      const re = M.activateZkpCircuitV2("c1");
      expect(re.activatedAt).toBe(c.activatedAt);
    });
    it("archive terminal stamps archivedAt", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      M.activateZkpCircuitV2("c1");
      const c = M.archiveZkpCircuitV2("c1");
      expect(c.status).toBe("archived");
      expect(c.archivedAt).toBeTruthy();
    });
    it("cannot touch archived", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      M.activateZkpCircuitV2("c1");
      M.archiveZkpCircuitV2("c1");
      expect(() => M.touchZkpCircuitV2("c1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      expect(() => M.deprecateZkpCircuitV2("c1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "alice" });
      expect(() => M.registerZkpCircuitV2({ id: "c1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerZkpCircuitV2({ id: "c1" })).toThrow());
    it("list all", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "a" });
      M.registerZkpCircuitV2({ id: "c2", owner: "b" });
      expect(M.listZkpCircuitsV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getZkpCircuitV2("none")).toBeNull());
    it("defensive copy metadata", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "a", metadata: { k: 5 } });
      const c = M.getZkpCircuitV2("c1");
      c.metadata.k = 99;
      expect(M.getZkpCircuitV2("c1").metadata.k).toBe(5);
    });
    it("default scheme groth16", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "a" });
      expect(M.getZkpCircuitV2("c1").scheme).toBe("groth16");
    });
    it("scheme preserved", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "a", scheme: "plonk" });
      expect(M.getZkpCircuitV2("c1").scheme).toBe("plonk");
    });
  });

  describe("active-circuit cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveZkpCircuitsPerOwnerV2(2);
      ["c1", "c2", "c3"].forEach((id) =>
        M.registerZkpCircuitV2({ id, owner: "o" }),
      );
      M.activateZkpCircuitV2("c1");
      M.activateZkpCircuitV2("c2");
      expect(() => M.activateZkpCircuitV2("c3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveZkpCircuitsPerOwnerV2(2);
      ["c1", "c2", "c3"].forEach((id) =>
        M.registerZkpCircuitV2({ id, owner: "o" }),
      );
      M.activateZkpCircuitV2("c1");
      M.activateZkpCircuitV2("c2");
      M.deprecateZkpCircuitV2("c1");
      M.activateZkpCircuitV2("c3");
      expect(() => M.activateZkpCircuitV2("c1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveZkpCircuitsPerOwnerV2(1);
      M.registerZkpCircuitV2({ id: "c1", owner: "o1" });
      M.registerZkpCircuitV2({ id: "c2", owner: "o2" });
      M.activateZkpCircuitV2("c1");
      expect(() => M.activateZkpCircuitV2("c2")).not.toThrow();
    });
  });

  describe("proof lifecycle", () => {
    beforeEach(() => {
      M.registerZkpCircuitV2({ id: "c1", owner: "o" });
      M.activateZkpCircuitV2("c1");
    });
    it("create→start→verify", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      M.startZkpProofV2("p1");
      const p = M.verifyZkpProofV2("p1");
      expect(p.status).toBe("verified");
    });
    it("fail stores reason", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      M.startZkpProofV2("p1");
      const p = M.failZkpProofV2("p1", "err");
      expect(p.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      expect(M.cancelZkpProofV2("p1").status).toBe("cancelled");
    });
    it("cannot verify from queued", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      expect(() => M.verifyZkpProofV2("p1")).toThrow();
    });
    it("unknown circuit rejected", () =>
      expect(() =>
        M.createZkpProofV2({ id: "p1", circuitId: "none" }),
      ).toThrow());
    it("per-circuit pending cap", () => {
      M.setMaxPendingZkpProofsPerCircuitV2(2);
      ["p1", "p2"].forEach((id) => M.createZkpProofV2({ id, circuitId: "c1" }));
      expect(() => M.createZkpProofV2({ id: "p3", circuitId: "c1" })).toThrow(
        /max pending/,
      );
    });
    it("proving counts as pending", () => {
      M.setMaxPendingZkpProofsPerCircuitV2(1);
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      M.startZkpProofV2("p1");
      expect(() => M.createZkpProofV2({ id: "p2", circuitId: "c1" })).toThrow();
    });
    it("verified frees slot", () => {
      M.setMaxPendingZkpProofsPerCircuitV2(1);
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      M.startZkpProofV2("p1");
      M.verifyZkpProofV2("p1");
      expect(() =>
        M.createZkpProofV2({ id: "p2", circuitId: "c1" }),
      ).not.toThrow();
    });
    it("default empty inputs", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      expect(M.getZkpProofV2("p1").inputs).toBe("");
    });
    it("inputs preserved", () => {
      M.createZkpProofV2({ id: "p1", circuitId: "c1", inputs: "x=1" });
      expect(M.getZkpProofV2("p1").inputs).toBe("x=1");
    });
  });

  describe("auto flips", () => {
    it("autoDeprecateIdle", () => {
      M.setZkpCircuitIdleMsV2(1000);
      M.registerZkpCircuitV2({ id: "c1", owner: "o" });
      M.activateZkpCircuitV2("c1");
      const r = M.autoDeprecateIdleZkpCircuitsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getZkpCircuitV2("c1").status).toBe("deprecated");
    });
    it("autoFailStuck", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "o" });
      M.activateZkpCircuitV2("c1");
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      M.startZkpProofV2("p1");
      M.setZkpProofStuckMsV2(100);
      const r = M.autoFailStuckZkpProofsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getZkpProofV2("p1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getZkpEngineGovStatsV2();
      expect(s.circuitsByStatus.pending).toBe(0);
      expect(s.proofsByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerZkpCircuitV2({ id: "c1", owner: "o" });
      M.activateZkpCircuitV2("c1");
      M.createZkpProofV2({ id: "p1", circuitId: "c1" });
      const s = M.getZkpEngineGovStatsV2();
      expect(s.totalCircuitsV2).toBe(1);
      expect(s.totalProofsV2).toBe(1);
    });
  });
});
