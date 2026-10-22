import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reproduce the macOS failure with a valid UUID whose digits become a
// payment-card match after the old eight-hex grouping.
const uuidSequence = vi.hoisted(() => ({ nextSuffix: 123456789011 }));
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal()),
  randomUUID: () => `12345678-1234-4567-8123-${++uuidSequence.nextSuffix}`,
}));

import { loadEvolutionDeploymentCommandDependencies } from "../../src/lib/evolution/evolution-deployment-loader.js";
import { captureAgentEvolutionRuntimeComposition } from "../../src/lib/evolution/agent-evolution-runtime-composition-brand.js";
import { prepareGovernedModelTurn } from "../../src/lib/evolution/governed-model-turn.js";

const temporaryRoots = [];
beforeEach(() => {
  uuidSequence.nextSuffix = 123456789011;
});
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("signed local UI Evolution IDs", () => {
  it("ingests and completes a first agent turn with a fixed digit-heavy UUID", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "chainlesschain-local-ui-fixed-id-"),
    );
    temporaryRoots.push(root);
    const config = {
      env: { CHAINLESSCHAIN_HOME: root },
      cwd: process.cwd(),
      root,
    };
    const dependencies = await loadEvolutionDeploymentCommandDependencies(
      "agent",
      config,
    );
    const composition = await dependencies.evolutionCompositionFactory({
      mode: "headless-stream",
      runId: "agent-fixed-uuid",
    });
    expect(captureAgentEvolutionRuntimeComposition(composition)).toBe(
      composition,
    );

    const messages = [{ role: "user", content: "hello" }];
    await composition.evolutionIngress.start();
    await composition.evolutionIngress.ingestUserPrompt({ messages });
    const prepared = await composition.evolutionIngress.prepareModelRequest({
      messages,
      tools: [],
    });
    expect(prepared.messages.length).toBeGreaterThan(0);
    await composition.evolutionIngress.complete();

    const ask = await loadEvolutionDeploymentCommandDependencies("ask", config);
    let governedRunId;
    const turn = await prepareGovernedModelTurn(
      (context) => {
        governedRunId = context.runId;
        return ask.evolutionCompositionFactory(context);
      },
      { mode: "ask", messages },
    );
    expect(governedRunId).toMatch(/^ask-(?:[a-p]{8}-){3}[a-p]{8}$/u);
    expect(governedRunId).not.toMatch(/\d/u);
    expect(turn.governed).toBe(true);
    await turn.complete("hello");
  }, 180_000);
});
