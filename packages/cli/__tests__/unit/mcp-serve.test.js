/**
 * cc mcp serve — Streamable-HTTP MCP file server (root-confined tools).
 * Driven over real HTTP with fetch using the exact request shape the CLI
 * MCPClient sends (POST JSON-RPC, application/json responses).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  startMcpServe,
  confine,
  buildTools,
} from "../../src/lib/mcp-serve.js";

let tmp;
let handle;

async function rpc(method, params, { token, id = 1 } = {}) {
  const res = await fetch(handle.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token !== undefined
        ? token
          ? { Authorization: `Bearer ${token}` }
          : {}
        : handle.token
          ? { Authorization: `Bearer ${handle.token}` }
          : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcpserve-"));
  fs.mkdirSync(path.join(tmp, "src"));
  fs.writeFileSync(path.join(tmp, "src", "alpha.js"), "const a = 1;", "utf-8");
  fs.writeFileSync(path.join(tmp, "readme.md"), "# hello", "utf-8");
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

describe("confine", () => {
  it("resolves inside the root and rejects escapes", () => {
    expect(confine(tmp, "src/alpha.js")).toBe(path.join(tmp, "src", "alpha.js"));
    expect(confine(tmp, ".")).toBe(path.resolve(tmp));
    expect(() => confine(tmp, "../outside.txt")).toThrow(/escapes/);
    expect(() => confine(tmp, path.join(os.tmpdir(), "x"))).toThrow(/escapes/);
  });
});

describe("protocol + tools", () => {
  it("initialize → tools/list → tools/call roundtrip", async () => {
    handle = await startMcpServe({ root: tmp });
    const init = await rpc("initialize", { protocolVersion: "2025-03-26" });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("cc-mcp-serve");

    const list = await rpc("tools/list", {});
    const names = list.body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "list_dir",
      "read_file",
      "search_files",
      "write_file",
    ]);

    const read = await rpc("tools/call", {
      name: "read_file",
      arguments: { path: "src/alpha.js" },
    });
    expect(read.body.result.content[0].text).toBe("const a = 1;");

    const dir = await rpc("tools/call", {
      name: "list_dir",
      arguments: {},
    });
    expect(dir.body.result.content[0].text).toContain("src/");

    const found = await rpc("tools/call", {
      name: "search_files",
      arguments: { query: "alpha" },
    });
    expect(found.body.result.content[0].text).toBe("src/alpha.js");

    const write = await rpc("tools/call", {
      name: "write_file",
      arguments: { path: "out/new.txt", content: "written" },
    });
    expect(write.body.result.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(tmp, "out", "new.txt"), "utf-8")).toBe(
      "written",
    );
  });

  it("read-only mode drops write_file", async () => {
    handle = await startMcpServe({ root: tmp, readOnly: true });
    const list = await rpc("tools/list", {});
    const names = list.body.result.tools.map((t) => t.name);
    expect(names).not.toContain("write_file");
  });

  it("path escapes come back as isError tool results, not crashes", async () => {
    handle = await startMcpServe({ root: tmp });
    const res = await rpc("tools/call", {
      name: "read_file",
      arguments: { path: "../../etc/passwd" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("escapes");
  });

  it("unknown tool and unknown method are well-formed errors", async () => {
    handle = await startMcpServe({ root: tmp });
    const tool = await rpc("tools/call", { name: "nope", arguments: {} });
    expect(tool.body.result.isError).toBe(true);
    const method = await rpc("definitely/not", {});
    expect(method.body.error.code).toBe(-32601);
  });
});

describe("auth", () => {
  it("rejects missing/wrong Bearer and accepts the right one", async () => {
    handle = await startMcpServe({ root: tmp, token: "sekret" });
    expect((await rpc("tools/list", {}, { token: null })).status).toBe(401);
    expect((await rpc("tools/list", {}, { token: "wrong" })).status).toBe(401);
    expect((await rpc("tools/list", {}, { token: "sekret" })).status).toBe(200);
  });

  it("token: false disables auth", async () => {
    handle = await startMcpServe({ root: tmp, token: false });
    expect(handle.token).toBeNull();
    expect((await rpc("tools/list", {}, { token: null })).status).toBe(200);
  });

  it("generates a random token by default", async () => {
    handle = await startMcpServe({ root: tmp });
    expect(handle.token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildTools caps", () => {
  it("read_file truncates oversized files", () => {
    const big = path.join(tmp, "big.txt");
    fs.writeFileSync(big, "x".repeat(250 * 1024), "utf-8");
    const tools = buildTools({ root: tmp });
    const out = tools.read_file.handler({ path: "big.txt" });
    expect(out.content[0].text).toContain("[truncated");
  });
});
