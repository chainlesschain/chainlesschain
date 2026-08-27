/**
 * Community Registry Remote Fetch Tests
 *
 * Tests for the _fetchRemoteCatalog() method and remote registry
 * integration in refreshCatalog().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  CommunityRegistry,
  REMOTE_REGISTRY_FETCH_LIMITS,
  REMOTE_REGISTRY_FETCH_HARD_LIMITS,
} = require("../../../src/main/mcp/community-registry");

describe("CommunityRegistry Remote Fetch", () => {
  let server;
  let serverPort;
  let registry;

  beforeEach(async () => {
    // Create a local HTTP server that acts as the remote registry
    server = http.createServer();
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("should construct without remoteRegistryUrl", () => {
    registry = new CommunityRegistry();
    expect(registry.remoteRegistryUrl).toBeNull();
    expect(registry.catalog.size).toBeGreaterThan(0); // builtin entries
  });

  it("should store remoteRegistryUrl when provided", () => {
    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });
    expect(registry.remoteRegistryUrl).toBe(
      `http://127.0.0.1:${serverPort}/registry`,
    );
  });

  it("should use bounded remote fetch limits", () => {
    const defaults = new CommunityRegistry();
    expect(defaults.remoteFetchTimeout).toBe(
      REMOTE_REGISTRY_FETCH_LIMITS.timeoutMs,
    );
    expect(defaults.maxRemoteResponseBytes).toBe(
      REMOTE_REGISTRY_FETCH_LIMITS.maxResponseBytes,
    );

    const clamped = new CommunityRegistry({
      remoteFetchTimeout: Number.MAX_SAFE_INTEGER,
      maxRemoteResponseBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(clamped.remoteFetchTimeout).toBe(
      REMOTE_REGISTRY_FETCH_HARD_LIMITS.timeoutMs,
    );
    expect(clamped.maxRemoteResponseBytes).toBe(
      REMOTE_REGISTRY_FETCH_HARD_LIMITS.maxResponseBytes,
    );
  });

  it("should fetch and merge remote servers on refreshCatalog()", async () => {
    const remoteServers = [
      {
        id: "remote-server-1",
        name: "remote-test",
        displayName: "Remote Test Server",
        description: "A test server from remote registry",
        version: "2.0.0",
        category: "automation",
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    const builtinCount = registry.catalog.size;
    const result = await registry.refreshCatalog();

    expect(result.success).toBe(true);
    expect(registry.catalog.has("remote-server-1")).toBe(true);

    const remote = registry.catalog.get("remote-server-1");
    expect(remote.name).toBe("remote-test");
    expect(remote.source).toBe("remote");
    expect(registry.catalog.size).toBe(builtinCount + 1);
  });

  it("should accept response with { servers: [...] } envelope", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          servers: [
            {
              id: "envelope-server",
              name: "envelope",
              description: "Server in envelope format",
            },
          ],
        }),
      );
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    expect(registry.catalog.has("envelope-server")).toBe(true);
  });

  it("should skip invalid entries from remote", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          { id: "valid-1", name: "valid", description: "OK" },
          { name: "missing-id" }, // no id
          { id: "missing-name" }, // no name
          null, // null entry
          { id: "valid-2", name: "valid2", description: "Also OK" },
        ]),
      );
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    expect(registry.catalog.has("valid-1")).toBe(true);
    expect(registry.catalog.has("valid-2")).toBe(true);
    expect(registry.catalog.has("missing-id")).toBe(false);
    expect(registry.catalog.has("missing-name")).toBe(false);
  });

  it("should gracefully handle remote server errors", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(500);
      res.end("Internal Server Error");
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    const builtinCount = registry.catalog.size;
    // Should not throw — falls back to local catalog
    const result = await registry.refreshCatalog();

    expect(result.success).toBe(true);
    expect(registry.catalog.size).toBe(builtinCount);
  });

  it("should gracefully handle invalid JSON response", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not valid json {{{");
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    const result = await registry.refreshCatalog();
    expect(result.success).toBe(true); // Falls back gracefully
  });

  it("should reject an oversized declared response before retaining it", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "1024",
      });
      res.end("[]");
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
      maxRemoteResponseBytes: 32,
    });

    await expect(registry._fetchRemoteCatalog()).rejects.toMatchObject({
      code: "REMOTE_REGISTRY_RESPONSE_TOO_LARGE",
      limit: 32,
      received: 1024,
    });
  });

  it("should count streamed UTF-8 response bytes and clear on overflow", async () => {
    const payload = JSON.stringify([
      { id: "utf8-server", name: "测".repeat(32) },
    ]);
    const maxRemoteResponseBytes = Buffer.byteLength(payload, "utf8") - 1;

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      const midpoint = Math.floor(payload.length / 2);
      res.write(payload.slice(0, midpoint));
      res.end(payload.slice(midpoint));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
      maxRemoteResponseBytes,
    });

    await expect(registry._fetchRemoteCatalog()).rejects.toMatchObject({
      code: "REMOTE_REGISTRY_RESPONSE_TOO_LARGE",
      limit: maxRemoteResponseBytes,
    });
  });

  it("should reject an aborted response and release retained chunks", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('[{"id":"partial"');
      res.destroy();
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await expect(registry._fetchRemoteCatalog()).rejects.toThrow(
      /remote registry (fetch|response)/i,
    );
  });

  it("should gracefully handle connection refused", async () => {
    // Close server first so connection is refused
    await new Promise((resolve) => server.close(resolve));
    server = null;

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    const result = await registry.refreshCatalog();
    expect(result.success).toBe(true); // Falls back gracefully
  });

  it("should not fetch remote when remoteRegistryUrl is null", async () => {
    let requestReceived = false;
    server.on("request", () => {
      requestReceived = true;
    });

    registry = new CommunityRegistry(); // No remoteRegistryUrl
    await registry.refreshCatalog();

    expect(requestReceived).toBe(false);
  });

  it("should return empty array from _fetchRemoteCatalog when no URL", async () => {
    registry = new CommunityRegistry();
    const result = await registry._fetchRemoteCatalog();
    expect(result).toEqual([]);
  });
});
