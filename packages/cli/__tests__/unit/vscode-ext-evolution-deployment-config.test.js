import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  parseStatus,
} = require("../../../vscode-extension/src/evolution-deployment-config.js");

describe("VS Code evolution deployment configuration", () => {
  it("accepts the CLI status projection", () => {
    expect(
      parseStatus(
        JSON.stringify({
          source: "profile",
          effectiveEnabled: true,
          profileEnabled: true,
          verified: true,
          autoPromotion: "hold",
        }),
      ),
    ).toMatchObject({ source: "profile", verified: true });
  });

  it("rejects malformed and explicit failure responses", () => {
    expect(() => parseStatus("not-json")).toThrow(/无法识别/u);
    expect(() =>
      parseStatus(JSON.stringify({ ok: false, error: "bad signature" })),
    ).toThrow("bad signature");
  });
});
