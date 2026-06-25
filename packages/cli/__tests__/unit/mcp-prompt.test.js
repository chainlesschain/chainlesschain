import { describe, it, expect, vi } from "vitest";
import {
  parseMcpPromptCommand,
  renderPromptMessages,
  expandMcpPrompt,
  renderMcpSurface,
} from "../../src/repl/mcp-prompt.js";

describe("parseMcpPromptCommand", () => {
  it("parses a bare /mcp__server__prompt with no args", () => {
    expect(parseMcpPromptCommand("/mcp__fs__list")).toEqual({
      server: "fs",
      name: "list",
      args: {},
    });
  });

  it("keeps __ inside the prompt name", () => {
    expect(parseMcpPromptCommand("/mcp__git__show__diff")).toMatchObject({
      server: "git",
      name: "show__diff",
    });
  });

  it("parses a trailing JSON object as args", () => {
    expect(parseMcpPromptCommand('/mcp__fs__read {"path":"/x","n":2}')).toEqual(
      { server: "fs", name: "read", args: { path: "/x", n: 2 } },
    );
  });

  it("wraps a non-JSON tail as { input } for ergonomic one-arg prompts", () => {
    expect(parseMcpPromptCommand("/mcp__web__search cats and dogs")).toEqual({
      server: "web",
      name: "search",
      args: { input: "cats and dogs" },
    });
  });

  it("wraps a JSON array tail as { input } (only plain objects become args)", () => {
    const r = parseMcpPromptCommand("/mcp__x__y [1,2,3]");
    expect(r.args).toEqual({ input: "[1,2,3]" });
  });

  it("returns null for non-mcp lines and malformed tokens", () => {
    expect(parseMcpPromptCommand("hello world")).toBeNull();
    expect(parseMcpPromptCommand("/mcp__only")).toBeNull(); // no prompt segment
    expect(parseMcpPromptCommand("/mcp__server__")).toBeNull(); // empty name
    expect(parseMcpPromptCommand("/mcp____list")).toBeNull(); // empty server
    expect(parseMcpPromptCommand("")).toBeNull();
    expect(parseMcpPromptCommand(null)).toBeNull();
  });
});

describe("renderPromptMessages", () => {
  it("joins text blocks across messages with blank lines", () => {
    const result = {
      messages: [
        { content: [{ type: "text", text: "one" }] },
        { content: [{ type: "text", text: "two" }] },
      ],
    };
    expect(renderPromptMessages(result)).toBe("one\n\ntwo");
  });

  it("handles a single (non-array) content block", () => {
    const result = { messages: [{ content: { type: "text", text: "solo" } }] };
    expect(renderPromptMessages(result)).toBe("solo");
  });

  it("includes embedded text resources and ignores binary blocks", () => {
    const result = {
      messages: [
        {
          content: [
            { type: "image", data: "…base64…" }, // ignored
            { type: "resource", resource: { text: "doc body" } },
          ],
        },
      ],
    };
    expect(renderPromptMessages(result)).toBe("doc body");
  });

  it("returns empty string for missing / empty messages", () => {
    expect(renderPromptMessages(undefined)).toBe("");
    expect(renderPromptMessages({})).toBe("");
    expect(renderPromptMessages({ messages: [] })).toBe("");
  });
});

describe("expandMcpPrompt", () => {
  it("returns null for a non-mcp line without touching the client", async () => {
    const client = { getPrompt: vi.fn() };
    expect(await expandMcpPrompt("just text", client)).toBeNull();
    expect(client.getPrompt).not.toHaveBeenCalled();
  });

  it("throws a clear error when no MCP client is connected", async () => {
    await expect(expandMcpPrompt("/mcp__fs__list", null)).rejects.toThrow(
      /No MCP servers are connected/,
    );
  });

  it("calls getPrompt with the parsed parts and renders the result", async () => {
    const client = {
      getPrompt: vi.fn(async () => ({
        messages: [{ content: [{ type: "text", text: "rendered" }] }],
      })),
    };
    const text = await expandMcpPrompt('/mcp__fs__read {"path":"/x"}', client);
    expect(client.getPrompt).toHaveBeenCalledWith("fs", "read", { path: "/x" });
    expect(text).toBe("rendered");
  });
});

describe("renderMcpSurface", () => {
  it("reports when no client is connected", () => {
    expect(renderMcpSurface(null)).toMatch(/No MCP servers are connected/);
  });

  it("lists resources and prompts", () => {
    const client = {
      listResources: () => [{ uri: "file://a", server: "fs", name: "A" }],
      listPrompts: () => [
        { server: "git", name: "show", description: "show a commit" },
      ],
    };
    const out = renderMcpSurface(client);
    expect(out).toContain("MCP resources (1):");
    expect(out).toContain("file://a [fs] — A");
    expect(out).toContain("MCP prompts (1):");
    expect(out).toContain("/mcp__git__show — show a commit");
  });

  it("notes when connected servers expose nothing", () => {
    const client = { listResources: () => [], listPrompts: () => [] };
    expect(renderMcpSurface(client)).toMatch(
      /connected servers expose no resources or prompts/,
    );
  });
});
