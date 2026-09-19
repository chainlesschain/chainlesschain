import { readFileSync } from "node:fs";
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
];

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
      expect(source).toContain("createRemoteLogRedactor(remoteLogSink");
      expect(source).not.toMatch(/const\s*\{\s*logger\s*\}\s*=\s*require/u);
    }
  });
});
