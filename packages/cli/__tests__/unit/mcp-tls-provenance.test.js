import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  _deps as clientDeps,
} from "../../src/harness/mcp-client.js";
import {
  MCP_TLS_MANAGED_SOURCE_REQUIRED_CODE,
  MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE,
  provisionManagedMcpTlsConfig,
} from "../../src/lib/mcp-tls.js";
import {
  loadManagedMcp,
  loadProjectMcp,
  parseHeadlessMcpConfig,
  setupMcpFromConfig,
} from "../../src/runtime/mcp-config.js";
import { textByteStream } from "../helpers/mcp-http-response.js";

const originalClientDeps = {
  fetch: clientDeps.fetch,
  loadMcpTlsMaterial: clientDeps.loadMcpTlsMaterial,
  createMcpTlsDispatcher: clientDeps.createMcpTlsDispatcher,
  closeMcpTlsDispatcher: clientDeps.closeMcpTlsDispatcher,
};
const clients = new Set();

function rpcResponse(id, result, status = 200) {
  const text = id == null ? "" : JSON.stringify({ jsonrpc: "2.0", id, result });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: textByteStream(text),
    text: async () => text,
  };
}

function installHttpFixture() {
  const calls = [];
  clientDeps.fetch = vi.fn(async (_url, options = {}) => {
    if (options.method === "DELETE") return rpcResponse(null, null, 202);
    const envelope = options.body ? JSON.parse(options.body) : null;
    calls.push({
      method: envelope?.method || options.method || "GET",
      dispatcher: options.dispatcher,
    });
    if (!envelope || envelope.id == null) return rpcResponse(null, null, 202);
    if (envelope.method === "initialize") {
      return rpcResponse(envelope.id, {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "managed-tls-fixture" },
      });
    }
    const results = {
      "tools/list": { tools: [] },
      "resources/list": { resources: [] },
      "resources/templates/list": { resourceTemplates: [] },
      "prompts/list": { prompts: [] },
    };
    return rpcResponse(envelope.id, results[envelope.method] || {});
  });
  return calls;
}

afterEach(async () => {
  for (const client of clients) await client.disconnectAll().catch(() => {});
  clients.clear();
  Object.assign(clientDeps, originalClientDeps);
  vi.restoreAllMocks();
});

describe("managed MCP TLS provenance", () => {
  it("provisions managed TLS through the managed loader and connects", async () => {
    const calls = installHttpFixture();
    const dispatcher = { close: vi.fn(async () => {}) };
    clientDeps.loadMcpTlsMaterial = vi.fn((_tls, options) => {
      expect(options).toEqual({ configScope: "managed" });
      return {
        connectOptions: { ca: Buffer.from("managed-ca-material") },
        identityDigest: `sha256:${"a".repeat(64)}`,
      };
    });
    clientDeps.createMcpTlsDispatcher = vi.fn(() => dispatcher);
    clientDeps.closeMcpTlsDispatcher = vi.fn(async () => {});
    const client = new MCPClient();
    clients.add(client);

    const result = await loadManagedMcp(
      {
        managedMcpServers: {
          corporate: {
            url: "https://mcp.example.test/rpc",
            transport: "https",
            tls: { caFile: path.resolve("managed-ca.pem") },
          },
        },
      },
      { createClient: () => client },
    );

    expect(result.connected).toEqual([
      { server: "corporate", tools: 0, resources: 0, prompts: 0 },
    ]);
    expect(clientDeps.loadMcpTlsMaterial).toHaveBeenCalledTimes(1);
    expect(client.servers.get("corporate").config.configScope).toBe("managed");
    expect(client.servers.get("corporate")._tlsIdentityDigest).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(calls.some((call) => call.method === "initialize")).toBe(true);
  });

  it("refuses a forged managed scope before TLS loading or an outbound dial", async () => {
    const secretPath = path.resolve("private-client-key.pem");
    const client = new MCPClient();
    clients.add(client);
    clientDeps.loadMcpTlsMaterial = vi.fn();
    clientDeps.fetch = vi.fn();

    const error = await client
      .connect("forged", {
        url: "https://mcp.example.test/rpc",
        transport: "https",
        configScope: "managed",
        tls: { certFile: secretPath, keyFile: secretPath },
      })
      .catch((reason) => reason);

    expect(error).toMatchObject({
      code: MCP_TLS_MANAGED_SOURCE_REQUIRED_CODE,
      message: MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE,
    });
    expect(error.message).not.toContain(secretPath);
    expect(clientDeps.loadMcpTlsMaterial).not.toHaveBeenCalled();
    expect(clientDeps.fetch).not.toHaveBeenCalled();
  });

  it("does not let a user-scoped server reuse a managed TLS capability", async () => {
    const secretPath = path.resolve("managed-ca.pem");
    const managedTls = provisionManagedMcpTlsConfig({ caFile: secretPath });
    const client = new MCPClient();
    clients.add(client);
    clientDeps.loadMcpTlsMaterial = vi.fn();
    clientDeps.fetch = vi.fn();
    const writeErr = vi.fn();

    const result = await setupMcpFromConfig(
      {
        user: {
          url: "https://mcp.example.test/rpc",
          transport: "https",
          configScope: "user",
          tls: managedTls,
        },
      },
      { createClient: () => client, writeErr },
    );

    expect(result.connected).toEqual([]);
    const diagnostic = writeErr.mock.calls.flat().join("");
    expect(diagnostic).toContain(MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE);
    expect(diagnostic).not.toContain(secretPath);
    expect(clientDeps.loadMcpTlsMaterial).not.toHaveBeenCalled();
    expect(clientDeps.fetch).not.toHaveBeenCalled();
  });

  it("redacts TLS paths when headless --mcp-config input is rejected", () => {
    const secretPath = path.resolve("headless-private-client-key.pem");
    const result = parseHeadlessMcpConfig({
      mcpServers: {
        headless: {
          url: "https://mcp.example.test/rpc",
          transport: "https",
          tls: { certFile: secretPath, keyFile: secretPath },
        },
      },
    });

    expect(result.servers).toEqual({});
    expect(result.errors).toEqual([
      {
        name: "headless",
        type: "invalid_config",
        message: "MCP server configuration is invalid.",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(secretPath);
  });

  it("rejects project MCP TLS configuration without exposing material paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-tls-"));
    try {
      const sourceFile = path.join(root, ".mcp.json");
      const secretPath = path.join(root, "project-client-key.pem");
      const content = JSON.stringify({
        mcpServers: {
          project: {
            url: "https://mcp.example.test/rpc",
            transport: "https",
            tls: { certFile: secretPath, keyFile: secretPath },
          },
        },
      });
      const writeErr = vi.fn();
      const createClient = vi.fn();
      clientDeps.fetch = vi.fn();
      clientDeps.loadMcpTlsMaterial = vi.fn();

      const result = await loadProjectMcp(
        { cwd: root, env: { CC_PROJECT_MCP: "1" } },
        {
          createClient,
          fileExists: (file) => file === sourceFile,
          readFile: () => content,
          writeErr,
          projectMcpTrust: {
            checkProjectMcpTrust: () => ({ status: "first-use" }),
            recordProjectMcpTrust: () => true,
          },
        },
      );

      expect(result).toBeNull();
      expect(createClient).not.toHaveBeenCalled();
      const diagnostic = writeErr.mock.calls.flat().join("");
      expect(diagnostic).toContain(MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE);
      expect(diagnostic).not.toContain(secretPath);
      expect(clientDeps.loadMcpTlsMaterial).not.toHaveBeenCalled();
      expect(clientDeps.fetch).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
