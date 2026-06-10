/**
 * IDE live context — full-chain integration WITHOUT a VS Code host:
 * the extension's real MCP server (fake editor facade) ⇆ the CLI's real
 * MCPClient (via setupMcpFromConfig, exactly how resolveAgentMcp connects an
 * IDE) ⇆ the real injection consumers:
 *   - buildIdePromptContext (prompt-time <ide-context> block)
 *   - executeTool write_file → ideDiagnostics post-edit feedback
 *
 * Complements __tests__/unit/ide-context.test.js (pure module + fake client)
 * by proving the wire protocol end to end: Streamable HTTP + Bearer + the
 * {content:[{type:"text",text:JSON}]} result envelope.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";
import {
  buildIdePromptContext,
  collectIdeDiagnostics,
} from "../../src/lib/ide-context.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const TOKEN = "ide-ctx-interop-secret";

/** Editor facade that reports an error for ANY file it is asked about. */
function facade() {
  return {
    getSelection: async () => ({
      file: "/abs/ws/src/a.js",
      languageId: "javascript",
      selection: {
        start: { line: 3, character: 2 },
        end: { line: 3, character: 9 },
      },
      text: "foo()",
    }),
    getDiagnostics: async ({ path: p } = {}) =>
      p
        ? [{ file: p, severity: "error", message: "boom from IDE", line: 3 }]
        : [],
    getOpenEditors: async () => [
      { file: "/abs/ws/src/a.js", active: true, languageId: "javascript" },
      { file: "/abs/ws/src/b.js", active: false },
    ],
    openDiff: async (args) => ({ outcome: "accepted", path: args.path }),
  };
}

describe("IDE context over the real extension MCP server", () => {
  let server;
  let mcp;
  let tmp;

  beforeEach(async () => {
    process.env.CC_IDE_DIAG_SETTLE_MS = "0";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-idectx-int-"));
    server = new IdeMcpServer({ tools: buildIdeTools(facade()), token: TOKEN });
    await server.start({ port: 0 });
    // Connect the way resolveAgentMcp/loadIdeMcp does — reserved name `ide`.
    mcp = await setupMcpFromConfig(
      {
        ide: {
          url: server.url(),
          transport: "http",
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      },
      { writeErr: () => {} },
    );
  });

  afterEach(async () => {
    delete process.env.CC_IDE_DIAG_SETTLE_MS;
    try {
      await mcp?.mcpClient?.disconnectAll();
    } catch {
      /* ignore */
    }
    await server.stop();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("buildIdePromptContext renders live selection + editors from the wire", async () => {
    expect(mcp).toBeTruthy();
    const block = await buildIdePromptContext(mcp, { env: {} });
    expect(block).toContain("<ide-context>");
    expect(block).toContain("Active file: /abs/ws/src/a.js");
    expect(block).toContain("/abs/ws/src/b.js");
    expect(block).toContain("Selected text in /abs/ws/src/a.js:4-4:");
    expect(block).toContain("foo()");
  });

  it("executeTool write_file pulls real diagnostics back as ideDiagnostics", async () => {
    const res = await executeTool(
      "write_file",
      { path: "broken.js", content: "const x = ;" },
      {
        cwd: tmp,
        mcpClient: mcp.mcpClient,
        externalToolExecutors: mcp.externalToolExecutors,
      },
    );
    expect(res.success).toBe(true);
    expect(res.ideDiagnostics).toContain("IDE diagnostics after this edit");
    expect(res.ideDiagnostics).toContain("boom from IDE");
    // the facade echoes the queried path → proves the resolved path went over the wire
    expect(res.ideDiagnostics).toContain(path.resolve(tmp, "broken.js"));
  });

  it("CC_IDE_CONTEXT=0 disables both behaviors end to end", async () => {
    expect(
      await buildIdePromptContext(mcp, { env: { CC_IDE_CONTEXT: "0" } }),
    ).toBe(null);
    expect(
      await collectIdeDiagnostics(mcp, "/any/file.js", {
        env: { CC_IDE_CONTEXT: "0" },
        settleMs: 0,
      }),
    ).toBe(null);
  });

  it("a dead IDE server degrades to null instead of failing the turn", async () => {
    await server.stop();
    const block = await buildIdePromptContext(mcp, {
      env: {},
      timeoutMs: 500,
    });
    expect(block).toBe(null);
  });
});

describe("IDE diff approval over the real extension MCP server", () => {
  let server;
  let mcp;
  let tmp;
  let mode = "accept";

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-diffint-"));
    // A facade whose openDiff behaves like the real VS Code one: on accept it
    // WRITES the proposed text to the file itself, then reports accepted.
    const diffFacade = {
      getSelection: async () => null,
      getDiagnostics: async () => [],
      getOpenEditors: async () => [],
      openDiff: async (args) => {
        if (mode === "accept") {
          const finalText = args.modifiedText + "\n// user tweak";
          fs.writeFileSync(args.path, finalText, "utf-8");
          return { outcome: "accepted", path: args.path, finalText };
        }
        return { outcome: "rejected", path: args.path };
      },
    };
    server = new IdeMcpServer({
      tools: buildIdeTools(diffFacade),
      token: TOKEN,
    });
    await server.start({ port: 0 });
    mcp = await setupMcpFromConfig(
      {
        ide: {
          url: server.url(),
          transport: "http",
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      },
      { writeErr: () => {} },
    );
  });

  afterEach(async () => {
    try {
      await mcp?.mcpClient?.disconnectAll();
    } catch {
      /* ignore */
    }
    await server.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = () => ({
    cwd: tmp,
    permissionRules: { allow: [], ask: ["Write", "Edit"], deny: [] },
    permissionConfirm: async () => {
      throw new Error("terminal confirm must not be reached");
    },
    mcpClient: mcp.mcpClient,
    externalToolExecutors: mcp.externalToolExecutors,
  });

  it("accept: the IDE writes the (user-edited) file; tool write is skipped", async () => {
    mode = "accept";
    const res = await executeTool(
      "write_file",
      { path: "approved.js", content: "const ok = true;" },
      ctx(),
    );
    expect(res).toMatchObject({
      success: true,
      appliedVia: "ide-diff",
      userEdited: true,
    });
    expect(fs.readFileSync(path.join(tmp, "approved.js"), "utf-8")).toBe(
      "const ok = true;\n// user tweak", // what the IDE wrote, not the proposal
    );
  });

  it("reject: nothing is written and the tool is denied", async () => {
    mode = "reject";
    const res = await executeTool(
      "write_file",
      { path: "denied.js", content: "nope" },
      ctx(),
    );
    expect(res.error).toMatch(/rejected in the IDE diff review/);
    expect(fs.existsSync(path.join(tmp, "denied.js"))).toBe(false);
  });
});
