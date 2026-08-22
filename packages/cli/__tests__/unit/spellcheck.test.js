import { describe, expect, it, vi } from "vitest";
import {
  parseSpellcheckCommand,
  resolveSpellcheckEnabled,
  spellcheckText,
  suppressFencedCodeBlocks,
} from "../../src/lib/spellcheck.js";

describe("spellcheck", () => {
  it("parses status, policy and local text commands", () => {
    expect(parseSpellcheckCommand("not a command")).toBeNull();
    expect(parseSpellcheckCommand("/spellcheck")).toEqual({ action: "status" });
    expect(parseSpellcheckCommand("/spellcheck on")).toEqual({ action: "on" });
    expect(parseSpellcheckCommand("/spellcheck prose wrng")).toEqual({
      action: "check",
      text: "prose wrng",
    });
  });

  it("resolves explicit disablement before environment and config", () => {
    expect(
      resolveSpellcheckEnabled({
        enabled: false,
        env: { CC_SPELLCHECK: "1" },
        config: { cli: { spellcheck: true } },
      }),
    ).toBe(false);
    expect(
      resolveSpellcheckEnabled({ env: { CLAUDE_CODE_SPELLCHECK: "off" } }),
    ).toBe(false);
    expect(
      resolveSpellcheckEnabled({ config: { cli: { spellcheck: false } } }),
    ).toBe(false);
  });

  it("suppresses fenced code while retaining prose", () => {
    expect(
      suppressFencedCodeBlocks(
        "intro typo\n```js\nconst identifer = 1;\n```\noutro wrng",
      ),
    ).toBe("intro typo\noutro wrng");
    expect(suppressFencedCodeBlocks("~\nnot a fence\n~\nprose")).toContain(
      "not a fence",
    );
  });

  it("does not spawn a local tool when disabled", () => {
    const spawnSync = vi.fn();
    expect(
      spellcheckText("wrng", { enabled: false, deps: { spawnSync } }),
    ).toMatchObject({
      enabled: false,
      reason: "disabled",
      words: [],
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("uses an installed adapter with code blocks removed and returns bounded unique words", () => {
    const spawnSync = vi.fn((command, args, options) => {
      if (args[0] === "--version") return { status: 0, stdout: "aspell" };
      expect(command).toBe("aspell");
      expect(args).toEqual(["list"]);
      expect(options.shell).toBe(false);
      expect(options.input).toContain("prose wrng");
      expect(options.input).not.toContain("identifer");
      return {
        status: 0,
        stdout: "wrng\nwrng\nnot-valid!\nTypo\n",
      };
    });

    const result = spellcheckText("prose wrng\n```\nidentifer\n```", {
      command: "aspell",
      deps: { spawnSync },
    });

    expect(result).toEqual({
      enabled: true,
      available: true,
      adapter: "aspell",
      words: ["wrng", "Typo"],
      reason: null,
    });
  });

  it("reports unavailable or failed adapters without returning tool diagnostics", () => {
    const unavailable = spellcheckText("typo", {
      deps: {
        spawnSync: () => ({ error: new Error("C:\\secret\\dictionary") }),
      },
    });
    expect(unavailable).toMatchObject({
      available: false,
      reason: "unavailable",
    });
    expect(JSON.stringify(unavailable)).not.toContain("secret");

    const failed = spellcheckText("typo", {
      command: "hunspell",
      deps: {
        spawnSync: (_command, args) =>
          args[0] === "--version"
            ? { status: 0 }
            : { status: 1, stderr: "token=secret" },
      },
    });
    expect(failed).toMatchObject({
      available: false,
      adapter: "hunspell",
      reason: "failed",
    });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });
});
