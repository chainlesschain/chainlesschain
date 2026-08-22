import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  _deps as clientDeps,
  assertSupportedMcpProtocolVersion,
} from "../../src/harness/mcp-client.js";
import {
  MCP_TLS_MAX_FILE_BYTES,
  loadMcpTlsMaterial,
  normalizeMcpTlsConfig,
  provisionManagedMcpTlsConfig,
} from "../../src/lib/mcp-tls.js";
import {
  loadRegisteredMcp,
  parseMcpServers,
  setupMcpFromConfig,
} from "../../src/runtime/mcp-config.js";
import { McpLifecycleAuthority } from "../../src/lib/mcp-lifecycle-authority.js";
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

function installHttpFixture({ protocolVersion = "2025-11-25" } = {}) {
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
        protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "lifecycle-fixture" },
      });
    }
    const results = {
      "tools/list": { tools: [] },
      "resources/list": { resources: [] },
      "resources/templates/list": { resourceTemplates: [] },
      "prompts/list": { prompts: [] },
      "resources/subscribe": {},
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

describe("MCP lifecycle increments", () => {
  it("accepts only the explicitly supported negotiated protocol versions", () => {
    for (const version of SUPPORTED_MCP_PROTOCOL_VERSIONS) {
      expect(assertSupportedMcpProtocolVersion(version)).toBe(version);
    }
    for (const version of [undefined, null, 1, "", "2026-01-01", {}]) {
      expect(() => assertSupportedMcpProtocolVersion(version)).toThrow(
        expect.objectContaining({
          code: "CC_MCP_PROTOCOL_VERSION_UNSUPPORTED",
        }),
      );
    }
  });

  it("reloads mTLS material and restores resource subscriptions on reconnect", async () => {
    const calls = installHttpFixture();
    let generation = 0;
    clientDeps.loadMcpTlsMaterial = vi.fn(() => {
      generation += 1;
      return {
        connectOptions: { ca: Buffer.from(`ca-generation-${generation}`) },
        identityDigest: `sha256:${String(generation).padStart(64, "0")}`,
      };
    });
    clientDeps.createMcpTlsDispatcher = vi.fn((material) => ({
      generation,
      identityDigest: material.identityDigest,
    }));
    clientDeps.closeMcpTlsDispatcher = vi.fn(async () => {});

    const client = new MCPClient();
    clients.add(client);
    const tls = provisionManagedMcpTlsConfig({
      caFile: path.resolve("ignored-ca.pem"),
    });
    const config = {
      url: "https://mcp.example.test/rpc",
      transport: "https",
      configScope: "managed",
      tls,
    };
    await client.connect("fixture", config);
    const firstEntry = client.servers.get("fixture");
    const firstDispatcher = firstEntry._httpDispatcher;
    firstEntry.resourceSubscriptions.add("res://watched");
    client.setReconnector("fixture", () => ({ ...config }));

    await expect(client._tryReconnect("fixture")).resolves.toBe(true);

    const secondEntry = client.servers.get("fixture");
    expect(clientDeps.loadMcpTlsMaterial).toHaveBeenCalledTimes(2);
    expect(secondEntry._tlsIdentityDigest).toBe(
      `sha256:${String(2).padStart(64, "0")}`,
    );
    expect(secondEntry._httpDispatcher).not.toBe(firstDispatcher);
    expect(clientDeps.closeMcpTlsDispatcher).toHaveBeenCalledWith(
      firstDispatcher,
    );
    expect(secondEntry.resourceSubscriptions).toEqual(
      new Set(["res://watched"]),
    );

    const initializeIndexes = calls
      .map((call, index) => (call.method === "initialize" ? index : -1))
      .filter((index) => index >= 0);
    const subscribeIndex = calls.findLastIndex(
      (call) => call.method === "resources/subscribe",
    );
    expect(initializeIndexes).toHaveLength(2);
    expect(subscribeIndex).toBeGreaterThan(initializeIndexes[1]);
    expect(calls.slice(0, 6).map((call) => call.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "resources/list",
      "resources/templates/list",
      "prompts/list",
    ]);
    expect(
      calls
        .filter((call) => call.method !== "GET")
        .every((call) => call.dispatcher != null),
    ).toBe(true);
    expect(JSON.stringify(secondEntry)).not.toContain("ca-generation-2");
  });

  it("keeps disabled registered servers at zero outbound connections", async () => {
    const createClient = vi.fn();
    const fetch = vi.spyOn(clientDeps, "fetch");
    const result = await loadRegisteredMcp(
      {},
      {
        createClient,
        makeServerConfig: () => ({
          list: () => [
            {
              name: "disabled",
              url: "https://disabled.example.test/rpc",
              transport: "https",
              autoConnect: false,
              configScope: "user",
            },
          ],
          getAutoConnect: () => [],
        }),
      },
    );
    expect(result).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filters an explicitly disabled config before client transport setup", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-disabled-"));
    try {
      const authority = new McpLifecycleAuthority({
        statePath: path.join(root, "authority.json"),
      });
      const fetch = vi.spyOn(clientDeps, "fetch");
      const result = await setupMcpFromConfig(
        parseMcpServers({
          mcpServers: {
            disabled: {
              url: "https://disabled.example.test/rpc",
              disabled: true,
            },
          },
        }),
        {
          mcpLifecycleAuthority: authority,
          sessionId: "disabled-session",
        },
      );
      expect(result.connected).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        authority.snapshot({
          name: "disabled",
          sessionId: "disabled-session",
        }),
      ).toMatchObject({ phase: "disabled", desired: "disabled" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails fast and closes TLS state when initialize selects a future version", async () => {
    installHttpFixture({ protocolVersion: "2026-01-01" });
    const dispatcher = { name: "future-version-dispatcher" };
    clientDeps.loadMcpTlsMaterial = vi.fn(() => ({
      connectOptions: { ca: Buffer.from("private-ca-material") },
      identityDigest: `sha256:${"f".repeat(64)}`,
    }));
    clientDeps.createMcpTlsDispatcher = vi.fn(() => dispatcher);
    clientDeps.closeMcpTlsDispatcher = vi.fn(async () => {});
    const client = new MCPClient();
    clients.add(client);
    const tls = provisionManagedMcpTlsConfig({
      caFile: path.resolve("ignored-ca.pem"),
    });

    await expect(
      client.connect("future", {
        url: "https://mcp.example.test/rpc",
        transport: "https",
        configScope: "managed",
        tls,
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_PROTOCOL_VERSION_UNSUPPORTED",
    });
    expect(client.servers.has("future")).toBe(false);
    expect(clientDeps.closeMcpTlsDispatcher).toHaveBeenCalledWith(dispatcher);
  });

  it("loads bounded regular TLS files and observes certificate rotation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-tls-"));
    try {
      const certFile = path.join(root, "client.crt");
      const keyFile = path.join(root, "client.key");
      const caFile = path.join(root, "ca.crt");
      fs.writeFileSync(certFile, "cert-generation-1");
      fs.writeFileSync(keyFile, "key-generation-1", { mode: 0o600 });
      fs.chmodSync(keyFile, 0o600);
      fs.writeFileSync(caFile, "trusted-ca");
      const config = provisionManagedMcpTlsConfig({
        certFile,
        keyFile,
        caFile,
        serverName: "mcp.test",
      });

      const first = loadMcpTlsMaterial(config, {
        configScope: "managed",
        createSecureContextImpl: () => ({}),
        validateCertificateImpl: () => {},
      });
      fs.writeFileSync(certFile, "cert-generation-2");
      const second = loadMcpTlsMaterial(config, {
        configScope: "managed",
        createSecureContextImpl: () => ({}),
        validateCertificateImpl: () => {},
      });

      expect(first.identityDigest).not.toBe(second.identityDigest);
      expect(second.connectOptions.cert.toString()).toBe("cert-generation-2");
      expect(second.connectOptions.servername).toBe("mcp.test");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe TLS config, links, relative paths, and oversized files", () => {
    expect(() => normalizeMcpTlsConfig({ caFile: "relative.pem" })).toThrow(
      /absolute file path/i,
    );
    expect(() =>
      normalizeMcpTlsConfig({
        caFile: path.resolve("ca.pem"),
        unexpected: true,
      }),
    ).toThrow(/allowlisted/i);
    expect(() =>
      loadMcpTlsMaterial(
        provisionManagedMcpTlsConfig({ caFile: path.resolve("ca.pem") }),
        {
          configScope: "managed",
          fsImpl: {
            lstatSync: () => ({ isSymbolicLink: () => true }),
          },
        },
      ),
    ).toThrow(/symbolic link/i);
    expect(() =>
      loadMcpTlsMaterial(
        provisionManagedMcpTlsConfig({ caFile: path.resolve("ca.pem") }),
        {
          configScope: "managed",
          fsImpl: {
            lstatSync: () => ({ isSymbolicLink: () => false }),
            constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
            openSync: () => 7,
            fstatSync: () => ({
              isFile: () => true,
              size: MCP_TLS_MAX_FILE_BYTES + 1,
              mode: 0o600,
            }),
            closeSync: () => {},
          },
        },
      ),
    ).toThrow(/no larger/i);
  });

  it("fails closed on malformed TLS material before a dispatcher can dial", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-tls-bad-"));
    try {
      const caFile = path.join(root, "invalid-ca.pem");
      fs.writeFileSync(caFile, "not a certificate");
      expect(() =>
        loadMcpTlsMaterial(provisionManagedMcpTlsConfig({ caFile }), {
          configScope: "managed",
        }),
      ).toThrow(
        expect.objectContaining({ code: "CC_MCP_TLS_MATERIAL_INVALID" }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects TLS configuration from the generic MCP parser", () => {
    expect(() =>
      parseMcpServers({
        mcpServers: {
          secure: {
            url: "https://mcp.example.test/rpc",
            tls: { caFile: path.resolve("untrusted-ca.pem") },
          },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TLS_MANAGED_SOURCE_REQUIRED",
      }),
    );
  });
});
