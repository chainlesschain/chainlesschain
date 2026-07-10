/**
 * executeCode — the conditional 5th IDE tool (Claude-Code mcp__ide__executeCode
 * parity). Exposed ONLY when the editor facade implements `executeCode`, so
 * base-tool consumers (JetBrains plugin, older facades, every existing test) are
 * untouched. Verified without a VS Code host: tool logic with a fake facade +
 * the real extension MCP server driven by the real CLI MCPClient.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { MCPClient } from "../../src/harness/mcp-client.js";

const baseFacade = () => ({
  getSelection: async () => null,
  getDiagnostics: async () => [],
  getOpenEditors: async () => [],
  openDiff: async (args) => ({ outcome: "rejected", path: args.path }),
});

const kernelFacade = () => ({
  ...baseFacade(),
  executeCode: async ({ code, timeoutMs }) => ({
    success: true,
    cancelled: false,
    outputs: [
      { mime: "application/vnd.code.notebook.stdout", text: `ran: ${code}` },
      ...(timeoutMs
        ? [{ mime: "text/plain", text: `budget=${timeoutMs}` }]
        : []),
    ],
  }),
});

describe("buildIdeTools — conditional executeCode", () => {
  it("facade WITHOUT executeCode keeps the core tools", () => {
    const names = buildIdeTools(baseFacade()).map((t) => t.name);
    expect(names.sort()).toEqual([
      "getActiveFile",
      "getDiagnostics",
      "getOpenEditors",
      "getSelection",
      "openDiff",
    ]);
  });

  it("facade WITH executeCode exposes 6 tools incl. the schema", () => {
    const tools = buildIdeTools(kernelFacade());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName)).toHaveLength(6);
    expect(byName.executeCode.inputSchema.required).toEqual(["code"]);
    expect(byName.executeCode.inputSchema.properties.timeout_ms).toBeTruthy();
  });

  it("handler validates code and forwards timeout", async () => {
    const tools = buildIdeTools(kernelFacade());
    const exec = tools.find((t) => t.name === "executeCode");
    await expect(exec.handler({})).rejects.toThrow(/requires `code`/);
    const res = await exec.handler({ code: "1+1", timeout_ms: 5000 });
    expect(res.success).toBe(true);
    expect(res.outputs[0].text).toBe("ran: 1+1");
    expect(res.outputs[1].text).toBe("budget=5000");
  });
});

describe("executeCode over the real extension MCP server", () => {
  const TOKEN = "exec-code-secret";
  let server;
  let client;

  beforeEach(async () => {
    server = new IdeMcpServer({
      tools: buildIdeTools(kernelFacade()),
      token: TOKEN,
    });
    await server.start({ port: 0 });
    client = new MCPClient();
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  afterEach(async () => {
    try {
      await client.disconnectAll();
    } catch {
      /* ignore */
    }
    await server.stop();
  });

  it("lists executeCode and round-trips an execution", async () => {
    const res = await client.callTool("ide", "executeCode", {
      code: "print('hi')",
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.outputs[0].text).toBe("ran: print('hi')");
  });

  it("kernel-less hosts surface a clear isError result", async () => {
    const noKernel = {
      ...baseFacade(),
      executeCode: async () => {
        throw new Error("No active notebook — open a notebook first");
      },
    };
    const s2 = new IdeMcpServer({
      tools: buildIdeTools(noKernel),
      token: TOKEN,
    });
    await s2.start({ port: 0 });
    const c2 = new MCPClient();
    try {
      await c2.connect("ide2", {
        url: s2.url(),
        transport: "http",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      const res = await c2.callTool("ide2", "executeCode", { code: "x" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/No active notebook/);
    } finally {
      await c2.disconnectAll().catch(() => {});
      await s2.stop();
    }
  });
});
