import { describe, it, expect } from "vitest";
import {
  BUNDLE_FILES,
  BUNDLE_MODES,
  validateManifest,
  validateBundle,
  parseMinimalToml,
} from "../lib/agent-bundle-schema.js";

describe("agent-bundle-schema: constants", () => {
  it("BUNDLE_FILES exposes expected filenames", () => {
    expect(BUNDLE_FILES.MANIFEST_TOML).toBe("chainless-agent.toml");
    expect(BUNDLE_FILES.AGENTS_MD).toBe("AGENTS.md");
    expect(BUNDLE_FILES.USER_MD).toBe("USER.md");
    expect(BUNDLE_FILES.MCP_JSON).toBe("mcp.json");
  });
  it("BUNDLE_MODES has local/lan/hosted", () => {
    expect(BUNDLE_MODES.LOCAL).toBe("local");
    expect(BUNDLE_MODES.LAN).toBe("lan");
    expect(BUNDLE_MODES.HOSTED).toBe("hosted");
  });
});

describe("validateManifest", () => {
  it("accepts minimal valid manifest", () => {
    expect(
      validateManifest({ id: "a", name: "A", mode: "local" })
    ).toEqual([]);
  });
  it("rejects missing id/name", () => {
    const errs = validateManifest({});
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
  it("rejects invalid mode", () => {
    const errs = validateManifest({
      id: "a",
      name: "A",
      mode: "wat",
    });
    expect(errs.join(" ")).toMatch(/mode/);
  });
  it("rejects non-object", () => {
    expect(validateManifest(null)).toEqual(["manifest must be an object"]);
  });
});

describe("validateBundle", () => {
  const baseManifest = { id: "a", name: "A", mode: "local" };
  it("accepts valid bundle", () => {
    expect(
      validateBundle({
        manifest: baseManifest,
        mcpConfig: null,
      })
    ).toEqual([]);
  });
  it("rejects stdio MCP in hosted mode", () => {
    const errs = validateBundle({
      manifest: { ...baseManifest, mode: "hosted" },
      mcpConfig: {
        servers: {
          fs: { transport: "stdio", command: "npx" },
        },
      },
    });
    expect(errs.join(" ")).toMatch(/stdio.*hosted/);
  });
  it("allows stdio MCP in local mode", () => {
    expect(
      validateBundle({
        manifest: { ...baseManifest, mode: "local" },
        mcpConfig: {
          servers: { fs: { transport: "stdio", command: "npx" } },
        },
      })
    ).toEqual([]);
  });
  it("allows http MCP in hosted mode", () => {
    expect(
      validateBundle({
        manifest: { ...baseManifest, mode: "hosted" },
        mcpConfig: {
          servers: { fs: { transport: "http", url: "https://x" } },
        },
      })
    ).toEqual([]);
  });
});

describe("parseMinimalToml", () => {
  it("parses flat key/value", () => {
    const out = parseMinimalToml(
      `id = "acme"\nname = "Acme Agent"\nversion = 42\nenabled = true`
    );
    expect(out).toEqual({
      id: "acme",
      name: "Acme Agent",
      version: 42,
      enabled: true,
    });
  });
  it("parses sections", () => {
    const out = parseMinimalToml(`[policy]\ndefault = "trusted"`);
    expect(out.policy.default).toBe("trusted");
  });
  it("ignores comments and blank lines", () => {
    const out = parseMinimalToml(
      `# comment\n\nid = "x"\n# another\nname = "N"`
    );
    expect(out).toEqual({ id: "x", name: "N" });
  });
  it("handles false and numeric", () => {
    const out = parseMinimalToml(`a = false\nb = 3.14`);
    expect(out.a).toBe(false);
    expect(out.b).toBe(3.14);
  });
});
