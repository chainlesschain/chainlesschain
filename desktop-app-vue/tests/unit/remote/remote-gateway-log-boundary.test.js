import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const GATEWAY_PATH = resolve(
  process.cwd(),
  "src/main/remote/remote-gateway.js",
);

describe("remote gateway log boundary", () => {
  it("routes every gateway log through the browser redactor", () => {
    const source = readFileSync(GATEWAY_PATH, "utf8");

    expect(source).toContain(
      "const logger = createBrowserLogRedactor(browserLogSink);",
    );
    expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
  });

  it("keeps gateway log messages static", () => {
    const source = readFileSync(GATEWAY_PATH, "utf8");
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
