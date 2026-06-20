import { describe, it, expect } from "vitest";
import {
  formatForDiscord,
  neutralizeMassMentions,
  splitForDiscord,
  codeBlock,
} from "../../src/gateways/discord/discord-formatter.js";

const ZWSP = "​";

describe("formatForDiscord — mass-mention safety", () => {
  it("defangs @everyone and @here so they do not ping", () => {
    const out = formatForDiscord("hey @everyone look @here now");
    // no raw mention tokens survive
    expect(out).not.toMatch(/@everyone/);
    expect(out).not.toMatch(/@here/);
    // a zero-width space was inserted right after the @
    expect(out).toContain(`@${ZWSP}everyone`);
    expect(out).toContain(`@${ZWSP}here`);
    // strips back to the original (renders identically to a human)
    expect(out.replace(new RegExp(ZWSP, "g"), "")).toBe(
      "hey @everyone look @here now",
    );
  });

  it("leaves ordinary text and normal @mentions of users untouched", () => {
    // @everyone / @here are the only mass-ping tokens; a username-ish @ is left alone
    const out = formatForDiscord("ping @alice about the @everyone policy");
    expect(out).toContain("@alice");
    expect(out).toContain(`@${ZWSP}everyone`);
  });

  it("still truncates over-long responses", () => {
    const out = formatForDiscord("x".repeat(5000), { maxLength: 100 });
    expect(out.length).toBe(100);
    expect(out.endsWith("...")).toBe(true);
  });

  it("returns empty string for falsy input", () => {
    expect(formatForDiscord("")).toBe("");
    expect(formatForDiscord(null)).toBe("");
  });
});

describe("neutralizeMassMentions", () => {
  it("handles null / non-string input", () => {
    expect(neutralizeMassMentions(null)).toBe("");
    expect(neutralizeMassMentions(undefined)).toBe("");
  });
  it("defangs repeated mentions", () => {
    const out = neutralizeMassMentions("@everyone @everyone @here");
    expect(out).not.toMatch(/@everyone/);
    expect(out).not.toMatch(/@here/);
  });
});

describe("splitForDiscord / codeBlock (unchanged behavior)", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitForDiscord("short")).toEqual(["short"]);
  });
  it("splits long text into bounded chunks", () => {
    const chunks = splitForDiscord("a\n".repeat(2000), 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });
  it("wraps code blocks", () => {
    expect(codeBlock("x=1", "py")).toBe("```py\nx=1\n```");
  });
});
