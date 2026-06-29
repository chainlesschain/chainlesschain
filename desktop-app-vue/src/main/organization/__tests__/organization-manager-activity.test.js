/**
 * OrganizationManager activity mixin — getMemberActivities column names
 *
 * Regression: getMemberActivities queried `WHERE user_did = ?` /
 * `ORDER BY activity_timestamp`, but organization_activities (and logActivity's
 * INSERT) use `actor_did` / `timestamp`. SQLite throws "no such column", which
 * the method's try/catch swallowed → member activity history was always empty.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const activityMixin = require("../organization-manager-activity.js");

describe("organization-manager-activity getMemberActivities", () => {
  it("queries the real columns (actor_did / timestamp), not the nonexistent ones", () => {
    let capturedSql = "";
    const ctx = {
      db: {
        prepare: (sql) => {
          capturedSql = sql;
          return { all: () => [{ id: "a1", actor_did: "did:x" }] };
        },
      },
    };

    const result = activityMixin.getMemberActivities.call(
      ctx,
      "org1",
      "did:x",
      10,
    );

    expect(result).toHaveLength(1);
    expect(capturedSql).toMatch(/actor_did/);
    expect(capturedSql).toMatch(/ORDER BY\s+timestamp/);
    // The columns that don't exist (caused empty results before the fix):
    expect(capturedSql).not.toMatch(/user_did/);
    expect(capturedSql).not.toMatch(/activity_timestamp/);
  });
});
