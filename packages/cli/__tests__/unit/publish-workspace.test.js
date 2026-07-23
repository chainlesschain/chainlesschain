import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { _deps, publishPackage } from "../../src/lib/publish-workspace.js";

const originalDeps = { ..._deps };

beforeEach(() => {
  _deps.execFileSync = vi.fn(() => "");
});

afterAll(() => {
  Object.assign(_deps, originalDeps);
});

describe("publish workspace process execution", () => {
  it("passes publish options as literal brokered argv", () => {
    const pkg = {
      name: "@example/pkg",
      version: "1.2.3",
      path: "packages/pkg",
    };

    expect(
      publishPackage(pkg, {
        tag: "next; echo not-a-command",
        access: "public",
      }),
    ).toBe(true);
    expect(_deps.execFileSync).toHaveBeenCalledWith(
      "npm",
      ["publish", "--tag", "next; echo not-a-command", "--access", "public"],
      expect.objectContaining({
        origin: "publish-workspace:npm",
        scope: "publish",
        policy: "allow",
        shell: false,
        cwd: "packages/pkg",
        stdio: "inherit",
      }),
    );
  });

  it("returns false when npm publish fails", () => {
    _deps.execFileSync.mockImplementation(() => {
      throw new Error("registry unavailable");
    });

    expect(
      publishPackage({
        name: "@example/pkg",
        version: "1.2.3",
        path: "packages/pkg",
      }),
    ).toBe(false);
  });
});
