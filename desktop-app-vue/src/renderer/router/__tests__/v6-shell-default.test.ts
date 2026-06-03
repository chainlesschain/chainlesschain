import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveHomeRedirect,
  setV6ShellDefault,
  isV6ShellDefault,
} from "../v6-shell-default";

describe("v6-shell-default.resolveHomeRedirect", () => {
  it("does not redirect root when disabled", () => {
    expect(
      resolveHomeRedirect({ path: "/" }, { useV6ShellByDefault: false }),
    ).toBeNull();
  });

  it("redirects root to /v6-preview when enabled", () => {
    expect(
      resolveHomeRedirect({ path: "/" }, { useV6ShellByDefault: true }),
    ).toBe("/v6-preview");
  });

  it("keeps existing app routes untouched when enabled", () => {
    const subroutes = [
      "/settings",
      "/settings/system",
      "/projects",
      "/projects/new",
      "/knowledge/list",
      "/ai/chat",
      "/did",
      "/community",
    ];
    for (const path of subroutes) {
      expect(
        resolveHomeRedirect({ path }, { useV6ShellByDefault: true }),
      ).toBeNull();
    }
  });

  it("does not re-redirect /v2 or /v6-preview paths", () => {
    const shellPaths = [
      "/v2",
      "/v2/workspace",
      "/v6-preview",
      "/v6-preview/foo",
    ];
    for (const path of shellPaths) {
      expect(
        resolveHomeRedirect({ path }, { useV6ShellByDefault: true }),
      ).toBeNull();
    }
  });

  it("does not redirect /login inside resolveHomeRedirect", () => {
    expect(
      resolveHomeRedirect({ path: "/login" }, { useV6ShellByDefault: true }),
    ).toBeNull();
  });
});

describe("v6-shell-default.setV6ShellDefault / isV6ShellDefault", () => {
  beforeEach(() => {
    setV6ShellDefault(true);
  });

  it("defaults to true before app config injection (Phase 3.4 hard-flip)", () => {
    expect(isV6ShellDefault()).toBe(true);
  });

  it("can be set to false (V5 opt-out)", () => {
    setV6ShellDefault(false);
    expect(isV6ShellDefault()).toBe(false);
  });

  it("coerces truthy and falsy inputs to boolean", () => {
    setV6ShellDefault(1 as unknown as boolean);
    expect(isV6ShellDefault()).toBe(true);

    setV6ShellDefault("" as unknown as boolean);
    expect(isV6ShellDefault()).toBe(false);

    setV6ShellDefault(null as unknown as boolean);
    expect(isV6ShellDefault()).toBe(false);
  });

  it("can be toggled back to true after disabling", () => {
    setV6ShellDefault(false);
    setV6ShellDefault(true);
    expect(isV6ShellDefault()).toBe(true);
  });
});
