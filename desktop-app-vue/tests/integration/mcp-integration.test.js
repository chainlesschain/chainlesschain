/**
 * MCP Integration Tests
 *
 * Tests for real MCP server connections and tool execution.
 * These tests require the MCP servers to be available.
 *
 * @module MCPIntegrationTests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// Skip tests if not in integration test environment
const SKIP_INTEGRATION =
  process.env.SKIP_MCP_INTEGRATION === "true" || process.env.CI === "true";

// Import modules (will be mocked if not available)
let MCPClientManager;
let MCPSecurityPolicy;

try {
  ({ MCPClientManager } = require("../../src/main/mcp/mcp-client-manager"));
  ({ MCPSecurityPolicy } = require("../../src/main/mcp/mcp-security-policy"));
} catch (error) {
  console.warn("MCP modules not available, skipping integration tests");
}

/**
 * Test configuration
 */
const TEST_CONFIG = {
  dataPath: path.join(__dirname, "../../test-data/mcp"),
  timeout: 30000,
};

/**
 * Helper to check if npx is available
 */
async function isNpxAvailable() {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["--version"], { shell: true });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Helper to create test directory and files
 */
function setupTestFiles() {
  const testDir = TEST_CONFIG.dataPath;

  // Create test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Create test files
  fs.writeFileSync(
    path.join(testDir, "test.txt"),
    "Hello from MCP integration test!",
  );

  // Create notes directory first, then write sample.md
  const notesDir = path.join(testDir, "notes");
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(notesDir, "sample.md"),
    "# Sample Note\n\nThis is a sample note for testing.",
  );

  return testDir;
}

/**
 * Helper to cleanup test files
 */
function cleanupTestFiles() {
  const testDir = TEST_CONFIG.dataPath;
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe.skipIf(SKIP_INTEGRATION)("MCP Integration Tests", () => {
  let manager;
  let npxAvailable;

  beforeAll(async () => {
    npxAvailable = await isNpxAvailable();
    if (!npxAvailable) {
      console.warn("npx not available, some tests will be skipped");
    }

    setupTestFiles();
  });

  afterAll(async () => {
    if (manager) {
      await manager.shutdown();
    }
    cleanupTestFiles();
  });

  describe("MCPClientManager Real Connection", () => {
    beforeAll(() => {
      manager = new MCPClientManager({
        timeout: TEST_CONFIG.timeout,
      });
    });

    it.skipIf(!npxAvailable)(
      "should connect to filesystem server",
      async () => {
        const capabilities = await manager.connectServer("filesystem-test", {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            TEST_CONFIG.dataPath,
          ],
          transport: "stdio",
        });

        expect(capabilities).toBeDefined();
        expect(capabilities.tools).toBeDefined();
        expect(Array.isArray(capabilities.tools)).toBe(true);
      },
      TEST_CONFIG.timeout,
    );

    it.skipIf(!npxAvailable)(
      "should list tools from filesystem server",
      async () => {
        // Ensure connected
        if (!manager.servers.has("filesystem-test")) {
          await manager.connectServer("filesystem-test", {
            command: "npx",
            args: [
              "-y",
              "@modelcontextprotocol/server-filesystem",
              TEST_CONFIG.dataPath,
            ],
          });
        }

        const tools = await manager.listTools("filesystem-test");

        expect(tools).toBeDefined();
        expect(Array.isArray(tools)).toBe(true);

        // Filesystem server should have these tools
        const toolNames = tools.map((t) => t.name);
        expect(toolNames).toContain("read_file");
      },
    );

    it.skipIf(!npxAvailable)("should read a file using MCP tool", async () => {
      // Ensure connected
      if (!manager.servers.has("filesystem-test")) {
        await manager.connectServer("filesystem-test", {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            TEST_CONFIG.dataPath,
          ],
        });
      }

      const result = await manager.callTool("filesystem-test", "read_file", {
        path: "test.txt",
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();

      // Check content
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Hello from MCP integration test");
    });

    it.skipIf(!npxAvailable)(
      "should track performance metrics",
      async () => {
        // Ensure connected and make some calls
        if (!manager.servers.has("filesystem-test")) {
          await manager.connectServer("filesystem-test", {
            command: "npx",
            args: [
              "-y",
              "@modelcontextprotocol/server-filesystem",
              TEST_CONFIG.dataPath,
            ],
          });
        }

        // Make a few tool calls
        await manager.callTool("filesystem-test", "read_file", {
          path: "test.txt",
        });

        const metrics = manager.getMetrics();

        expect(metrics.totalCalls).toBeGreaterThan(0);
        expect(metrics.successfulCalls).toBeGreaterThan(0);
        expect(metrics.connectionTimes["filesystem-test"]).toBeDefined();
      },
      TEST_CONFIG.timeout,
    );

    it.skipIf(!npxAvailable)(
      "should disconnect from server",
      async () => {
        if (manager.servers.has("filesystem-test")) {
          await manager.disconnectServer("filesystem-test");
        }

        expect(manager.servers.has("filesystem-test")).toBe(false);
      },
      TEST_CONFIG.timeout,
    );
  });

  describe("MCPSecurityPolicy Integration", () => {
    let securityPolicy;

    beforeAll(() => {
      securityPolicy = new MCPSecurityPolicy({});
      // Configure permissions for the filesystem server
      securityPolicy.setServerPermissions("filesystem", {
        allowedPaths: ["notes/", "imports/", "exports/"],
        forbiddenPaths: ["chainlesschain.db", "ukey/", "did/private-keys/"],
        readOnly: false,
      });
    });

    it("should allow access to allowed paths", async () => {
      // validateToolExecution resolves for allowed paths
      await expect(
        securityPolicy.validateToolExecution("filesystem", "read_file", {
          path: "notes/sample.md",
        }),
      ).resolves.toBeUndefined();
    });

    it("should block access to forbidden paths", async () => {
      // validateToolExecution throws for forbidden paths
      await expect(
        securityPolicy.validateToolExecution("filesystem", "read_file", {
          path: "chainlesschain.db",
        }),
      ).rejects.toThrow(/forbidden/i);
    });

    it("should block path traversal attempts", async () => {
      // validateToolExecution throws for path traversal attempts
      await expect(
        securityPolicy.validateToolExecution("filesystem", "read_file", {
          path: "../../../etc/passwd",
        }),
      ).rejects.toThrow();
    });
  });

  describe("HTTP+SSE Transport", () => {
    // These tests require a running HTTP+SSE MCP server
    // Skip if no server is available

    const HTTP_SSE_SERVER_URL = process.env.MCP_HTTP_SSE_SERVER_URL;

    it.skipIf(!HTTP_SSE_SERVER_URL)(
      "should connect to HTTP+SSE server",
      async () => {
        const httpManager = new MCPClientManager({});

        await httpManager.connectServer("http-test", {
          transport: "http-sse",
          baseURL: HTTP_SSE_SERVER_URL,
          timeout: 10000,
        });

        expect(httpManager.servers.has("http-test")).toBe(true);

        await httpManager.shutdown();
      },
      30000,
    );
  });
});

describe("MCP Mocked Tests", () => {
  // These tests use mocks and can run in CI

  it("should create MCPClientManager instance", () => {
    if (!MCPClientManager) {
      return;
    }

    const manager = new MCPClientManager({});
    expect(manager).toBeDefined();
    expect(manager.servers).toBeDefined();
    expect(manager.metrics).toBeDefined();
  });

  it("should handle missing server gracefully", async () => {
    if (!MCPClientManager) {
      return;
    }

    const manager = new MCPClientManager({});

    await expect(manager.listTools("non-existent")).rejects.toThrow(
      "Server not found",
    );
  });

  it("should track metrics correctly", () => {
    if (!MCPClientManager) {
      return;
    }

    const manager = new MCPClientManager({});
    const metrics = manager.getMetrics();

    expect(metrics.totalCalls).toBe(0);
    expect(metrics.successfulCalls).toBe(0);
    expect(metrics.failedCalls).toBe(0);
  });
});
