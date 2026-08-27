import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser extension background console boundary", () => {
  it("keeps dead request tracking and console capture state out of background.js", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/remote/browser-extension/background.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\bpendingRequests\b/);
    expect(source).not.toMatch(/\bconsoleCaptures\b/);
    expect(source).not.toMatch(/\bconsoleLogs\b/);
    expect(source).not.toMatch(/function\s+enableConsoleCapture/);
    expect(source).not.toMatch(/case\s+["']console\./);
    expect(source).not.toMatch(/case\s+["']page\.getConsole/);
  });
});
