import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";

const roots = [];

function fixture(name, frontmatter = "", body = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-lazy-"));
  roots.push(root);
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} descriptor\n${frontmatter}---\n\n${body}`,
    "utf-8",
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CLISkillLoader two-tier body cache", () => {
  it("keeps ordinary bodies lazy during descriptor discovery", () => {
    const root = fixture("ordinary", "", "# Secret body\nDo the work.");
    const loader = new CLISkillLoader({ contextLedger: null });
    const [skill] = loader._loadFromDir(root, "workspace");

    expect(skill).toMatchObject({
      id: "ordinary",
      description: "ordinary descriptor",
      body: null,
      bodyLoaded: false,
      mcpServers: [],
    });
    loader._cache = [skill];
    const ledger = loader.getCacheLedger();
    expect(ledger.descriptors.resident).toBe(1);
    expect(ledger.bodies.resident).toBe(0);
    expect(ledger.savings.lazyFileBytes).toBeGreaterThan(0);
  });

  it("materializes once, parses embedded MCP, then reports a cache hit", () => {
    const root = fixture(
      "weather",
      "",
      [
        "# Weather",
        "```mcp-servers",
        '[{"name":"weather-api","command":"node","args":["server.js"]}]',
        "```",
      ].join("\n"),
    );
    const recordRead = vi.fn();
    const loader = new CLISkillLoader({ contextLedger: { recordRead } });
    const [skill] = loader._loadFromDir(root, "workspace");
    loader._cache = [skill];

    loader.materializeSkill(skill, {
      sessionId: "s1",
      turnId: "t1",
      loadedBecause: "run_skill",
    });
    expect(skill.bodyLoaded).toBe(true);
    expect(skill.body).toContain("# Weather");
    expect(skill.mcpServers.map((server) => server.name)).toEqual([
      "weather-api",
    ]);

    loader.materializeSkill(skill, {
      sessionId: "s1",
      turnId: "t2",
      loadedBecause: "run_skill",
    });
    const ledger = loader.getCacheLedger();
    expect(ledger.bodies).toMatchObject({
      resident: 1,
      cacheMisses: 1,
      cacheHits: 1,
    });
    expect(ledger.bodies.entries[0]).toMatchObject({
      id: "weather",
      loads: 2,
      cacheHits: 1,
      loadedBecause: ["run_skill"],
    });
    expect(recordRead).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(recordRead.mock.calls)).not.toContain("# Weather");
  });

  it("auto-activation materializes persona bodies but leaves ordinary skills lazy", () => {
    const root = fixture(
      "persona-one",
      "category: persona\nactivation: auto\n",
      "Persona guidance",
    );
    const ordinaryRoot = fixture("ordinary-one", "", "Ordinary guidance");
    const loader = new CLISkillLoader({ contextLedger: null });
    const skills = [
      ...loader._loadFromDir(root, "workspace"),
      ...loader._loadFromDir(ordinaryRoot, "workspace"),
    ];
    loader._cache = skills;

    const personas = loader.getAutoActivatedPersonas();

    expect(personas).toHaveLength(1);
    expect(personas[0].body).toContain("Persona guidance");
    expect(skills.find((skill) => skill.id === "ordinary-one").bodyLoaded).toBe(
      false,
    );
    expect(loader.getCacheLedger().bodies.resident).toBe(1);
  });
});
