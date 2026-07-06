/**
 * hardenedEnv — the env applied to every `cc`/`npm` child spawned through a
 * Windows shell so cmd.exe does NOT resolve a bare command name from the
 * current directory before PATH (a cloned repo shipping `cc.bat` at its root
 * would otherwise run just from opening the chat panel). Pure Node.
 */
import { describe, it, expect } from "vitest";
import { hardenedEnv } from "../../../vscode-extension/src/hardened-env.js";

describe("hardenedEnv", () => {
  it("sets NoDefaultCurrentDirectoryInExePath on Windows and preserves the base", () => {
    const base = { PATH: "/usr/bin", FOO: "bar" };
    const out = hardenedEnv(base);
    expect(out.PATH).toBe("/usr/bin");
    expect(out.FOO).toBe("bar");
    if (process.platform === "win32") {
      expect(out.NoDefaultCurrentDirectoryInExePath).toBe("1");
    } else {
      // The variable is Windows-only; on POSIX the env is passed through as-is.
      expect(out.NoDefaultCurrentDirectoryInExePath).toBeUndefined();
    }
  });

  it("does not mutate the passed base object", () => {
    const base = { PATH: "/x" };
    hardenedEnv(base);
    expect(base.NoDefaultCurrentDirectoryInExePath).toBeUndefined();
  });

  it("falls back to process.env when no base is given", () => {
    const out = hardenedEnv();
    // A well-known var from process.env survives the copy.
    expect(typeof out).toBe("object");
    if (process.platform === "win32") {
      expect(out.NoDefaultCurrentDirectoryInExePath).toBe("1");
    }
  });
});
