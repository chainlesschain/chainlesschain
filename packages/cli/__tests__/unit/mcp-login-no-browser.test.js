/**
 * Unit tests for `cc mcp login` browser-suppression flag handling.
 * Claude-Code 2.1.186 documents `claude mcp login <name> --no-browser` for SSH
 * scenarios; cc canonically uses `--no-open` and accepts `--no-browser` as an
 * alias. Both (and either alone) must suppress the browser; default opens it.
 */
import { describe, it, expect } from "vitest";
import { loginWantsNoBrowser } from "../../src/commands/mcp.js";

describe("loginWantsNoBrowser", () => {
  it("returns false by default (browser opens)", () => {
    // commander defaults: --no-X flags leave the boolean truthy when absent
    expect(loginWantsNoBrowser({ open: true, browser: true })).toBe(false);
    expect(loginWantsNoBrowser({})).toBe(false);
    expect(loginWantsNoBrowser()).toBe(false);
  });

  it("suppresses the browser when --no-open is passed", () => {
    expect(loginWantsNoBrowser({ open: false, browser: true })).toBe(true);
  });

  it("suppresses the browser when --no-browser alias is passed", () => {
    expect(loginWantsNoBrowser({ open: true, browser: false })).toBe(true);
  });

  it("suppresses the browser when both flags are passed", () => {
    expect(loginWantsNoBrowser({ open: false, browser: false })).toBe(true);
  });
});
