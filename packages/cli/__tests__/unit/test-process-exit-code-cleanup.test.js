import { describe, expect, it } from "vitest";

describe("Vitest process exit-code isolation", () => {
  it("allows command tests to model a non-zero CLI outcome", () => {
    process.exitCode = 17;
    expect(process.exitCode).toBe(17);
  });

  it("does not inherit a prior test's command exit code", () => {
    expect(process.exitCode).toBeUndefined();
  });
});
