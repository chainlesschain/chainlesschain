import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const EXTENSION_SCRIPTS = ["background.js", "content.js", "popup.js"];

describe("browser extension static console boundary", () => {
  it("allows only fixed string literals in extension-owned console output", () => {
    for (const fileName of EXTENSION_SCRIPTS) {
      const source = readFileSync(
        resolve(process.cwd(), "src/main/remote/browser-extension", fileName),
        "utf8",
      );
      const calls = [
        ...source.matchAll(/console\.(?:log|warn|error)\(([^)]*)\);/gu),
      ];

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1].trim()).toMatch(/^"[^"\r\n]*"$/u);
      }
    }
  });

  it("returns a stable command error without logging or returning Error text", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/remote/browser-extension/background.js"),
      "utf8",
    );

    expect(source).toContain('message: "Command failed"');
    expect(source).toContain("if (message?.id !== undefined)");
    expect(source).not.toContain("message: error.message");
  });
});
