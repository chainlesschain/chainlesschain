/**
 * ElementLocator.locate — strategy 3 (ID) returns .first()
 *
 * Regression: strategies 1/2/4 all return locator.first(), but the ID strategy
 * returned the bare locator. Callers like isVisible() use locator.isVisible(),
 * which is "is ANY matching element visible" on a multi-match locator vs "is the
 * FIRST visible" on .first() — so an element located via ID gave visibility
 * results inconsistent with every other strategy.
 */
import { describe, it, expect } from "vitest";

const { ElementLocator } = require("../element-locator.js");

describe("ElementLocator.locate ID strategy", () => {
  it("returns locator.first(), consistent with the other strategies", async () => {
    const firstLocator = { _kind: "first", waitFor: async () => {} };
    const bareLocator = {
      _kind: "bare",
      waitFor: async () => {},
      first: () => firstLocator,
    };
    const page = {
      // No role/label/tag on the element, so strategies 1/2/4 are skipped;
      // page.locator("#id") backs strategy 3.
      locator: () => bareLocator,
      getByRole: () => ({ first: () => ({ waitFor: async () => {} }) }),
    };

    const result = await ElementLocator.locate(page, {
      ref: "r1",
      attributes: { id: "myid" },
    });

    // Must be the .first() locator, not the bare multi-match locator.
    expect(result).toBe(firstLocator);
    expect(result._kind).toBe("first");
  });
});
