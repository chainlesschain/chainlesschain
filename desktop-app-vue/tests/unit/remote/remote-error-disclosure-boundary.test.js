import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const { CommandRouter, ERROR_CODES } =
  await import("../../../src/main/remote/command-router.js");

describe("remote error disclosure boundary", () => {
  it("returns stable handler failures to P2P and mobile callers", async () => {
    for (const context of [{ channel: "p2p" }, { source: "mobile" }]) {
      const router = new CommandRouter({ enableLogging: false });
      const error = Object.assign(new Error("handler-secret-sentinel"), {
        code: ERROR_CODES.HANDLER_ERROR,
        data: { detail: "handler-data-sentinel" },
      });
      router.registerHandler("test", {
        handle: async () => {
          throw error;
        },
      });

      const response = await router.route(
        { id: "request-secret-sentinel", method: "test.fail", params: {} },
        context,
      );

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: "request-secret-sentinel",
        error: {
          code: ERROR_CODES.HANDLER_ERROR,
          message: "Handler execution failed",
        },
      });
      expect(JSON.stringify(response)).not.toContain("handler-secret-sentinel");
      expect(JSON.stringify(response)).not.toContain("handler-data-sentinel");
    }
  });

  it("preserves legacy handler diagnostics for in-process callers", async () => {
    const router = new CommandRouter({ enableLogging: false });
    const error = Object.assign(new Error("local diagnostic"), {
      data: { detail: "local detail" },
    });
    router.registerHandler("test", {
      handle: async () => {
        throw error;
      },
    });

    const response = await router.route({
      id: 1,
      method: "test.fail",
      params: {},
    });

    expect(response.error.message).toBe("local diagnostic");
    expect(response.error.data).toEqual({ detail: "local detail" });
  });

  it("does not return raw Error messages from gateway or adapter catches", () => {
    for (const relativePath of [
      "src/main/remote/remote-gateway.js",
      "src/main/remote/p2p-command-adapter.js",
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).not.toContain("data: error.message");
    }
  });
});
