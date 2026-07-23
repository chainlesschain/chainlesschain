import { describe, expect, it } from "vitest";
import { resolveNpmInvocation } from "../../src/lib/npm-invocation.js";

describe("resolveNpmInvocation", () => {
  it("uses the npm executable directly on POSIX", () => {
    expect(resolveNpmInvocation({ platform: "linux" })).toEqual({
      command: "npm",
      prefixArgs: [],
    });
  });

  it("uses node.exe plus npm-cli.js on Windows without a CMD shell", () => {
    expect(
      resolveNpmInvocation({
        platform: "win32",
        execPath: "C:\\node\\node.exe",
      }),
    ).toEqual({
      command: "C:\\node\\node.exe",
      prefixArgs: ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js"],
    });
  });
});
