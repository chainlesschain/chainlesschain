/**
 * Cowork Performance Benchmark Suite
 *
 * Benchmarks critical operations and identifies performance bottlenecks.
 * Includes baseline measurements for regression detection.
 *
 * Run with: npm run benchmark:cowork
 *
 * @category Benchmarks
 * @module CoworkPerformance
 */

const Benchmark = require("benchmark");
const path = require("path");
const fs = require("fs-extra");
const Database = require("../../../database");
const TeammateTool = require("../../teammate-tool");
const FileSandbox = require("../../file-sandbox");
const LongRunningTaskManager = require("../../long-running-task-manager");
const SkillRegistry = require("../../skills/skill-registry");
const OfficeSkill = require("../../skills/office-skill");
const CoworkOrchestrator = require("../../cowork-orchestrator");

// Test configuration
const TEST_DB_PATH = path.join(__dirname, "../../../../../../../data/benchmark-cowork.db");
const TEST_SANDBOX_ROOT = path.join(__dirname, "../../../../../../../data/benchmark-sandbox");
const TEST_KEY = "test-encryption-key-32-chars!!!";

// Performance baselines (in ms)
const BASELINES = {
  teamCreation: 50,
  agentCreation: 30,
  taskAssignment: 40,
  permissionCheck: 5,
  permissionGrant: 20,
  auditLogWrite: 10,
  skillMatching: 15,
  simpleTaskExecution: 200,
  decisionMaking: 25,
  messageB roadcast: 30,
  resultMerging: 20,
};

// Global test fixtures
let db;
let teammateTool;
let fileSandbox;
let taskManager;
let skillRegistry;
let orchestrator;

// ==========================================
// Setup & Teardown
// ==========================================

async function setupBenchmark() {
  // Clean up from previous runs
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  if (fs.existsSync(TEST_SANDBOX_ROOT)) {
    fs.removeSync(TEST_SANDBOX_ROOT);
  }

  // Initialize database
  db = new Database(TEST_DB_PATH, TEST_KEY);
  await db.open();

  // Initialize components
  teammateTool = new TeammateTool(db);
  fileSandbox = new FileSandbox(db);
  taskManager = new LongRunningTaskManager(db);
  skillRegistry = new SkillRegistry();
  orchestrator = new CoworkOrchestrator(db, teammateTool);

  // Register skills
  const officeSkill = new OfficeSkill();
  skillRegistry.registerSkill(officeSkill);

  // Create sandbox root
  await fs.ensureDir(TEST_SANDBOX_ROOT);

  console.log("\n=== Cowork Performance Benchmark Suite ===\n");
  console.log("Baselines (expected performance in ms):");
  for (const [operation, baseline] of Object.entries(BASELINES)) {
    console.log(`  ${operation}: ${baseline}ms`);
  }
  console.log("\n");
}

async function teardownBenchmark() {
  // Cleanup
  if (db) {
    await db.close();
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  if (fs.existsSync(TEST_SANDBOX_ROOT)) {
    fs.removeSync(TEST_SANDBOX_ROOT);
  }
}

// ==========================================
// Benchmark Suites
// ==========================================

/**
 * Team Operations Benchmarks
 */
async function benchmarkTeamOperations() {
  const suite = new Benchmark.Suite("Team Operations");

  let teamCounter = 0;
  let testTeam = null;
  let agentCounter = 0;

  suite
    .add("Team Creation", {
      defer: true,
      fn: async (deferred) => {
        await teammateTool.spawnTeam(`Benchmark Team ${teamCounter++}`);
        deferred.resolve();
      },
    })
    .add("Agent Creation", {
      defer: true,
      setup: async () => {
        testTeam = await teammateTool.spawnTeam("Agent Benchmark Team");
      },
      fn: async (deferred) => {
        await teammateTool.addAgent(testTeam.id, {
          name: `Agent ${agentCounter++}`,
          capabilities: ["benchmark"],
        });
        deferred.resolve();
      },
    })
    .add("Task Assignment", {
      defer: true,
      setup: async () => {
        if (!testTeam) {
          testTeam = await teammateTool.spawnTeam("Task Benchmark Team");
        }
      },
      fn: async (deferred) => {
        await teammateTool.assignTask(testTeam.id, {
          description: "Benchmark task",
          type: "benchmark",
        });
        deferred.resolve();
      },
    })
    .add("Get Team Metrics", {
      defer: true,
      setup: async () => {
        if (!testTeam) {
          testTeam = await teammateTool.spawnTeam("Metrics Benchmark Team");
        }
      },
      fn: async (deferred) => {
        await teammateTool.getMetrics(testTeam.id);
        deferred.resolve();
      },
    })
    .add("List Teams", {
      defer: true,
      fn: async (deferred) => {
        await teammateTool.listTeams();
        deferred.resolve();
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * File Sandbox Benchmarks
 */
async function benchmarkFileSandbox() {
  const suite = new Benchmark.Suite("File Sandbox Operations");

  let team = null;
  let permissionCounter = 0;

  suite
    .add("Permission Check", {
      defer: true,
      setup: async () => {
        team = await teammateTool.spawnTeam("Permission Benchmark Team");
        await fileSandbox.grantPermission(team.id, TEST_SANDBOX_ROOT, ["READ", "WRITE"]);
      },
      fn: async (deferred) => {
        await fileSandbox.hasPermission(
          team.id,
          path.join(TEST_SANDBOX_ROOT, "test.txt"),
          "READ"
        );
        deferred.resolve();
      },
    })
    .add("Permission Grant", {
      defer: true,
      setup: async () => {
        team = await teammateTool.spawnTeam("Grant Benchmark Team");
      },
      fn: async (deferred) => {
        await fileSandbox.grantPermission(
          team.id,
          path.join(TEST_SANDBOX_ROOT, `dir-${permissionCounter++}`),
          ["READ"]
        );
        deferred.resolve();
      },
    })
    .add("Audit Log Write", {
      defer: true,
      setup: async () => {
        if (!team) {
          team = await teammateTool.spawnTeam("Audit Benchmark Team");
        }
      },
      fn: async (deferred) => {
        await fileSandbox.recordAuditLog({
          teamId: team.id,
          operation: "READ",
          path: path.join(TEST_SANDBOX_ROOT, "test.txt"),
          success: true,
        });
        deferred.resolve();
      },
    })
    .add("Audit Log Query", {
      defer: true,
      setup: async () => {
        if (!team) {
          team = await teammateTool.spawnTeam("Audit Query Team");
        }
        // Pre-populate with 100 logs
        for (let i = 0; i < 100; i++) {
          await fileSandbox.recordAuditLog({
            teamId: team.id,
            operation: "READ",
            path: path.join(TEST_SANDBOX_ROOT, `file-${i}.txt`),
            success: true,
          });
        }
      },
      fn: async (deferred) => {
        await fileSandbox.getAuditLog({
          teamId: team.id,
          limit: 10,
        });
        deferred.resolve();
      },
    })
    .add("Validate Access", {
      defer: true,
      setup: async () => {
        if (!team) {
          team = await teammateTool.spawnTeam("Validate Access Team");
        }
        await fileSandbox.grantPermission(team.id, TEST_SANDBOX_ROOT, ["READ", "WRITE"]);
      },
      fn: async (deferred) => {
        await fileSandbox.validateAccess(
          team.id,
          path.join(TEST_SANDBOX_ROOT, "test.txt"),
          "WRITE"
        );
        deferred.resolve();
      },
    })
    .add("Sensitive Path Check", {
      defer: false,
      fn: () => {
        fileSandbox.isSensitivePath("/home/user/.env");
        fileSandbox.isSensitivePath("/app/config/database.json");
        fileSandbox.isSensitivePath("/normal/file.txt");
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * Skill Registry Benchmarks
 */
async function benchmarkSkillRegistry() {
  const suite = new Benchmark.Suite("Skill Registry Operations");

  suite
    .add("Skill Matching", {
      defer: true,
      fn: async (deferred) => {
        await skillRegistry.findBestSkill({
          type: "office",
          operation: "createExcel",
        });
        deferred.resolve();
      },
    })
    .add("Get All Skills", {
      defer: false,
      fn: () => {
        skillRegistry.getAllSkills();
      },
    })
    .add("Get Skills By Type", {
      defer: false,
      fn: () => {
        skillRegistry.getSkillsByType("office");
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * Task Execution Benchmarks
 */
async function benchmarkTaskExecution() {
  const suite = new Benchmark.Suite("Task Execution");

  let team = null;

  suite
    .add("Simple Excel Creation", {
      defer: true,
      setup: async () => {
        team = await teammateTool.spawnTeam("Excel Benchmark Team");
        await fileSandbox.grantPermission(team.id, TEST_SANDBOX_ROOT, ["READ", "WRITE"]);
      },
      fn: async (deferred) => {
        const result = await skillRegistry.autoExecute({
          operation: "createExcel",
          outputPath: path.join(TEST_SANDBOX_ROOT, `bench-${Date.now()}.xlsx`),
          sheetName: "Data",
          columns: [{ header: "Col1", key: "col1" }],
          rows: [{ col1: "data" }],
        });
        deferred.resolve();
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * Orchestrator Benchmarks
 */
async function benchmarkOrchestrator() {
  const suite = new Benchmark.Suite("Orchestrator Operations");

  suite
    .add("Decision Making (Simple Task)", {
      defer: true,
      fn: async (deferred) => {
        await orchestrator.shouldUseSingleAgent({
          description: "Simple task",
          type: "office",
          estimatedComplexity: 20,
        });
        deferred.resolve();
      },
    })
    .add("Decision Making (Complex Task)", {
      defer: true,
      fn: async (deferred) => {
        await orchestrator.shouldUseSingleAgent({
          description: "Complex multi-step task requiring coordination",
          type: "office",
          estimatedComplexity: 85,
          requiresParallelization: true,
        });
        deferred.resolve();
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * Collaboration Benchmarks
 */
async function benchmarkCollaboration() {
  const suite = new Benchmark.Suite("Collaboration Operations");

  let team = null;
  let agents = [];

  suite
    .add("Message Broadcast", {
      defer: true,
      setup: async () => {
        team = await teammateTool.spawnTeam("Broadcast Benchmark Team");
        // Add 10 agents
        agents = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            teammateTool.addAgent(team.id, { name: `Agent ${i}` })
          )
        );
      },
      fn: async (deferred) => {
        await teammateTool.broadcastMessage(team.id, {
          from: agents[0].id,
          content: "Benchmark message",
          type: "info",
        });
        deferred.resolve();
      },
    })
    .add("Result Merging (Aggregate)", {
      defer: true,
      setup: async () => {
        if (!team) {
          team = await teammateTool.spawnTeam("Merge Benchmark Team");
        }
      },
      fn: async (deferred) => {
        const results = Array.from({ length: 10 }, (_, i) => ({
          agentId: `agent-${i}`,
          data: { value: i * 10 },
        }));

        await teammateTool.mergeResults(team.id, results, "aggregate");
        deferred.resolve();
      },
    })
    .add("Result Merging (Vote)", {
      defer: true,
      setup: async () => {
        if (!team) {
          team = await teammateTool.spawnTeam("Vote Benchmark Team");
        }
      },
      fn: async (deferred) => {
        const results = Array.from({ length: 10 }, (_, i) => ({
          agentId: `agent-${i}`,
          classification: i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C",
        }));

        await teammateTool.mergeResults(team.id, results, "vote");
        deferred.resolve();
      },
    })
    .on("cycle", (event) => {
      const benchmark = event.target;
      const meanTime = (benchmark.stats.mean * 1000).toFixed(2);
      const opsPerSec = benchmark.hz.toFixed(0);
      const baseline = BASELINES[benchmark.name.replace(/ /g, "")];
      const status = baseline && meanTime > baseline ? "⚠️" : "✓";

      console.log(`  ${status} ${benchmark.name}: ${meanTime}ms (${opsPerSec} ops/sec)`);
      if (baseline) {
        console.log(`    Baseline: ${baseline}ms | Deviation: ${(meanTime - baseline).toFixed(2)}ms`);
      }
    })
    .on("complete", function () {
      console.log("\n");
    });

  return suite;
}

/**
 * Scalability Benchmarks
 */
async function benchmarkScalability() {
  console.log("=== Scalability Benchmarks ===\n");

  // Test 1: Many Teams
  console.log("Test 1: Creating 100 teams...");
  const startTeams = Date.now();
  const teamPromises = Array.from({ length: 100 }, (_, i) =>
    teammateTool.spawnTeam(`Scale Team ${i}`)
  );
  const teams = await Promise.all(teamPromises);
  const teamsTime = Date.now() - startTeams;
  console.log(`  ✓ Created 100 teams in ${teamsTime}ms (${(teamsTime / 100).toFixed(2)}ms per team)\n`);

  // Test 2: Many Agents per Team
  console.log("Test 2: Adding 50 agents to a team...");
  const testTeam = teams[0];
  const startAgents = Date.now();
  const agentPromises = Array.from({ length: 50 }, (_, i) =>
    teammateTool.addAgent(testTeam.id, {
      name: `Agent ${i}`,
      capabilities: [`skill-${i % 10}`],
    })
  );
  await Promise.all(agentPromises);
  const agentsTime = Date.now() - startAgents;
  console.log(`  ✓ Added 50 agents in ${agentsTime}ms (${(agentsTime / 50).toFixed(2)}ms per agent)\n`);

  // Test 3: Many Tasks
  console.log("Test 3: Assigning 100 tasks...");
  const startTasks = Date.now();
  const taskPromises = Array.from({ length: 100 }, (_, i) =>
    teammateTool.assignTask(testTeam.id, {
      description: `Task ${i}`,
      type: "benchmark",
    })
  );
  await Promise.all(taskPromises);
  const tasksTime = Date.now() - startTasks;
  console.log(`  ✓ Assigned 100 tasks in ${tasksTime}ms (${(tasksTime / 100).toFixed(2)}ms per task)\n`);

  // Test 4: Many Permission Checks
  console.log("Test 4: Performing 1000 permission checks...");
  const startPerms = Date.now();
  const permChecks = Array.from({ length: 1000 }, (_, i) =>
    fileSandbox.hasPermission(
      testTeam.id,
      path.join(TEST_SANDBOX_ROOT, `file-${i}.txt`),
      "READ"
    )
  );
  await Promise.all(permChecks);
  const permsTime = Date.now() - startPerms;
  console.log(`  ✓ Performed 1000 permission checks in ${permsTime}ms (${(permsTime / 1000).toFixed(2)}ms per check)\n`);

  // Test 5: Many Audit Logs
  console.log("Test 5: Writing 1000 audit logs...");
  const startAudit = Date.now();
  const auditPromises = Array.from({ length: 1000 }, (_, i) =>
    fileSandbox.recordAuditLog({
      teamId: testTeam.id,
      operation: i % 2 === 0 ? "READ" : "WRITE",
      path: path.join(TEST_SANDBOX_ROOT, `file-${i}.txt`),
      success: true,
    })
  );
  await Promise.all(auditPromises);
  const auditTime = Date.now() - startAudit;
  console.log(`  ✓ Wrote 1000 audit logs in ${auditTime}ms (${(auditTime / 1000).toFixed(2)}ms per log)\n`);

  // Cleanup
  console.log("Cleaning up...");
  for (const team of teams) {
    await teammateTool.disbandTeam(team.id);
  }
  console.log("  ✓ Cleanup complete\n");
}

/**
 * Memory Usage Analysis
 */
async function analyzeMemoryUsage() {
  console.log("=== Memory Usage Analysis ===\n");

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Baseline memory
  if (global.gc) {
    global.gc();
  }
  const baselineMemory = process.memoryUsage();
  console.log("Baseline Memory:");
  console.log(`  Heap Used: ${formatBytes(baselineMemory.heapUsed)}`);
  console.log(`  Heap Total: ${formatBytes(baselineMemory.heapTotal)}`);
  console.log(`  RSS: ${formatBytes(baselineMemory.rss)}\n`);

  // Create 100 teams with 10 agents each
  console.log("Creating 100 teams with 10 agents each...");
  const teams = [];
  for (let i = 0; i < 100; i++) {
    const team = await teammateTool.spawnTeam(`Memory Test Team ${i}`);
    teams.push(team);

    for (let j = 0; j < 10; j++) {
      await teammateTool.addAgent(team.id, {
        name: `Agent ${j}`,
        capabilities: ["test"],
      });
    }
  }

  const afterTeamsMemory = process.memoryUsage();
  console.log("\nAfter creating teams:");
  console.log(`  Heap Used: ${formatBytes(afterTeamsMemory.heapUsed)}`);
  console.log(`  Heap Increase: ${formatBytes(afterTeamsMemory.heapUsed - baselineMemory.heapUsed)}`);
  console.log(`  Per Team: ${formatBytes((afterTeamsMemory.heapUsed - baselineMemory.heapUsed) / 100)}\n`);

  // Cleanup teams
  console.log("Cleaning up teams...");
  for (const team of teams) {
    await teammateTool.disbandTeam(team.id);
  }

  if (global.gc) {
    global.gc();
  }

  const afterCleanupMemory = process.memoryUsage();
  console.log("\nAfter cleanup:");
  console.log(`  Heap Used: ${formatBytes(afterCleanupMemory.heapUsed)}`);
  console.log(`  Memory Freed: ${formatBytes(afterTeamsMemory.heapUsed - afterCleanupMemory.heapUsed)}\n`);
}

// ==========================================
// Main Benchmark Runner
// ==========================================

async function runBenchmarks() {
  try {
    await setupBenchmark();

    // Run benchmark suites
    const teamSuite = await benchmarkTeamOperations();
    const fileSuite = await benchmarkFileSandbox();
    const skillSuite = await benchmarkSkillRegistry();
    const taskSuite = await benchmarkTaskExecution();
    const orchestratorSuite = await benchmarkOrchestrator();
    const collabSuite = await benchmarkCollaboration();

    // Run all suites
    console.log("=== Running Benchmarks ===\n");

    await new Promise((resolve) => teamSuite.run({ async: true }));
    await new Promise((resolve) => {
      teamSuite.on("complete", resolve);
    });

    await new Promise((resolve) => fileSuite.run({ async: true }));
    await new Promise((resolve) => {
      fileSuite.on("complete", resolve);
    });

    await new Promise((resolve) => skillSuite.run({ async: true }));
    await new Promise((resolve) => {
      skillSuite.on("complete", resolve);
    });

    await new Promise((resolve) => taskSuite.run({ async: true }));
    await new Promise((resolve) => {
      taskSuite.on("complete", resolve);
    });

    await new Promise((resolve) => orchestratorSuite.run({ async: true }));
    await new Promise((resolve) => {
      orchestratorSuite.on("complete", resolve);
    });

    await new Promise((resolve) => collabSuite.run({ async: true }));
    await new Promise((resolve) => {
      collabSuite.on("complete", resolve);
    });

    // Run scalability benchmarks
    await benchmarkScalability();

    // Run memory analysis
    await analyzeMemoryUsage();

    console.log("\n=== Benchmark Complete ===\n");

    await teardownBenchmark();
    process.exit(0);
  } catch (error) {
    console.error("Benchmark failed:", error);
    await teardownBenchmark();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runBenchmarks();
}

module.exports = {
  setupBenchmark,
  teardownBenchmark,
  benchmarkTeamOperations,
  benchmarkFileSandbox,
  benchmarkSkillRegistry,
  benchmarkTaskExecution,
  benchmarkOrchestrator,
  benchmarkCollaboration,
  benchmarkScalability,
  analyzeMemoryUsage,
};
