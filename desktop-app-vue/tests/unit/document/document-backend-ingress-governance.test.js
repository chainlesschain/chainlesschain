import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const legacyDocumentEngines = [
  "word-engine.js",
  "ppt-engine.js",
  "pdf-engine.js",
  "excel-engine.js",
  "document-engine.js",
];

describe("legacy document backend ingress governance", () => {
  it.each(legacyDocumentEngines)(
    "blocks %s before it can create an HTTP request",
    (fileName) => {
      const source = fs.readFileSync(
        path.resolve("src/main/engines", fileName),
        "utf8",
      );
      const method = source.indexOf("async queryBackendAI(");
      const guard = source.indexOf("assertGovernedDocumentIngress();", method);
      const request = source.indexOf("request(", guard);

      expect(method).toBeGreaterThan(-1);
      expect(guard).toBeGreaterThan(method);
      expect(request).toBeGreaterThan(guard);
      expect(source).toContain(
        'error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED"',
      );
    },
  );
});
