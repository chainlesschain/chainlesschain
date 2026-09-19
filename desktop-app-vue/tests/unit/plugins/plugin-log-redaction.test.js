import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  createPluginLogRedactor,
} = require("../../../src/main/plugins/plugin-log-redaction");

function createSink() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function listProductionJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === "__tests__") {
      return [];
    }
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return listProductionJavaScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
  });
}

describe("plugin log redaction", () => {
  it("removes messages and every variadic data argument", () => {
    const sink = createSink();
    const logger = createPluginLogRedactor(sink, "BoundaryTest");
    const secret = "plugin-log-secret";

    logger.error(
      `plugin failed: ${secret}`,
      { path: secret },
      new Error(secret),
    );

    expect(sink.error).toHaveBeenCalledWith(
      "[Plugin:BoundaryTest] redacted event",
      expect.objectContaining({
        message: expect.objectContaining({ redacted: true }),
        data: expect.any(Object),
      }),
    );
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
    expect(Object.getPrototypeOf(sink.error.mock.calls[0][1])).toBeNull();
  });

  it("rejects invalid components and incomplete sinks", () => {
    expect(() =>
      createPluginLogRedactor(createSink(), "bad component"),
    ).toThrow("Plugin log component is invalid");
    expect(() =>
      createPluginLogRedactor({ info: vi.fn() }, "BoundaryTest"),
    ).toThrow("Plugin log sink level is invalid");
  });

  it("prohibits direct generic logger imports in plugin and marketplace sources", () => {
    const roots = [
      resolve(process.cwd(), "src/main/plugins"),
      resolve(process.cwd(), "src/main/marketplace"),
    ];
    const directLoggerImport =
      /const\s*\{[^}\n]*\blogger\b(?!\s*:)[^}\n]*\}\s*=\s*require\(\s*["'][^"']*utils\/logger(?:\.js)?["']\s*\)/u;

    for (const root of roots) {
      for (const absolutePath of listProductionJavaScriptFiles(root)) {
        expect(readFileSync(absolutePath, "utf8"), absolutePath).not.toMatch(
          directLoggerImport,
        );
      }
    }
  });
});
