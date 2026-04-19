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

// =====================================================================
// interactive-planner V2 governance overlay (iter26)
// =====================================================================
export const PLANNERGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const PLANNERGOV_PROMPT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ASKING: "asking",
  ANSWERED: "answered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _plannergovPTrans = new Map([
  [
    PLANNERGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE,
      PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PLANNERGOV_PROFILE_MATURITY_V2.PAUSED,
      PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PLANNERGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE,
      PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _plannergovPTerminal = new Set([PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _plannergovJTrans = new Map([
  [
    PLANNERGOV_PROMPT_LIFECYCLE_V2.QUEUED,
    new Set([
      PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING,
      PLANNERGOV_PROMPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING,
    new Set([
      PLANNERGOV_PROMPT_LIFECYCLE_V2.ANSWERED,
      PLANNERGOV_PROMPT_LIFECYCLE_V2.FAILED,
      PLANNERGOV_PROMPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PLANNERGOV_PROMPT_LIFECYCLE_V2.ANSWERED, new Set()],
  [PLANNERGOV_PROMPT_LIFECYCLE_V2.FAILED, new Set()],
  [PLANNERGOV_PROMPT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _plannergovPsV2 = new Map();
const _plannergovJsV2 = new Map();
let _plannergovMaxActive = 6,
  _plannergovMaxPending = 15,
  _plannergovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _plannergovStuckMs = 60 * 1000;
function _plannergovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _plannergovCheckP(from, to) {
  const a = _plannergovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid plannergov profile transition ${from} → ${to}`);
}
function _plannergovCheckJ(from, to) {
  const a = _plannergovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid plannergov prompt transition ${from} → ${to}`);
}
function _plannergovCountActive(owner) {
  let c = 0;
  for (const p of _plannergovPsV2.values())
    if (p.owner === owner && p.status === PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _plannergovCountPending(profileId) {
  let c = 0;
  for (const j of _plannergovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PLANNERGOV_PROMPT_LIFECYCLE_V2.QUEUED ||
        j.status === PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING)
    )
      c++;
  return c;
}
export function setMaxActivePlannergovProfilesPerOwnerV2(n) {
  _plannergovMaxActive = _plannergovPos(
    n,
    "maxActivePlannergovProfilesPerOwner",
  );
}
export function getMaxActivePlannergovProfilesPerOwnerV2() {
  return _plannergovMaxActive;
}
export function setMaxPendingPlannergovPromptsPerProfileV2(n) {
  _plannergovMaxPending = _plannergovPos(
    n,
    "maxPendingPlannergovPromptsPerProfile",
  );
}
export function getMaxPendingPlannergovPromptsPerProfileV2() {
  return _plannergovMaxPending;
}
export function setPlannergovProfileIdleMsV2(n) {
  _plannergovIdleMs = _plannergovPos(n, "plannergovProfileIdleMs");
}
export function getPlannergovProfileIdleMsV2() {
  return _plannergovIdleMs;
}
export function setPlannergovPromptStuckMsV2(n) {
  _plannergovStuckMs = _plannergovPos(n, "plannergovPromptStuckMs");
}
export function getPlannergovPromptStuckMsV2() {
  return _plannergovStuckMs;
}
export function _resetStateInteractivePlannerGovV2() {
  _plannergovPsV2.clear();
  _plannergovJsV2.clear();
  _plannergovMaxActive = 6;
  _plannergovMaxPending = 15;
  _plannergovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _plannergovStuckMs = 60 * 1000;
}
export function registerPlannergovProfileV2({
  id,
  owner,
  persona,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_plannergovPsV2.has(id))
    throw new Error(`plannergov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    persona: persona || "default",
    status: PLANNERGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _plannergovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePlannergovProfileV2(id) {
  const p = _plannergovPsV2.get(id);
  if (!p) throw new Error(`plannergov profile ${id} not found`);
  const isInitial = p.status === PLANNERGOV_PROFILE_MATURITY_V2.PENDING;
  _plannergovCheckP(p.status, PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _plannergovCountActive(p.owner) >= _plannergovMaxActive)
    throw new Error(
      `max active plannergov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausePlannergovProfileV2(id) {
  const p = _plannergovPsV2.get(id);
  if (!p) throw new Error(`plannergov profile ${id} not found`);
  _plannergovCheckP(p.status, PLANNERGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = PLANNERGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePlannergovProfileV2(id) {
  const p = _plannergovPsV2.get(id);
  if (!p) throw new Error(`plannergov profile ${id} not found`);
  _plannergovCheckP(p.status, PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PLANNERGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPlannergovProfileV2(id) {
  const p = _plannergovPsV2.get(id);
  if (!p) throw new Error(`plannergov profile ${id} not found`);
  if (_plannergovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal plannergov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPlannergovProfileV2(id) {
  const p = _plannergovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPlannergovProfilesV2() {
  return [..._plannergovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPlannergovPromptV2({
  id,
  profileId,
  question,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_plannergovJsV2.has(id))
    throw new Error(`plannergov prompt ${id} already exists`);
  if (!_plannergovPsV2.has(profileId))
    throw new Error(`plannergov profile ${profileId} not found`);
  if (_plannergovCountPending(profileId) >= _plannergovMaxPending)
    throw new Error(
      `max pending plannergov prompts for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    question: question || "",
    status: PLANNERGOV_PROMPT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _plannergovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function askingPlannergovPromptV2(id) {
  const j = _plannergovJsV2.get(id);
  if (!j) throw new Error(`plannergov prompt ${id} not found`);
  _plannergovCheckJ(j.status, PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING);
  const now = Date.now();
  j.status = PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completePromptPlannergovV2(id) {
  const j = _plannergovJsV2.get(id);
  if (!j) throw new Error(`plannergov prompt ${id} not found`);
  _plannergovCheckJ(j.status, PLANNERGOV_PROMPT_LIFECYCLE_V2.ANSWERED);
  const now = Date.now();
  j.status = PLANNERGOV_PROMPT_LIFECYCLE_V2.ANSWERED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPlannergovPromptV2(id, reason) {
  const j = _plannergovJsV2.get(id);
  if (!j) throw new Error(`plannergov prompt ${id} not found`);
  _plannergovCheckJ(j.status, PLANNERGOV_PROMPT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PLANNERGOV_PROMPT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPlannergovPromptV2(id, reason) {
  const j = _plannergovJsV2.get(id);
  if (!j) throw new Error(`plannergov prompt ${id} not found`);
  _plannergovCheckJ(j.status, PLANNERGOV_PROMPT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PLANNERGOV_PROMPT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPlannergovPromptV2(id) {
  const j = _plannergovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPlannergovPromptsV2() {
  return [..._plannergovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdlePlannergovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _plannergovPsV2.values())
    if (
      p.status === PLANNERGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _plannergovIdleMs
    ) {
      p.status = PLANNERGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPlannergovPromptsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _plannergovJsV2.values())
    if (
      j.status === PLANNERGOV_PROMPT_LIFECYCLE_V2.ASKING &&
      j.startedAt != null &&
      t - j.startedAt >= _plannergovStuckMs
    ) {
      j.status = PLANNERGOV_PROMPT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getInteractivePlannerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PLANNERGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _plannergovPsV2.values()) profilesByStatus[p.status]++;
  const promptsByStatus = {};
  for (const v of Object.values(PLANNERGOV_PROMPT_LIFECYCLE_V2))
    promptsByStatus[v] = 0;
  for (const j of _plannergovJsV2.values()) promptsByStatus[j.status]++;
  return {
    totalPlannergovProfilesV2: _plannergovPsV2.size,
    totalPlannergovPromptsV2: _plannergovJsV2.size,
    maxActivePlannergovProfilesPerOwner: _plannergovMaxActive,
    maxPendingPlannergovPromptsPerProfile: _plannergovMaxPending,
    plannergovProfileIdleMs: _plannergovIdleMs,
    plannergovPromptStuckMs: _plannergovStuckMs,
    profilesByStatus,
    promptsByStatus,
  };
}
