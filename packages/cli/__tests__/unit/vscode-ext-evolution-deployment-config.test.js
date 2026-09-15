import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  initializeEvolutionTestDeployment,
  parseStatus,
  replaceEvolutionTestDeployment,
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

  it("uses fixed CLI routes for test setup and managed replacement", async () => {
    const calls = [];
    const deps = {
      execFile(command, args, _options, callback) {
        calls.push({ command, args });
        callback(null, JSON.stringify({ verified: true }), "");
      },
    };
    await initializeEvolutionTestDeployment(
      { modulePath: "C:\\dev\\host.mjs" },
      { command: "cc", deps },
    );
    await replaceEvolutionTestDeployment(
      {
        descriptorPath: "C:\\managed\\deployment.json",
        trustRootPath: "C:\\managed\\public.pem",
      },
      { command: "cc", deps },
    );
    expect(calls.map(({ args }) => args.slice(0, 3))).toEqual([
      ["evolution", "deployment", "init-test"],
      ["evolution", "deployment", "replace-test"],
    ]);
    expect(calls.every(({ args }) => args.at(-1) === "--json")).toBe(true);
  });
});
