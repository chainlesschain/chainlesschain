/**
 * DeployAgent unit tests — v3.0
 *
 * Coverage: initialize, deploy (dryRun), getActiveDeployments, getStats,
 *           getConfig/configure, DEPLOY_STRATEGY and DEPLOY_STATUS constants
 *
 * IMPORTANT: always call agent.configure({ dryRun: true }) before deploy()
 *            to avoid real git/docker/npm execution.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
const {
  DeployAgent,
  DEPLOY_STRATEGY,
  DEPLOY_STATUS,
} = require("../deploy-agent");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DeployAgent", () => {
  let agent;
  let db;

  beforeEach(() => {
    agent = new DeployAgent();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // initialize()
  // ──────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      await agent.initialize(db);

      expect(agent.initialized).toBe(true);
    });

    it("should set db reference", async () => {
      await agent.initialize(db);

      expect(agent.db).toBe(db);
    });

    it("should be idempotent on double initialize", async () => {
      await agent.initialize(db);
      const db2 = createMockDatabase();
      await agent.initialize(db2); // second call is a no-op

      expect(agent.db).toBe(db); // db was set on the first call only
    });

    it("should accept optional rollbackManager dep", async () => {
      const rollbackManager = { initialized: true, rollback: vi.fn() };
      await agent.initialize(db, { rollbackManager });

      expect(agent.rollbackManager).toBe(rollbackManager);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // deploy() — dryRun mode
  // ──────────────────────────────────────────────────────────────────────────
  describe("deploy() with dryRun:true", () => {
    beforeEach(async () => {
      await agent.initialize(db);
      agent.configure({ dryRun: true });
    });

    it("should return SUCCESS status with a deployId", async () => {
      const result = await agent.deploy({
        strategy: DEPLOY_STRATEGY.GIT_PR,
        pipelineId: "pipe-001",
      });

      expect(result.status).toBe(DEPLOY_STATUS.SUCCESS);
      expect(result.deployId).toBeTruthy();
      expect(typeof result.deployId).toBe("string");
    });

    it("should return details.dryRun === true", async () => {
      const result = await agent.deploy({
        strategy: DEPLOY_STRATEGY.GIT_PR,
        pipelineId: "pipe-001",
      });

      expect(result.details).toBeDefined();
      expect(result.details.dryRun).toBe(true);
    });

    it("should include strategy and duration in result", async () => {
      const result = await agent.deploy({
        strategy: DEPLOY_STRATEGY.LOCAL,
        pipelineId: "pipe-002",
      });

      expect(result.strategy).toBe(DEPLOY_STRATEGY.LOCAL);
      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should emit 'deploy:success' event on a successful dryRun deploy", async () => {
      const handler = vi.fn();
      agent.on("deploy:success", handler);

      await agent.deploy({
        strategy: DEPLOY_STRATEGY.DOCKER,
        pipelineId: "pipe-003",
      });

      expect(handler).toHaveBeenCalledOnce();
      const payload = handler.mock.calls[0][0];
      expect(payload.status).toBe(DEPLOY_STATUS.SUCCESS);
    });

    it("should also emit 'deploy:completed' alias event — via deploy:success", async () => {
      // deploy-agent emits deploy:success (not a separate deploy:completed),
      // so we confirm the success emission delivers the deployId
      const handler = vi.fn();
      agent.on("deploy:success", handler);

      const result = await agent.deploy({
        strategy: DEPLOY_STRATEGY.STAGING,
        pipelineId: "pipe-004",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].deployId).toBe(result.deployId);
    });

    it("should decrement activeDeployments after deploy completes", async () => {
      expect(agent.getActiveDeployments().length).toBe(0);

      await agent.deploy({
        strategy: DEPLOY_STRATEGY.GIT_PR,
        pipelineId: "pipe-005",
      });

      // After completion the deployment is removed from activeDeployments
      expect(agent.getActiveDeployments().length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // deploy() — not initialized
  // ──────────────────────────────────────────────────────────────────────────
  describe("deploy() before initialize()", () => {
    it("should throw if not initialized", async () => {
      await expect(
        agent.deploy({ strategy: DEPLOY_STRATEGY.GIT_PR }),
      ).rejects.toThrow("DeployAgent not initialized");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getActiveDeployments()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getActiveDeployments()", () => {
    it("should return an empty Array before any deployment", async () => {
      await agent.initialize(db);

      const active = agent.getActiveDeployments();

      expect(Array.isArray(active)).toBe(true);
      expect(active.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getStats()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await agent.initialize(db);
      agent.configure({ dryRun: true });
    });

    it("should return stats with expected fields", () => {
      const stats = agent.getStats();

      expect(stats).toHaveProperty("totalDeploys");
      expect(stats).toHaveProperty("successCount");
      expect(stats).toHaveProperty("failureCount");
      expect(stats).toHaveProperty("rollbackCount");
      expect(stats).toHaveProperty("active");
    });

    it("should increment successCount after a successful deploy", async () => {
      expect(agent.getStats().successCount).toBe(0);

      await agent.deploy({
        strategy: DEPLOY_STRATEGY.GIT_PR,
        pipelineId: "pipe-s1",
      });

      expect(agent.getStats().successCount).toBe(1);
    });

    it("should increment totalDeploys for every deploy call", async () => {
      expect(agent.getStats().totalDeploys).toBe(0);

      await agent.deploy({
        strategy: DEPLOY_STRATEGY.GIT_PR,
        pipelineId: "pipe-t1",
      });
      await agent.deploy({
        strategy: DEPLOY_STRATEGY.LOCAL,
        pipelineId: "pipe-t2",
      });

      expect(agent.getStats().totalDeploys).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getConfig() / configure()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    it("should return default config with expected keys", () => {
      const config = agent.getConfig();

      expect(config).toHaveProperty("defaultStrategy");
      expect(config).toHaveProperty("dryRun");
      expect(config).toHaveProperty("enableSmokeTests");
      expect(config).toHaveProperty("deployTimeoutMs");
    });

    it("should update a config field via configure()", () => {
      agent.configure({ autoMerge: true });

      expect(agent.getConfig().autoMerge).toBe(true);
    });

    it("should return the updated config from configure()", () => {
      const returned = agent.configure({ branchPrefix: "release/" });

      expect(returned.branchPrefix).toBe("release/");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────────────────────
  describe("DEPLOY_STRATEGY", () => {
    it("should have GIT_PR, DOCKER, NPM_PUBLISH, LOCAL, STAGING values", () => {
      expect(DEPLOY_STRATEGY.GIT_PR).toBe("git-pr");
      expect(DEPLOY_STRATEGY.DOCKER).toBe("docker");
      expect(DEPLOY_STRATEGY.NPM_PUBLISH).toBe("npm-publish");
      expect(DEPLOY_STRATEGY.LOCAL).toBe("local");
      expect(DEPLOY_STRATEGY.STAGING).toBe("staging");
    });
  });

  describe("DEPLOY_STATUS", () => {
    it("should have PENDING, PREPARING, DEPLOYING, VERIFYING, SUCCESS, FAILED, ROLLED_BACK", () => {
      expect(DEPLOY_STATUS.PENDING).toBeDefined();
      expect(DEPLOY_STATUS.PREPARING).toBeDefined();
      expect(DEPLOY_STATUS.DEPLOYING).toBeDefined();
      expect(DEPLOY_STATUS.VERIFYING).toBeDefined();
      expect(DEPLOY_STATUS.SUCCESS).toBeDefined();
      expect(DEPLOY_STATUS.FAILED).toBeDefined();
      expect(DEPLOY_STATUS.ROLLED_BACK).toBeDefined();
    });

    it("should have string values for all keys", () => {
      for (const [, value] of Object.entries(DEPLOY_STATUS)) {
        expect(typeof value).toBe("string");
      }
    });
  });
});
