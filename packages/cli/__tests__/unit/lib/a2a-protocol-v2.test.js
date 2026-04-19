import { describe, it, expect, beforeEach } from "vitest";
import * as M from "../../../src/lib/a2a-protocol.js";

describe("A2A Protocol V2 Surface", () => {
  beforeEach(() => M._resetStateA2aProtocolV2());

  describe("enums", () => {
    it("agent maturity has 4 states", () =>
      expect(Object.keys(M.A2A_AGENT_MATURITY_V2)).toHaveLength(4));
    it("message lifecycle has 5 states", () =>
      expect(Object.keys(M.A2A_MESSAGE_LIFECYCLE_V2)).toHaveLength(5));
    it("enums frozen", () => {
      expect(Object.isFrozen(M.A2A_AGENT_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(M.A2A_MESSAGE_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config", () => {
    it("setMaxActiveA2aAgentsPerOwnerV2", () => {
      M.setMaxActiveA2aAgentsPerOwnerV2(25);
      expect(M.getMaxActiveA2aAgentsPerOwnerV2()).toBe(25);
    });
    it("setMaxPendingA2aMessagesPerAgentV2", () => {
      M.setMaxPendingA2aMessagesPerAgentV2(40);
      expect(M.getMaxPendingA2aMessagesPerAgentV2()).toBe(40);
    });
    it("setA2aAgentIdleMsV2", () => {
      M.setA2aAgentIdleMsV2(3600000);
      expect(M.getA2aAgentIdleMsV2()).toBe(3600000);
    });
    it("setA2aMessageStuckMsV2", () => {
      M.setA2aMessageStuckMsV2(60000);
      expect(M.getA2aMessageStuckMsV2()).toBe(60000);
    });
    it("rejects zero", () =>
      expect(() => M.setMaxActiveA2aAgentsPerOwnerV2(0)).toThrow());
    it("rejects negative", () =>
      expect(() => M.setA2aMessageStuckMsV2(-1)).toThrow());
    it("floors decimals", () => {
      M.setMaxPendingA2aMessagesPerAgentV2(8.7);
      expect(M.getMaxPendingA2aMessagesPerAgentV2()).toBe(8);
    });
  });

  describe("agent lifecycle", () => {
    it("register", () => {
      const a = M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      expect(a.status).toBe("pending");
    });
    it("activate stamps activatedAt", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      const a = M.activateA2aAgentV2("a1");
      expect(a.status).toBe("active");
      expect(a.activatedAt).toBeTruthy();
    });
    it("suspend active→suspended", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      M.activateA2aAgentV2("a1");
      expect(M.suspendA2aAgentV2("a1").status).toBe("suspended");
    });
    it("recovery suspended→active preserves activatedAt", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      const a = M.activateA2aAgentV2("a1");
      M.suspendA2aAgentV2("a1");
      const re = M.activateA2aAgentV2("a1");
      expect(re.activatedAt).toBe(a.activatedAt);
    });
    it("retire terminal stamps retiredAt", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      M.activateA2aAgentV2("a1");
      const a = M.retireA2aAgentV2("a1");
      expect(a.status).toBe("retired");
      expect(a.retiredAt).toBeTruthy();
    });
    it("cannot touch retired", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      M.activateA2aAgentV2("a1");
      M.retireA2aAgentV2("a1");
      expect(() => M.touchA2aAgentV2("a1")).toThrow();
    });
    it("invalid transition rejected", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      expect(() => M.suspendA2aAgentV2("a1")).toThrow();
    });
    it("duplicate rejected", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "alice" });
      expect(() => M.registerA2aAgentV2({ id: "a1", owner: "b" })).toThrow();
    });
    it("missing owner rejected", () =>
      expect(() => M.registerA2aAgentV2({ id: "a1" })).toThrow());
    it("list all", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "a" });
      M.registerA2aAgentV2({ id: "a2", owner: "b" });
      expect(M.listA2aAgentsV2()).toHaveLength(2);
    });
    it("get null unknown", () => expect(M.getA2aAgentV2("none")).toBeNull());
    it("defensive copy metadata", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "a", metadata: { k: 5 } });
      const a = M.getA2aAgentV2("a1");
      a.metadata.k = 99;
      expect(M.getA2aAgentV2("a1").metadata.k).toBe(5);
    });
    it("defensive copy capabilities", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "a", capabilities: ["x"] });
      const a = M.getA2aAgentV2("a1");
      a.capabilities.push("y");
      expect(M.getA2aAgentV2("a1").capabilities).toEqual(["x"]);
    });
  });

  describe("active-agent cap", () => {
    it("enforced on pending→active", () => {
      M.setMaxActiveA2aAgentsPerOwnerV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerA2aAgentV2({ id, owner: "o" }),
      );
      M.activateA2aAgentV2("a1");
      M.activateA2aAgentV2("a2");
      expect(() => M.activateA2aAgentV2("a3")).toThrow(/max active/);
    });
    it("recovery exempt", () => {
      M.setMaxActiveA2aAgentsPerOwnerV2(2);
      ["a1", "a2", "a3"].forEach((id) =>
        M.registerA2aAgentV2({ id, owner: "o" }),
      );
      M.activateA2aAgentV2("a1");
      M.activateA2aAgentV2("a2");
      M.suspendA2aAgentV2("a1");
      M.activateA2aAgentV2("a3");
      expect(() => M.activateA2aAgentV2("a1")).not.toThrow();
    });
    it("per-owner isolated", () => {
      M.setMaxActiveA2aAgentsPerOwnerV2(1);
      M.registerA2aAgentV2({ id: "a1", owner: "o1" });
      M.registerA2aAgentV2({ id: "a2", owner: "o2" });
      M.activateA2aAgentV2("a1");
      expect(() => M.activateA2aAgentV2("a2")).not.toThrow();
    });
  });

  describe("message lifecycle", () => {
    beforeEach(() => {
      M.registerA2aAgentV2({ id: "a1", owner: "o" });
      M.activateA2aAgentV2("a1");
    });
    it("create→start→deliver", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      M.startA2aMessageV2("m1");
      const m = M.deliverA2aMessageV2("m1");
      expect(m.status).toBe("delivered");
    });
    it("fail stores reason", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      M.startA2aMessageV2("m1");
      const m = M.failA2aMessageV2("m1", "err");
      expect(m.metadata.failReason).toBe("err");
    });
    it("cancel queued", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      expect(M.cancelA2aMessageV2("m1").status).toBe("cancelled");
    });
    it("cannot deliver from queued", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      expect(() => M.deliverA2aMessageV2("m1")).toThrow();
    });
    it("unknown agent rejected", () =>
      expect(() =>
        M.createA2aMessageV2({ id: "m1", agentId: "none" }),
      ).toThrow());
    it("per-agent pending cap", () => {
      M.setMaxPendingA2aMessagesPerAgentV2(2);
      ["m1", "m2"].forEach((id) => M.createA2aMessageV2({ id, agentId: "a1" }));
      expect(() => M.createA2aMessageV2({ id: "m3", agentId: "a1" })).toThrow(
        /max pending/,
      );
    });
    it("sending counts as pending", () => {
      M.setMaxPendingA2aMessagesPerAgentV2(1);
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      M.startA2aMessageV2("m1");
      expect(() => M.createA2aMessageV2({ id: "m2", agentId: "a1" })).toThrow();
    });
    it("delivered frees slot", () => {
      M.setMaxPendingA2aMessagesPerAgentV2(1);
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      M.startA2aMessageV2("m1");
      M.deliverA2aMessageV2("m1");
      expect(() =>
        M.createA2aMessageV2({ id: "m2", agentId: "a1" }),
      ).not.toThrow();
    });
    it("default empty peerId", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      expect(M.getA2aMessageV2("m1").peerId).toBe("");
    });
    it("peerId preserved", () => {
      M.createA2aMessageV2({ id: "m1", agentId: "a1", peerId: "p" });
      expect(M.getA2aMessageV2("m1").peerId).toBe("p");
    });
  });

  describe("auto flips", () => {
    it("autoSuspendIdle", () => {
      M.setA2aAgentIdleMsV2(1000);
      M.registerA2aAgentV2({ id: "a1", owner: "o" });
      M.activateA2aAgentV2("a1");
      const r = M.autoSuspendIdleA2aAgentsV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getA2aAgentV2("a1").status).toBe("suspended");
    });
    it("autoFailStuck", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "o" });
      M.activateA2aAgentV2("a1");
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      M.startA2aMessageV2("m1");
      M.setA2aMessageStuckMsV2(100);
      const r = M.autoFailStuckA2aMessagesV2({ now: Date.now() + 5000 });
      expect(r.count).toBe(1);
      expect(M.getA2aMessageV2("m1").status).toBe("failed");
    });
  });

  describe("stats", () => {
    it("all enum keys initialised", () => {
      const s = M.getA2aProtocolGovStatsV2();
      expect(s.agentsByStatus.pending).toBe(0);
      expect(s.messagesByStatus.queued).toBe(0);
    });
    it("counts", () => {
      M.registerA2aAgentV2({ id: "a1", owner: "o" });
      M.activateA2aAgentV2("a1");
      M.createA2aMessageV2({ id: "m1", agentId: "a1" });
      const s = M.getA2aProtocolGovStatsV2();
      expect(s.totalAgentsV2).toBe(1);
      expect(s.totalMessagesV2).toBe(1);
    });
  });
});
