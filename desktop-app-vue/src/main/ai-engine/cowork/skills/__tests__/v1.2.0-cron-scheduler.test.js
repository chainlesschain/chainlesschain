/**
 * Unit tests for cron-scheduler skill handler (v1.2.0)
 * Timer-based handler - needs cleanup in afterEach
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/cron-scheduler/handler.js");

describe("cron-scheduler handler", () => {
  afterEach(async () => {
    // Clean up all scheduled jobs to prevent timer leaks
    try {
      const result = await handler.execute({ input: "list" }, {}, {});
      if (result && result.jobs) {
        for (const job of result.jobs) {
          try {
            await handler.execute({ input: `remove ${job.id}` }, {}, {});
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  });

  describe("execute() - add action", () => {
    it("should add a cron job", async () => {
      const result = await handler.execute(
        { input: 'add "*/5 * * * *" "echo hello"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("add");
      expect(result.jobId).toBeDefined();
    });

    it("should support natural language schedule", async () => {
      const result = await handler.execute(
        { input: 'add "every 10 minutes" "run backup"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.cron).toBeDefined();
    });

    it('should support "every hour" natural language', async () => {
      const result = await handler.execute(
        { input: 'add "every 1 hour" "check status"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });

    it('should support "every day" natural language', async () => {
      const result = await handler.execute(
        { input: 'add "every day at 9am" "run cleanup"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - list action", () => {
    it("should list all scheduled jobs", async () => {
      const result = await handler.execute({ input: "list" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.jobs).toBeDefined();
    });
  });

  describe("execute() - remove action", () => {
    it("should remove a job by id", async () => {
      const addResult = await handler.execute(
        { input: 'add "*/30 * * * *" "test task"' },
        {},
        {},
      );
      const jobId = addResult.jobId;
      expect(jobId).toBeDefined();

      const result = await handler.execute(
        { input: `remove ${jobId}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("remove");
    });
  });

  describe("execute() - pause/resume actions", () => {
    it("should pause and resume a job", async () => {
      const addResult = await handler.execute(
        { input: 'add "*/15 * * * *" "test"' },
        {},
        {},
      );
      const jobId = addResult.jobId;
      expect(jobId).toBeDefined();

      const pauseResult = await handler.execute(
        { input: `pause ${jobId}` },
        {},
        {},
      );
      expect(pauseResult.success).toBe(true);

      const resumeResult = await handler.execute(
        { input: `resume ${jobId}` },
        {},
        {},
      );
      expect(resumeResult.success).toBe(true);
    });
  });

  describe("execute() - status action", () => {
    it("should return job status", async () => {
      const addResult = await handler.execute(
        { input: 'add "*/5 * * * *" "check"' },
        {},
        {},
      );
      const jobId = addResult.jobId;

      const result = await handler.execute(
        { input: `status ${jobId}` },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to list on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });

    it("should default to list on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
    });
  });
});
