"use strict";

/**
 * mcp-prompt tests (previously untested) — the pure core that surfaces MCP
 * server prompts as `/mcp__<server>__<prompt>` slash commands. Covers
 * parseMcpPromptCommand (server/name split incl. `__` in names, JSON-object args
 * vs non-JSON tail, reject non-mcp / missing parts), renderPromptMessages
 * (text + embedded resource text, ignore binary, single vs array content),
 * expandMcpPrompt (parse -> getPrompt -> render, null for non-mcp, throw when no
 * client) and renderMcpSurface (overview / empty / no-client). No I/O.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseMcpPromptCommand,
  renderPromptMessages,
  expandMcpPrompt,
  renderMcpSurface,
} from "../mcp-prompt.js";

describe("parseMcpPromptCommand", () => {
  it("returns null for non-mcp lines", () => {
    expect(parseMcpPromptCommand("hello")).toBe(null);
    expect(parseMcpPromptCommand("/other__a__b")).toBe(null);
    expect(parseMcpPromptCommand("")).toBe(null);
  });

  it("parses server and prompt name with empty args", () => {
    expect(parseMcpPromptCommand("/mcp__github__review")).toEqual({
      server: "github",
      name: "review",
      args: {},
    });
  });

  it("keeps '__' inside the prompt name", () => {
    expect(parseMcpPromptCommand("/mcp__srv__deep__name").name).toBe(
      "deep__name",
    );
  });

  it("parses a trailing JSON object as args", () => {
    expect(parseMcpPromptCommand('/mcp__s__p {"a":1,"b":"x"}').args).toEqual({
      a: 1,
      b: "x",
    });
  });

  it("treats a non-JSON tail as { input: tail }", () => {
    expect(parseMcpPromptCommand("/mcp__s__p just some text").args).toEqual({
      input: "just some text",
    });
  });

  it("treats a JSON array tail as { input } (not an object)", () => {
    expect(parseMcpPromptCommand("/mcp__s__p [1,2]").args).toEqual({
      input: "[1,2]",
    });
  });

  it("returns null when server or prompt is missing", () => {
    expect(parseMcpPromptCommand("/mcp__srv")).toBe(null); // < 3 parts
    expect(parseMcpPromptCommand("/mcp____p")).toBe(null); // empty server
  });
});

describe("renderPromptMessages", () => {
  it("returns '' when there are no messages", () => {
    expect(renderPromptMessages(null)).toBe("");
    expect(renderPromptMessages({ messages: [] })).toBe("");
  });

  it("joins text blocks with blank lines", () => {
    const r = renderPromptMessages({
      messages: [
        { content: [{ type: "text", text: "one" }] },
        { content: [{ type: "text", text: "two" }] },
      ],
    });
    expect(r).toBe("one\n\ntwo");
  });

  it("includes embedded resource text and ignores binary/unknown blocks", () => {
    const r = renderPromptMessages({
      messages: [
        {
          content: [
            { type: "text", text: "T" },
            { type: "resource", resource: { text: "R" } },
            { type: "image", data: "..." },
            null,
          ],
        },
      ],
    });
    expect(r).toBe("T\n\nR");
  });

  it("handles content given as a single block (not an array)", () => {
    const r = renderPromptMessages({
      messages: [{ content: { type: "text", text: "solo" } }],
    });
    expect(r).toBe("solo");
  });
});

describe("expandMcpPrompt", () => {
  it("returns null for a non-mcp line", async () => {
    expect(await expandMcpPrompt("hi", {})).toBe(null);
  });

  it("throws when no MCP client is connected", async () => {
    await expect(expandMcpPrompt("/mcp__s__p", null)).rejects.toThrow(
      /No MCP servers/,
    );
  });

  it("calls getPrompt with parsed args and renders the result", async () => {
    const getPrompt = vi.fn(async () => ({
      messages: [{ content: [{ type: "text", text: "rendered" }] }],
    }));
    const out = await expandMcpPrompt('/mcp__s__p {"k":1}', { getPrompt });
    expect(getPrompt).toHaveBeenCalledWith("s", "p", { k: 1 });
    expect(out).toBe("rendered");
  });
});

describe("renderMcpSurface", () => {
  it("reports when no client is connected", () => {
    expect(renderMcpSurface(null)).toMatch(/No MCP servers/);
  });

  it("lists resources and prompts with counts", () => {
    const surface = renderMcpSurface({
      listResources: () => [{ uri: "file://x", server: "fs", name: "X" }],
      listPrompts: () => [
        { server: "gh", name: "review", description: "code review" },
      ],
    });
    expect(surface).toContain("MCP resources (1):");
    expect(surface).toContain("file://x [fs] — X");
    expect(surface).toContain("MCP prompts (1):");
    expect(surface).toContain("/mcp__gh__review — code review");
  });

  it("notes when servers expose nothing", () => {
    const surface = renderMcpSurface({
      listResources: () => [],
      listPrompts: () => [],
    });
    expect(surface).toContain(
      "(connected servers expose no resources or prompts)",
    );
  });
});
