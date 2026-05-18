import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let ContributionTracker, getContributionTracker;

beforeEach(async () => {
  const mod =
    await import("../../../src/main/marketplace/contribution-tracker.js");
  ContributionTracker = mod.ContributionTracker;
  getContributionTracker = mod.getContributionTracker;
});

describe("ContributionTracker", () => {
  let tracker;
  beforeEach(() => {
    tracker = new ContributionTracker(null);
  });

  it("should get empty contributions", async () => {
    const c = await tracker.getContributions();
    expect(c).toHaveLength(0);
  });
  it("should throw on score without id", async () => {
    await expect(tracker.scoreContribution()).rejects.toThrow(
      "Contribution ID is required",
    );
  });
  it("should throw on invalid score", async () => {
    await expect(tracker.scoreContribution("id", 2)).rejects.toThrow(
      "Score must be between 0 and 1",
    );
  });
  it("should get empty leaderboard", async () => {
    const l = await tracker.getLeaderboard();
    expect(l).toHaveLength(0);
  });
  it("should close", async () => {
    await tracker.close();
    expect(tracker._contributions).toHaveLength(0);
  });
});
