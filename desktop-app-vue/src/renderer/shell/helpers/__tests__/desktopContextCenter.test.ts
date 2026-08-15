import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDesktopContextCenter,
  buildDesktopDocumentCandidates,
  composeDesktopContextPrompt,
  stableDesktopContextChipId,
  type DesktopContextCandidate,
} from "../desktopContextCenter";

const cases = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../../packages/vscode-extension/src/__fixtures__/context-center/cases.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

describe("desktop cc-context-center/v1 twin", () => {
  for (const fixture of cases) {
    it(fixture.name, async () => {
      expect(await buildDesktopContextCenter(fixture.input)).toEqual(
        fixture.expected,
      );
    });
  }

  it("uses the same content-free SHA-256 stable id", async () => {
    await expect(
      stableDesktopContextChipId({
        kind: "active-file",
        source: "desktop.legacy.active-file",
        identity: "src/app.ts",
      }),
    ).resolves.toBe("ctx_b304ff7832667e0d");
  });

  it("uses focused evidence instead of the whole-file fallback", async () => {
    const candidates = buildDesktopDocumentCandidates(
      {
        name: "app.ts",
        path: "src/app.ts",
        content: "whole file",
        selectionText: "picked",
        selection: { start: 1, end: 2 },
        diagnostics: [{ severity: "error", line: 2, message: "boom" }],
        gitDiff: "@@ -1 +1 @@\n-old\n+new",
      },
      "2026-08-15T00:00:00.000Z",
    );
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "selection",
      "diagnostics",
      "git-diff",
    ]);
    const projection = await buildDesktopContextCenter({
      candidates,
      tokenBudget: 2,
    });
    expect(projection.chips[0].kind).toBe("selection");
    expect(projection.chips[0].content).toBe("picked");
    expect(projection.chips.some((chip) => chip.kind === "active-file")).toBe(
      false,
    );
  });

  it("falls back to active-file when focused evidence is unavailable", () => {
    expect(
      buildDesktopDocumentCandidates({
        name: "app.ts",
        path: "src/app.ts",
        content: "whole file",
      }).map((candidate) => candidate.kind),
    ).toEqual(["active-file"]);
  });

  it("keeps the switch default-off and enriches only the outbound prompt", async () => {
    const document = {
      name: "app.ts",
      path: "src/app.ts",
      content: "export const answer = 42;",
    };
    await expect(
      composeDesktopContextPrompt("hello", { enabled: false, document }),
    ).resolves.toEqual({ prompt: "hello", projection: null });

    const enabled = await composeDesktopContextPrompt("hello", {
      enabled: true,
      document,
    });
    expect(enabled.prompt).toContain("<ide-context-center");
    expect(enabled.prompt).toContain('"schema": "cc-context-center/v1"');
    expect(enabled.prompt).toEndWith("hello");
  });

  it("drops unsupported candidate kinds", async () => {
    const invalid = {
      kind: "whole-file-dump",
      content: "nope",
    } as unknown as DesktopContextCandidate;
    const projection = await buildDesktopContextCenter({
      candidates: [invalid],
    });
    expect(projection.chips).toEqual([]);
  });
});
