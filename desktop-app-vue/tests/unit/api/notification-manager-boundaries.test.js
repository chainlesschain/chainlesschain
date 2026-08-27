import { describe, expect, it } from "vitest";

const {
  HARD_NOTIFICATION_LIMITS,
  NotificationBoundaryError,
  cloneBoundedNavigation,
  createNotificationLimits,
  projectNavigationItems,
  truncateUtf8,
} = require("../../../src/main/api/notification-manager-boundaries.js");

describe("API notification boundaries", () => {
  it("clamps hostile options at immutable hard limits", () => {
    const limits = createNotificationLimits(
      Object.fromEntries(
        Object.keys(HARD_NOTIFICATION_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(limits).toEqual(HARD_NOTIFICATION_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("projects detached click payloads and truncates UTF-8 safely", () => {
    const source = [
      { id: "文章一", title: "标题一" },
      { id: "文章二", title: "标题二" },
      { id: "文章三", title: "标题三" },
    ];
    const projected = projectNavigationItems(source, 2, 7, ["id", "title"]);
    source[0].id = "mutated";

    expect(projected).toHaveLength(2);
    expect(projected[0].id).toBe("文章");
    expect(projected[0].id).not.toContain("�");
    expect(truncateUtf8("文章一", 7)).toBe("文章");
  });

  it("rejects cyclic and oversized navigation parameters", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => cloneBoundedNavigation(cyclic, 100)).toThrow(
      NotificationBoundaryError,
    );
    expect(() => cloneBoundedNavigation(() => undefined, 100)).toThrow(
      NotificationBoundaryError,
    );
    let error;
    try {
      cloneBoundedNavigation({ value: "x".repeat(101) }, 100);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "OVERLOADED",
      scope: "notification_navigation",
    });
  });
});
