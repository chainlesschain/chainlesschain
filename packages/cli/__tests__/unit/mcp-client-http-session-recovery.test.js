import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { MCPClient } from "../../src/harness/mcp-client.js";

const cleanup = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture({ stateful, failRecovery = false, concurrent = false }) {
  let initializations = 0;
  let toolCalls = 0;
  const receivedSessions = [];
  const blocked = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    if (message.id == null) {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (message.method === "initialize") {
      initializations++;
      if (failRecovery && initializations > 1) {
        res.writeHead(404).end();
        return;
      }
      if (stateful)
        res.setHeader("Mcp-Session-Id", `session-${initializations}`);
      result = {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "test", version: "1" },
        capabilities: { tools: {} },
      };
    } else if (message.method === "tools/list") {
      result = { tools: [{ name: "mutate", inputSchema: { type: "object" } }] };
    } else if (message.method === "tools/call") {
      toolCalls++;
      receivedSessions.push(req.headers["mcp-session-id"] || null);
      if (toolCalls <= (concurrent ? 2 : 1)) {
        if (concurrent) {
          blocked.push(res);
          if (blocked.length === 2)
            for (const pending of blocked) pending.writeHead(404).end();
        } else res.writeHead(404).end();
        return;
      }
      result = { content: [{ type: "text", text: "next explicit request" }] };
    } else result = {};
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const client = new MCPClient();
  cleanup.push(() => client.disconnectAll());
  await client.connect("test", {
    transport: "http",
    url: `http://127.0.0.1:${server.address().port}/rpc`,
  });
  return {
    client,
    counts: () => ({ initializations, toolCalls, receivedSessions }),
  };
}

describe("MCP HTTP 404 recovery without tool replay", () => {
  it.each([false, true])(
    "recovers stateful=%s and leaves effects unreplayed",
    async (stateful) => {
      const { client, counts } = await fixture({ stateful });
      await expect(client.callTool("test", "mutate")).rejects.toMatchObject({
        code: "CC_MCP_HTTP_TOOL_OUTCOME_UNKNOWN",
        outcomeUnknown: true,
        connectionRecovered: true,
      });
      expect(counts()).toMatchObject({ initializations: 2, toolCalls: 1 });
      await expect(client.callTool("test", "mutate")).resolves.toMatchObject({
        content: [{ text: "next explicit request" }],
      });
      expect(counts().receivedSessions).toEqual(
        stateful ? ["session-1", "session-2"] : [null, null],
      );
    },
  );

  it("bounds failed reinitialization without tool replay", async () => {
    const { client, counts } = await fixture({
      stateful: true,
      failRecovery: true,
    });
    await expect(client.callTool("test", "mutate")).rejects.toMatchObject({
      outcomeUnknown: true,
      connectionRecovered: false,
    });
    expect(counts()).toMatchObject({ initializations: 2, toolCalls: 1 });
  });

  it("shares recovery across concurrent failed tool calls", async () => {
    const { client, counts } = await fixture({
      stateful: true,
      concurrent: true,
    });
    const results = await Promise.allSettled([
      client.callTool("test", "mutate"),
      client.callTool("test", "mutate"),
    ]);
    expect(
      results.every((r) => r.status === "rejected" && r.reason.outcomeUnknown),
    ).toBe(true);
    expect(counts()).toMatchObject({ initializations: 2, toolCalls: 2 });
  });
});
