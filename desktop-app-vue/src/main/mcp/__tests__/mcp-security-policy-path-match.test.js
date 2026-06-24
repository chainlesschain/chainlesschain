/**
 * pathMatchesPattern — strict (whitelist) vs loose (blacklist) segment matching.
 *
 * Bug: the path matcher had a loose `includes("/" + pattern)` branch that matches
 * the pattern as a *prefix of a segment* (".../app" matching ".../application/...").
 * For the FORBIDDEN blacklist that over-blocking is fine (".env" also blocks
 * ".env.local"), but `_validatePathAccess` used the same matcher for the ALLOWED
 * whitelist, so an MCP server allowed "app" could reach ".../application/secrets"
 * — a sandbox escape. Fix: strict mode (segment-bounded) for the whitelist;
 * loose mode kept for the blacklist.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { pathMatchesPattern } = require("../mcp-security-policy.js");

describe("pathMatchesPattern strict (whitelist)", () => {
  it("does NOT match a prefix-of-segment (allowed 'app' !-> application)", () => {
    expect(pathMatchesPattern("/home/application/secrets", "app", true)).toBe(
      false,
    );
    expect(
      pathMatchesPattern("/home/config.json.bak", "config.json", true),
    ).toBe(false);
  });

  it("still matches all legitimate segment positions", () => {
    expect(pathMatchesPattern("/home/app/x", "app", true)).toBe(true); // middle
    expect(pathMatchesPattern("/home/app", "app", true)).toBe(true); // suffix
    expect(pathMatchesPattern("app/x", "app", true)).toBe(true); // prefix
    expect(pathMatchesPattern("app", "app", true)).toBe(true); // exact
  });
});

describe("pathMatchesPattern loose (blacklist, default)", () => {
  it("blocks sensitive variants by prefix (.env also blocks .env.local)", () => {
    expect(pathMatchesPattern("/proj/.env.local", ".env")).toBe(true);
  });

  it("still blocks the exact forbidden dir", () => {
    expect(pathMatchesPattern("/home/.ssh/id_rsa", ".ssh")).toBe(true);
    expect(
      pathMatchesPattern("/home/proj/node_modules/x", "node_modules"),
    ).toBe(true);
  });
});
