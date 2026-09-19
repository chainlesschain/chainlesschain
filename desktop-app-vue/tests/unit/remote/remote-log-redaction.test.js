import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  createRemoteLogRedactor,
} = require("../../../src/main/remote/remote-log-redaction");

const WIRED_MODULES = [
  "src/main/remote/handlers/file-transfer-handler.js",
  "src/main/remote/handlers/command-history-handler.js",
  "src/main/remote/handlers/process-handler.js",
  "src/main/remote/handlers/application-handler.js",
  "src/main/remote/handlers/network-handler.js",
  "src/main/remote/handlers/device-manager-handler.js",
  "src/main/remote/handlers/clipboard-handler.js",
  "src/main/remote/handlers/notification-handler.js",
  "src/main/remote/handlers/input-handler.js",
  "src/main/remote/handlers/display-handler.js",
  "src/main/remote/handlers/media-handler.js",
  "src/main/remote/handlers/power-handler.js",
  "src/main/remote/handlers/security-handler.js",
  "src/main/remote/handlers/remote-desktop-handler.js",
  "src/main/remote/handlers/ai-handler.js",
  "src/main/remote/handlers/ai-handler-enhanced.js",
  "src/main/remote/handlers/browser-handler.js",
  "src/main/remote/handlers/project-management-handler.js",
  "src/main/remote/handlers/mobile-approval-transport.js",
  "src/main/remote/handlers/system-info-handler.js",
  "src/main/remote/remote-ipc.js",
  "src/main/remote/workflow/workflow-engine.js",
  "src/main/remote/logging/statistics-collector.js",
  "src/main/remote/logging/index.js",
  "src/main/remote/logging/command-logger.js",
  "src/main/remote/logging/batched-command-logger.js",
  "src/main/remote/integration-example.js",
];

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return listJavaScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
  });
}

function createSink() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("remote log redaction", () => {
  it("removes the complete legacy message and sanitizes structured data", () => {
    const sink = createSink();
    const logger = createRemoteLogRedactor(sink, "BoundaryTest");
    const secret = "remote-log-secret-sentinel";

    logger.error(`failed at C:\\private\\${secret}.txt`, {
      path: `C:\\private\\${secret}.txt`,
      error: new Error(secret),
    });

    expect(sink.error).toHaveBeenCalledWith(
      "[BoundaryTest] redacted event",
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
      createRemoteLogRedactor(createSink(), "bad component"),
    ).toThrow("Remote log component is invalid");
    expect(() =>
      createRemoteLogRedactor({ info: vi.fn() }, "BoundaryTest"),
    ).toThrow("Remote log sink level is invalid");
  });

  it("wires high-risk transfer and history modules through the strict wrapper", () => {
    for (const relativePath of WIRED_MODULES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).toMatch(/createRemoteLogRedactor\(\s*remoteLogSink\s*,/u);
      expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
    }
  });

  it("prohibits direct generic logger imports across the remote source tree", () => {
    const remoteRoot = resolve(process.cwd(), "src/main/remote");
    const directLoggerImport =
      /const\s*\{[^}\n]*\blogger\b(?!\s*:)[^}\n]*\}\s*=\s*require\(\s*["'][^"']*utils\/logger(?:\.js)?["']\s*\)/u;

    for (const absolutePath of listJavaScriptFiles(remoteRoot)) {
      expect(readFileSync(absolutePath, "utf8"), absolutePath).not.toMatch(
        directLoggerImport,
      );
    }
  });

  it("keeps the integration example behind the strict logger", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/remote/integration-example.js"),
      "utf8",
    );
    expect(source).not.toMatch(/\bconsole\s*\./u);
  });
});
