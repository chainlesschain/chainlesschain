/**
 * Deep-link parser for the VS Code extension (vscode://…/open[?prompt=…]).
 * Pure → no host needed.
 */
import { describe, it, expect } from "vitest";
import { parseDeepLink } from "../../../vscode-extension/src/uri-handler.js";

describe("parseDeepLink", () => {
  it("maps /open (and the bare authority) to the open action", () => {
    expect(parseDeepLink({ path: "/open" })).toEqual({ action: "open" });
    expect(parseDeepLink({ path: "" })).toEqual({ action: "open" });
    expect(parseDeepLink({})).toEqual({ action: "open" });
    // case-insensitive + leading slashes tolerated
    expect(parseDeepLink({ path: "//OPEN" })).toEqual({ action: "open" });
  });

  it("extracts and decodes a prompt query param", () => {
    expect(
      parseDeepLink({ path: "/open", query: "prompt=fix%20the%20bug" }),
    ).toEqual({
      action: "open",
      prompt: "fix the bug",
    });
    // '+' decodes to a space too
    expect(
      parseDeepLink({ path: "/open", query: "prompt=hello+world" }),
    ).toEqual({
      action: "open",
      prompt: "hello world",
    });
  });

  it("ignores other params and a blank/whitespace prompt", () => {
    expect(parseDeepLink({ path: "/open", query: "foo=1&bar=2" })).toEqual({
      action: "open",
    });
    expect(parseDeepLink({ path: "/open", query: "prompt=" })).toEqual({
      action: "open",
    });
    expect(parseDeepLink({ path: "/open", query: "prompt=%20%20" })).toEqual({
      action: "open",
    });
  });

  it("returns null for an unknown action (ignored, never misfires)", () => {
    expect(parseDeepLink({ path: "/settings" })).toBe(null);
    expect(parseDeepLink({ path: "/run", query: "prompt=x" })).toBe(null);
  });

  it("never throws on a malformed percent-escape", () => {
    expect(() =>
      parseDeepLink({ path: "/open", query: "prompt=%E0%A4%A" }),
    ).not.toThrow();
    const r = parseDeepLink({ path: "/open", query: "prompt=%zz" });
    expect(r.action).toBe("open");
    expect(r.prompt).toBe("%zz"); // left as-is when undecodable
  });

  it("picks the FIRST prompt when repeated", () => {
    expect(
      parseDeepLink({ path: "/open", query: "prompt=a&prompt=b" }).prompt,
    ).toBe("a");
  });
});
