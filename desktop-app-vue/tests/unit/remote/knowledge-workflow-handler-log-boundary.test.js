import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const HANDLER_PATHS = [
  "src/main/remote/handlers/knowledge-handler.js",
  "src/main/remote/handlers/workflow-handler.js",
];

describe("remote knowledge and workflow handler log boundary", () => {
  it("routes both handler loggers through the browser redactor", () => {
    for (const relativePath of HANDLER_PATHS) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).toContain(
        "const logger = createBrowserLogRedactor(browserLogSink);",
      );
      expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
    }
  });

  it("keeps knowledge and workflow log messages static", () => {
    for (const relativePath of HANDLER_PATHS) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      const logCalls = [
        ...source.matchAll(/logger\.(?:debug|info|warn|error)\(\s*/gu),
      ];
      const fixedMessageCalls = [
        ...source.matchAll(
          /logger\.(?:debug|info|warn|error)\(\s*"[^"\r\n]*"/gu,
        ),
      ];

      expect(logCalls.length).toBeGreaterThan(0);
      expect(fixedMessageCalls).toHaveLength(logCalls.length);
      expect(source).not.toMatch(/logger\.(?:debug|info|warn|error)\(\s*`/u);
      expect(source).not.toMatch(
        /logger\.(?:debug|info|warn|error)\(\s*"[^"\r\n]*"\s*\+/u,
      );
    }
  });
});
