/**
 * MCP End-to-End Integration Tests
 *
 * Tests the complete MCP system flow:
 * 1. Server connection lifecycle
 * 2. Tool registration and execution
 * 3. Error handling and recovery
 * 4. Performance metrics collection
 * 5. Security policy enforcement
 *
 * Usage: node scripts/test-mcp-integration.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { EventEmitter } = require("events");

// Test utilities
let passed = 0;
let failed = 0;
const testResults = [];

function test(name, fn) {
  const startTime = Date.now();
  try {
    fn();
    const duration = Date.now() - startTime;
    console.log(`  ✅ ${name} (${duration}ms)`);
    passed++;
    testResults.push({ name, status: "passed", duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
    testResults.push({
      name,
      status: "failed",
      duration,
      error: error.message,
    });
  }
}

async function asyncTest(name, fn) {
  const startTime = Date.now();
  try {
    await fn();
    const duration = Date.now() - startTime;
    console.log(`  ✅ ${name} (${duration}ms)`);
    passed++;
    testResults.push({ name, status: "passed", duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
    testResults.push({
      name,
      status: "failed",
      duration,
      error: error.message,
    });
  }
}

function assertEqual(actual, expected, message) {
  message = message || "";
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  message = message || "";
  if (!value) {
    throw new Error(`${message} Expected true, got ${value}`);
  }
}

function assertFalse(value, message) {
  message = message || "";
  if (value) {
    throw new Error(`${message} Expected false, got ${value}`);
  }
}

// Mock logger
const mockLogger = {
  info: function () {},
  warn: function () {
    console.warn.apply(console, ["[WARN]"].concat(Array.from(arguments)));
  },
  error: function () {},
  debug: function () {},
};

// Override require for logger
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (modulePath) {
  if (modulePath.includes("logger")) {
    return {
      logger: mockLogger,
      createLogger: function () {
        return mockLogger;
      },
    };
  }
  return originalRequire.call(this, modulePath);
};

// ============================================================
// Mock MCP Server for Integration Testing
// ============================================================

class MockMCPServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = options.name || "mock-server";
    this.connected = false;
    this.tools = options.tools || [
      {
        name: "read_file",
        description: "Read file contents",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write file contents",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_files",
        description: "List files in directory",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path" },
          },
          required: ["path"],
        },
      },
    ];
    this.resources = [];
    this.prompts = [];
    this.callCount = 0;
    this.failOnConnect = options.failOnConnect || false;
    this.failOnToolCall = options.failOnToolCall || false;
    this.latency = options.latency || 0;
  }

  async connect() {
    if (this.failOnConnect) {
      throw new Error("Connection failed");
    }
    await this._simulateLatency();
    this.connected = true;
    this.emit("connected");
    return {
      tools: this.tools,
      resources: this.resources,
      prompts: this.prompts,
    };
  }

  async disconnect() {
    this.connected = false;
    this.emit("disconnected");
  }

  async callTool(toolName, args) {
    if (!this.connected) {
      throw new Error("Server not connected");
    }
    if (this.failOnToolCall) {
      throw new Error("Tool call failed");
    }

    await this._simulateLatency();
    this.callCount++;

    // Simulate tool responses
    switch (toolName) {
      case "read_file":
        return {
          content: [{ type: "text", text: `Contents of ${args.path}` }],
          isError: false,
        };
      case "write_file":
        return {
          content: [
            {
              type: "text",
              text: `Wrote ${args.content.length} bytes to ${args.path}`,
            },
          ],
          isError: false,
        };
      case "list_files":
        return {
          content: [{ type: "text", text: "file1.txt\nfile2.txt\nfile3.txt" }],
          isError: false,
        };
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  async _simulateLatency() {
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
  }
}

// ============================================================
// Test 1: Server Connection Lifecycle
// ============================================================

async function testServerConnectionLifecycle() {
  console.log("\n--- Test Suite: Server Connection Lifecycle ---");

  const { MCPSecurityPolicy } = require("../src/main/mcp/mcp-security-policy");

  // Test 1.1: Initial connection
  await asyncTest("should establish initial connection", async () => {
    const server = new MockMCPServer({ name: "test-server" });
    const capabilities = await server.connect();

    assertTrue(server.connected);
    assertTrue(Array.isArray(capabilities.tools));
    assertEqual(capabilities.tools.length, 3);
  });

  // Test 1.2: Reconnection after disconnect
  await asyncTest("should handle reconnection after disconnect", async () => {
    const server = new MockMCPServer({ name: "reconnect-server" });

    // Connect
    await server.connect();
    assertTrue(server.connected);

    // Disconnect
    await server.disconnect();
    assertFalse(server.connected);

    // Reconnect
    await server.connect();
    assertTrue(server.connected);
  });

  // Test 1.3: Connection failure handling
  await asyncTest("should handle connection failure gracefully", async () => {
    const server = new MockMCPServer({
      name: "fail-server",
      failOnConnect: true,
    });

    let errorThrown = false;
    try {
      await server.connect();
    } catch (error) {
      errorThrown = true;
      assertTrue(error.message.includes("Connection failed"));
    }
    assertTrue(errorThrown);
    assertFalse(server.connected);
  });

  // Test 1.4: Connection events
  await asyncTest("should emit connection events", async () => {
    const server = new MockMCPServer({ name: "event-server" });

    let connectedEmitted = false;
    let disconnectedEmitted = false;

    server.on("connected", () => {
      connectedEmitted = true;
    });
    server.on("disconnected", () => {
      disconnectedEmitted = true;
    });

    await server.connect();
    assertTrue(connectedEmitted);

    await server.disconnect();
    assertTrue(disconnectedEmitted);
  });

  // Test 1.5: Multiple server management
  await asyncTest("should manage multiple server connections", async () => {
    const servers = [
      new MockMCPServer({ name: "server-1" }),
      new MockMCPServer({ name: "server-2" }),
      new MockMCPServer({ name: "server-3" }),
    ];

    // Connect all
    await Promise.all(servers.map((s) => s.connect()));
    assertTrue(servers.every((s) => s.connected));

    // Disconnect one
    await servers[1].disconnect();
    assertTrue(servers[0].connected);
    assertFalse(servers[1].connected);
    assertTrue(servers[2].connected);
  });
}

// ============================================================
// Test 2: Tool Registration and Execution
// ============================================================

async function testToolRegistrationAndExecution() {
  console.log("\n--- Test Suite: Tool Registration and Execution ---");

  // Test 2.1: Tool discovery
  await asyncTest("should discover available tools on connection", async () => {
    const server = new MockMCPServer({ name: "tool-server" });
    const capabilities = await server.connect();

    assertTrue(capabilities.tools.length > 0);
    const toolNames = capabilities.tools.map((t) => t.name);
    assertTrue(toolNames.includes("read_file"));
    assertTrue(toolNames.includes("write_file"));
    assertTrue(toolNames.includes("list_files"));
  });

  // Test 2.2: Tool execution - read
  await asyncTest("should execute read_file tool", async () => {
    const server = new MockMCPServer({ name: "read-server" });
    await server.connect();

    const result = await server.callTool("read_file", {
      path: "/test/file.txt",
    });

    assertFalse(result.isError);
    assertTrue(result.content[0].text.includes("Contents of"));
    assertEqual(server.callCount, 1);
  });

  // Test 2.3: Tool execution - write
  await asyncTest("should execute write_file tool", async () => {
    const server = new MockMCPServer({ name: "write-server" });
    await server.connect();

    const result = await server.callTool("write_file", {
      path: "/test/output.txt",
      content: "Hello, World!",
    });

    assertFalse(result.isError);
    assertTrue(result.content[0].text.includes("Wrote"));
  });

  // Test 2.4: Tool execution - list
  await asyncTest("should execute list_files tool", async () => {
    const server = new MockMCPServer({ name: "list-server" });
    await server.connect();

    const result = await server.callTool("list_files", { path: "/test" });

    assertFalse(result.isError);
    assertTrue(result.content[0].text.includes("file1.txt"));
  });

  // Test 2.5: Unknown tool handling
  await asyncTest("should handle unknown tool gracefully", async () => {
    const server = new MockMCPServer({ name: "unknown-tool-server" });
    await server.connect();

    const result = await server.callTool("nonexistent_tool", {});

    assertTrue(result.isError);
    assertTrue(result.content[0].text.includes("Unknown tool"));
  });

  // Test 2.6: Tool call on disconnected server
  await asyncTest("should reject tool call when disconnected", async () => {
    const server = new MockMCPServer({ name: "disconnected-server" });

    let errorThrown = false;
    try {
      await server.callTool("read_file", { path: "/test.txt" });
    } catch (error) {
      errorThrown = true;
      assertTrue(error.message.includes("not connected"));
    }
    assertTrue(errorThrown);
  });

  // Test 2.7: Multiple sequential tool calls
  await asyncTest("should handle multiple sequential tool calls", async () => {
    const server = new MockMCPServer({ name: "multi-call-server" });
    await server.connect();

    await server.callTool("read_file", { path: "/file1.txt" });
    await server.callTool("read_file", { path: "/file2.txt" });
    await server.callTool("write_file", {
      path: "/output.txt",
      content: "test",
    });

    assertEqual(server.callCount, 3);
  });

  // Test 2.8: Concurrent tool calls
  await asyncTest("should handle concurrent tool calls", async () => {
    const server = new MockMCPServer({
      name: "concurrent-server",
      latency: 10,
    });
    await server.connect();

    const calls = [
      server.callTool("read_file", { path: "/file1.txt" }),
      server.callTool("read_file", { path: "/file2.txt" }),
      server.callTool("read_file", { path: "/file3.txt" }),
    ];

    const results = await Promise.all(calls);

    assertEqual(results.length, 3);
    assertTrue(results.every((r) => !r.isError));
    assertEqual(server.callCount, 3);
  });
}

// ============================================================
// Test 3: Error Handling and Recovery
// ============================================================

async function testErrorHandlingAndRecovery() {
  console.log("\n--- Test Suite: Error Handling and Recovery ---");

  // Test 3.1: Tool call failure
  await asyncTest("should handle tool call failure", async () => {
    const server = new MockMCPServer({
      name: "fail-tool-server",
      failOnToolCall: true,
    });
    await server.connect();

    let errorThrown = false;
    try {
      await server.callTool("read_file", { path: "/test.txt" });
    } catch (error) {
      errorThrown = true;
      assertTrue(error.message.includes("Tool call failed"));
    }
    assertTrue(errorThrown);
  });

  // Test 3.2: Recovery after failure
  await asyncTest("should recover after tool call failure", async () => {
    const server = new MockMCPServer({ name: "recovery-server" });
    server.failOnToolCall = true;
    await server.connect();

    // First call fails
    let firstCallFailed = false;
    try {
      await server.callTool("read_file", { path: "/test.txt" });
    } catch (error) {
      firstCallFailed = true;
    }
    assertTrue(firstCallFailed);

    // Fix the server
    server.failOnToolCall = false;

    // Second call succeeds
    const result = await server.callTool("read_file", { path: "/test.txt" });
    assertFalse(result.isError);
  });

  // Test 3.3: Connection retry logic
  await asyncTest("should implement connection retry logic", async () => {
    let attempts = 0;
    const maxRetries = 3;
    let connected = false;

    const server = new MockMCPServer({ name: "retry-server" });
    server.failOnConnect = true;

    while (attempts < maxRetries && !connected) {
      attempts++;
      try {
        await server.connect();
        connected = true;
      } catch (error) {
        if (attempts === 2) {
          // Simulate server becoming available
          server.failOnConnect = false;
        }
      }
    }

    assertTrue(connected);
    assertEqual(attempts, 3);
  });

  // Test 3.4: Timeout handling
  await asyncTest("should handle timeouts", async () => {
    const server = new MockMCPServer({ name: "timeout-server", latency: 100 });
    await server.connect();

    const timeout = 50;
    let timedOut = false;

    const callPromise = server.callTool("read_file", { path: "/test.txt" });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), timeout);
    });

    try {
      await Promise.race([callPromise, timeoutPromise]);
    } catch (error) {
      if (error.message === "Timeout") {
        timedOut = true;
      }
    }

    assertTrue(timedOut);
  });
}

// ============================================================
// Test 4: Performance Metrics
// ============================================================

async function testPerformanceMetrics() {
  console.log("\n--- Test Suite: Performance Metrics ---");

  const MCPPerformanceMonitor = require("../src/main/mcp/mcp-performance-monitor");

  // Test 4.1: Connection timing
  await asyncTest("should track connection timing", async () => {
    const monitor = new MCPPerformanceMonitor();
    const server = new MockMCPServer({ name: "timing-server", latency: 20 });

    const startTime = Date.now();
    await server.connect();
    const connectionTime = Date.now() - startTime;

    monitor.recordConnection("timing-server", connectionTime, true);

    const summary = monitor.getSummary();
    assertTrue(summary.connections.total >= 1);
    assertTrue(summary.connections.avgTime > 0);
  });

  // Test 4.2: Tool call timing
  await asyncTest("should track tool call timing", async () => {
    const monitor = new MCPPerformanceMonitor();
    const server = new MockMCPServer({
      name: "tool-timing-server",
      latency: 10,
    });
    await server.connect();

    const startTime = Date.now();
    await server.callTool("read_file", { path: "/test.txt" });
    const callTime = Date.now() - startTime;

    monitor.recordToolCall("tool-timing-server", "read_file", callTime, true);

    const summary = monitor.getSummary();
    assertTrue(summary.toolCalls.total >= 1);
  });

  // Test 4.3: Error rate tracking
  await asyncTest("should track error rates", async () => {
    const monitor = new MCPPerformanceMonitor();

    // Record successes
    monitor.recordToolCall("server", "tool1", 10, true);
    monitor.recordToolCall("server", "tool2", 10, true);

    // Record failure
    monitor.recordToolCall("server", "tool3", 10, false);

    const summary = monitor.getSummary();
    assertEqual(summary.toolCalls.total, 3);
    assertEqual(summary.toolCalls.successful, 2);
    assertEqual(summary.toolCalls.failed, 1);
  });

  // Test 4.4: Latency percentiles
  await asyncTest("should calculate latency statistics", async () => {
    const monitor = new MCPPerformanceMonitor();

    // Record multiple calls with varying latencies
    monitor.recordToolCall("server", "tool", 10, true);
    monitor.recordToolCall("server", "tool", 20, true);
    monitor.recordToolCall("server", "tool", 30, true);
    monitor.recordToolCall("server", "tool", 40, true);
    monitor.recordToolCall("server", "tool", 50, true);

    const summary = monitor.getSummary();
    assertTrue(summary.toolCalls.avgLatency > 0);
  });

  // Test 4.5: Reset metrics
  await asyncTest("should reset metrics", async () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordConnection("server", 100, true);
    monitor.recordToolCall("server", "tool", 50, true);

    monitor.reset();

    const summary = monitor.getSummary();
    assertEqual(summary.connections.total, 0);
    assertEqual(summary.toolCalls.total, 0);
  });

  // Test 4.6: Generate performance report
  await asyncTest("should generate performance report", async () => {
    const monitor = new MCPPerformanceMonitor();

    monitor.recordConnection("server1", 100, true);
    monitor.recordConnection("server2", 150, true);
    monitor.recordToolCall("server1", "read_file", 50, true);
    monitor.recordToolCall("server1", "write_file", 75, true);
    monitor.recordError("tool_call", new Error("Test error"), {
      server: "server1",
    });

    const report = monitor.generateReport();

    assertTrue(typeof report === "string");
    assertTrue(report.length > 0);
  });
}

// ============================================================
// Test 5: Security Policy Enforcement
// ============================================================

async function testSecurityPolicyEnforcement() {
  console.log("\n--- Test Suite: Security Policy Enforcement ---");

  const { MCPSecurityPolicy } = require("../src/main/mcp/mcp-security-policy");

  // Test 5.1: Allowed path access
  await asyncTest("should allow access to permitted paths", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/notes/", "data/exports/"],
      forbiddenPaths: [],
      readOnly: false,
    });

    const server = new MockMCPServer({ name: "filesystem" });
    await server.connect();

    // Validate before execution
    await policy.validateToolExecution("filesystem", "read_file", {
      path: "data/notes/test.md",
    });

    // If validation passes, execute
    const result = await server.callTool("read_file", {
      path: "data/notes/test.md",
    });
    assertFalse(result.isError);
  });

  // Test 5.2: Forbidden path blocking
  await asyncTest("should block access to forbidden paths", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/"],
      forbiddenPaths: [],
      readOnly: false,
    });

    let blocked = false;
    try {
      await policy.validateToolExecution("filesystem", "read_file", {
        path: "/data/chainlesschain.db",
      });
    } catch (error) {
      blocked = true;
    }
    assertTrue(blocked);
  });

  // Test 5.3: Read-only mode enforcement
  await asyncTest("should enforce read-only mode", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/"],
      forbiddenPaths: [],
      readOnly: true,
    });

    // Read should be allowed
    await policy.validateToolExecution("filesystem", "read_file", {
      path: "data/notes/test.md",
    });

    // Write should be blocked
    let writeBlocked = false;
    try {
      await policy.validateToolExecution("filesystem", "write_file", {
        path: "data/notes/test.md",
        content: "test",
      });
    } catch (error) {
      writeBlocked = true;
      assertTrue(error.message.includes("read-only"));
    }
    assertTrue(writeBlocked);
  });

  // Test 5.4: Audit logging
  await asyncTest("should log all operations to audit trail", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/"],
      forbiddenPaths: [],
      readOnly: false,
    });

    // Clear existing logs
    policy.auditLog = [];

    // Perform some operations
    await policy.validateToolExecution("filesystem", "read_file", {
      path: "data/test.txt",
    });

    try {
      await policy.validateToolExecution("filesystem", "read_file", {
        path: "/data/chainlesschain.db",
      });
    } catch (e) {
      // Expected
    }

    const logs = policy.getAuditLog();
    assertTrue(logs.length >= 2);

    const allowedLogs = logs.filter((l) => l.decision === "ALLOWED");
    const deniedLogs = logs.filter((l) => l.decision === "DENIED");

    assertTrue(allowedLogs.length >= 1);
    assertTrue(deniedLogs.length >= 1);
  });

  // Test 5.5: Statistics collection
  await asyncTest("should collect security statistics", async () => {
    const policy = new MCPSecurityPolicy({});
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/"],
      forbiddenPaths: [],
      readOnly: false,
    });

    // Clear existing data
    policy.auditLog = [];

    // Perform operations
    await policy.validateToolExecution("filesystem", "read_file", {
      path: "data/test1.txt",
    });
    await policy.validateToolExecution("filesystem", "read_file", {
      path: "data/test2.txt",
    });

    try {
      await policy.validateToolExecution("filesystem", "read_file", {
        path: "/secrets/key.txt",
      });
    } catch (e) {
      // Expected
    }

    const stats = policy.getStatistics();

    assertTrue(stats.totalOperations >= 3);
    assertTrue(stats.allowed >= 2);
    assertTrue(stats.denied >= 1);
  });
}

// ============================================================
// Test 6: Integration Flow
// ============================================================

async function testIntegrationFlow() {
  console.log("\n--- Test Suite: Complete Integration Flow ---");

  const { MCPSecurityPolicy } = require("../src/main/mcp/mcp-security-policy");
  const MCPPerformanceMonitor = require("../src/main/mcp/mcp-performance-monitor");

  // Test 6.1: Complete workflow
  await asyncTest("should execute complete MCP workflow", async () => {
    // Setup
    const policy = new MCPSecurityPolicy({});
    const monitor = new MCPPerformanceMonitor();
    const server = new MockMCPServer({ name: "workflow-server", latency: 5 });

    // Configure permissions
    policy.setServerPermissions("workflow-server", {
      allowedPaths: ["data/", "exports/"],
      forbiddenPaths: [],
      readOnly: false,
    });

    // 1. Connect server
    const connectStart = Date.now();
    const capabilities = await server.connect();
    monitor.recordConnection(
      "workflow-server",
      Date.now() - connectStart,
      true,
    );

    // 2. Validate and execute multiple tools
    for (const tool of capabilities.tools) {
      if (tool.name === "read_file") {
        await policy.validateToolExecution("workflow-server", tool.name, {
          path: "data/test.txt",
        });

        const toolStart = Date.now();
        const result = await server.callTool(tool.name, {
          path: "data/test.txt",
        });
        monitor.recordToolCall(
          "workflow-server",
          tool.name,
          Date.now() - toolStart,
          !result.isError,
        );
      }
    }

    // 3. Verify metrics
    const summary = monitor.getSummary();
    assertTrue(summary.connections.total >= 1);
    assertTrue(summary.toolCalls.total >= 1);

    // 4. Disconnect
    await server.disconnect();
    assertFalse(server.connected);
  });

  // Test 6.2: Multi-server workflow
  await asyncTest("should manage multi-server workflow", async () => {
    const policy = new MCPSecurityPolicy({});
    const monitor = new MCPPerformanceMonitor();

    const servers = {
      filesystem: new MockMCPServer({ name: "filesystem" }),
      database: new MockMCPServer({
        name: "database",
        tools: [
          {
            name: "query",
            description: "Execute query",
            inputSchema: {
              type: "object",
              properties: { sql: { type: "string" } },
            },
          },
        ],
      }),
    };

    // Configure policies
    policy.setServerPermissions("filesystem", {
      allowedPaths: ["data/"],
      forbiddenPaths: [],
      readOnly: false,
    });
    policy.setServerPermissions("database", {
      allowedPaths: [],
      forbiddenPaths: [],
      readOnly: true,
    });

    // Connect all servers
    for (const [name, server] of Object.entries(servers)) {
      const start = Date.now();
      await server.connect();
      monitor.recordConnection(name, Date.now() - start, true);
    }

    // Execute tools on different servers
    const fsResult = await servers.filesystem.callTool("read_file", {
      path: "data/test.txt",
    });
    const dbResult = await servers.database.callTool("query", {
      sql: "SELECT 1",
    });

    assertFalse(fsResult.isError);
    assertTrue(dbResult.isError); // Unknown tool

    // Cleanup
    for (const server of Object.values(servers)) {
      await server.disconnect();
    }
  });

  // Test 6.3: Error recovery workflow
  await asyncTest("should handle error recovery in workflow", async () => {
    const server = new MockMCPServer({ name: "error-recovery-server" });
    let recovered = false;

    try {
      // Simulate initial failure
      server.failOnConnect = true;
      await server.connect();
    } catch (error) {
      // Attempt recovery
      server.failOnConnect = false;
      await server.connect();
      recovered = true;
    }

    assertTrue(recovered);
    assertTrue(server.connected);

    // Verify server works after recovery
    const result = await server.callTool("read_file", { path: "/test.txt" });
    assertFalse(result.isError);

    await server.disconnect();
  });
}

// ============================================================
// Main
// ============================================================

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("MCP End-to-End Integration Tests");
  console.log("=".repeat(60));

  const startTime = Date.now();

  try {
    await testServerConnectionLifecycle();
    await testToolRegistrationAndExecution();
    await testErrorHandlingAndRecovery();
    await testPerformanceMetrics();
    await testSecurityPolicyEnforcement();
    await testIntegrationFlow();
  } catch (error) {
    console.error("\nTest runner error:", error);
    failed++;
  }

  const totalTime = Date.now() - startTime;

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log("=".repeat(60));

  // Detailed results
  if (failed > 0) {
    console.log("\nFailed Tests:");
    testResults
      .filter((t) => t.status === "failed")
      .forEach((t) => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
  }

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
