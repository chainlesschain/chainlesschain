import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { ElementLocator } = require("../element-locator");

const browserDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const REDACTED_LOGGER_MODULES = [
  "advanced/spa-observer.js",
  "advanced/shadow-dom-scanner.js",
  "advanced/iframe-scanner.js",
  "diagnostics/ocr-engine.js",
  "diagnostics/screenshot-diff.js",
  "diagnostics/smart-diagnostics.js",
  "actions/keyboard-action.js",
  "actions/multi-tab-action.js",
  "actions/scroll-action.js",
  "actions/upload-action.js",
];

describe("browser diagnostic log wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes every advanced, diagnostic and action logger through the redactor", () => {
    for (const relativePath of REDACTED_LOGGER_MODULES) {
      const source = readFileSync(join(browserDir, relativePath), "utf8");
      expect(source).toContain(
        "const logger = createBrowserLogRedactor(browserLogSink);",
      );
      expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
    }
  });

  it("never writes an element ref to fallback console diagnostics", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const failingLocator = {
      first: () => ({
        waitFor: vi.fn().mockRejectedValue(new Error("not found")),
      }),
    };
    const page = {
      getByRole: vi.fn(() => failingLocator),
      locator: vi.fn(() => failingLocator),
    };
    const element = {
      ref: "element-ref-secret",
      role: "button",
      label: "button-label-secret",
      tag: "button",
      selector: "#selector-secret",
      attributes: {},
    };

    await expect(ElementLocator.locate(page, element)).rejects.toThrow(
      "element-ref-secret",
    );
    const serialized = JSON.stringify(consoleLog.mock.calls);
    expect(serialized).not.toContain("element-ref-secret");
    expect(serialized).not.toContain("button-label-secret");
    expect(serialized).not.toContain("selector-secret");
    expect(serialized).toContain("refDigest=sha256:");
  });
});
