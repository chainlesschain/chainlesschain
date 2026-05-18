/**
 * MCP Community Registry E2E Tests
 *
 * Tests the IPC-level integration of the MCP Community Registry,
 * covering listing, searching, installing, uninstalling, and refreshing.
 */

import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

test.describe("MCP Community Registry", () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let window: Awaited<ReturnType<typeof electronApp.firstWindow>>;

  /**
   * Helper to invoke IPC from renderer context
   */
  async function callIPC(channel: string, ...args: unknown[]) {
    return window.evaluate(
      ({ ch, a }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).electronAPI?.invoke(ch, ...a);
      },
      { ch: channel, a: args },
    );
  }

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, "../../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(3000);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("community-registry:list returns servers", async () => {
    const result = await callIPC("community-registry:list", {});

    expect(result).toBeDefined();
    expect(result.servers).toBeDefined();
    expect(Array.isArray(result.servers)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.servers.length).toBeGreaterThan(0);

    // Verify server structure
    const server = result.servers[0];
    expect(server).toHaveProperty("id");
    expect(server).toHaveProperty("name");
    expect(server).toHaveProperty("description");
  });

  test("community-registry:search finds by keyword", async () => {
    const result = await callIPC("community-registry:search", "git");

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    // Git server should be in results
    const gitServer = result.find((s: { name: string }) => s.name === "git");
    expect(gitServer).toBeDefined();
    expect(gitServer.relevanceScore).toBeGreaterThan(0);
  });

  test("community-registry:detail returns server info", async () => {
    const result = await callIPC("community-registry:detail", "mcp-server-git");

    expect(result).toBeDefined();
    expect(result.id).toBe("mcp-server-git");
    expect(result.name).toBe("git");
    expect(result.catalogSize).toBeGreaterThan(0);
    expect(result).toHaveProperty("installed");
  });

  test("community-registry:install installs a server", async () => {
    const result = await callIPC(
      "community-registry:install",
      "mcp-server-sqlite",
      {},
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.server).toBeDefined();
    expect(result.server.serverId).toBe("mcp-server-sqlite");
  });

  test("community-registry:uninstall removes a server", async () => {
    // First ensure it's installed
    await callIPC("community-registry:install", "mcp-server-puppeteer", {});

    // Then uninstall
    const result = await callIPC(
      "community-registry:uninstall",
      "mcp-server-puppeteer",
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.uninstalledServer).toBeDefined();
  });

  test("community-registry:refresh refreshes catalog", async () => {
    const result = await callIPC("community-registry:refresh");

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.currentCount).toBeGreaterThan(0);
    expect(result).toHaveProperty("refreshedAt");
  });

  test("community-registry:stats returns statistics", async () => {
    const result = await callIPC("community-registry:stats");

    expect(result).toBeDefined();
    expect(result.totalServers).toBeGreaterThan(0);
    expect(typeof result.installedCount).toBe("number");
    expect(typeof result.availableCount).toBe("number");
    expect(result.categories).toBeDefined();
  });

  test("community-registry:install then uninstall lifecycle", async () => {
    const serverId = "mcp-server-brave-search";

    // Install
    const installResult = await callIPC(
      "community-registry:install",
      serverId,
      {},
    );
    expect(installResult.success).toBe(true);
    expect(installResult.alreadyInstalled).toBe(false);

    // Verify it shows in detail as installed
    const detail = await callIPC("community-registry:detail", serverId);
    expect(detail.installed).toBe(true);

    // Uninstall
    const uninstallResult = await callIPC(
      "community-registry:uninstall",
      serverId,
    );
    expect(uninstallResult.success).toBe(true);

    // Verify it's no longer installed
    const detailAfter = await callIPC("community-registry:detail", serverId);
    expect(detailAfter.installed).toBe(false);
  });
});
