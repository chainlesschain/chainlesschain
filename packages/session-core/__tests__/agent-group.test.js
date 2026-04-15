import { describe, it, expect } from "vitest";
import {
  AgentGroup,
  RELATIONSHIPS,
  generateGroupId,
  validateRelationship,
} from "../lib/agent-group.js";

describe("AgentGroup — construction", () => {
  it("auto-generates groupId", () => {
    const g = new AgentGroup();
    expect(g.groupId).toMatch(/^grp_[a-f0-9]{16}$/);
  });

  it("accepts explicit groupId", () => {
    const g = new AgentGroup({ groupId: "g1" });
    expect(g.groupId).toBe("g1");
  });

  it("parentAgentId defaults to null", () => {
    const g = new AgentGroup();
    expect(g.parentAgentId).toBeNull();
  });

  it("stores metadata", () => {
    const g = new AgentGroup({ metadata: { task: "review" } });
    expect(g.metadata.task).toBe("review");
  });
});

describe("AgentGroup — addMember validation", () => {
  it("rejects missing agentId", () => {
    const g = new AgentGroup();
    expect(() =>
      g.addMember({ sessionId: "s1", relationship: "peer" })
    ).toThrow(/agentId required/);
  });

  it("rejects missing sessionId", () => {
    const g = new AgentGroup();
    expect(() =>
      g.addMember({ agentId: "a1", relationship: "peer" })
    ).toThrow(/sessionId required/);
  });

  it("rejects invalid relationship", () => {
    const g = new AgentGroup();
    expect(() =>
      g.addMember({ agentId: "a1", sessionId: "s1", relationship: "boss" })
    ).toThrow(/invalid relationship/);
  });

  it("child requires parentAgentId on group", () => {
    const g = new AgentGroup();
    expect(() =>
      g.addMember({ agentId: "a1", sessionId: "s1", relationship: "child" })
    ).toThrow(/child relationship requires parentAgentId/);
  });

  it("parent cannot be its own child", () => {
    const g = new AgentGroup({ parentAgentId: "parent" });
    expect(() =>
      g.addMember({
        agentId: "parent",
        sessionId: "s1",
        relationship: "child",
      })
    ).toThrow(/cannot also be its own child/);
  });

  it("rejects duplicate agentId", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    expect(() =>
      g.addMember({ agentId: "a1", sessionId: "s2", relationship: "peer" })
    ).toThrow(/already in group/);
  });
});

describe("AgentGroup — member management", () => {
  it("addMember returns frozen record", () => {
    const g = new AgentGroup();
    const r = g.addMember({
      agentId: "a1",
      sessionId: "s1",
      relationship: "peer",
      role: "reviewer",
    });
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.role).toBe("reviewer");
  });

  it("getMember / hasMember", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    expect(g.hasMember("a1")).toBe(true);
    expect(g.getMember("a1").sessionId).toBe("s1");
    expect(g.getMember("nope")).toBeNull();
  });

  it("removeMember", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    expect(g.removeMember("a1")).toBe(true);
    expect(g.hasMember("a1")).toBe(false);
    expect(g.removeMember("a1")).toBe(false);
  });

  it("size reflects member count", () => {
    const g = new AgentGroup();
    expect(g.size()).toBe(0);
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    g.addMember({ agentId: "a2", sessionId: "s2", relationship: "peer" });
    expect(g.size()).toBe(2);
  });

  it("listPeers and listChildren filter correctly", () => {
    const g = new AgentGroup({ parentAgentId: "P" });
    g.addMember({ agentId: "p1", sessionId: "s1", relationship: "peer" });
    g.addMember({ agentId: "p2", sessionId: "s2", relationship: "peer" });
    g.addMember({ agentId: "c1", sessionId: "s3", relationship: "child" });
    expect(g.listPeers()).toHaveLength(2);
    expect(g.listChildren()).toHaveLength(1);
  });

  it("close empties the group", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    g.close();
    expect(g.size()).toBe(0);
    expect(g.sharedTaskList).toBeNull();
  });
});

describe("AgentGroup — canSeeMessage (visibility rules)", () => {
  it("peer → peer: visible", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "p1", sessionId: "s1", relationship: "peer" });
    g.addMember({ agentId: "p2", sessionId: "s2", relationship: "peer" });
    expect(g.canSeeMessage({ fromAgentId: "p1", toAgentId: "p2" })).toBe(true);
  });

  it("parent → child: visible", () => {
    const g = new AgentGroup({ parentAgentId: "P" });
    g.addMember({ agentId: "c1", sessionId: "s1", relationship: "child" });
    expect(g.canSeeMessage({ fromAgentId: "P", toAgentId: "c1" })).toBe(true);
  });

  it("child → parent: visible", () => {
    const g = new AgentGroup({ parentAgentId: "P" });
    g.addMember({ agentId: "c1", sessionId: "s1", relationship: "child" });
    expect(g.canSeeMessage({ fromAgentId: "c1", toAgentId: "P" })).toBe(true);
  });

  it("child → child: NOT visible (isolation)", () => {
    const g = new AgentGroup({ parentAgentId: "P" });
    g.addMember({ agentId: "c1", sessionId: "s1", relationship: "child" });
    g.addMember({ agentId: "c2", sessionId: "s2", relationship: "child" });
    expect(g.canSeeMessage({ fromAgentId: "c1", toAgentId: "c2" })).toBe(false);
  });

  it("peer → child (mixed group): NOT visible", () => {
    const g = new AgentGroup({ parentAgentId: "P" });
    g.addMember({ agentId: "p1", sessionId: "s1", relationship: "peer" });
    g.addMember({ agentId: "c1", sessionId: "s2", relationship: "child" });
    expect(g.canSeeMessage({ fromAgentId: "p1", toAgentId: "c1" })).toBe(false);
    expect(g.canSeeMessage({ fromAgentId: "c1", toAgentId: "p1" })).toBe(false);
  });

  it("same agent: always visible", () => {
    const g = new AgentGroup();
    g.addMember({ agentId: "a1", sessionId: "s1", relationship: "peer" });
    expect(g.canSeeMessage({ fromAgentId: "a1", toAgentId: "a1" })).toBe(true);
  });
});

describe("AgentGroup — serialization", () => {
  it("toJSON captures group shape", () => {
    const g = new AgentGroup({
      groupId: "g1",
      parentAgentId: "P",
      metadata: { task: "review" },
    });
    g.addMember({ agentId: "p1", sessionId: "s1", relationship: "peer" });
    const json = g.toJSON();
    expect(json.groupId).toBe("g1");
    expect(json.parentAgentId).toBe("P");
    expect(json.metadata.task).toBe("review");
    expect(json.members).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("validateRelationship accepts peer/child", () => {
    expect(() => validateRelationship("peer")).not.toThrow();
    expect(() => validateRelationship("child")).not.toThrow();
    expect(() => validateRelationship("")).toThrow();
  });

  it("RELATIONSHIPS constant is frozen", () => {
    expect(Object.isFrozen(RELATIONSHIPS)).toBe(true);
  });

  it("generateGroupId produces unique ids", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateGroupId());
    expect(ids.size).toBe(50);
  });
});
