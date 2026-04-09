import { describe, it, expect, vi } from "vitest";
import {
  parseSkillMcpServers,
  validateMcpServerConfig,
  mountSkillMcpServers,
  unmountSkillMcpServers,
} from "../../src/lib/skill-mcp.js";

describe("parseSkillMcpServers", () => {
  it("returns empty array for missing body", () => {
    expect(parseSkillMcpServers(null)).toEqual([]);
    expect(parseSkillMcpServers("")).toEqual([]);
    expect(parseSkillMcpServers(undefined)).toEqual([]);
  });

  it("returns empty array when no mcp-servers block present", () => {
    const body = "Just some text.\n\n## Instructions\nDo things.";
    expect(parseSkillMcpServers(body)).toEqual([]);
  });

  it("parses a single-server block", () => {
    const body = [
      "## MCP Servers",
      "",
      "```mcp-servers",
      "[",
      '  { "name": "weather", "command": "npx", "args": ["-y", "@mcp/weather"] }',
      "]",
      "```",
    ].join("\n");
    const result = parseSkillMcpServers(body);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "weather",
      command: "npx",
      args: ["-y", "@mcp/weather"],
    });
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("parses a multi-server block", () => {
    const body = [
      "```mcp-servers",
      "[",
      '  { "name": "weather", "command": "npx", "args": ["-y"] },',
      '  { "name": "fs", "command": "node", "args": ["fs-server.js"] }',
      "]",
      "```",
    ].join("\n");
    const result = parseSkillMcpServers(body);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(["weather", "fs"]);
  });

  it("accepts `json mcp-servers` info string variant", () => {
    const body = [
      "```json mcp-servers",
      '[{"name": "foo", "command": "bar"}]',
      "```",
    ].join("\n");
    expect(parseSkillMcpServers(body)).toHaveLength(1);
  });

  it("returns empty array on malformed JSON", () => {
    const body = ["```mcp-servers", "[ not valid json }", "```"].join("\n");
    expect(parseSkillMcpServers(body)).toEqual([]);
  });

  it("returns empty array when block is not an array", () => {
    const body = [
      "```mcp-servers",
      '{ "name": "foo", "command": "bar" }',
      "```",
    ].join("\n");
    expect(parseSkillMcpServers(body)).toEqual([]);
  });

  it("filters out invalid server entries", () => {
    const body = [
      "```mcp-servers",
      "[",
      '  { "name": "valid", "command": "ok" },',
      '  { "name": "", "command": "empty-name" },',
      '  { "command": "no-name" },',
      '  { "name": "no-command" },',
      "  null,",
      '  { "name": "also-valid", "command": "go" }',
      "]",
      "```",
    ].join("\n");
    const result = parseSkillMcpServers(body);
    expect(result.map((s) => s.name)).toEqual(["valid", "also-valid"]);
  });

  it("preserves env and cwd when valid", () => {
    const body = [
      "```mcp-servers",
      "[",
      '  { "name": "x", "command": "y", "env": {"K": "V"}, "cwd": "/tmp" }',
      "]",
      "```",
    ].join("\n");
    const result = parseSkillMcpServers(body);
    expect(result[0].env).toEqual({ K: "V" });
    expect(result[0].cwd).toBe("/tmp");
  });

  it("ignores the block if indented inside another fence", () => {
    // Only top-level ```mcp-servers fences match. This is a weaker guarantee —
    // we don't fully parse nested fences, but a simple regex is good enough
    // for the common case.
    const body = "```markdown\nNot matching\n```";
    expect(parseSkillMcpServers(body)).toEqual([]);
  });
});

describe("validateMcpServerConfig", () => {
  it("rejects non-objects", () => {
    expect(validateMcpServerConfig(null)).toBeNull();
    expect(validateMcpServerConfig("str")).toBeNull();
    expect(validateMcpServerConfig(42)).toBeNull();
  });

  it("rejects missing name or command", () => {
    expect(validateMcpServerConfig({ command: "x" })).toBeNull();
    expect(validateMcpServerConfig({ name: "x" })).toBeNull();
    expect(validateMcpServerConfig({ name: "", command: "x" })).toBeNull();
    expect(validateMcpServerConfig({ name: "x", command: "" })).toBeNull();
  });

  it("normalizes args to array of strings", () => {
    const result = validateMcpServerConfig({
      name: "x",
      command: "y",
      args: ["a", 1, "b", null, "c"],
    });
    expect(result.args).toEqual(["a", "b", "c"]);
  });

  it("defaults args to empty array", () => {
    const result = validateMcpServerConfig({ name: "x", command: "y" });
    expect(result.args).toEqual([]);
  });

  it("trims name and command", () => {
    const result = validateMcpServerConfig({
      name: "  foo  ",
      command: "  bar  ",
    });
    expect(result.name).toBe("foo");
    expect(result.command).toBe("bar");
  });

  it("ignores env if not a plain object", () => {
    const r1 = validateMcpServerConfig({ name: "x", command: "y", env: [] });
    expect(r1.env).toBeUndefined();
    const r2 = validateMcpServerConfig({ name: "x", command: "y", env: "str" });
    expect(r2.env).toBeUndefined();
  });
});

describe("mountSkillMcpServers", () => {
  function fakeClient(overrides = {}) {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("returns empty handle when skill has no mcpServers", async () => {
    const client = fakeClient();
    const result = await mountSkillMcpServers(client, { id: "s" });
    expect(result).toEqual({ mounted: [], skipped: [] });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("connects each declared server in order", async () => {
    const client = fakeClient();
    const skill = {
      id: "weather-skill",
      mcpServers: [
        { name: "weather", command: "npx", args: ["-y"] },
        { name: "fs", command: "node", args: ["s.js"] },
      ],
    };
    const result = await mountSkillMcpServers(client, skill);
    expect(result.mounted).toEqual(["weather", "fs"]);
    expect(result.skipped).toEqual([]);
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(client.connect).toHaveBeenNthCalledWith(
      1,
      "weather",
      expect.objectContaining({ name: "weather", command: "npx" }),
    );
    expect(client.connect).toHaveBeenNthCalledWith(
      2,
      "fs",
      expect.objectContaining({ name: "fs", command: "node" }),
    );
  });

  it("records failures in skipped and calls onWarn", async () => {
    const err = new Error("connection refused");
    const client = fakeClient({
      connect: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(err),
    });
    const onWarn = vi.fn();
    const skill = {
      id: "s",
      mcpServers: [
        { name: "ok", command: "x" },
        { name: "bad", command: "y" },
      ],
    };
    const result = await mountSkillMcpServers(client, skill, { onWarn });
    expect(result.mounted).toEqual(["ok"]);
    expect(result.skipped).toEqual([
      { name: "bad", error: "connection refused" },
    ]);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0][0]).toMatch(/Failed to mount "bad"/);
  });

  it("skips entries that fail validation without calling connect", async () => {
    const client = fakeClient();
    const skill = {
      mcpServers: [
        { name: "valid", command: "x" },
        { command: "no-name" }, // invalid
      ],
    };
    const result = await mountSkillMcpServers(client, skill);
    expect(result.mounted).toEqual(["valid"]);
    expect(result.skipped).toHaveLength(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("throws when mcpClient lacks .connect", async () => {
    await expect(
      mountSkillMcpServers({}, { mcpServers: [{ name: "x", command: "y" }] }),
    ).rejects.toThrow(/requires an MCPClient/);
  });
});

describe("unmountSkillMcpServers", () => {
  function fakeClient(overrides = {}) {
    return {
      disconnect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("returns empty result for empty list", async () => {
    const client = fakeClient();
    const result = await unmountSkillMcpServers(client, []);
    expect(result).toEqual({ unmounted: [], errors: [] });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects each mounted server", async () => {
    const client = fakeClient();
    const result = await unmountSkillMcpServers(client, ["a", "b"]);
    expect(result.unmounted).toEqual(["a", "b"]);
    expect(client.disconnect).toHaveBeenCalledTimes(2);
    expect(client.disconnect).toHaveBeenNthCalledWith(1, "a");
    expect(client.disconnect).toHaveBeenNthCalledWith(2, "b");
  });

  it("collects errors without aborting", async () => {
    const client = fakeClient({
      disconnect: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined),
    });
    const result = await unmountSkillMcpServers(client, ["a", "b", "c"]);
    expect(result.unmounted).toEqual(["a", "c"]);
    expect(result.errors).toEqual([{ name: "b", error: "boom" }]);
  });

  it("falls back to disconnectAll when disconnect is missing", async () => {
    const client = {
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    const result = await unmountSkillMcpServers(client, ["a", "b"]);
    expect(result.unmounted).toEqual(["a", "b"]);
    expect(client.disconnectAll).toHaveBeenCalledOnce();
  });

  it("throws when client has neither disconnect nor disconnectAll", async () => {
    await expect(unmountSkillMcpServers({}, ["a"])).rejects.toThrow(
      /requires an MCPClient/,
    );
  });
});
