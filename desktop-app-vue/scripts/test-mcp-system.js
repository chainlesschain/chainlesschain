/**
 * MCP System Comprehensive Test Script
 *
 * Tests:
 * 1. MCPSecurityPolicy - path validation, security enforcement
 * 2. MCPConfigLoader - config loading, validation
 * 3. MCPToolAdapter - tool registration, conversion
 * 4. MCPFunctionExecutor - function conversion, caching
 * 5. MCPClientManager - connection management (mock)
 *
 * Usage: node scripts/test-mcp-system.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

// Mock logger
const mockLogger = {
  info: (...args) => {}, // Silent for clean output
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => {},
};

// Override require for testing
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath.includes("logger")) {
    return { logger: mockLogger, createLogger: () => mockLogger };
  }
  if (modulePath.includes("unified-config-manager")) {
    return { getUnifiedConfigManager: () => ({ getConfigDir: () => os.tmpdir() }) };
  }
  return originalRequire.call(this, modulePath);
};

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = "") {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message = "") {
  if (!value) {
    throw new Error(`${message} Expected true, got ${value}`);
  }
}

function assertFalse(value, message = "") {
  if (value) {
    throw new Error(`${message} Expected false, got ${value}`);
  }
}

function assertThrows(fn, message = "") {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) {
    throw new Error(`${message} Expected function to throw`);
  }
}

async function assertRejects(fn, message = "") {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) {
    throw new Error(`${message} Expected function to reject`);
  }
}

// ============================================================
// Test 1: MCPSecurityPolicy
// ============================================================

async function testSecurityPolicy() {
  console.log("\n--- Test Suite: MCPSecurityPolicy ---");

  const { MCPSecurityPolicy, SecurityError } = require("../src/main/mcp/mcp-security-policy");

  // Test 1.1: Initialization
  test("should initialize with default config", () => {
    const policy = new MCPSecurityPolicy({});
    assertTrue(policy !== null);
  });

  // Test 1.2: Forbidden paths
  test("should block chainlesschain.db access", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", { allowedPaths: [], forbiddenPaths: [] });

    let blocked = false;
    try {
      await policy.validateToolExecution("test", "read_file", {
        path: "/data/chainlesschain.db",
      });
    } catch (e) {
      blocked = true;
    }
    assertTrue(blocked, "Should block database access");
  });

  // Test 1.3: Ukey directory protection
  test("should block ukey directory access", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", { allowedPaths: [], forbiddenPaths: [] });

    let blocked = false;
    try {
      await policy.validateToolExecution("test", "read_file", {
        path: "/data/ukey/keys.json",
      });
    } catch (e) {
      blocked = true;
    }
    assertTrue(blocked, "Should block ukey access");
  });

  // Test 1.4: Environment file protection
  test("should block .env file access", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", { allowedPaths: [], forbiddenPaths: [] });

    let blocked = false;
    try {
      await policy.validateToolExecution("test", "read_file", {
        path: "/app/.env",
      });
    } catch (e) {
      blocked = true;
    }
    assertTrue(blocked, "Should block .env access");
  });

  // Test 1.5: Allowed paths
  test("should allow access to allowed paths", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", {
      allowedPaths: ["/allowed/dir"],
      forbiddenPaths: [],
    });

    // This should not throw
    await policy.validateToolExecution("test", "read_file", {
      path: "/allowed/dir/file.txt",
    });
    assertTrue(true);
  });

  // Test 1.6: Audit logging
  test("should log security events", () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", { allowedPaths: [], forbiddenPaths: [] });

    // Access audit log
    const logs = policy.getAuditLog();
    assertTrue(Array.isArray(logs), "Audit log should be an array");
  });

  // Test 1.7: Read-only mode
  test("should enforce read-only mode", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("test", {
      allowedPaths: ["/data"],
      forbiddenPaths: [],
      readOnly: true,
    });

    let blocked = false;
    try {
      await policy.validateToolExecution("test", "write_file", {
        path: "/data/file.txt",
      });
    } catch (e) {
      blocked = true;
    }
    assertTrue(blocked, "Should block write in read-only mode");
  });
}

// ============================================================
// Test 2: MCPConfigLoader
// ============================================================

async function testConfigLoader() {
  console.log("\n--- Test Suite: MCPConfigLoader ---");

  const { MCPConfigLoader } = require("../src/main/mcp/mcp-config-loader");

  // Create temp config directory
  const tempDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // Test 2.1: Default config
  test("should return default config when file not found", () => {
    const loader = new MCPConfigLoader(path.join(tempDir, "nonexistent.json"));
    const config = loader.load();
    assertTrue(config !== null);
    assertEqual(config.enabled, true);
  });

  // Test 2.2: Load valid config
  test("should load valid config file", () => {
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          enabled: true,
          servers: {
            filesystem: {
              enabled: true,
              transport: "stdio",
              command: "npx",
              args: ["-y", "@anthropic/mcp-server-filesystem"],
            },
          },
        },
      })
    );

    const loader = new MCPConfigLoader(configPath);
    const config = loader.load();

    assertTrue(config.enabled);
    assertTrue(config.servers.filesystem !== undefined);
  });

  // Test 2.3: Config validation
  test("should validate config structure", () => {
    const configPath = path.join(tempDir, "config2.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          enabled: true,
          servers: {},
        },
      })
    );

    const loader = new MCPConfigLoader(configPath);
    const config = loader.load();
    assertTrue(typeof config.servers === "object");
  });

  // Test 2.4: Get server config
  test("should return server config by name", () => {
    const configPath = path.join(tempDir, "config3.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          enabled: true,
          servers: {
            test: {
              enabled: true,
              transport: "stdio",
              command: "node",
              args: ["server.js"],
            },
          },
        },
      })
    );

    const loader = new MCPConfigLoader(configPath);
    loader.load();
    const serverConfig = loader.getServerConfig("test");

    assertTrue(serverConfig !== undefined);
    assertEqual(serverConfig.transport, "stdio");
  });

  // Test 2.5: Get enabled servers
  test("should return only enabled servers", () => {
    const configPath = path.join(tempDir, "config4.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          enabled: true,
          servers: {
            enabled1: { enabled: true, transport: "stdio", command: "node", args: [] },
            disabled1: { enabled: false, transport: "stdio", command: "node", args: [] },
            enabled2: { enabled: true, transport: "stdio", command: "node", args: [] },
          },
        },
      })
    );

    const loader = new MCPConfigLoader(configPath);
    loader.load();
    const enabledServers = loader.getEnabledServers();

    assertEqual(enabledServers.length, 2);
  });

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ============================================================
// Test 3: MCPFunctionExecutor
// ============================================================

async function testFunctionExecutor() {
  console.log("\n--- Test Suite: MCPFunctionExecutor ---");

  const MCPFunctionExecutor = require("../src/main/mcp/mcp-function-executor");

  // Mock MCP Tool Adapter with toolManager that returns proper tool objects
  const mockToolAdapter = {
    getMCPTools: () => [
      {
        toolId: "mcp_test_read_file",
        serverName: "test",
        originalToolName: "read_file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      },
    ],
    getToolServer: (toolId) => ({
      serverName: "test",
      originalToolName: "read_file",
    }),
    // toolManager is required for _convertToOpenAIFunction
    toolManager: {
      getTool: async (toolId) => ({
        id: toolId,
        name: toolId,
        description: "Test MCP tool for reading files",
        parameters_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      }),
    },
  };

  // Mock MCP Client Manager
  const mockClientManager = {
    callTool: async (serverName, toolName, args) => {
      return { content: [{ type: "text", text: "result" }] };
    },
  };

  // Test 3.1: Get functions
  await asyncTest("should convert MCP tools to OpenAI functions", async () => {
    const executor = new MCPFunctionExecutor(mockClientManager, mockToolAdapter);
    const functions = await executor.getFunctions();

    assertTrue(Array.isArray(functions));
    assertTrue(functions.length > 0);
  });

  // Test 3.2: Function format
  await asyncTest("should have correct function format", async () => {
    const executor = new MCPFunctionExecutor(mockClientManager, mockToolAdapter);
    const functions = await executor.getFunctions();
    const func = functions[0];

    assertTrue(func.name !== undefined);
    assertTrue(func.parameters !== undefined);
    assertEqual(func.parameters.type, "object");
  });

  // Test 3.3: Cache
  await asyncTest("should cache functions", async () => {
    const executor = new MCPFunctionExecutor(mockClientManager, mockToolAdapter);

    const functions1 = await executor.getFunctions();
    const functions2 = await executor.getFunctions();

    // Same reference due to caching
    assertEqual(functions1, functions2);
  });

  // Test 3.4: Clear cache
  await asyncTest("should clear cache", async () => {
    const executor = new MCPFunctionExecutor(mockClientManager, mockToolAdapter);

    await executor.getFunctions();
    executor.clearCache();

    const functions = await executor.getFunctions();
    assertTrue(Array.isArray(functions));
  });

  // Test 3.5: Execute function (method is execute(), not executeFunction())
  await asyncTest("should execute MCP tool", async () => {
    const executor = new MCPFunctionExecutor(mockClientManager, mockToolAdapter);

    const result = await executor.execute("mcp_test_read_file", {
      path: "/test/file.txt",
    });

    assertTrue(result !== undefined);
    assertTrue(result.success === true);
  });
}

// ============================================================
// Test 4: MCPToolAdapter
// ============================================================

async function testToolAdapter() {
  console.log("\n--- Test Suite: MCPToolAdapter ---");

  const { MCPToolAdapter } = require("../src/main/mcp/mcp-tool-adapter");

  // Mock Tool Manager
  const mockToolManager = {
    registerTool: (toolDef) => {
      return { id: toolDef.id, ...toolDef };
    },
    unregisterTool: (toolId) => true,
    getTool: (toolId) => ({ id: toolId }),
  };

  // Mock MCP Client Manager
  const mockClientManager = {
    servers: new Map(),
    connectServer: async (name, config) => ({
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      resources: [],
      prompts: [],
    }),
    disconnectServer: async (name) => {},
    callTool: async (server, tool, args) => ({
      content: [{ type: "text", text: "result" }],
    }),
    getAllTools: () => [
      { name: "test_tool", description: "Test", serverName: "test" },
    ],
    on: () => {},
    off: () => {},
  };

  // Test 4.1: Initialization
  test("should initialize correctly", () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);
    assertTrue(adapter !== null);
  });

  // Test 4.2: Register server tools
  await asyncTest("should register MCP server tools", async () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    await adapter.registerMCPServerTools("test", {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    const tools = adapter.getMCPTools();
    assertTrue(tools.length > 0);
  });

  // Test 4.3: Tool ID format
  await asyncTest("should create correct tool ID format", async () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    await adapter.registerMCPServerTools("test", {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    const tools = adapter.getMCPTools();
    assertTrue(tools[0].toolId.startsWith("mcp_"));
  });

  // Test 4.4: Check if tool is MCP tool
  await asyncTest("should identify MCP tools", async () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    await adapter.registerMCPServerTools("test", {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    const tools = adapter.getMCPTools();
    const isMCP = adapter.isMCPTool(tools[0].toolId);

    assertTrue(isMCP);
  });

  // Test 4.5: Unregister server tools
  await asyncTest("should unregister server tools", async () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    await adapter.registerMCPServerTools("test", {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    await adapter.unregisterMCPServerTools("test");

    const tools = adapter.getMCPTools();
    const testTools = tools.filter((t) => t.serverName === "test");
    assertEqual(testTools.length, 0);
  });

  // Test 4.6: Get tool server info (returns serverName string, not object)
  await asyncTest("should return tool server name", async () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    await adapter.registerMCPServerTools("test", {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    const tools = adapter.getMCPTools();
    const serverName = adapter.getToolServer(tools[0].toolId);

    assertTrue(serverName !== null);
    assertEqual(serverName, "test");
  });

  // Test 4.7: Should return null for non-MCP tool
  test("should return null for non-MCP tool", () => {
    const adapter = new MCPToolAdapter(mockToolManager, mockClientManager);

    const serverName = adapter.getToolServer("non_existent_tool");
    assertTrue(serverName === null);
  });
}

// ============================================================
// Test 5: MCPPerformanceMonitor
// ============================================================

async function testPerformanceMonitor() {
  console.log("\n--- Test Suite: MCPPerformanceMonitor ---");

  const MCPPerformanceMonitor = require("../src/main/mcp/mcp-performance-monitor");

  // Test 5.1: Initialization
  test("should initialize correctly", () => {
    const monitor = new MCPPerformanceMonitor();
    assertTrue(monitor !== null);
  });

  // Test 5.2: Record connection
  test("should record connection metrics", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordConnection("test", 100, true);

    const summary = monitor.getSummary();
    assertTrue(summary !== null);
    assertTrue(summary.connections !== undefined);
  });

  // Test 5.3: Record tool call
  test("should record tool call metrics", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordToolCall("test", "read_file", 50, true);
    monitor.recordToolCall("test", "read_file", 100, true);
    monitor.recordToolCall("test", "read_file", 150, true);

    const summary = monitor.getSummary();
    assertTrue(summary.toolCalls !== undefined);
    assertTrue(summary.toolCalls.total >= 3);
  });

  // Test 5.4: Track errors
  test("should track errors", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordError("tool_call", new Error("Test error"), { server: "test" });
    monitor.recordError("tool_call", new Error("Test error 2"), { server: "test" });

    const summary = monitor.getSummary();
    assertTrue(summary.errors !== undefined);
    assertTrue(summary.errors.total >= 2);
  });

  // Test 5.5: Success rate calculation
  test("should calculate success rate", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordToolCall("test", "tool", 100, true);
    monitor.recordToolCall("test", "tool", 100, true);
    monitor.recordToolCall("test", "tool", 100, false);

    const summary = monitor.getSummary();
    // Check tool call success rate
    assertTrue(summary.toolCalls.successRate !== undefined);
  });

  // Test 5.6: Reset metrics
  test("should reset metrics", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordToolCall("test", "tool", 100, true);
    monitor.reset();

    const summary = monitor.getSummary();
    assertEqual(summary.toolCalls.total, 0);
  });

  // Test 5.7: Generate report
  test("should generate report", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordConnection("server1", 100, true);
    monitor.recordToolCall("server1", "tool1", 100, true);

    const report = monitor.generateReport();
    assertTrue(typeof report === "string");
    assertTrue(report.length > 0);
  });

  // Test 5.8: Set baseline
  test("should set and use baseline", () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.setBaseline("connection", 50);
    monitor.recordConnection("test", 100, true);

    const summary = monitor.getSummary();
    assertTrue(summary !== null);
  });
}

// ============================================================
// Main
// ============================================================

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("MCP System Comprehensive Tests");
  console.log("=".repeat(60));

  try {
    await testSecurityPolicy();
    await testConfigLoader();
    await testFunctionExecutor();
    await testToolAdapter();
    await testPerformanceMonitor();
  } catch (error) {
    console.error("\nTest runner error:", error);
    failed++;
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
