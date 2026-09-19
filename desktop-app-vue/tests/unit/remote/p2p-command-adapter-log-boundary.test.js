import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ADAPTER_PATH = resolve(
  process.cwd(),
  "src/main/remote/p2p-command-adapter.js",
);

describe("P2P command adapter log boundary", () => {
  it("routes every adapter log through the browser redactor", () => {
    const source = readFileSync(ADAPTER_PATH, "utf8");

    expect(source).toContain(
      "const logger = createBrowserLogRedactor(browserLogSink);",
    );
    expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
  });

  it("keeps adapter log messages static", () => {
    const source = readFileSync(ADAPTER_PATH, "utf8");
    const logCalls = [
      ...source.matchAll(/logger\.(?:debug|info|warn|error)\(\s*/gu),
    ];
    const fixedMessageCalls = [
      ...source.matchAll(/logger\.(?:debug|info|warn|error)\(\s*"[^"\r\n]*"/gu),
    ];

    expect(logCalls.length).toBeGreaterThan(0);
    expect(fixedMessageCalls).toHaveLength(logCalls.length);
    expect(source).not.toMatch(/logger\.(?:debug|info|warn|error)\(\s*`/u);
  });
});
