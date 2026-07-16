/**
 * win-shell — cmd.exe argv escaping for `shell: true` spawns (VS Code ext).
 *
 * Pure string assertions run everywhere; the round-trip suite runs on Windows
 * only and drives a REAL `cmd.exe` + `.cmd` shim (the exact production shape:
 * Node joins argv with spaces into `cmd /d /s /c "<file> <args>"`, and the npm
 * `cc.cmd` shim re-parses the line once more via `%*`), proving each escaped
 * token survives both parse passes byte-for-byte.
 */
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  escapeCmdArg,
  escapeCmdArgs,
} from "../../../vscode-extension/src/win-shell.js";

describe("escapeCmdArg (pure)", () => {
  it("is a no-op on non-Windows platforms", () => {
    expect(escapeCmdArg("a & b", { platform: "linux" })).toBe("a & b");
    expect(escapeCmdArg('say "hi"', { platform: "darwin" })).toBe('say "hi"');
  });

  it("quotes and double-^-escapes cmd metacharacters on win32", () => {
    const out = escapeCmdArg("Continue the task & run tests", {
      platform: "win32",
    });
    expect(out).toContain("^^&");
    expect(out.startsWith('^^^"')).toBe(true);
    expect(out.endsWith('^^^"')).toBe(true);
  });

  it("escapes embedded quotes and trailing backslashes (msvcrt rules)", () => {
    // an embedded quote must become \" inside the quoted token
    expect(escapeCmdArg('say "hi"', { platform: "win32" })).toContain('\\^^^"');
    // a trailing backslash doubles so it cannot eat the closing quote
    const out = escapeCmdArg("C:\\dir\\", { platform: "win32" });
    expect(out).toContain("C:\\dir\\\\");
  });

  it("stringifies null/undefined safely and maps arrays", () => {
    expect(escapeCmdArg(null, { platform: "linux" })).toBe("");
    expect(escapeCmdArgs(["a", "b c"], { platform: "linux" })).toEqual([
      "a",
      "b c",
    ]);
  });
});

describe.runIf(process.platform === "win32")(
  "escapeCmdArg round-trip through real cmd.exe + .cmd shim",
  () => {
    // Faithful production shape: a batch shim that forwards %* to node, which
    // prints its argv as JSON — exactly how the npm `cc.cmd` shim forwards to
    // the CLI entry. `shell: true` reproduces Node's unquoted argv join.
    const dir = mkdtempSync(join(tmpdir(), "win-shell-"));
    const echoJs = join(dir, "echo-args.js");
    const shim = join(dir, "echo-args.cmd");
    writeFileSync(
      echoJs,
      "console.log(JSON.stringify(process.argv.slice(2)))",
      "utf8",
    );
    writeFileSync(shim, `@"${process.execPath}" "${echoJs}" %*\r\n`, "utf8");

    const roundTrip = (tokens) =>
      new Promise((resolve, reject) => {
        execFile(
          shim,
          escapeCmdArgs(tokens, { platform: "win32" }),
          { shell: true, windowsHide: true, timeout: 15000 },
          (err, stdout) => {
            if (err) return reject(err);
            try {
              resolve(JSON.parse(String(stdout).trim()));
            } catch (e) {
              reject(new Error(`bad echo output: ${stdout}: ${e.message}`));
            }
          },
        );
      });

    it("preserves prose with &, |, quotes, parens and CJK byte-for-byte", async () => {
      const tokens = [
        "daemon",
        "resume",
        "bg-1",
        'verify & deploy | tell me "when" (soon) 100% done — 中文也要过',
        "--json",
      ];
      expect(await roundTrip(tokens)).toEqual(tokens);
    });

    it("does NOT execute an injected second command", async () => {
      const marker = join(dir, "pwned.txt");
      const tokens = [`x & echo pwned > "${marker}"`];
      expect(await roundTrip(tokens)).toEqual(tokens);
      const { existsSync } = await import("node:fs");
      expect(existsSync(marker)).toBe(false);
    });

    it("cleans up", () => {
      rmSync(dir, { recursive: true, force: true });
    });
  },
);
