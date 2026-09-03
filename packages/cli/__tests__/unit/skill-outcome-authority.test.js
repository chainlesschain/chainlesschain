import { describe, expect, it, vi } from "vitest";

import { resolveSkillOutcomeAuthority } from "../../src/lib/skill-outcome-authority.js";

describe("Skill outcome authority selection", () => {
  it("prefers an explicitly configured persistent index", () => {
    const indexed = { status: "verified-indexed", metrics: {} };
    const buildIndex = vi.fn(() => indexed);
    const buildTranscript = vi.fn();
    expect(
      resolveSkillOutcomeAuthority(
        { indexAdapters: ["adapter"] },
        {
          buildSkillOutcomeIndexAuthority: buildIndex,
          buildSkillOutcomeTranscriptAuthority: buildTranscript,
        },
      ),
    ).toBe(indexed);
    expect(buildIndex).toHaveBeenCalledWith(
      { adapters: ["adapter"] },
      undefined,
    );
    expect(buildTranscript).not.toHaveBeenCalled();
  });

  it("does not hide an invalid configured index behind transcript fallback", () => {
    const unavailable = { status: "unavailable", metrics: null };
    const buildTranscript = vi.fn();
    const unavailableIndex = vi.fn(() => unavailable);
    expect(
      resolveSkillOutcomeAuthority(
        { indexAdapters: [] },
        {
          buildSkillOutcomeIndexAuthority: () => {
            throw Object.assign(new Error("backfill"), {
              code: "CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED",
            });
          },
          unavailableSkillOutcomeIndexAuthority: unavailableIndex,
          buildSkillOutcomeTranscriptAuthority: buildTranscript,
        },
      ),
    ).toBe(unavailable);
    expect(unavailableIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED",
      }),
    );
    expect(buildTranscript).not.toHaveBeenCalled();
  });

  it("uses transcript authority when no index was configured", () => {
    const transcript = { status: "verified", metrics: {} };
    const buildTranscript = vi.fn(() => transcript);
    expect(
      resolveSkillOutcomeAuthority(
        {},
        {
          buildSkillOutcomeTranscriptAuthority: buildTranscript,
        },
      ),
    ).toBe(transcript);
    expect(buildTranscript).toHaveBeenCalledWith(undefined, undefined);
  });

  it("sanitizes transcript authority failures", () => {
    const unavailable = { status: "unavailable", metrics: null };
    expect(
      resolveSkillOutcomeAuthority(
        {},
        {
          buildSkillOutcomeTranscriptAuthority: () => {
            throw new Error("private path");
          },
          unavailableSkillOutcomeTranscriptAuthority: () => unavailable,
        },
      ),
    ).toBe(unavailable);
  });
});
