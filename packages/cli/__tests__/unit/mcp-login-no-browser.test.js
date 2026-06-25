/**
 * Unit tests for `cc mcp login` browser-suppression flag handling.
 * Claude-Code 2.1.186 documents `claude mcp login <name> --no-browser` for SSH
 * scenarios; cc canonically uses `--no-open` and accepts `--no-browser` as an
 * alias. Both (and either alone) must suppress the browser; default opens it.
 */
import { describe, it, expect } from "vitest";
import { loginWantsNoBrowser, isHeadlessEnv } from "../../src/commands/mcp.js";

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

/**
 * Claude-Code 2.1.191: headless environments auto-skip the browser popup. cc
 * detects this so `mcp login` prints the authorize URL (the localhost callback
 * still catches the code) instead of launching a popup that can never appear.
 */
describe("isHeadlessEnv", () => {
  it("treats a desktop Linux session (DISPLAY set) as not headless", () => {
    expect(isHeadlessEnv({ DISPLAY: ":0" }, "linux")).toBe(false);
    expect(isHeadlessEnv({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(
      false,
    );
  });

  it("treats Linux/BSD with no display server as headless (SSH without X11)", () => {
    expect(isHeadlessEnv({}, "linux")).toBe(true);
    expect(isHeadlessEnv({ SSH_CONNECTION: "1.2.3.4 22" }, "linux")).toBe(true);
    expect(isHeadlessEnv({}, "freebsd")).toBe(true);
  });

  it("treats macOS and Windows as not headless (window server always present)", () => {
    expect(isHeadlessEnv({}, "darwin")).toBe(false);
    expect(isHeadlessEnv({}, "win32")).toBe(false);
  });

  it("forces headless on any OS when a CI marker is set", () => {
    expect(isHeadlessEnv({ CI: "true", DISPLAY: ":0" }, "linux")).toBe(true);
    expect(isHeadlessEnv({ CI: "1" }, "darwin")).toBe(true);
    expect(isHeadlessEnv({ CI: "yes" }, "win32")).toBe(true);
  });

  it("treats CI=false / CI=0 as not-CI", () => {
    expect(isHeadlessEnv({ CI: "false" }, "darwin")).toBe(false);
    expect(isHeadlessEnv({ CI: "0", DISPLAY: ":0" }, "linux")).toBe(false);
  });
});
