/**
 * Shared background-agent phase vocabulary + grouping contract
 * (P0 state-machine slice). Pure, deterministic — the single source of truth
 * that separates `idle` (parked, nothing blocking) from a genuine
 * `needs-input` (a human decision blocks progress), used by both the worker/
 * supervisor and the REPL dashboard.
 */
import { describe, it, expect } from "vitest";
import {
  BACKGROUND_AGENT_PHASES,
  idlePhaseFor,
  normalizeBackgroundAgentPhase,
  phaseGroupKey,
} from "../../src/lib/background-agent-phase.js";

describe("normalizeBackgroundAgentPhase", () => {
  it("maps the legacy worker phases to canonical values", () => {
    // The worker has always emitted "turn" for a live turn — it must classify
    // exactly like the canonical "working".
    expect(normalizeBackgroundAgentPhase("turn")).toBe(
      BACKGROUND_AGENT_PHASES.WORKING,
    );
    expect(normalizeBackgroundAgentPhase("idle")).toBe(
      BACKGROUND_AGENT_PHASES.IDLE,
    );
  });

  it("accepts canonical, kebab and *_approval spellings", () => {
    for (const v of [
      "needs_input",
      "needs-input",
      "awaiting_input",
      "question",
    ]) {
      expect(normalizeBackgroundAgentPhase(v)).toBe(
        BACKGROUND_AGENT_PHASES.NEEDS_INPUT,
      );
    }
    for (const v of [
      "waiting_permission",
      "waiting-permission",
      "waiting_approval",
      "awaiting_approval",
    ]) {
      expect(normalizeBackgroundAgentPhase(v)).toBe(
        BACKGROUND_AGENT_PHASES.WAITING_PERMISSION,
      );
    }
    expect(normalizeBackgroundAgentPhase("starting")).toBe(
      BACKGROUND_AGENT_PHASES.STARTING,
    );
  });

  it("recognizes uncertain_side_effect (snake and kebab)", () => {
    for (const v of ["uncertain_side_effect", "uncertain-side-effect"]) {
      expect(normalizeBackgroundAgentPhase(v)).toBe(
        BACKGROUND_AGENT_PHASES.UNCERTAIN_SIDE_EFFECT,
      );
    }
  });

  it("is case/whitespace tolerant and null-safe for unknown/absent input", () => {
    expect(normalizeBackgroundAgentPhase("  IDLE  ")).toBe(
      BACKGROUND_AGENT_PHASES.IDLE,
    );
    expect(normalizeBackgroundAgentPhase("bogus")).toBeNull();
    expect(normalizeBackgroundAgentPhase("")).toBeNull();
    expect(normalizeBackgroundAgentPhase(null)).toBeNull();
    expect(normalizeBackgroundAgentPhase(undefined)).toBeNull();
    expect(normalizeBackgroundAgentPhase(42)).toBeNull();
  });
});

describe("phaseGroupKey", () => {
  it("splits a live turn (working) from a parked idle session (idle)", () => {
    expect(phaseGroupKey({ status: "running", phase: "turn" })).toBe("working");
    expect(phaseGroupKey({ status: "running", phase: "working" })).toBe(
      "working",
    );
    expect(phaseGroupKey({ status: "running", phase: "starting" })).toBe(
      "working",
    );
    // The core fix: idle is NOT needs-input.
    expect(phaseGroupKey({ status: "running", phase: "idle" })).toBe("idle");
  });

  it("routes blocking phases to needs-input", () => {
    expect(phaseGroupKey({ status: "running", phase: "needs_input" })).toBe(
      "needs-input",
    );
    expect(
      phaseGroupKey({ status: "running", phase: "waiting_permission" }),
    ).toBe("needs-input");
    // UNKNOWN-outcome side effects on resume demand a look before replay.
    expect(
      phaseGroupKey({ status: "running", phase: "uncertain_side_effect" }),
    ).toBe("needs-input");
  });

  it("lets a pending approval override the phase label", () => {
    // Even a session the worker last marked idle is blocked when an approval
    // is genuinely pending.
    expect(
      phaseGroupKey({ status: "running", phase: "idle", pendingApprovals: 1 }),
    ).toBe("needs-input");
    expect(
      phaseGroupKey({ status: "running", phase: "turn", pendingApprovals: 3 }),
    ).toBe("needs-input");
    // Zero / absent approvals do not force needs-input.
    expect(
      phaseGroupKey({ status: "running", phase: "idle", pendingApprovals: 0 }),
    ).toBe("idle");
  });

  it("treats an unknown or missing running phase as working (never idle)", () => {
    expect(phaseGroupKey({ status: "running", phase: "bogus" })).toBe(
      "working",
    );
    expect(phaseGroupKey({ status: "running" })).toBe("working");
  });

  it("idlePhaseFor keeps needs_input while a parked question is unanswered", () => {
    // The worker's between-turns merge uses this rule: an unanswered
    // ask_user_question must not demote the session to Idle.
    expect(idlePhaseFor({ pendingQuestion: { question: "Deploy?" } })).toBe(
      BACKGROUND_AGENT_PHASES.NEEDS_INPUT,
    );
    expect(idlePhaseFor({ pendingQuestion: null })).toBe(
      BACKGROUND_AGENT_PHASES.IDLE,
    );
    expect(idlePhaseFor({})).toBe(BACKGROUND_AGENT_PHASES.IDLE);
    expect(idlePhaseFor(null)).toBe(BACKGROUND_AGENT_PHASES.IDLE);
  });

  it("maps terminal statuses to their own groups; lost/unknown → failed", () => {
    expect(phaseGroupKey({ status: "completed" })).toBe("completed");
    expect(phaseGroupKey({ status: "stopped" })).toBe("stopped");
    expect(phaseGroupKey({ status: "failed" })).toBe("failed");
    expect(phaseGroupKey({ status: "lost" })).toBe("failed");
    expect(phaseGroupKey({ status: "weird" })).toBe("failed");
    expect(phaseGroupKey(null)).toBe("failed");
    expect(phaseGroupKey(undefined)).toBe("failed");
  });
});
