import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const GATE_PATH = resolve(process.cwd(), "src/main/remote/permission-gate.js");

describe("permission gate log boundary", () => {
  it("routes every permission log through the browser redactor", () => {
    const source = readFileSync(GATE_PATH, "utf8");

    expect(source).toContain(
      "const logger = createBrowserLogRedactor(browserLogSink);",
    );
    expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
  });

  it("keeps permission log messages static", () => {
    const source = readFileSync(GATE_PATH, "utf8");
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
