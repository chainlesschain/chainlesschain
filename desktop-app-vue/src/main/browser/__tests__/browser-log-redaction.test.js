import { describe, expect, it, vi } from "vitest";

const {
  createBrowserLogRedactor,
  digestBrowserLogValue,
  sanitizeBrowserLogData,
  sanitizeBrowserLogMessage,
} = require("../browser-log-redaction");

describe("browser log redaction", () => {
  it("removes URL, path, text, DID and signature values recursively", () => {
    const raw = {
      targetId: "target-safe-1",
      url: "https://secret.example/private?q=token",
      nested: {
        filePath: "C:\\Users\\operator\\secret.pdf",
        inputText: "the user's secret form value",
        operatorDid: "did:chainlesschain:secret-operator",
        signature: "base64-secret-signature",
      },
      error: new Error("failed at /private/secret/file.txt"),
    };
    const sanitized = sanitizeBrowserLogData(raw);
    const serialized = JSON.stringify(sanitized);

    for (const secret of [
      "secret.example",
      "operator\\secret.pdf",
      "user's secret",
      "secret-operator",
      "base64-secret-signature",
      "/private/secret/file.txt",
    ])
      expect(serialized).not.toContain(secret);
    expect(sanitized.targetId).toMatchObject({
      redacted: true,
      valueDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(sanitized.url).toMatchObject({
      redacted: true,
      valueDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(sanitized.error).toMatchObject({
      name: "Error",
      message: { redacted: true },
    });
  });

  it("sanitizes sensitive tokens embedded in log messages", () => {
    const message = sanitizeBrowserLogMessage(
      "open https://secret.example/a and C:\\Users\\operator\\secret.txt from /private/data.json",
    );
    expect(message).not.toContain("secret.example");
    expect(message).not.toContain("operator\\secret.txt");
    expect(message).not.toContain("/private/data.json");
    expect(message).toContain("[redacted:");
  });

  it("wraps logger levels and never evaluates accessors or renderer proxies", () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const accessor = vi.fn(() => "must-not-run");
    const value = { url: "https://secret.example" };
    Object.defineProperty(value, "computed", {
      enumerable: true,
      get: accessor,
    });
    value.renderer = new Proxy({ text: "proxy-secret" }, {});
    const logger = createBrowserLogRedactor(sink);

    logger.info("[Browser] safe event", value);
    expect(accessor).not.toHaveBeenCalled();
    expect(JSON.stringify(sink.info.mock.calls)).not.toContain(
      "secret.example",
    );
    expect(JSON.stringify(sink.info.mock.calls)).not.toContain("proxy-secret");
    expect(sink.info).toHaveBeenCalledWith(
      "[Browser] safe event",
      expect.objectContaining({
        url: expect.objectContaining({ redacted: true }),
      }),
    );
  });

  it("does not trigger proxy traps or Error accessors", () => {
    const getPrototypeOf = vi.fn(() => {
      throw new Error("proxy trap must not run");
    });
    const proxy = new Proxy({}, { getPrototypeOf });
    const error = new Error("safe own message");
    const errorMessage = vi.fn(() => "accessor secret");
    Object.defineProperty(error, "message", {
      configurable: true,
      get: errorMessage,
    });

    expect(() => sanitizeBrowserLogData(proxy)).not.toThrow();
    expect(getPrototypeOf).not.toHaveBeenCalled();
    expect(sanitizeBrowserLogData(error)).toMatchObject({
      name: "Error",
      message: { redacted: true },
    });
    expect(errorMessage).not.toHaveBeenCalled();
  });

  it("uses domain-separated stable digests", () => {
    expect(digestBrowserLogValue("url", "same")).toBe(
      digestBrowserLogValue("url", "same"),
    );
    expect(digestBrowserLogValue("url", "same")).not.toBe(
      digestBrowserLogValue("path", "same"),
    );
  });
});
