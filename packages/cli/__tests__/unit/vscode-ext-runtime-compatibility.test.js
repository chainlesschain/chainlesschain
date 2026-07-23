import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STATUS_READY,
  STATUS_DEGRADED,
  STATUS_REPAIR,
  evaluateRuntimeCompatibility,
} from "../../../vscode-extension/src/runtime-compatibility.js";

const fixturePath = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/runtime-compatibility/cases.json",
    import.meta.url,
  ),
);
const cases = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

describe("runtime compatibility shared twin fixture", () => {
  it("keeps all three user-facing outcomes represented", () => {
    expect(new Set(cases.map((item) => item.expected.status))).toEqual(
      new Set([STATUS_READY, STATUS_DEGRADED, STATUS_REPAIR]),
    );
  });

  for (const item of cases) {
    it(item.name, () => {
      const result = evaluateRuntimeCompatibility(item.input);
      expect(result).toMatchObject(item.expected);
      expect(result.summary).toContain(result.label);
    });
  }
});
