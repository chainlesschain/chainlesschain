/**
 * Web-shell integration test — end-to-end wire validation for all 5 topics
 * registered by `web-shell-bootstrap.js`. Stubbed managers so we don't need
 * a live MCP child process / Ollama / Anthropic provider.
 *
 * What this catches that unit tests don't:
 *   - The `web-shell-bootstrap.js` registration map actually wires every
 *     handler factory under the right topic name (typo-resistant).
 *   - The streaming envelope in ws-cli-loader.js sees an *async generator*
 *     return from the real handler factory (not a vitest-fabricated stub).
 *   - The handler ↔ dispatcher boundary correctly serialises chunk +
 *     result frames over a real TCP/WS hop.
 *   - A frame that the SPA would actually send (id + type + payload)
 *     round-trips end-to-end.
 *
 * Why not Playwright / Electron e2e:
 *   - Spinning up Electron is 30-60s on cold disk, flaky on CI without a
 *     display, and adds nothing to the protocol assertions.
 *   - The web-panel SPA is irrelevant to wire correctness — it's a
 *     consumer of these frames, not the contract owner.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import WebSocket from "ws";

import { startWebShell } from "../web-shell-bootstrap.js";

/** Build a stub MCPClientManager with the surface mcp-handlers calls into. */
function makeStubMcp() {
  return {
    getConnectedServers: () => ["filesystem", "github"],
    getServerInfo: vi.fn((name) => ({
      name,
      state: "connected",
      connectedAt: 1700000000000,
      toolCount: 1,
    })),
    listTools: vi.fn(async (name) => {
      if (name === "filesystem") {
        return [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        ];
      }
      if (name === "github") {
        return [{ name: "list_repos", description: "List repos" }];
      }
      return [];
    }),
    callTool: vi.fn(async (server, tool, params) => ({
      content: [
        {
          type: "text",
          text: `${server}.${tool} called with ${JSON.stringify(params)}`,
        },
      ],
    })),
    listResources: vi.fn(async (name) => {
      if (name === "filesystem") {
        return [
          { uri: "file:///tmp/x.txt", name: "x", mimeType: "text/plain" },
        ];
      }
      return [];
    }),
    readResource: vi.fn(async (server, uri) => ({
      contents: [
        { uri, mimeType: "text/plain", text: `read ${uri} via ${server}` },
      ],
    })),
  };
}

/** Build a stub UKeyManager surface enough for ukey.sign. */
function makeStubUkey() {
  return {
    sign: vi.fn(async (data) => ({
      success: true,
      signature: `sig(${data})`,
      algorithm: "SM2",
    })),
  };
}

/** Build a stub LLMManager whose chatStream emits a few deltas. */
function makeStubLlm() {
  return {
    chatStream: vi.fn(async (messages, onChunk) => {
      const tokens = ["He", "llo", " ", "world"];
      let acc = "";
      for (const t of tokens) {
        await new Promise((r) => setImmediate(r));
        acc += t;
        onChunk(t, acc);
      }
      return {
        message: { role: "assistant", content: acc },
        model: "stub-model",
        tokens: tokens.length,
      };
    }),
  };
}

async function openWs(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}

/** Send a frame; collect a single reply matching its id. */
function rpc(ws, frame) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      if (msg.id !== frame.id) {
        return;
      }
      cleanup();
      resolve(msg);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.send(JSON.stringify(frame));
  });
}

/** Send a streaming frame; drain .chunk frames into chunks[], resolve on .result. */
function streamRpc(ws, frame) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      if (msg.id !== frame.id) {
        return;
      }
      if (msg.type === `${frame.type}.chunk`) {
        chunks.push(msg);
        return;
      }
      if (msg.type === `${frame.type}.result`) {
        cleanup();
        resolve({ chunks, terminal: msg });
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.send(JSON.stringify(frame));
  });
}

describe("web-shell integration — all 5 topics over a real WS hop", () => {
  let handle = null;
  let ws = null;
  const stubMcp = makeStubMcp();
  const stubLlm = makeStubLlm();
  const stubUkey = makeStubUkey();

  beforeAll(async () => {
    handle = await startWebShell({
      host: "127.0.0.1",
      httpPort: 0,
      wsPort: 0,
      mcpManager: stubMcp,
      llmManager: stubLlm,
      ukeyManager: stubUkey,
      // mainWindow null is OK for these topics — only fs.* dialogs need it.
    });
    ws = await openWs(handle.wsUrl);
  }, 30000);

  afterAll(async () => {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    if (handle) {
      await handle.close();
    }
  });

  it("mcp.list_tools aggregate returns a server entry per connected server", async () => {
    const reply = await rpc(ws, { id: "mcp-1", type: "mcp.list_tools" });
    expect(reply).toMatchObject({
      id: "mcp-1",
      type: "mcp.list_tools.result",
      ok: true,
    });
    expect(reply.result.servers).toHaveLength(2);
    const fs = reply.result.servers.find((s) => s.name === "filesystem");
    expect(fs.tools[0].name).toBe("read_file");
    expect(fs.tools[0].inputSchema.type).toBe("object");
  });

  it("mcp.list_tools serverName returns just that server", async () => {
    const reply = await rpc(ws, {
      id: "mcp-2",
      type: "mcp.list_tools",
      serverName: "github",
    });
    expect(reply.ok).toBe(true);
    expect(reply.result.server.name).toBe("github");
    expect(reply.result.server.tools).toHaveLength(1);
  });

  it("mcp.call_tool forwards args + returns the manager's result verbatim", async () => {
    const reply = await rpc(ws, {
      id: "mcp-3",
      type: "mcp.call_tool",
      serverName: "filesystem",
      toolName: "read_file",
      params: { path: "/tmp/foo" },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result.content[0].text).toContain(
      'filesystem.read_file called with {"path":"/tmp/foo"}',
    );
    expect(stubMcp.callTool).toHaveBeenCalledWith("filesystem", "read_file", {
      path: "/tmp/foo",
    });
  });

  it("mcp.list_resources + mcp.read_resource round-trip", async () => {
    const list = await rpc(ws, {
      id: "mcp-4",
      type: "mcp.list_resources",
      serverName: "filesystem",
    });
    expect(list.result.server.resources[0].uri).toBe("file:///tmp/x.txt");

    const read = await rpc(ws, {
      id: "mcp-5",
      type: "mcp.read_resource",
      serverName: "filesystem",
      uri: "file:///tmp/x.txt",
    });
    expect(read.ok).toBe(true);
    expect(read.result.contents[0].text).toContain("read file:///tmp/x.txt");
  });

  it("mcp.call_tool with missing toolName returns ok:false envelope", async () => {
    const reply = await rpc(ws, {
      id: "mcp-6",
      type: "mcp.call_tool",
      serverName: "filesystem",
      // toolName missing
    });
    expect(reply).toMatchObject({
      id: "mcp-6",
      type: "mcp.call_tool.result",
      ok: false,
      error: "tool_name_required",
    });
  });

  it("llm.chat streams .chunk frames + terminal .result with the final value", async () => {
    const { chunks, terminal } = await streamRpc(ws, {
      id: "llm-1",
      type: "llm.chat",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.ok === true)).toBe(true);
    const merged = chunks.map((c) => c.chunk.delta).join("");
    expect(merged).toBe("Hello world");
    expect(terminal).toMatchObject({
      id: "llm-1",
      type: "llm.chat.result",
      ok: true,
    });
    expect(terminal.result.tokens).toBe(4);
    expect(terminal.result.message.content).toBe("Hello world");
  });

  it("llm.chat with invalid messages shape rejects via the streaming envelope", async () => {
    // Empty messages array trips messages_required at the handler entry.
    // The handler throws BEFORE yielding, so the dispatcher's plain-error
    // path delivers a single .result(ok:false) — there are no .chunk frames.
    const { chunks, terminal } = await streamRpc(ws, {
      id: "llm-2",
      type: "llm.chat",
      messages: [],
    });
    expect(chunks).toHaveLength(0);
    expect(terminal).toMatchObject({
      id: "llm-2",
      type: "llm.chat.result",
      ok: false,
      error: "messages_required",
    });
  });

  it("ukey.sign streams pre_check + signing stage markers, returns manager result", async () => {
    const { chunks, terminal } = await streamRpc(ws, {
      id: "ukey-1",
      type: "ukey.sign",
      data: "tx-payload",
    });
    expect(chunks.map((c) => c.chunk.stage)).toEqual(["pre_check", "signing"]);
    expect(terminal).toMatchObject({
      id: "ukey-1",
      type: "ukey.sign.result",
      ok: true,
    });
    expect(terminal.result).toEqual({
      success: true,
      signature: "sig(tx-payload)",
      algorithm: "SM2",
    });
    expect(stubUkey.sign).toHaveBeenCalledWith("tx-payload");
  });

  it("ukey.sign with missing data returns ok:false envelope, no stage chunks", async () => {
    const { chunks, terminal } = await streamRpc(ws, {
      id: "ukey-2",
      type: "ukey.sign",
    });
    expect(chunks).toHaveLength(0);
    expect(terminal).toMatchObject({
      id: "ukey-2",
      type: "ukey.sign.result",
      ok: false,
      error: "data_required",
    });
  });

  it("unknown topic falls through to the CLI dispatcher's UNKNOWN_TYPE error", async () => {
    const reply = await rpc(ws, {
      id: "unk-1",
      type: "definitely.not.a.topic",
    });
    expect(reply).toMatchObject({
      id: "unk-1",
      type: "error",
      code: "UNKNOWN_TYPE",
    });
  });
});
