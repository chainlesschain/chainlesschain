import { describe, expect, it } from "vitest";
import {
  PUBLIC_IDE_CAPABILITY_MANIFEST,
  renderPublicIdeCapabilityManifest,
  renderPublicIdeReadmeBlock,
} from "../../src/lib/public-ide-capability-manifest.js";
import {
  validatePublicIdeGeneratedArtifacts,
  validatePublicIdeSurfaces,
} from "../../src/lib/public-ide-capability-validation.js";

describe("public IDE capability manifest", () => {
  it("is versioned, deterministic and safe to publish", () => {
    expect(PUBLIC_IDE_CAPABILITY_MANIFEST.schema).toBe(
      "chainlesschain.public-ide-capabilities/v1",
    );
    expect(PUBLIC_IDE_CAPABILITY_MANIFEST.schemaVersion).toBe(1);
    expect(renderPublicIdeCapabilityManifest()).toBe(
      renderPublicIdeCapabilityManifest(),
    );
    const serialized = renderPublicIdeCapabilityManifest();
    expect(serialized).not.toMatch(
      /(?:api[_-]?key|access[_-]?token|password|credential)\s*["']?\s*:/i,
    );
  });

  it("matches VS Code, JetBrains, Desktop, Doctor and CLI sources", () => {
    expect(validatePublicIdeSurfaces()).toEqual([]);
  });

  it("fails closed when a host command drifts from the canonical list", () => {
    const drifted = JSON.parse(JSON.stringify(PUBLIC_IDE_CAPABILITY_MANIFEST));
    drifted.surfaces.vscode.commands.pop();
    expect(
      validatePublicIdeSurfaces({ manifest: drifted }).some((error) =>
        error.startsWith("VS Code contributed commands drifted:"),
      ),
    ).toBe(true);
  });

  it("pins the checked-in JSON and generated README sections byte-for-byte", () => {
    expect(validatePublicIdeGeneratedArtifacts()).toEqual([]);
  });

  it("renders both host summaries from the same minimum and entry lists", () => {
    const vscode = renderPublicIdeReadmeBlock("vscode");
    const jetbrains = renderPublicIdeReadmeBlock("jetbrains");
    expect(vscode).toContain("VS Code commands: **52**");
    expect(jetbrains).toContain("JetBrains actions: **35**");
    for (const text of [vscode, jetbrains]) {
      expect(text).toContain("cc >= 0.162.47");
      expect(text).toContain("Bridge capability schema: **v1**");
    }
  });
});
