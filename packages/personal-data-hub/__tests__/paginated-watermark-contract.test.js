"use strict";

import { describe, expect, it } from "vitest";
const fs = require("node:fs");
const path = require("node:path");

const ADAPTERS_ROOT = path.resolve(__dirname, "../lib/adapters");

function walkJavaScriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJavaScriptFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(absolute);
    }
  }
  return files;
}

describe("bounded pagination watermark contract", () => {
  it("requires every complete-scan collector to be bounded and expose a lossless completion handshake", () => {
    const boundedCollectors = walkJavaScriptFiles(ADAPTERS_ROOT)
      .map((file) => ({
        file,
        source: fs.readFileSync(file, "utf8"),
      }))
      .filter(({ source }) =>
        /watermarkRequiresCompleteScan\s*=\s*true/.test(source),
      );

    expect(boundedCollectors.length).toBeGreaterThan(10);
    for (const { file, source } of boundedCollectors) {
      const relative = path.relative(ADAPTERS_ROOT, file);
      expect(source, `${relative} must honor a bounded page budget`).toMatch(
        /\bmaxPages\b/,
      );
      expect(
        source,
        `${relative} must not use the registry's count watermark`,
      ).toMatch(/watermarkStrategy\s*=\s*["']max-captured-at["']/);
      expect(
        source,
        `${relative} must defer the watermark when maxPages truncates a scan`,
      ).toMatch(/watermarkRequiresCompleteScan\s*=\s*true/);
      expect(
        source,
        `${relative} must report when the source end or prior watermark is reached`,
      ).toMatch(/markWatermarkComplete/);
    }
  });
});
