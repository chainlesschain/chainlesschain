/**
 * End-to-End Integration Tests for Cowork System
 *
 * Tests the complete workflow from team creation to task completion,
 * including IPC communication, skill execution, and result handling.
 *
 * @category Integration Tests
 * @module CoworkE2E
 */

const path = require("path");
const fs = require("fs-extra");
const Database = require("../../../database");
const { TeammateTool } = require("../../../ai-engine/cowork/teammate-tool");
const { FileSandbox } = require("../../../ai-engine/cowork/file-sandbox");
const { LongRunningTaskManager } = require("../../../ai-engine/cowork/long-running-task-manager");
const { SkillRegistry } = require("../../../ai-engine/cowork/skills/skill-registry");
const { OfficeSkill } = require("../../../ai-engine/cowork/skills/office-skill");
const { CoworkOrchestrator } = require("../../../ai-engine/multi-agent/cowork-orchestrator");

// Test configuration
const os = require("os");
const TEST_DB_PATH = path.join(os.tmpdir(), "test-cowork-e2e.db");
const TEST_SANDBOX_ROOT = path.join(os.tmpdir(), "test-cowork-sandbox");
const TEST_KEY = "test-encryption-key-32-chars!!!";

describe("Cowork E2E Integration Tests", () => {
  let db;
  let teammateTool;
  let fileSandbox;
  let taskManager;
  let skillRegistry;
  let orchestrator;

  // ==========================================
  // Setup & Teardown
  // ==========================================

  beforeAll(async () => {
    // Clean up from previous runs
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_SANDBOX_ROOT)) {
      fs.removeSync(TEST_SANDBOX_ROOT);
    }

    // Initialize database
    db = new Database(TEST_DB_PATH, { password: TEST_KEY, encryptionEnabled: false });
    await db.initialize();

    // Initialize components
    teammateTool = new TeammateTool(db);
    fileSandbox = new FileSandbox(db);
    taskManager = new LongRunningTaskManager(db);
    skillRegistry = new SkillRegistry();
    orchestrator = new CoworkOrchestrator(db, teammateTool);

    // Register skills
    const officeSkill = new OfficeSkill();
    skillRegistry.register(officeSkill);

    // Create sandbox root
    await fs.ensureDir(TEST_SANDBOX_ROOT);
  });

  afterAll(async () => {
    // Cleanup
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_SANDBOX_ROOT)) {
      fs.removeSync(TEST_SANDBOX_ROOT);
    }
  });

  afterEach(async () => {
    // Clean up after each test
    const teams = await teammateTool.listTeams();
    for (const team of teams) {
      await teammateTool.disbandTeam(team.id);
    }

    const tasks = await taskManager.listTasks();
    for (const task of tasks) {
      if (task.status === "running") {
        await taskManager.cancelTask(task.id);
      }
    }
  });

  // ==========================================
  // E2E Workflow Tests
  // ==========================================

  describe("Complete Workflow: Team Creation to Task Completion", () => {
    test("should execute full workflow with single agent", async () => {
      // 1. Create team
      const team = await teammateTool.spawnTeam("Data Analysis Team", {
        maxAgents: 1,
        autoAssignTasks: true,
      });

      expect(team).toBeDefined();
      expect(team.id).toBeTruthy();
      expect(team.name).toBe("Data Analysis Team");
      expect(team.status).toBe("active");

      // 2. Add agent to team
      const agent = await teammateTool.addAgent(team.id, {
        name: "Excel Agent",
        role: "data-analyst",
        capabilities: ["excel", "data-analysis"],
      });

      expect(agent).toBeDefined();
      expect(agent.teamId).toBe(team.id);
      expect(agent.status).toBe("active");

      // 3. Assign task
      const task = await teammateTool.assignTask(team.id, {
        description: "Create sales report",
        type: "office",
        priority: "high",
        input: {
          operation: "createExcel",
          outputPath: path.join(TEST_SANDBOX_ROOT, "sales-report.xlsx"),
          sheetName: "Sales",
          columns: [
            { header: "Product", key: "product" },
            { header: "Revenue", key: "revenue" },
          ],
          rows: [
            { product: "Product A", revenue: 10000 },
            { product: "Product B", revenue: 15000 },
          ],
        },
      });

      expect(task).toBeDefined();
      expect(task.id).toBeTruthy();
      expect(task.status).toBe("pending");

      // 4. Grant file permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      const hasPermission = await fileSandbox.hasPermission(
        team.id,
        path.join(TEST_SANDBOX_ROOT, "sales-report.xlsx"),
        "WRITE"
      );
      expect(hasPermission).toBe(true);

      // 5. Find best skill
      const matchResult = await skillRegistry.findBestSkill({
        type: "office",
        operation: "createExcel",
        input: task.input,
      });

      expect(matchResult).toBeDefined();
      expect(matchResult.skill).toBeDefined();
      expect(matchResult.score).toBeGreaterThanOrEqual(80);

      // 6. Execute task with skill
      const executionResult = await skillRegistry.autoExecute({
        type: "office",
        operation: "createExcel",
        input: task.input,
      });

      expect(executionResult.success).toBe(true);
      expect(executionResult.result).toBeDefined();
      expect(executionResult.result.filePath).toBe(task.input.outputPath);

      // Verify file was created
      const fileExists = await fs.pathExists(task.input.outputPath);
      expect(fileExists).toBe(true);

      // 7. Update task status
      const updatedTask = await teammateTool.updateTaskStatus(
        task.id,
        "completed",
        { result: executionResult.result }
      );

      expect(updatedTask.status).toBe("completed");
      expect(updatedTask.result).toBeDefined();

      // 8. Verify metrics were recorded
      const metrics = await teammateTool.getMetrics(team.id);
      expect(metrics).toBeDefined();
      expect(metrics.tasksCompleted).toBe(1);
      expect(metrics.successRate).toBe(100);

      // 9. Verify audit log
      const auditLogs = await fileSandbox.getAuditLog({
        teamId: team.id,
        limit: 10,
      });

      expect(auditLogs.logs.length).toBeGreaterThan(0);
      const writeLog = auditLogs.logs.find(
        (log) => log.operation === "WRITE" && log.success === true
      );
      expect(writeLog).toBeDefined();
    });

    test("should execute workflow with multiple agents and task distribution", async () => {
      // 1. Create team with multiple agents
      const team = await teammateTool.spawnTeam("Multi-Agent Team", {
        maxAgents: 3,
        autoAssignTasks: true,
      });

      // 2. Add multiple agents with different capabilities
      const agent1 = await teammateTool.addAgent(team.id, {
        name: "Excel Agent",
        role: "data-analyst",
        capabilities: ["excel"],
      });

      const agent2 = await teammateTool.addAgent(team.id, {
        name: "Word Agent",
        role: "document-writer",
        capabilities: ["word"],
      });

      const agent3 = await teammateTool.addAgent(team.id, {
        name: "PowerPoint Agent",
        role: "presenter",
        capabilities: ["powerpoint"],
      });

      expect(team.members.length).toBe(3);

      // 3. Grant file permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      // 4. Assign multiple tasks
      const task1 = await teammateTool.assignTask(team.id, {
        description: "Create Excel report",
        type: "office",
        input: {
          operation: "createExcel",
          outputPath: path.join(TEST_SANDBOX_ROOT, "multi-agent-report.xlsx"),
          sheetName: "Data",
          columns: [{ header: "Name", key: "name" }],
          rows: [{ name: "Test" }],
        },
      });

      const task2 = await teammateTool.assignTask(team.id, {
        description: "Create Word document",
        type: "office",
        input: {
          operation: "createWord",
          outputPath: path.join(TEST_SANDBOX_ROOT, "multi-agent-doc.docx"),
          title: "Test Document",
          sections: [{ heading: "Introduction", content: "Test content" }],
        },
      });

      const task3 = await teammateTool.assignTask(team.id, {
        description: "Create PowerPoint presentation",
        type: "office",
        input: {
          operation: "createPowerPoint",
          outputPath: path.join(TEST_SANDBOX_ROOT, "multi-agent-ppt.pptx"),
          title: "Test Presentation",
          slides: [{ title: "Slide 1", content: ["Point 1"] }],
        },
      });

      // 5. Execute all tasks
      const results = await Promise.all([
        skillRegistry.autoExecute(task1.input),
        skillRegistry.autoExecute(task2.input),
        skillRegistry.autoExecute(task3.input),
      ]);

      // 6. Verify all tasks completed successfully
      expect(results.every((r) => r.success)).toBe(true);

      // Verify all files exist
      const filesExist = await Promise.all([
        fs.pathExists(task1.input.outputPath),
        fs.pathExists(task2.input.outputPath),
        fs.pathExists(task3.input.outputPath),
      ]);
      expect(filesExist.every((exists) => exists)).toBe(true);

      // 7. Update all task statuses
      await Promise.all([
        teammateTool.updateTaskStatus(task1.id, "completed", { result: results[0].result }),
        teammateTool.updateTaskStatus(task2.id, "completed", { result: results[1].result }),
        teammateTool.updateTaskStatus(task3.id, "completed", { result: results[2].result }),
      ]);

      // 8. Verify team metrics
      const metrics = await teammateTool.getMetrics(team.id);
      expect(metrics.tasksCompleted).toBe(3);
      expect(metrics.successRate).toBe(100);
    });

    test("should handle task failure and retry", async () => {
      // 1. Create team
      const team = await teammateTool.spawnTeam("Retry Test Team");

      // 2. Add agent
      await teammateTool.addAgent(team.id, {
        name: "Test Agent",
        role: "tester",
        capabilities: ["testing"],
      });

      // 3. Assign task with invalid input (will fail)
      const task = await teammateTool.assignTask(team.id, {
        description: "Invalid task",
        type: "office",
        input: {
          operation: "createExcel",
          outputPath: "/invalid/path/that/does/not/exist/file.xlsx",
          sheetName: "Data",
          columns: [{ header: "Col1", key: "col1" }],
          rows: [{ col1: "data" }],
        },
      });

      // 4. Try to execute (should fail)
      const executionResult = await skillRegistry.autoExecute(task.input);
      expect(executionResult.success).toBe(false);

      // 5. Update task status to failed
      await teammateTool.updateTaskStatus(task.id, "failed", {
        error: executionResult.error,
      });

      // 6. Create valid task (retry with correct path)
      const validTask = await teammateTool.assignTask(team.id, {
        description: "Valid retry task",
        type: "office",
        input: {
          operation: "createExcel",
          outputPath: path.join(TEST_SANDBOX_ROOT, "retry-success.xlsx"),
          sheetName: "Data",
          columns: [{ header: "Col1", key: "col1" }],
          rows: [{ col1: "data" }],
        },
      });

      // 7. Grant permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      // 8. Execute successfully
      const validResult = await skillRegistry.autoExecute(validTask.input);
      expect(validResult.success).toBe(true);

      // 9. Verify metrics show both failure and success
      const metrics = await teammateTool.getMetrics(team.id);
      expect(metrics.tasksCompleted).toBe(1);
      expect(metrics.tasksFailed).toBe(1);
      expect(metrics.successRate).toBe(50); // 1 success / 2 total
    });
  });

  // ==========================================
  // Orchestrator Integration Tests
  // ==========================================

  describe("Orchestrator Decision Making", () => {
    test("should choose single agent for simple task", async () => {
      const decision = await orchestrator.shouldUseSingleAgent({
        description: "Create a simple Excel file",
        type: "office",
        estimatedComplexity: 20,
      });

      expect(decision.useSingleAgent).toBe(true);
      expect(decision.reason).toContain("Simple");
      expect(decision.confidence).toBeGreaterThan(0.7);
    });

    test("should choose multi-agent for complex task", async () => {
      const decision = await orchestrator.shouldUseSingleAgent({
        description: "Generate comprehensive quarterly report with data analysis, visualizations, and executive summary across multiple documents",
        type: "office",
        estimatedComplexity: 90,
        requiresParallelization: true,
      });

      expect(decision.useSingleAgent).toBe(false);
      expect(decision.reason).toContain("Complex");
      expect(decision.confidence).toBeGreaterThan(0.7);
    });

    test("should execute task with orchestrator recommendation", async () => {
      // Create team
      const team = await teammateTool.spawnTeam("Orchestrated Team", {
        maxAgents: 3,
      });

      // Add agents
      await teammateTool.addAgent(team.id, {
        name: "Agent 1",
        capabilities: ["excel"],
      });

      // Simple task - should use single agent
      const simpleTask = {
        description: "Create simple Excel file",
        type: "office",
        estimatedComplexity: 25,
        input: {
          operation: "createExcel",
          outputPath: path.join(TEST_SANDBOX_ROOT, "simple.xlsx"),
          sheetName: "Data",
          columns: [{ header: "Col1", key: "col1" }],
          rows: [{ col1: "data" }],
        },
      };

      const decision = await orchestrator.shouldUseSingleAgent(simpleTask);
      expect(decision.useSingleAgent).toBe(true);

      // Grant permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      // Assign and execute
      const task = await teammateTool.assignTask(team.id, simpleTask);
      const result = await skillRegistry.autoExecute(task.input);

      expect(result.success).toBe(true);

      // Verify single agent was used (task assigned to one agent)
      const taskDetails = await teammateTool.getTask(task.id);
      expect(taskDetails.assignedTo).toBeDefined();
      expect(Array.isArray(taskDetails.assignedTo) ? taskDetails.assignedTo.length : 1).toBe(1);
    });
  });

  // ==========================================
  // Long-Running Task Integration Tests
  // ==========================================

  describe("Long-Running Task Management", () => {
    test("should handle long-running task with checkpoints", async () => {
      // Create a task that will create multiple files (simulate long-running)
      const taskConfig = {
        id: `task-${Date.now()}`,
        name: "Batch Excel Generation",
        description: "Generate 5 Excel files",
        maxRetries: 3,
        timeout: 60000,
        checkpointInterval: 2000,
        execute: async (context) => {
          const results = [];
          for (let i = 0; i < 5; i++) {
            // Simulate work
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Create file
            const filePath = path.join(TEST_SANDBOX_ROOT, `batch-${i}.xlsx`);
            const result = await skillRegistry.autoExecute({
              operation: "createExcel",
              outputPath: filePath,
              sheetName: `Sheet ${i}`,
              columns: [{ header: "Index", key: "index" }],
              rows: [{ index: i }],
            });

            results.push(result);

            // Update progress
            context.updateProgress((i + 1) / 5);
          }
          return { results, count: results.length };
        },
      };

      // Create task
      const task = await taskManager.createTask(taskConfig);
      expect(task.id).toBe(taskConfig.id);

      // Start task
      const executePromise = taskManager.startTask(task.id);

      // Wait a bit for checkpoints to be created
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get checkpoints
      const checkpoints = await taskManager.getCheckpoints(task.id);
      expect(checkpoints.length).toBeGreaterThan(0);

      // Wait for completion
      await executePromise;

      // Get final task status
      const finalTask = await taskManager.getTask(task.id);
      expect(finalTask.status).toBe("completed");
      expect(finalTask.result.count).toBe(5);
      expect(finalTask.progress).toBe(1);

      // Verify all files were created
      for (let i = 0; i < 5; i++) {
        const fileExists = await fs.pathExists(
          path.join(TEST_SANDBOX_ROOT, `batch-${i}.xlsx`)
        );
        expect(fileExists).toBe(true);
      }
    });

    test("should recover from checkpoint after failure", async () => {
      let attemptCount = 0;

      const taskConfig = {
        id: `task-recovery-${Date.now()}`,
        name: "Task with Recovery",
        description: "Fails first time, succeeds on retry",
        maxRetries: 2,
        timeout: 30000,
        execute: async (context) => {
          attemptCount++;

          if (attemptCount === 1) {
            // First attempt fails
            await new Promise((resolve) => setTimeout(resolve, 500));
            throw new Error("Simulated failure");
          } else {
            // Second attempt succeeds
            context.updateProgress(0.5);
            await new Promise((resolve) => setTimeout(resolve, 500));
            context.updateProgress(1.0);
            return { success: true, attempts: attemptCount };
          }
        },
      };

      // Create and start task
      await taskManager.createTask(taskConfig);

      try {
        await taskManager.startTask(taskConfig.id);
      } catch (error) {
        // First attempt will fail, that's expected
      }

      // Get task after failure
      const taskAfterFailure = await taskManager.getTask(taskConfig.id);
      expect(taskAfterFailure.status).toBe("failed");
      expect(taskAfterFailure.error).toBeDefined();

      // Retry task
      await taskManager.retryTask(taskConfig.id);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get final task status
      const finalTask = await taskManager.getTask(taskConfig.id);
      expect(finalTask.status).toBe("completed");
      expect(finalTask.result.success).toBe(true);
      expect(finalTask.result.attempts).toBe(2);
    });
  });

  // ==========================================
  // File Sandbox Integration Tests
  // ==========================================

  describe("File Sandbox Permission Flows", () => {
    test("should block access without permission", async () => {
      // Create team
      const team = await teammateTool.spawnTeam("Restricted Team");

      // Try to access file without permission
      const filePath = path.join(TEST_SANDBOX_ROOT, "restricted.xlsx");
      const hasPermission = await fileSandbox.hasPermission(team.id, filePath, "READ");

      expect(hasPermission).toBe(false);

      // Validate access (should fail)
      const validation = await fileSandbox.validateAccess(team.id, filePath, "READ");
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toBe("insufficient_permission");
    });

    test("should grant and revoke permissions", async () => {
      // Create team
      const team = await teammateTool.spawnTeam("Permission Test Team");

      const testPath = path.join(TEST_SANDBOX_ROOT, "permission-test.xlsx");

      // Initially no permission
      expect(await fileSandbox.hasPermission(team.id, testPath, "WRITE")).toBe(false);

      // Grant permission
      await fileSandbox.grantPermission(team.id, TEST_SANDBOX_ROOT, ["READ", "WRITE"]);

      // Now has permission
      expect(await fileSandbox.hasPermission(team.id, testPath, "WRITE")).toBe(true);
      expect(await fileSandbox.hasPermission(team.id, testPath, "READ")).toBe(true);

      // Revoke WRITE permission
      await fileSandbox.revokePermission(team.id, TEST_SANDBOX_ROOT, ["WRITE"]);

      // Still has READ, but not WRITE
      expect(await fileSandbox.hasPermission(team.id, testPath, "READ")).toBe(true);
      expect(await fileSandbox.hasPermission(team.id, testPath, "WRITE")).toBe(false);

      // Revoke all
      await fileSandbox.revokePermission(team.id, TEST_SANDBOX_ROOT, ["READ", "EXECUTE"]);

      // No permissions
      expect(await fileSandbox.hasPermission(team.id, testPath, "READ")).toBe(false);
    });

    test("should detect and block sensitive paths", async () => {
      const team = await teammateTool.spawnTeam("Security Test Team");

      // Test sensitive paths
      const sensitivePaths = [
        "/home/user/.env",
        "/app/config/credentials.json",
        "/root/.ssh/id_rsa",
        "/etc/secrets.json",
        "/app/.npmrc",
      ];

      for (const sensitivePath of sensitivePaths) {
        const isSensitive = fileSandbox.isSensitivePath(sensitivePath);
        expect(isSensitive).toBe(true);

        // Even if we grant permission, sensitive paths should be blocked
        await fileSandbox.grantPermission(team.id, "/", ["READ", "WRITE"]);

        const validation = await fileSandbox.validateAccess(team.id, sensitivePath, "READ");
        expect(validation.allowed).toBe(false);
        expect(validation.reason).toBe("sensitive_file");
      }
    });

    test("should log all file operations in audit log", async () => {
      const team = await teammateTool.spawnTeam("Audit Test Team");

      // Grant permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      // Perform operations
      const testFile = path.join(TEST_SANDBOX_ROOT, "audit-test.xlsx");

      // Simulate file write
      await fileSandbox.recordAuditLog({
        teamId: team.id,
        operation: "WRITE",
        path: testFile,
        success: true,
        metadata: { fileSize: 1024 },
      });

      // Simulate file read
      await fileSandbox.recordAuditLog({
        teamId: team.id,
        operation: "READ",
        path: testFile,
        success: true,
      });

      // Get audit logs
      const auditResult = await fileSandbox.getAuditLog({
        teamId: team.id,
        limit: 10,
      });

      expect(auditResult.logs.length).toBeGreaterThanOrEqual(2);

      const writeLog = auditResult.logs.find(
        (log) => log.operation === "WRITE" && log.path === testFile
      );
      expect(writeLog).toBeDefined();
      expect(writeLog.success).toBe(true);

      const readLog = auditResult.logs.find(
        (log) => log.operation === "READ" && log.path === testFile
      );
      expect(readLog).toBeDefined();
      expect(readLog.success).toBe(true);
    });
  });

  // ==========================================
  // Error Handling Tests
  // ==========================================

  describe("Error Handling and Recovery", () => {
    test("should handle database errors gracefully", async () => {
      // Close database to simulate error
      db.close();

      // Try to create team (should fail)
      await expect(
        teammateTool.spawnTeam("Error Test Team")
      ).rejects.toThrow();

      // Reopen database
      await db.initialize();

      // Now should work
      const team = await teammateTool.spawnTeam("Recovery Test Team");
      expect(team).toBeDefined();
    });

    test("should handle concurrent operations", async () => {
      // Create multiple teams concurrently
      const teamPromises = Array.from({ length: 5 }, (_, i) =>
        teammateTool.spawnTeam(`Concurrent Team ${i}`)
      );

      const teams = await Promise.all(teamPromises);

      // All teams should be created
      expect(teams.length).toBe(5);
      expect(teams.every((t) => t.id && t.status === "active")).toBe(true);

      // All teams should be unique
      const uniqueIds = new Set(teams.map((t) => t.id));
      expect(uniqueIds.size).toBe(5);
    });

    test("should clean up resources when team is disbanded", async () => {
      // Create team with agents and tasks
      const team = await teammateTool.spawnTeam("Cleanup Test Team");

      const agent = await teammateTool.addAgent(team.id, {
        name: "Test Agent",
        capabilities: ["testing"],
      });

      const task = await teammateTool.assignTask(team.id, {
        description: "Test task",
        type: "testing",
      });

      // Verify resources exist
      expect(team.members.length).toBe(1);
      expect(team.tasks.length).toBe(1);

      // Disband team
      const result = await teammateTool.disbandTeam(team.id);
      expect(result.success).toBe(true);

      // Verify team is archived
      const teams = await teammateTool.listTeams({ includeArchived: true });
      const archivedTeam = teams.find((t) => t.id === team.id);
      expect(archivedTeam.status).toBe("archived");

      // Verify agents are removed
      const removedAgent = await teammateTool.getAgent(agent.id);
      expect(removedAgent.status).toBe("removed");
    });
  });

  // ==========================================
  // Performance Tests
  // ==========================================

  describe("Performance and Scalability", () => {
    test("should handle team with many agents efficiently", async () => {
      const startTime = Date.now();

      // Create team with 50 agents
      const team = await teammateTool.spawnTeam("Large Team", {
        maxAgents: 50,
      });

      const agentPromises = Array.from({ length: 50 }, (_, i) =>
        teammateTool.addAgent(team.id, {
          name: `Agent ${i}`,
          capabilities: [`skill-${i % 10}`],
        })
      );

      await Promise.all(agentPromises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Verify all agents were added
      const teamDetails = await teammateTool.getTeam(team.id);
      expect(teamDetails.members.length).toBe(50);
    });

    test("should handle many concurrent tasks efficiently", async () => {
      const team = await teammateTool.spawnTeam("Concurrent Task Team", {
        maxAgents: 10,
      });

      // Add 10 agents
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          teammateTool.addAgent(team.id, {
            name: `Agent ${i}`,
            capabilities: ["office"],
          })
        )
      );

      // Grant permissions
      await fileSandbox.grantPermission(
        team.id,
        TEST_SANDBOX_ROOT,
        ["READ", "WRITE"],
        { remember: true }
      );

      const startTime = Date.now();

      // Assign 20 tasks concurrently
      const taskPromises = Array.from({ length: 20 }, (_, i) =>
        teammateTool.assignTask(team.id, {
          description: `Task ${i}`,
          type: "office",
          input: {
            operation: "createExcel",
            outputPath: path.join(TEST_SANDBOX_ROOT, `concurrent-${i}.xlsx`),
            sheetName: "Data",
            columns: [{ header: "Index", key: "index" }],
            rows: [{ index: i }],
          },
        })
      );

      const tasks = await Promise.all(taskPromises);

      // Execute all tasks
      const executionPromises = tasks.map((task) =>
        skillRegistry.autoExecute(task.input)
      );

      const results = await Promise.all(executionPromises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All tasks should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Should complete in reasonable time (< 10 seconds)
      expect(duration).toBeLessThan(10000);

      // Verify all files were created
      const fileChecks = await Promise.all(
        tasks.map((task) => fs.pathExists(task.input.outputPath))
      );
      expect(fileChecks.every((exists) => exists)).toBe(true);
    });
  });
});
