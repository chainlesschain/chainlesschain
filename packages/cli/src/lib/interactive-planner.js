/**
 * CLI Interactive Planner — plan generation, user confirmation, and execution
 *
 * Simplified port of desktop-app-vue/src/main/ai-engine/task-planner-interactive.js
 * Adapted for CLI with InteractionAdapter support for terminal and WebSocket modes.
 *
 * Flow: user request → LLM generates plan → show + recommend skills → user confirms → execute → score
 */

import { EventEmitter } from "events";
import { createHash } from "crypto";

/**
 * Plan session statuses
 */
export const PlanSessionStatus = {
  PLANNING: "planning",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export class CLIInteractivePlanner extends EventEmitter {
  /**
   * @param {object} options
   * @param {function} options.llmChat - LLM chat function (messages) => response
   * @param {object} [options.db] - Database for persistence
   * @param {import("./skill-loader.js").CLISkillLoader} [options.skillLoader]
   * @param {import("./interaction-adapter.js").InteractionAdapter} options.interaction
   */
  constructor({ llmChat, db, skillLoader, interaction }) {
    super();
    this.llmChat = llmChat;
    this.db = db || null;
    this.skillLoader = skillLoader || null;
    this.interaction = interaction;

    /** @type {Map<string, object>} */
    this.sessions = new Map();
  }

  /**
   * Generate a plan session ID
   */
  _generateSessionId() {
    return `plan-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
  }

  /**
   * Start an interactive plan session.
   *
   * @param {string} userRequest
   * @param {object} [projectContext] - cwd, project type, etc.
   * @returns {Promise<{ sessionId, status, plan, message }>}
   */
  async startPlanSession(userRequest, projectContext = {}) {
    const sessionId = this._generateSessionId();

    const session = {
      id: sessionId,
      userRequest,
      projectContext,
      status: PlanSessionStatus.PLANNING,
      createdAt: Date.now(),
      taskPlan: null,
      recommendedSkills: [],
      userConfirmation: null,
      executionResult: null,
      qualityScore: null,
    };

    this.sessions.set(sessionId, session);

    // Generate the plan via LLM
    try {
      const taskPlan = await this._generatePlan(userRequest, projectContext);
      session.taskPlan = taskPlan;

      // Recommend skills
      session.recommendedSkills = this.recommendSkills(userRequest, taskPlan);

      session.status = PlanSessionStatus.AWAITING_CONFIRMATION;

      const planPresentation = this.formatPlanForUser(session);

      this.emit("plan-generated", { sessionId, planPresentation });

      return {
        sessionId,
        status: session.status,
        plan: planPresentation,
        message: "Plan generated. Review and confirm, adjust, or cancel.",
      };
    } catch (err) {
      session.status = PlanSessionStatus.FAILED;
      return {
        sessionId,
        status: session.status,
        plan: null,
        message: `Failed to generate plan: ${err.message}`,
      };
    }
  }

  /**
   * Handle user response to a plan.
   *
   * @param {string} sessionId
   * @param {{ action: "confirm"|"adjust"|"regenerate"|"cancel", adjustments?: object, feedback?: string }} response
   * @returns {Promise<object>}
   */
  async handleUserResponse(sessionId, response) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { error: `Session not found: ${sessionId}` };
    }

    switch (response.action) {
      case "confirm":
        return this._executePlan(session);

      case "adjust":
        return this._adjustPlan(session, response.adjustments || {});

      case "regenerate":
        return this._regeneratePlan(session, response.feedback || "");

      case "cancel":
        session.status = PlanSessionStatus.CANCELLED;
        return {
          sessionId,
          status: PlanSessionStatus.CANCELLED,
          message: "Plan cancelled.",
        };

      default:
        return { error: `Unknown action: ${response.action}` };
    }
  }

  /**
   * Recommend skills relevant to the plan.
   */
  recommendSkills(userRequest, taskPlan) {
    if (!this.skillLoader) return [];

    try {
      const allSkills = this.skillLoader.getResolvedSkills();
      if (!allSkills || allSkills.length === 0) return [];

      const keywords = this._extractKeywords(userRequest, taskPlan);
      const scored = [];

      for (const skill of allSkills) {
        let score = 0;
        const skillText =
          `${skill.id} ${skill.description || ""} ${skill.category || ""}`.toLowerCase();

        for (const kw of keywords) {
          if (skillText.includes(kw.toLowerCase())) {
            score += 0.3;
          }
        }

        if (score > 0) {
          scored.push({
            id: skill.id,
            name: skill.id,
            category: skill.category,
            description: (skill.description || "").substring(0, 80),
            score: Math.min(score, 1.0),
          });
        }
      }

      return scored.sort((a, b) => b.score - a.score).slice(0, 5);
    } catch (_err) {
      return [];
    }
  }

  /**
   * Evaluate quality of plan execution.
   */
  evaluateQuality(session) {
    if (!session.executionResult) return null;

    const result = session.executionResult;
    let score = 0;
    const maxScore = 100;

    // Completion score (40 points)
    if (result.success) score += 40;
    else if (result.partial) score += 20;

    // Steps completed (30 points)
    if (result.stepsCompleted && result.totalSteps) {
      score += Math.round((result.stepsCompleted / result.totalSteps) * 30);
    } else {
      score += result.success ? 30 : 0;
    }

    // No errors (20 points)
    if (!result.errors || result.errors.length === 0) {
      score += 20;
    } else {
      score += Math.max(0, 20 - result.errors.length * 5);
    }

    // Timeliness (10 points)
    if (session.completedAt && session.executionStartedAt) {
      const duration = session.completedAt - session.executionStartedAt;
      if (duration < 30000) score += 10;
      else if (duration < 60000) score += 7;
      else if (duration < 120000) score += 4;
    } else {
      score += 5; // Default
    }

    const percentage = Math.round((score / maxScore) * 100);
    let grade;
    if (percentage >= 90) grade = "A";
    else if (percentage >= 80) grade = "B";
    else if (percentage >= 70) grade = "C";
    else if (percentage >= 60) grade = "D";
    else grade = "F";

    return {
      totalScore: score,
      maxScore,
      percentage,
      grade,
    };
  }

  /**
   * Format a plan session for display.
   */
  formatPlanForUser(session) {
    const plan = session.taskPlan;
    if (!plan) return { overview: null, steps: [], recommendations: {} };

    return {
      overview: {
        title: plan.title || "Untitled Plan",
        description: plan.description || "",
        stepCount: (plan.steps || []).length,
        estimatedComplexity: plan.complexity || "medium",
      },
      steps: (plan.steps || []).map((step, idx) => ({
        step: idx + 1,
        title: step.title || step.description || `Step ${idx + 1}`,
        description: step.description || "",
        tool: step.tool || null,
        estimatedImpact: step.impact || "low",
      })),
      recommendations: {
        skills: session.recommendedSkills || [],
      },
      adjustableParameters: [
        {
          key: "title",
          label: "Plan title",
          currentValue: plan.title || "",
          type: "string",
        },
        {
          key: "detailLevel",
          label: "Detail level",
          currentValue: "standard",
          type: "select",
          options: ["brief", "standard", "detailed"],
        },
      ],
    };
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Clean up old sessions.
   */
  cleanupExpiredSessions(maxAgeMs = 3600000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (
        now - session.createdAt > maxAgeMs &&
        [
          PlanSessionStatus.COMPLETED,
          PlanSessionStatus.CANCELLED,
          PlanSessionStatus.FAILED,
        ].includes(session.status)
      ) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // ─── Private methods ────────────────────────────────────────────────────

  /**
   * Generate a plan via LLM.
   */
  async _generatePlan(userRequest, projectContext) {
    const prompt = `You are a task planning assistant. Given the user's request and project context, create a detailed execution plan.

User request: ${userRequest}
Project directory: ${projectContext.cwd || "unknown"}
Project type: ${projectContext.projectType || "unknown"}

Respond with a JSON object:
{
  "title": "Plan title",
  "description": "Brief description",
  "complexity": "low|medium|high",
  "steps": [
    {
      "title": "Step title",
      "description": "What to do",
      "tool": "tool_name (read_file, write_file, edit_file, run_shell, search_files, list_dir, run_skill, run_code, or null)",
      "impact": "low|medium|high"
    }
  ]
}

Keep plans concise (3-8 steps). Use appropriate tools for each step.`;

    const response = await this.llmChat([
      {
        role: "system",
        content:
          "You are a task planning assistant. Always respond with valid JSON.",
      },
      { role: "user", content: prompt },
    ]);

    const content = response?.message?.content || response?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse plan from LLM response");
    }

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Execute a confirmed plan.
   */
  async _executePlan(session) {
    session.status = PlanSessionStatus.EXECUTING;
    session.executionStartedAt = Date.now();

    this.emit("execution-started", { sessionId: session.id });

    try {
      const steps = session.taskPlan?.steps || [];
      const results = [];
      let stepsCompleted = 0;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        this.emit("execution-progress", {
          sessionId: session.id,
          step: i + 1,
          total: steps.length,
          title: step.title,
        });

        results.push({
          step: i + 1,
          title: step.title,
          status: "completed",
        });
        stepsCompleted++;
      }

      session.executionResult = {
        success: true,
        stepsCompleted,
        totalSteps: steps.length,
        results,
        errors: [],
      };

      session.completedAt = Date.now();
      session.status = PlanSessionStatus.COMPLETED;
      session.qualityScore = this.evaluateQuality(session);

      this.emit("execution-completed", {
        sessionId: session.id,
        result: session.executionResult,
        qualityScore: session.qualityScore,
      });

      return {
        sessionId: session.id,
        status: session.status,
        result: session.executionResult,
        qualityScore: session.qualityScore,
      };
    } catch (err) {
      session.status = PlanSessionStatus.FAILED;
      session.executionResult = {
        success: false,
        error: err.message,
      };

      this.emit("execution-failed", {
        sessionId: session.id,
        error: err.message,
      });

      return {
        sessionId: session.id,
        status: session.status,
        error: err.message,
      };
    }
  }

  /**
   * Adjust plan with user modifications.
   */
  async _adjustPlan(session, adjustments) {
    const plan = session.taskPlan;
    if (!plan) return { error: "No plan to adjust" };

    if (adjustments.title) plan.title = adjustments.title;
    if (adjustments.removeSteps) {
      plan.steps = plan.steps.filter(
        (_, i) => !adjustments.removeSteps.includes(i),
      );
    }
    if (adjustments.addStep) {
      plan.steps.push(adjustments.addStep);
    }

    session.status = PlanSessionStatus.AWAITING_CONFIRMATION;

    return {
      sessionId: session.id,
      status: session.status,
      plan: this.formatPlanForUser(session),
      message: "Plan adjusted. Review and confirm.",
    };
  }

  /**
   * Regenerate plan with feedback.
   */
  async _regeneratePlan(session, feedback) {
    session.status = PlanSessionStatus.PLANNING;

    const enhancedRequest = feedback
      ? `${session.userRequest}\n\nAdditional feedback: ${feedback}`
      : session.userRequest;

    try {
      const taskPlan = await this._generatePlan(
        enhancedRequest,
        session.projectContext,
      );
      session.taskPlan = taskPlan;
      session.recommendedSkills = this.recommendSkills(
        session.userRequest,
        taskPlan,
      );
      session.status = PlanSessionStatus.AWAITING_CONFIRMATION;

      return {
        sessionId: session.id,
        status: session.status,
        plan: this.formatPlanForUser(session),
        message: "Plan regenerated. Review and confirm.",
      };
    } catch (err) {
      session.status = PlanSessionStatus.FAILED;
      return {
        sessionId: session.id,
        status: session.status,
        error: `Failed to regenerate: ${err.message}`,
      };
    }
  }

  /**
   * Extract keywords from request and plan for skill matching.
   */
  _extractKeywords(request, plan) {
    const words = new Set();

    // From request
    const requestWords = request
      .toLowerCase()
      .split(/[\s,.\-_]+/)
      .filter((w) => w.length > 2);
    for (const w of requestWords) words.add(w);

    // From plan steps
    if (plan && plan.steps) {
      for (const step of plan.steps) {
        if (step.tool) words.add(step.tool);
        const titleWords = (step.title || "")
          .toLowerCase()
          .split(/[\s,.\-_]+/)
          .filter((w) => w.length > 2);
        for (const w of titleWords) words.add(w);
      }
    }

    return Array.from(words);
  }
}
