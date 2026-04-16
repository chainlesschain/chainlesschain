/**
 * Tests for src/lib/mcp-scaffold.js — pure template generator for MCP
 * server boilerplate projects.
 */

import { describe, it, expect } from "vitest";
import {
  generateMcpServerScaffold,
  normalizeName,
  normalizeTransport,
  SUPPORTED_TRANSPORTS,
  SDK_VERSION,
  EXPRESS_VERSION,
} from "../../src/lib/mcp-scaffold.js";

function byPath(files) {
  const m = new Map();
  for (const f of files) m.set(f.path, f);
  return m;
}

describe("mcp-scaffold", () => {
  describe("normalizeName", () => {
    it("accepts a simple kebab-case name", () => {
      expect(normalizeName("weather")).toBe("weather");
      expect(normalizeName("my-weather")).toBe("my-weather");
      expect(normalizeName("srv-123")).toBe("srv-123");
    });

    it("lowercases and trims", () => {
      expect(normalizeName("  Weather  ")).toBe("weather");
      expect(normalizeName("MY-SERVER")).toBe("my-server");
    });

    it("rejects empty or non-string input", () => {
      expect(() => normalizeName("")).toThrow(/required/i);
      expect(() => normalizeName("   ")).toThrow(/required/i);
      expect(() => normalizeName(null)).toThrow(/required/i);
      expect(() => normalizeName(undefined)).toThrow(/required/i);
      expect(() => normalizeName(42)).toThrow(/required/i);
    });

    it("rejects names with invalid characters", () => {
      expect(() => normalizeName("my_server")).toThrow(/Invalid/);
      expect(() => normalizeName("my server")).toThrow(/Invalid/);
      expect(() => normalizeName("-leading")).toThrow(/Invalid/);
      expect(() => normalizeName("trailing-")).toThrow(/Invalid/);
      expect(() => normalizeName("Caps.dot")).toThrow(/Invalid/);
    });

    it("rejects over-long names", () => {
      expect(() => normalizeName("a".repeat(61))).toThrow(/60/);
    });
  });

  describe("normalizeTransport", () => {
    it("defaults to stdio", () => {
      expect(normalizeTransport(undefined)).toBe("stdio");
      expect(normalizeTransport("")).toBe("stdio");
    });

    it("accepts both supported transports", () => {
      for (const t of SUPPORTED_TRANSPORTS) {
        expect(normalizeTransport(t)).toBe(t);
      }
      expect(normalizeTransport("STDIO")).toBe("stdio");
      expect(normalizeTransport("  Http  ")).toBe("http");
    });

    it("rejects unknown transports", () => {
      expect(() => normalizeTransport("ws")).toThrow(/Unknown transport/);
      expect(() => normalizeTransport("sse-legacy")).toThrow(/Unknown/);
    });
  });

  describe("generateMcpServerScaffold — common shape", () => {
    it("returns 4 files: package.json, index.js, README.md, .gitignore", () => {
      const { files } = generateMcpServerScaffold({ name: "demo" });
      const paths = files.map((f) => f.path).sort();
      expect(paths).toEqual([
        ".gitignore",
        "README.md",
        "index.js",
        "package.json",
      ]);
    });

    it("returns a summary matching the spec", () => {
      const { summary } = generateMcpServerScaffold({
        name: "Demo",
        transport: "http",
        port: 4001,
      });
      expect(summary).toEqual({
        name: "demo",
        description: "An MCP server — demo",
        transport: "http",
        port: 4001,
        fileCount: 4,
      });
    });

    it("clamps port to default when invalid", () => {
      const { summary } = generateMcpServerScaffold({
        name: "demo",
        transport: "http",
        port: -1,
      });
      expect(summary.port).toBe(3333);
    });

    it("stdio summary has null port", () => {
      const { summary } = generateMcpServerScaffold({ name: "demo" });
      expect(summary.port).toBeNull();
    });

    it("falls back to a generated description", () => {
      const { files } = generateMcpServerScaffold({ name: "weather" });
      const readme = byPath(files).get("README.md").content;
      expect(readme).toMatch(/An MCP server — weather/);
    });

    it("honours a provided description", () => {
      const { files } = generateMcpServerScaffold({
        name: "weather",
        description: "Live forecast lookup",
      });
      const readme = byPath(files).get("README.md").content;
      expect(readme).toMatch(/Live forecast lookup/);
    });
  });

  describe("generateMcpServerScaffold — package.json", () => {
    it("produces valid JSON with MCP SDK as a dependency", () => {
      const { files } = generateMcpServerScaffold({
        name: "weather",
        author: "Alice",
      });
      const pkgRaw = byPath(files).get("package.json").content;
      const pkg = JSON.parse(pkgRaw);
      expect(pkg.name).toBe("weather");
      expect(pkg.type).toBe("module");
      expect(pkg.main).toBe("index.js");
      expect(pkg.scripts.start).toMatch(/node/);
      expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBe(SDK_VERSION);
      expect(pkg.author).toBe("Alice");
    });

    it("omits author when not supplied", () => {
      const { files } = generateMcpServerScaffold({ name: "weather" });
      const pkg = JSON.parse(byPath(files).get("package.json").content);
      expect(pkg.author).toBeUndefined();
    });

    it("does not depend on express for stdio transport", () => {
      const { files } = generateMcpServerScaffold({ name: "demo" });
      const pkg = JSON.parse(byPath(files).get("package.json").content);
      expect(pkg.dependencies.express).toBeUndefined();
    });

    it("depends on express for http transport", () => {
      const { files } = generateMcpServerScaffold({
        name: "demo",
        transport: "http",
      });
      const pkg = JSON.parse(byPath(files).get("package.json").content);
      expect(pkg.dependencies.express).toBe(EXPRESS_VERSION);
    });
  });

  describe("generateMcpServerScaffold — index.js (stdio)", () => {
    it("imports StdioServerTransport and registers echo + hello resource", () => {
      const { files } = generateMcpServerScaffold({ name: "demo" });
      const idx = byPath(files).get("index.js").content;
      expect(idx).toMatch(/StdioServerTransport/);
      expect(idx).not.toMatch(/StreamableHTTPServerTransport/);
      expect(idx).toMatch(/"echo"/);
      expect(idx).toMatch(/hello:\/\/world/);
      expect(idx).toMatch(/await server\.connect\(transport\)/);
    });

    it("embeds the server name in the Server constructor", () => {
      const { files } = generateMcpServerScaffold({ name: "my-weather" });
      const idx = byPath(files).get("index.js").content;
      expect(idx).toMatch(/name: "my-weather"/);
    });
  });

  describe("generateMcpServerScaffold — index.js (http)", () => {
    it("imports StreamableHTTPServerTransport and uses express", () => {
      const { files } = generateMcpServerScaffold({
        name: "demo",
        transport: "http",
        port: 4001,
      });
      const idx = byPath(files).get("index.js").content;
      expect(idx).toMatch(/StreamableHTTPServerTransport/);
      expect(idx).not.toMatch(/StdioServerTransport/);
      expect(idx).toMatch(/import express from "express"/);
      expect(idx).toMatch(/app\.all\("\/mcp"/);
      expect(idx).toMatch(/4001/);
    });

    it("falls back to default port 3333", () => {
      const { files } = generateMcpServerScaffold({
        name: "demo",
        transport: "http",
      });
      const idx = byPath(files).get("index.js").content;
      expect(idx).toMatch(/3333/);
    });
  });

  describe("generateMcpServerScaffold — README transport-specific wireup", () => {
    it("stdio README shows `cc mcp add -c node -a`", () => {
      const { files } = generateMcpServerScaffold({ name: "demo" });
      const readme = byPath(files).get("README.md").content;
      expect(readme).toMatch(/cc mcp add demo -c node -a "\.\/index\.js"/);
      expect(readme).not.toMatch(/http:\/\//);
    });

    it("http README shows `cc mcp add -u http://...`", () => {
      const { files } = generateMcpServerScaffold({
        name: "demo",
        transport: "http",
        port: 4001,
      });
      const readme = byPath(files).get("README.md").content;
      expect(readme).toMatch(/cc mcp add demo -u http:\/\/localhost:4001\/mcp/);
      expect(readme).toMatch(/npm start/);
    });
  });

  describe("generateMcpServerScaffold — .gitignore", () => {
    it("ignores node_modules, env files, and logs", () => {
      const { files } = generateMcpServerScaffold({ name: "demo" });
      const gi = byPath(files).get(".gitignore").content;
      expect(gi).toMatch(/node_modules\//);
      expect(gi).toMatch(/\.env/);
      expect(gi).toMatch(/\*\.log/);
    });
  });

  describe("generateMcpServerScaffold — validation", () => {
    it("propagates name validation errors", () => {
      expect(() => generateMcpServerScaffold({ name: "" })).toThrow(
        /required/i,
      );
      expect(() => generateMcpServerScaffold({ name: "bad name" })).toThrow(
        /Invalid/,
      );
    });

    it("propagates transport validation errors", () => {
      expect(() =>
        generateMcpServerScaffold({
          name: "demo",
          transport: "carrier-pigeon",
        }),
      ).toThrow(/Unknown transport/);
    });
  });
});
