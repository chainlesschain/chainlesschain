/**
 * Community Registry Lifecycle Integration Tests
 *
 * Tests end-to-end lifecycle flows (fetch → search → install → list)
 * using a local HTTP server to simulate the remote registry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  CommunityRegistry,
  SERVER_STATUS,
} = require("../../../src/main/mcp/community-registry");

describe("CommunityRegistry Lifecycle Integration", () => {
  let server;
  let serverPort;
  let registry;

  beforeEach(async () => {
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

  it("fetch remote → listServers includes remote entries", async () => {
    const remoteServers = [
      {
        id: "remote-lifecycle-1",
        name: "lifecycle-server",
        displayName: "Lifecycle Test Server",
        description: "A server for lifecycle testing",
        version: "1.0.0",
        category: "automation",
        tags: ["lifecycle", "test"],
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    const { servers } = registry.listServers();
    const ids = servers.map((s) => s.id);
    expect(ids).toContain("remote-lifecycle-1");
  });

  it("fetch remote → searchServers finds remote entries", async () => {
    const remoteServers = [
      {
        id: "remote-search-target",
        name: "unique-zephyr-tool",
        displayName: "Zephyr Tool",
        description: "A unique tool for zephyr workflows",
        version: "1.2.0",
        category: "productivity",
        tags: ["zephyr", "workflow"],
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    const results = registry.searchServers("zephyr");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("remote-search-target");
  });

  it("remote server with same ID as builtin overrides with source=remote", async () => {
    const remoteServers = [
      {
        id: "mcp-server-git",
        name: "git",
        displayName: "Git (Remote Override)",
        description: "Overridden git server from remote registry",
        version: "2.0.0",
        category: "version-control",
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    const entry = registry.catalog.get("mcp-server-git");
    expect(entry.source).toBe("remote");
    expect(entry.description).toBe(
      "Overridden git server from remote registry",
    );
  });

  it("install remote server → getInstalledServers includes it", async () => {
    const remoteServers = [
      {
        id: "remote-installable",
        name: "installable-server",
        displayName: "Installable Server",
        description: "A server that can be installed",
        version: "1.0.0",
        command: "npx",
        args: ["-y", "installable-server"],
        transport: "stdio",
        tools: ["tool_a"],
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();
    await registry.installServer("remote-installable");

    const installed = registry.getInstalledServers();
    const ids = installed.map((s) => s.id);
    expect(ids).toContain("remote-installable");
    expect(installed.find((s) => s.id === "remote-installable").status).toBe(
      SERVER_STATUS.INSTALLED,
    );
  });

  it("refresh twice → no duplicate entries", async () => {
    const remoteServers = [
      {
        id: "remote-dedup-1",
        name: "dedup-server",
        displayName: "Dedup Server",
        description: "Should not be duplicated",
        version: "1.0.0",
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();
    const sizeAfterFirst = registry.catalog.size;

    await registry.refreshCatalog();
    const sizeAfterSecond = registry.catalog.size;

    expect(sizeAfterSecond).toBe(sizeAfterFirst);
  });

  it("remote entries have source: remote field", async () => {
    const remoteServers = [
      {
        id: "remote-source-check-1",
        name: "source-check-alpha",
        description: "Alpha server",
        version: "1.0.0",
      },
      {
        id: "remote-source-check-2",
        name: "source-check-beta",
        description: "Beta server",
        version: "1.0.0",
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    for (const remoteId of ["remote-source-check-1", "remote-source-check-2"]) {
      const entry = registry.catalog.get(remoteId);
      expect(entry).toBeDefined();
      expect(entry.source).toBe("remote");
    }
  });

  it("entry without description passes refreshCatalog filter", async () => {
    const remoteServers = [
      {
        id: "remote-no-desc",
        name: "no-description-server",
        // no description field
      },
    ];

    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteServers));
    });

    registry = new CommunityRegistry({
      remoteRegistryUrl: `http://127.0.0.1:${serverPort}/registry`,
    });

    await registry.refreshCatalog();

    expect(registry.catalog.has("remote-no-desc")).toBe(true);
    const entry = registry.catalog.get("remote-no-desc");
    expect(entry.name).toBe("no-description-server");
    expect(entry.source).toBe("remote");
  });

  it("_compareVersions with non-numeric parts returns 0", () => {
    registry = new CommunityRegistry();

    const result = registry._compareVersions("1.0.0-beta", "1.0.0");
    expect(result).toBe(0);
  });
});
