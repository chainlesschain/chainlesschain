import { describe, expect, it } from "vitest";
import {
  buildEvolutionReviewRequest,
  buildEvolutionRollbackRequest,
  validateEvolutionWorkbenchResponse,
} from "./evolution-workbench-utils.js";
import EvolutionWorkbenchDrawer from "./EvolutionWorkbenchDrawer.vue";

const digest = (character) => `sha256:${character.repeat(64)}`;

function candidate({ id, packetCharacter, contentCharacter, status, active }) {
  return {
    candidateId: id,
    packetDigest: digest(packetCharacter),
    candidateContentDigest: digest(contentCharacter),
    status,
    actualUsage: { active },
  };
}

const active = candidate({
  id: "active",
  packetCharacter: "1",
  contentCharacter: "2",
  status: "approved",
  active: true,
});
const target = candidate({
  id: "target",
  packetCharacter: "3",
  contentCharacter: "4",
  status: "approved",
  active: false,
});
const pending = candidate({
  id: "pending",
  packetCharacter: "5",
  contentCharacter: "6",
  status: "pending",
  active: false,
});
const governance = {
  runStatus: "active",
  activeReleaseId: null,
  lastKnownGoodReleaseId: null,
  conflictCount: 0,
  pilot: null,
};

describe("Evolution Workbench renderer boundary", () => {
  it("compiles the Desktop reviewer surface", () => {
    expect(EvolutionWorkbenchDrawer).toMatchObject({
      __name: "EvolutionWorkbenchDrawer",
    });
  });

  it("accepts a bounded digest-addressed projection", () => {
    const result = {
      projectionDigest: digest("a"),
      governance: {
        runStatus: "active",
        activeReleaseId: digest("b"),
        lastKnownGoodReleaseId: digest("c"),
        conflictCount: 1,
        pilot: {
          stage: "canary",
          revision: 4,
          killSwitch: false,
          reconciliationRequired: true,
        },
      },
      candidates: [active, target, pending],
    };

    expect(validateEvolutionWorkbenchResponse({ success: true, result })).toBe(
      result,
    );
  });

  it("rejects forged projection and candidate digests", () => {
    expect(() =>
      validateEvolutionWorkbenchResponse({
        success: true,
        result: { projectionDigest: "forged", candidates: [] },
      }),
    ).toThrow(/projection is invalid/u);
    expect(() =>
      validateEvolutionWorkbenchResponse({
        success: true,
        result: {
          projectionDigest: digest("a"),
          governance,
          candidates: [{ ...pending, packetDigest: "forged" }],
        },
      }),
    ).toThrow(/candidate is invalid/u);
    expect(() =>
      validateEvolutionWorkbenchResponse({
        success: true,
        result: {
          projectionDigest: digest("a"),
          governance: {
            runStatus: "active",
            activeReleaseId: null,
            lastKnownGoodReleaseId: null,
            conflictCount: 0,
            pilot: { stage: "canary", revision: 1 },
          },
          candidates: [],
        },
      }),
    ).toThrow(/governance state is invalid/u);
  });

  it("builds an exact pending review request with a human reason", () => {
    expect(buildEvolutionReviewRequest(pending, "approve", "  safe  ")).toEqual(
      {
        packetDigests: [pending.packetDigest],
        decision: "approve",
        reason: "safe",
      },
    );
  });

  it("rejects stale, forged, and unreasoned review requests", () => {
    expect(() =>
      buildEvolutionReviewRequest(target, "approve", "safe"),
    ).toThrow(/pending packet/u);
    expect(() =>
      buildEvolutionReviewRequest(
        { ...pending, packetDigest: "forged" },
        "reject",
        "unsafe",
      ),
    ).toThrow(/pending packet/u);
    expect(() => buildEvolutionReviewRequest(pending, "approve", " ")).toThrow(
      /human reason/u,
    );
  });

  it("builds an exact active-to-approved rollback request", () => {
    expect(
      buildEvolutionRollbackRequest([active, target], target, " regression "),
    ).toEqual({
      fromPacketDigest: active.packetDigest,
      toPacketDigest: target.packetDigest,
      reason: "regression",
    });
  });

  it("rejects ambiguous, inactive, forged, and unreasoned rollbacks", () => {
    expect(() =>
      buildEvolutionRollbackRequest(
        [active, { ...target, actualUsage: { active: true } }],
        target,
        "regression",
      ),
    ).toThrow(/one active version/u);
    expect(() =>
      buildEvolutionRollbackRequest([active, pending], pending, "regression"),
    ).toThrow(/approved target/u);
    expect(() =>
      buildEvolutionRollbackRequest(
        [active, { ...target, packetDigest: "forged" }],
        { ...target, packetDigest: "forged" },
        "regression",
      ),
    ).toThrow(/approved target/u);
    expect(() =>
      buildEvolutionRollbackRequest([active, target], target, " "),
    ).toThrow(/human reason/u);
  });
});
