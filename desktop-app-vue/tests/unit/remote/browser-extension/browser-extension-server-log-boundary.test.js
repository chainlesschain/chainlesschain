import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SERVER_PATH = resolve(
  process.cwd(),
  "src/main/remote/browser-extension-server.js",
);

describe("browser extension server log boundary", () => {
  it("routes every server log through the browser redactor", () => {
    const source = readFileSync(SERVER_PATH, "utf8");

    expect(source).toContain(
      "const logger = createBrowserLogRedactor(browserLogSink);",
    );
    expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
  });

  it("keeps log messages static and moves runtime values into redacted data", () => {
    const source = readFileSync(SERVER_PATH, "utf8");
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
