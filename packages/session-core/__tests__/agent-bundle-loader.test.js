import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadBundle } from "../lib/agent-bundle-loader.js";

function makeTempBundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bundle-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
  return dir;
}

describe("loadBundle", () => {
  let tmpDir = null;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = null;
  });

  it("loads TOML manifest + AGENTS.md + USER.md", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `id = "acme"\nname = "Acme"\nmode = "local"`,
      "AGENTS.md": "# Acme\nBe concise.",
      "USER.md": "# profile\nUser likes Rust.",
    });
    const bundle = loadBundle(tmpDir);
    expect(bundle.manifest.id).toBe("acme");
    expect(bundle.manifest.name).toBe("Acme");
    expect(bundle.manifest.mode).toBe("local");
    expect(bundle.agentsMd).toMatch(/Be concise/);
    expect(bundle.userMd).toMatch(/Rust/);
    expect(bundle.warnings).toEqual([]);
  });

  it("loads JSON manifest as fallback", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.json": JSON.stringify({
        id: "j",
        name: "J",
        mode: "lan",
      }),
    });
    const bundle = loadBundle(tmpDir);
    expect(bundle.manifest.id).toBe("j");
    expect(bundle.manifest.mode).toBe("lan");
  });

  it("throws when manifest missing", () => {
    tmpDir = makeTempBundle({ "AGENTS.md": "hi" });
    expect(() => loadBundle(tmpDir)).toThrow(/missing chainless-agent/);
  });

  it("throws when dir does not exist", () => {
    expect(() => loadBundle(path.join(os.tmpdir(), "cc-no-such-dir-xyz"))).toThrow(
      /not a directory/
    );
  });

  it("throws on validation errors (missing id)", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `name = "only-name"`,
    });
    expect(() => loadBundle(tmpDir)).toThrow(/manifest\.id/);
  });

  it("parses mcp.json, approval.json, sandbox.json", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `id = "x"\nname = "X"`,
      "mcp.json": JSON.stringify({ servers: { fs: { transport: "http" } } }),
      "policies/approval.json": JSON.stringify({ default: "trusted" }),
      "policies/sandbox.json": JSON.stringify({ scope: "thread", ttl: 3600 }),
      "manifests/capabilities.json": JSON.stringify({ protocols: ["mcp"] }),
    });
    const bundle = loadBundle(tmpDir);
    expect(bundle.mcpConfig.servers.fs.transport).toBe("http");
    expect(bundle.approvalPolicy.default).toBe("trusted");
    expect(bundle.sandboxPolicy.scope).toBe("thread");
    expect(bundle.capabilities.protocols).toEqual(["mcp"]);
  });

  it("detects skills/ directory", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `id = "x"\nname = "X"`,
      "skills/my-skill/SKILL.md": "# skill",
    });
    const bundle = loadBundle(tmpDir);
    expect(bundle.skillsDir).toBe(path.join(tmpDir, "skills"));
  });

  it("records warning on invalid JSON", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `id = "x"\nname = "X"`,
      "mcp.json": "{not json",
    });
    const bundle = loadBundle(tmpDir);
    expect(bundle.mcpConfig).toBeNull();
    expect(bundle.warnings.some((w) => /mcp\.json/.test(w))).toBe(true);
  });

  it("rejects hosted mode with stdio MCP", () => {
    tmpDir = makeTempBundle({
      "chainless-agent.toml": `id = "x"\nname = "X"\nmode = "hosted"`,
      "mcp.json": JSON.stringify({
        servers: { fs: { transport: "stdio", command: "npx" } },
      }),
    });
    expect(() => loadBundle(tmpDir)).toThrow(/stdio.*hosted/);
  });
});
