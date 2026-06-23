/**
 * Unit tests for mcp-auth-target — resolving `cc mcp login|logout <target>`
 * (a URL or a configured server name) to a concrete server URL.
 * Claude-Code 2.1.186 `mcp login <name>` parity.
 */
import { describe, it, expect } from "vitest";
import {
  resolveMcpAuthTarget,
  isUrlLike,
} from "../../src/lib/mcp-auth-target.js";

describe("isUrlLike", () => {
  it("accepts http/https/custom schemes", () => {
    expect(isUrlLike("https://mcp.example.com")).toBe(true);
    expect(isUrlLike("http://localhost:8080/sse")).toBe(true);
    expect(isUrlLike("  https://x.io ")).toBe(true); // trims first
  });
  it("rejects bare names and hosts", () => {
    expect(isUrlLike("my-server")).toBe(false);
    expect(isUrlLike("mcp.example.com")).toBe(false); // no scheme
    expect(isUrlLike("")).toBe(false);
    expect(isUrlLike(null)).toBe(false);
  });
});

describe("resolveMcpAuthTarget", () => {
  it("uses a raw URL verbatim and never calls lookupServer", () => {
    let called = false;
    const res = resolveMcpAuthTarget("https://mcp.example.com/x", () => {
      called = true;
      return null;
    });
    expect(res).toEqual({
      url: "https://mcp.example.com/x",
      name: null,
      source: "url",
    });
    expect(called).toBe(false);
  });

  it("trims a URL target", () => {
    expect(resolveMcpAuthTarget("  https://a.io  ").url).toBe("https://a.io");
  });

  it("resolves a configured server name to its url", () => {
    const lookup = (name) =>
      name === "context7"
        ? {
            name: "context7",
            url: "https://ctx7.example.com",
            transport: "http",
          }
        : null;
    const res = resolveMcpAuthTarget("context7", lookup);
    expect(res).toEqual({
      url: "https://ctx7.example.com",
      name: "context7",
      source: "config",
    });
  });

  it("throws a helpful error for an unknown server name", () => {
    expect(() => resolveMcpAuthTarget("nope", () => null)).toThrow(
      /no configured MCP server named "nope"/,
    );
  });

  it("throws when a configured server has no http(s) url (stdio)", () => {
    const lookup = () => ({ name: "local", url: null, transport: "stdio" });
    expect(() => resolveMcpAuthTarget("local", lookup)).toThrow(
      /has no http\(s\) URL .*transport: stdio/,
    );
  });

  it("throws when a configured server url is not URL-like", () => {
    const lookup = () => ({ name: "weird", url: "not-a-url" });
    expect(() => resolveMcpAuthTarget("weird", lookup)).toThrow(
      /has no http\(s\) URL/,
    );
  });

  it("requires a non-empty target", () => {
    expect(() => resolveMcpAuthTarget("", () => null)).toThrow(
      /server URL or configured server name is required/,
    );
    expect(() => resolveMcpAuthTarget(undefined)).toThrow(/required/);
  });

  it("treats a name as unknown when no lookup is supplied", () => {
    expect(() => resolveMcpAuthTarget("context7")).toThrow(
      /no configured MCP server named "context7"/,
    );
  });
});
