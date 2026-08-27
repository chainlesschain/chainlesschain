import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("compression handler extraction", () => {
  it("removes the legacy unbounded background implementation", () => {
    const background = readFileSync(
      resolve(process.cwd(), "src/main/remote/browser-extension/background.js"),
      "utf8",
    );
    expect(background).not.toContain('case "compression.compress"');
    expect(background).not.toContain('case "compression.decompress"');
    expect(background).not.toContain("async function compressData(");
    expect(background).not.toContain("async function decompressData(");
    expect(background).not.toContain(
      "async function getSupportedCompressionFormats(",
    );
    expect(background).not.toContain("async function isCompressionSupported(");
  });
});
