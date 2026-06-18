/**
 * cc mcp serve — request-collection guardrails.
 *
 * The JSON-RPC server must not let a single request exhaust memory (unbounded
 * body) or hold a socket open forever (stalled client that never ends the
 * request). It caps the body (413) and bounds the collection phase with a
 * timeout (408). Both limits are overridable via opts so the tests run fast.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";

import { startMcpServe } from "../../src/lib/mcp-serve.js";

let tmp;
let handle;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcpserve-lim-"));
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("startMcpServe request limits", () => {
  it("rejects an oversized request body with 413", async () => {
    handle = await startMcpServe({
      root: tmp,
      token: false,
      maxRequestBytes: 64,
    });
    const big = "x".repeat(5000);
    const res = await fetch(handle.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { pad: big },
      }),
    });
    expect(res.status).toBe(413);
  });

  it("still serves a normal request under the size cap", async () => {
    handle = await startMcpServe({
      root: tmp,
      token: false,
      maxRequestBytes: 1024 * 1024,
    });
    const res = await fetch(handle.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it("times out a stalled request instead of hanging", async () => {
    handle = await startMcpServe({
      root: tmp,
      token: false,
      requestTimeoutMs: 80,
    });
    const u = new URL(handle.url);
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      // Surface the case where the server closes the socket without a response
      // — also an acceptable "did not hang" outcome.
      req.on("error", (e) => reject(e));
      // Write a partial body and never call end() — the server must not wait
      // forever; its collection timeout should fire.
      req.write('{"jsonrpc":"2.0","id":1');
    });
    expect(status).toBe(408);
  });
});
