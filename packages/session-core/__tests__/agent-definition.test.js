import { describe, it, expect } from "vitest";
import {
  AgentDefinition,
  AgentDefinitionCache,
  normalizeToolSchema,
  generateAgentId,
} from "../lib/agent-definition.js";

describe("normalizeToolSchema", () => {
  it("prefers inputSchema over parameters", () => {
    const out = normalizeToolSchema({
      name: "t",
      inputSchema: { type: "object", properties: { a: { type: "string" } } },
      parameters: { type: "object", properties: {} },
    });
    expect(out.inputSchema.properties.a).toBeDefined();
    expect(out.parameters).toBe(out.inputSchema);
  });

  it("falls back to parameters when inputSchema absent", () => {
    const out = normalizeToolSchema({
      name: "t",
      parameters: { type: "object", properties: { b: { type: "number" } } },
    });
    expect(out.inputSchema.properties.b).toBeDefined();
  });

  it("provides empty schema as last fallback", () => {
    const out = normalizeToolSchema({ name: "t" });
    expect(out.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("defaults riskLevel to low, availableInPlanMode to true", () => {
    const out = normalizeToolSchema({ name: "t" });
    expect(out.riskLevel).toBe("low");
    expect(out.availableInPlanMode).toBe(true);
    expect(out.isReadOnly).toBe(false);
  });

  it("propagates explicit security fields", () => {
    const out = normalizeToolSchema({
      name: "t",
      riskLevel: "high",
      isReadOnly: true,
      availableInPlanMode: false,
      requiresPlanApproval: true,
    });
    expect(out.riskLevel).toBe("high");
    expect(out.isReadOnly).toBe(true);
    expect(out.availableInPlanMode).toBe(false);
    expect(out.requiresPlanApproval).toBe(true);
  });
});

describe("AgentDefinition — construction", () => {
  it("requires name", () => {
    expect(() => new AgentDefinition({})).toThrow(/name is required/);
  });

  it("auto-generates agentId", () => {
    const a = new AgentDefinition({ name: "x" });
    expect(a.agentId).toMatch(/^agent_[a-f0-9]{16}$/);
  });

  it("is frozen (immutable)", () => {
    const a = new AgentDefinition({ name: "x" });
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      a.name = "mutated";
    }).toThrow();
  });

  it("stores tools indexed by name", () => {
    const a = new AgentDefinition({
      name: "x",
      tools: [
        { name: "t1", inputSchema: { type: "object" } },
        { name: "t2", inputSchema: { type: "object" } },
      ],
    });
    expect(a.listToolNames().sort()).toEqual(["t1", "t2"]);
    expect(a.hasTool("t1")).toBe(true);
    expect(a.hasTool("tX")).toBe(false);
  });

  it("skips tools without name", () => {
    const a = new AgentDefinition({
      name: "x",
      tools: [{ name: "t1" }, {}, null, { description: "no name" }],
    });
    expect(a.listToolNames()).toEqual(["t1"]);
  });

  it("tool schemas are frozen", () => {
    const a = new AgentDefinition({
      name: "x",
      tools: [{ name: "t1", inputSchema: { type: "object" } }],
    });
    const schema = a.getTool("t1");
    expect(Object.isFrozen(schema)).toBe(true);
  });

  it("getToolSchemas returns array of normalized tools", () => {
    const a = new AgentDefinition({
      name: "x",
      tools: [{ name: "t1" }, { name: "t2" }],
    });
    const schemas = a.getToolSchemas();
    expect(schemas).toHaveLength(2);
    expect(schemas[0]).toHaveProperty("inputSchema");
  });
});

describe("AgentDefinition — hash", () => {
  it("same content produces same hash", () => {
    const a = new AgentDefinition({
      name: "x",
      systemPrompt: "hi",
      tools: [{ name: "t1" }],
    });
    const b = new AgentDefinition({
      name: "x",
      systemPrompt: "hi",
      tools: [{ name: "t1" }],
    });
    expect(a.getHash()).toBe(b.getHash());
  });

  it("different systemPrompt changes hash", () => {
    const a = new AgentDefinition({ name: "x", systemPrompt: "a" });
    const b = new AgentDefinition({ name: "x", systemPrompt: "b" });
    expect(a.getHash()).not.toBe(b.getHash());
  });

  it("different tools change hash", () => {
    const a = new AgentDefinition({ name: "x", tools: [{ name: "t1" }] });
    const b = new AgentDefinition({ name: "x", tools: [{ name: "t2" }] });
    expect(a.getHash()).not.toBe(b.getHash());
  });

  it("tool order does not affect hash", () => {
    const a = new AgentDefinition({
      name: "x",
      tools: [{ name: "t1" }, { name: "t2" }],
    });
    const b = new AgentDefinition({
      name: "x",
      tools: [{ name: "t2" }, { name: "t1" }],
    });
    expect(a.getHash()).toBe(b.getHash());
  });
});

describe("AgentDefinition.fromSkill", () => {
  it("requires skill with name", () => {
    expect(() => AgentDefinition.fromSkill(null)).toThrow();
    expect(() => AgentDefinition.fromSkill({})).toThrow();
  });

  it("uses skill.instructions as systemPrompt", () => {
    const skill = { name: "my-skill", instructions: "Do X" };
    const def = AgentDefinition.fromSkill(skill);
    expect(def.systemPrompt).toBe("Do X");
  });

  it("overrides win over skill fields", () => {
    const skill = { name: "my-skill", instructions: "Original", model: "a" };
    const def = AgentDefinition.fromSkill(skill, {
      systemPrompt: "Override",
      model: "b",
    });
    expect(def.systemPrompt).toBe("Override");
    expect(def.model).toBe("b");
  });

  it("merges metadata", () => {
    const skill = { name: "s", version: "2.0.0", metadata: { a: 1 } };
    const def = AgentDefinition.fromSkill(skill, { metadata: { b: 2 } });
    expect(def.metadata).toMatchObject({ skillVersion: "2.0.0", a: 1, b: 2 });
  });

  it("resolves tools from overrides.tools", () => {
    const skill = { name: "s" };
    const def = AgentDefinition.fromSkill(skill, {
      tools: [{ name: "read_file" }],
    });
    expect(def.hasTool("read_file")).toBe(true);
  });
});

describe("AgentDefinitionCache", () => {
  it("register returns the same instance for identical hash", () => {
    const cache = new AgentDefinitionCache();
    const a = new AgentDefinition({ name: "x", systemPrompt: "hi" });
    const b = new AgentDefinition({ name: "x", systemPrompt: "hi" });
    const r1 = cache.register(a);
    const r2 = cache.register(b);
    expect(r1).toBe(a);
    expect(r2).toBe(a); // dedup
    expect(cache.size()).toBe(1);
  });

  it("get by agentId", () => {
    const cache = new AgentDefinitionCache();
    const a = new AgentDefinition({ name: "x" });
    cache.register(a);
    expect(cache.get(a.agentId)).toBe(a);
  });

  it("getByName returns latest registration", () => {
    const cache = new AgentDefinitionCache();
    const a = new AgentDefinition({ name: "x", systemPrompt: "v1" });
    const b = new AgentDefinition({ name: "x", systemPrompt: "v2" });
    cache.register(a);
    cache.register(b);
    expect(cache.getByName("x")).toBe(b);
  });

  it("has/remove", () => {
    const cache = new AgentDefinitionCache();
    const a = new AgentDefinition({ name: "x" });
    cache.register(a);
    expect(cache.has(a.agentId)).toBe(true);
    cache.remove(a.agentId);
    expect(cache.has(a.agentId)).toBe(false);
  });

  it("clear wipes all", () => {
    const cache = new AgentDefinitionCache();
    cache.register(new AgentDefinition({ name: "a" }));
    cache.register(new AgentDefinition({ name: "b" }));
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("evicts oldest when over maxEntries", () => {
    const cache = new AgentDefinitionCache({ maxEntries: 2 });
    const a = new AgentDefinition({ name: "a" });
    const b = new AgentDefinition({ name: "b" });
    const c = new AgentDefinition({ name: "c" });
    cache.register(a);
    cache.register(b);
    cache.register(c);
    expect(cache.size()).toBe(2);
    expect(cache.has(a.agentId)).toBe(false);
    expect(cache.has(c.agentId)).toBe(true);
  });

  it("rejects non-AgentDefinition", () => {
    const cache = new AgentDefinitionCache();
    expect(() => cache.register({ name: "fake" })).toThrow();
  });

  it("list returns all registered", () => {
    const cache = new AgentDefinitionCache();
    cache.register(new AgentDefinition({ name: "a" }));
    cache.register(new AgentDefinition({ name: "b" }));
    expect(cache.list()).toHaveLength(2);
  });
});

describe("generateAgentId", () => {
  it("produces unique ids", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateAgentId());
    expect(ids.size).toBe(100);
  });
});
