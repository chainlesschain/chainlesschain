import { describe, expect, it } from "vitest";
import {
  buildRrsiCampaign,
  buildRrsiCandidate,
} from "../../src/lib/evolution/rrsi-contracts.js";
import { replayRrsiSelection } from "../../src/lib/evolution/rrsi-selector.js";
import {
  createRrsiShadowFixture,
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiObservation,
} from "../fixtures/rrsi-shadow-fixture.js";

describe("RRSI synthetic candidate screening", () => {
  it("rejects the train-only gain and shadow-selects the robust candidate", () => {
    const input = createRrsiShadowFixture();
    const report = replayRrsiSelection(input);
    expect(report.status).toBe("shadow-selected");
    expect(report.selectedCandidateDigest).toBe(
      input.candidates[1].candidateDigest,
    );
    const overfit = report.decisions.find(
      (entry) => entry.candidateDigest === input.candidates[0].candidateDigest,
    );
    expect(overfit.status).toBe("rejected");
    expect(overfit.penalties.generalization).toBeCloseTo(0.54);
    expect(report).toMatchObject({
      evidenceKind: "synthetic-offline",
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
      statisticalProtocolValidated: false,
    });
  });

  it("produces the same replay digest after candidate/observation reordering", () => {
    const input = createRrsiShadowFixture();
    const expected = replayRrsiSelection(input).replayDigest;
    input.candidates.reverse();
    input.observations.reverse();
    expect(replayRrsiSelection(input).replayDigest).toBe(expected);
  });

  it.each([
    ["candidateCostMicrounits", null, "COST_UNKNOWN"],
    ["costComplete", false, "COST_UNKNOWN"],
    ["cleanupConfirmed", false, "CLEANUP_UNCONFIRMED"],
    ["completedSlots", 479, "INSUFFICIENT_EVIDENCE"],
    ["independentGroups", 10, "INSUFFICIENT_EVIDENCE"],
    ["selectionDelta", null, "INSUFFICIENT_EVIDENCE"],
    ["wallClockMs", null, "BUDGET_UNKNOWN"],
    ["executions", null, "BUDGET_UNKNOWN"],
    ["executions", 959, "INSUFFICIENT_EVIDENCE"],
    ["environmentMatches", false, "ENVIRONMENT_DRIFT"],
  ])(
    "HOLDs the entire campaign on incomplete competitor %s",
    (key, value, reason) => {
      const input = createRrsiShadowFixture();
      input.observations[0][key] = value;
      const report = replayRrsiSelection(input);
      expect(report.status).toBe("hold");
      expect(report.selectedCandidateDigest).toBeNull();
      expect(report.blockingReasons).toContain(reason);
    },
  );

  it("retains hard rejection and HOLDs campaign when a rejected attempt lacks costs", () => {
    const input = createRrsiShadowFixture();
    input.observations[0].safetyViolations = 1;
    input.observations[0].costComplete = false;
    const report = replayRrsiSelection(input);
    expect(report.status).toBe("hold");
    expect(
      report.decisions.find(
        (entry) =>
          entry.candidateDigest === input.candidates[0].candidateDigest,
      ),
    ).toMatchObject({
      status: "rejected",
      reasons: ["SAFETY_HARD_GATE", "COST_UNKNOWN"],
    });
  });

  it.each([
    "safetyViolations",
    "permissionViolations",
    "dataLeakage",
    "ancestorPassed",
  ])("cannot score around hard failure %s", (key) => {
    const input = createRrsiShadowFixture();
    input.observations[1][key] =
      key === "ancestorPassed" ? false : key === "dataLeakage" ? true : 1;
    const report = replayRrsiSelection(input);
    expect(report.status).toBe("hold");
    expect(report.selectedCandidateDigest).toBeNull();
  });

  it("HOLDs missing observations and cannot invent independent groups", () => {
    const input = createRrsiShadowFixture();
    input.observations.pop();
    expect(replayRrsiSelection(input).blockingReasons).toContain(
      "INSUFFICIENT_EVIDENCE",
    );
    input.observations[0].independentGroups = 41;
    expect(() => replayRrsiSelection(input)).toThrow(/invent/);
  });

  it("rejects registered perturbation regression even when clean gain is positive", () => {
    const input = createRrsiShadowFixture();
    input.observations[1].perturbationDeltas[0].mean = -0.2;
    expect(replayRrsiSelection(input).selectedCandidateDigest).toBeNull();
  });

  it("does not silently omit a registered perturbation", () => {
    const input = createRrsiShadowFixture();
    input.observations[1].perturbationDeltas.pop();
    expect(replayRrsiSelection(input).blockingReasons).toContain(
      "INSUFFICIENT_EVIDENCE",
    );
  });

  it("rejects all copies of identical content independently of input order", () => {
    const input = createRrsiShadowFixture();
    const duplicateInput = rrsiCandidateInput(input.campaign);
    duplicateInput.candidateId = "copied-candidate";
    duplicateInput.artifacts[0].bytes++;
    const duplicate = buildRrsiCandidate(input.campaign, duplicateInput);
    input.candidates = [input.candidates[1], duplicate];
    input.observations = input.candidates.map((candidate) =>
      rrsiObservation(candidate),
    );
    const report = replayRrsiSelection(input);
    expect(report.status).toBe("hold");
    expect(
      report.decisions.every((entry) =>
        entry.reasons.includes("DUPLICATE_CONTENT"),
      ),
    ).toBe(true);
    input.candidates.reverse();
    input.observations.reverse();
    expect(replayRrsiSelection(input).replayDigest).toBe(report.replayDigest);
  });

  it.each([
    ["candidateTokens", 300_000],
    ["candidateToolCalls", 3000],
    ["wallClockMs", 1_000_000],
    ["executions", 4000],
  ])(
    "checks aggregate selection budget including rejected attempts for %s",
    (key, value) => {
      const input = createRrsiShadowFixture();
      input.observations.forEach((observation) => {
        observation[key] = value;
      });
      expect(replayRrsiSelection(input).blockingReasons).toContain(
        "BUDGET_EXCEEDED",
      );
    },
  );

  it("checks aggregate cost budget before choosing individually eligible candidates", () => {
    const input = createRrsiShadowFixture();
    input.observations = input.candidates.map((candidate) =>
      rrsiObservation(candidate, {
        trainDelta: 0.92,
        selectionDelta: { mean: 0.92, lower: 0.9, upper: 0.94 },
        candidateCostMicrounits: 1_250_000,
        perturbationDeltas: [
          { id: "paraphrase", mean: 0.91 },
          { id: "tool-order", mean: 0.91 },
          { id: "tool-delay", mean: 0.91 },
        ],
      }),
    );
    const report = replayRrsiSelection(input);
    expect(
      report.decisions.every((entry) => entry.status === "shadow-eligible"),
    ).toBe(true);
    expect(report.status).toBe("hold");
    expect(report.blockingReasons).toContain("BUDGET_EXCEEDED");
  });

  it("handles zero baseline costs without division or false free-price inference", () => {
    const input = createRrsiShadowFixture();
    const candidate = input.candidates[1];
    input.candidates = [candidate];
    input.observations = [
      rrsiObservation(candidate, {
        trainDelta: 0,
        selectionDelta: { mean: 0, lower: 0, upper: 0 },
        baselineCostMicrounits: 0,
        candidateCostMicrounits: 0,
        perturbationDeltas: [
          { id: "paraphrase", mean: 0 },
          { id: "tool-order", mean: 0 },
          { id: "tool-delay", mean: 0 },
        ],
      }),
    ];
    expect(replayRrsiSelection(input).status).toBe("shadow-selected");
  });

  it("only returns HOLD when policy calibration is still pending", () => {
    const campaignInput = rrsiCampaignInput();
    const policyInput = Object.fromEntries(
      Object.entries(campaignInput.policy).filter(
        ([key]) =>
          ![
            "schema",
            "structuralOnly",
            "authenticated",
            "readyForExecution",
            "qualifiesForPromotion",
            "policyDigest",
          ].includes(key),
      ),
    );
    policyInput.calibrated = false;
    // Rebuilding prevents a modified flag from borrowing the previous digest.
    return import("../../src/lib/evolution/rrsi-contracts.js").then(
      ({ buildRrsiPolicy }) => {
        campaignInput.policy = buildRrsiPolicy(policyInput);
        const campaign = buildRrsiCampaign(campaignInput);
        const candidate = buildRrsiCandidate(
          campaign,
          rrsiCandidateInput(campaign),
        );
        const report = replayRrsiSelection({
          campaign,
          candidates: [candidate],
          observations: [rrsiObservation(candidate)],
        });
        expect(report.blockingReasons).toContain("POLICY_NOT_CALIBRATED");
      },
    );
  });
});
