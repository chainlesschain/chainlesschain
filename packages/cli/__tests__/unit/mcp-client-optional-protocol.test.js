import { describe, expect, it, vi } from "vitest";
import { MCPClient, ServerState } from "../../src/harness/mcp-client.js";

function connectedClient() {
  const client = new MCPClient();
  client.servers.set("fixture", {
    state: ServerState.CONNECTED,
    resources: [],
    resourceTemplates: [{ name: "file", uriTemplate: "file:///{path}" }],
    resourceSubscriptions: new Set(),
    _pending: new Map(),
  });
  return client;
}

describe("MCP optional protocol surface", () => {
  it("lists resource templates with owning server", () => {
    const client = connectedClient();
    expect(client.listResourceTemplates()).toEqual([
      {
        name: "file",
        uriTemplate: "file:///{path}",
        server: "fixture",
      },
    ]);
    expect(client.listResourceTemplates("fixture")).toEqual([
      {
        name: "file",
        uriTemplate: "file:///{path}",
        server: "fixture",
      },
    ]);
    expect(() => client.listResourceTemplates("missing")).toThrow(
      'Server "missing" not found',
    );
  });

  it("supports resource subscribe/unsubscribe", async () => {
    const client = connectedClient();
    client._sendRequest = vi.fn(async () => ({}));
    await client.subscribeResource("fixture", "file:///README.md");
    expect(client.servers.get("fixture").resourceSubscriptions).toContain(
      "file:///README.md",
    );
    await client.unsubscribeResource("fixture", "file:///README.md");
    expect(client.servers.get("fixture").resourceSubscriptions).not.toContain(
      "file:///README.md",
    );
    expect(client._sendRequest.mock.calls).toEqual([
      ["fixture", "resources/subscribe", { uri: "file:///README.md" }],
      ["fixture", "resources/unsubscribe", { uri: "file:///README.md" }],
    ]);
  });

  it("supports logging level and completion requests", async () => {
    const client = connectedClient();
    client._sendRequest = vi.fn(async (_server, method) =>
      method === "completion/complete"
        ? { completion: { values: ["src/index.js"] } }
        : {},
    );
    await expect(client.setLoggingLevel("fixture", "warning")).resolves.toBe(
      "warning",
    );
    await expect(
      client.complete(
        "fixture",
        { type: "ref/resource", uri: "file:///{path}" },
        { name: "path", value: "src/" },
      ),
    ).resolves.toEqual({ completion: { values: ["src/index.js"] } });
    await expect(client.setLoggingLevel("fixture", "verbose")).rejects.toThrow(
      /Invalid MCP logging level/,
    );
  });

  it("surfaces resource updates and log messages as typed events", () => {
    const client = connectedClient();
    const updated = vi.fn();
    const logged = vi.fn();
    client.on("resource-updated", updated);
    client.on("log-message", logged);
    client._handleMessage("fixture", {
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "file:///README.md" },
    });
    client._handleMessage("fixture", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "warning", logger: "fixture", data: "slow" },
    });
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file:///README.md" }),
    );
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", data: "slow" }),
    );
  });
});
