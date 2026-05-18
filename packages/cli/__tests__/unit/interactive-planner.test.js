/**
 * Unit tests for CLIInteractivePlanner
 *
 * Tests plan generation, user response handling, skill recommendation,
 * quality evaluation, session management, and cleanup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CLIInteractivePlanner,
  PlanSessionStatus,
} from "../../src/lib/interactive-planner.js";

/** Default LLM plan response */
const MOCK_PLAN = {
  title: "Refactor API",
  description: "Refactor the REST API layer",
  complexity: "medium",
  steps: [
    {
      title: "Read existing code",
      description: "Analyze current API structure",
      tool: "read_file",
      impact: "low",
    },
    {
      title: "Write new endpoint",
      description: "Create improved handler",
      tool: "write_file",
      impact: "medium",
    },
    {
      title: "Run tests",
      description: "Validate changes",
      tool: "run_shell",
      impact: "low",
    },
  ],
};

/** Create a mock llmChat function that returns a JSON plan */
function mockLlmChat(plan = MOCK_PLAN) {
  return vi.fn().mockResolvedValue({
    message: { content: JSON.stringify(plan) },
  });
}

/** Create a mock skillLoader */
function mockSkillLoader(skills = []) {
  return {
    getResolvedSkills: vi.fn().mockReturnValue(skills),
  };
}

/** Create a mock interaction adapter */
function mockInteraction() {
  return {
    askInput: vi.fn().mockResolvedValue("yes"),
    askSelect: vi.fn().mockResolvedValue("confirm"),
  };
}

describe("CLIInteractivePlanner", () => {
  let llmChat;
  let interaction;

  beforeEach(() => {
    llmChat = mockLlmChat();
    interaction = mockInteraction();
  });

  // ─── Constructor ────────────────────────────────────────────────────

  it("constructor sets dependencies", () => {
    const skillLoader = mockSkillLoader();
    const db = {};
    const planner = new CLIInteractivePlanner({
      llmChat,
      db,
      skillLoader,
      interaction,
    });

    expect(planner.llmChat).toBe(llmChat);
    expect(planner.db).toBe(db);
    expect(planner.skillLoader).toBe(skillLoader);
    expect(planner.interaction).toBe(interaction);
    expect(planner.sessions).toBeInstanceOf(Map);
  });

  // ─── startPlanSession ──────────────────────────────────────────────

  it("startPlanSession generates plan via LLM", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const result = await planner.startPlanSession("Refactor the API");

    expect(llmChat).toHaveBeenCalled();
    expect(result.plan).toBeDefined();
    expect(result.plan.overview.title).toBe("Refactor API");
  });

  it("startPlanSession returns sessionId and plan", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const result = await planner.startPlanSession("Build a feature");

    expect(result.sessionId).toMatch(/^plan-/);
    expect(result.status).toBe(PlanSessionStatus.AWAITING_CONFIRMATION);
    expect(result.plan).toBeDefined();
    expect(result.plan.overview).toBeDefined();
    expect(result.plan.steps).toBeInstanceOf(Array);
    expect(result.plan.steps.length).toBe(3);
    expect(result.message).toBeTruthy();
  });

  it("startPlanSession recommends skills", async () => {
    const skillLoader = mockSkillLoader([
      {
        id: "code-review",
        description: "Review code quality",
        category: "code",
      },
      { id: "refactor", description: "Refactor code", category: "code" },
      { id: "deploy-app", description: "Deploy application", category: "ops" },
    ]);
    const planner = new CLIInteractivePlanner({
      llmChat,
      skillLoader,
      interaction,
    });

    const result = await planner.startPlanSession("Refactor the API");

    // "refactor" skill should be recommended due to keyword match
    expect(result.plan.recommendations.skills.length).toBeGreaterThan(0);
  });

  it("startPlanSession handles LLM failure", async () => {
    const failingLlm = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const planner = new CLIInteractivePlanner({
      llmChat: failingLlm,
      interaction,
    });

    const result = await planner.startPlanSession("Do something");

    expect(result.status).toBe(PlanSessionStatus.FAILED);
    expect(result.plan).toBeNull();
    expect(result.message).toContain("Failed to generate plan");
  });

  it("startPlanSession emits plan-generated event", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const events = [];
    planner.on("plan-generated", (e) => events.push(e));

    await planner.startPlanSession("Build feature");

    expect(events.length).toBe(1);
    expect(events[0].sessionId).toMatch(/^plan-/);
    expect(events[0].planPresentation).toBeDefined();
  });

  // ─── handleUserResponse ────────────────────────────────────────────

  it("handleUserResponse confirm executes plan", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const { sessionId } = await planner.startPlanSession("Build feature");

    const result = await planner.handleUserResponse(sessionId, {
      action: "confirm",
    });

    expect(result.status).toBe(PlanSessionStatus.COMPLETED);
    expect(result.result).toBeDefined();
    expect(result.result.success).toBe(true);
    expect(result.result.stepsCompleted).toBe(3);
    expect(result.qualityScore).toBeDefined();
  });

  it("handleUserResponse adjust modifies plan", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const { sessionId } = await planner.startPlanSession("Build feature");

    const result = await planner.handleUserResponse(sessionId, {
      action: "adjust",
      adjustments: { title: "Updated Plan Title" },
    });

    expect(result.status).toBe(PlanSessionStatus.AWAITING_CONFIRMATION);
    expect(result.plan.overview.title).toBe("Updated Plan Title");
    expect(result.message).toContain("adjusted");
  });

  it("handleUserResponse regenerate calls LLM again", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const { sessionId } = await planner.startPlanSession("Build feature");

    expect(llmChat).toHaveBeenCalledTimes(1);

    const result = await planner.handleUserResponse(sessionId, {
      action: "regenerate",
      feedback: "Make it simpler",
    });

    expect(llmChat).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(PlanSessionStatus.AWAITING_CONFIRMATION);
    expect(result.plan).toBeDefined();
    expect(result.message).toContain("regenerated");
  });

  it("handleUserResponse cancel sets cancelled status", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const { sessionId } = await planner.startPlanSession("Build feature");

    const result = await planner.handleUserResponse(sessionId, {
      action: "cancel",
    });

    expect(result.status).toBe(PlanSessionStatus.CANCELLED);
    expect(result.message).toContain("cancelled");
  });

  it("handleUserResponse returns error for unknown session", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const result = await planner.handleUserResponse("nonexistent-id", {
      action: "confirm",
    });

    expect(result.error).toContain("Session not found");
  });

  // ─── recommendSkills ───────────────────────────────────────────────

  it("recommendSkills returns scored skills", () => {
    const skillLoader = mockSkillLoader([
      {
        id: "code-review",
        description: "Review code for quality",
        category: "code",
      },
      {
        id: "refactor",
        description: "Automated refactoring",
        category: "code",
      },
      {
        id: "weather",
        description: "Check weather forecast",
        category: "utility",
      },
    ]);
    const planner = new CLIInteractivePlanner({
      llmChat,
      skillLoader,
      interaction,
    });

    const results = planner.recommendSkills("refactor the code", MOCK_PLAN);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("id");
    expect(results[0]).toHaveProperty("score");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("recommendSkills returns empty when no skillLoader", () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const results = planner.recommendSkills("refactor code", MOCK_PLAN);

    expect(results).toEqual([]);
  });

  // ─── evaluateQuality ───────────────────────────────────────────────

  it("evaluateQuality returns score and grade", () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const session = {
      executionResult: {
        success: true,
        stepsCompleted: 3,
        totalSteps: 3,
        errors: [],
      },
      executionStartedAt: Date.now() - 5000,
      completedAt: Date.now(),
    };

    const quality = planner.evaluateQuality(session);

    expect(quality).toBeDefined();
    expect(quality.totalScore).toBeGreaterThan(0);
    expect(quality.maxScore).toBe(100);
    expect(quality.percentage).toBeGreaterThanOrEqual(90);
    expect(quality.grade).toBe("A");
  });

  it("evaluateQuality handles missing execution result", () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const result = planner.evaluateQuality({ executionResult: null });

    expect(result).toBeNull();
  });

  // ─── formatPlanForUser ─────────────────────────────────────────────

  it("formatPlanForUser returns overview and steps", () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const session = {
      taskPlan: MOCK_PLAN,
      recommendedSkills: [],
    };

    const formatted = planner.formatPlanForUser(session);

    expect(formatted.overview).toBeDefined();
    expect(formatted.overview.title).toBe("Refactor API");
    expect(formatted.overview.stepCount).toBe(3);
    expect(formatted.steps).toHaveLength(3);
    expect(formatted.steps[0].step).toBe(1);
    expect(formatted.steps[0].title).toBe("Read existing code");
    expect(formatted.recommendations).toBeDefined();
  });

  // ─── getSession ────────────────────────────────────────────────────

  it("getSession returns session by id", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });
    const { sessionId } = await planner.startPlanSession("Test");

    const session = planner.getSession(sessionId);

    expect(session).toBeDefined();
    expect(session.id).toBe(sessionId);
    expect(session.userRequest).toBe("Test");
  });

  it("getSession returns null for unknown", () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const session = planner.getSession("does-not-exist");

    expect(session).toBeNull();
  });

  // ─── cleanupExpiredSessions ────────────────────────────────────────

  it("cleanupExpiredSessions removes old sessions", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    // Create and complete a session
    const { sessionId } = await planner.startPlanSession("Old task");
    await planner.handleUserResponse(sessionId, { action: "cancel" });

    // Artificially age the session
    const session = planner.getSession(sessionId);
    session.createdAt = Date.now() - 7200000; // 2 hours ago

    const cleaned = planner.cleanupExpiredSessions(3600000); // 1 hour max age

    expect(cleaned).toBe(1);
    expect(planner.getSession(sessionId)).toBeNull();
  });

  it("cleanupExpiredSessions keeps active sessions", async () => {
    const planner = new CLIInteractivePlanner({ llmChat, interaction });

    const { sessionId } = await planner.startPlanSession("Active task");

    // Session is AWAITING_CONFIRMATION (not completed/cancelled/failed)
    const session = planner.getSession(sessionId);
    session.createdAt = Date.now() - 7200000; // 2 hours ago

    const cleaned = planner.cleanupExpiredSessions(3600000);

    expect(cleaned).toBe(0);
    expect(planner.getSession(sessionId)).toBeDefined();
  });
});
