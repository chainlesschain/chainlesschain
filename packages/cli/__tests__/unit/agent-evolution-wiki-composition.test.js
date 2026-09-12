import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentEvolutionRuntimeComposition } from "../../src/lib/evolution/agent-evolution-runtime-composition.js";
import {
  createJourneyAuthorities,
  durableFilesystem,
  retainCompositionEvidence,
  schemaPolicies,
  digest,
  NOW,
} from "../helpers/evolution-wiki-journey-fixture.js";

const roots = [];
function setup() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-composed-wiki-"),
  );
  roots.push(root);
  const tenantId = "tenant-composed-wiki";
  const runId = "run-composed-wiki";
  const authority = createJourneyAuthorities(tenantId);
  let evidenceSequence = 0;
  let ingressSequence = 0;
  const options = {
    tenantId,
    runId,
    stateRootDir: root,
    clock: authority.now,
    secure: false,
    fsImpl: durableFilesystem(),
    evidenceIdGenerator: async () => `evidence-${++evidenceSequence}`,
    ingressIdGenerator: () => `ingress-${++ingressSequence}`,
    authorities: Object.fromEntries(
      [
        "artifact",
        "attestationSigner",
        "attestationVerifier",
        "keyedCommitter",
        "ledger",
        "rawEncryptor",
        "sourceVerifier",
        "storagePolicy",
        "witness",
      ].map((key) => [key, authority[key]]),
    ),
    wikiMaintenance: {
      principalEnvelope: authority.principalEnvelope,
      schemaPolicies,
      readAuthorities: authority.readAuthorities,
      commitCoordinator: authority.commitCoordinator,
      maintainer: {
        maintainerModel: "schema-rule-maintainer",
        rulesDigest: digest("composed-wiki-rules"),
        minCorroboratingSources: 2,
        derive({ evidence }) {
          return {
            operations: [
              {
                type: "upsert",
                pattern: {
                  patternId: "pat-composed-verification",
                  kind: "success",
                  summary: "Independent bounded checks agree",
                  rootCause: "Observed deterministic checks",
                  procedure: "Execute bounded checks",
                  appliesWhen: ["deterministic fixtures"],
                  doesNotApplyWhen: ["unverified environment"],
                  positiveEvidence: evidence.map((item) => item.ref),
                  confidence: 0.8,
                  skillNames: ["safe-refactor"],
                },
              },
            ],
          };
        },
      },
    },
  };
  options.authorities.sourceEnvelope = {
    async issue(request) {
      if (request.tenantId !== tenantId || request.runId !== runId)
        throw new Error("source issuer scope denied");
      const event = request.evidence.event;
      if (
        request.kind === "tool-completed" &&
        ["tool-a", "tool-b"].includes(event?.tool)
      ) {
        return authority.issueSource(request.evidence, {
          principalId: event.tool,
          trustedPayload: event.result,
        });
      }
      return authority.issueSource(request.evidence, {
        principalId: "user-a",
        sourceKind: "user-statement",
      });
    },
  };
  return { options, authority, root };
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function ingestBaseline(composition, authority) {
  for (const [tool, summary] of [
    ["tool-a", "focused-checks"],
    ["tool-b", "independent-checks"],
  ]) {
    await composition.evolutionIngress.ingestAgentEvent({
      type: "tool-result",
      tool,
      result: { summary, result: "passed" },
    });
  }
  await composition.evolutionIngress.complete();
  return retainCompositionEvidence(composition, authority);
}

describe("explicit production Wiki composition", () => {
  it("is disabled by default and exposes no evidence/Raw authority", () => {
    const { options } = setup();
    delete options.wikiMaintenance;
    const composition = createAgentEvolutionRuntimeComposition(options);
    expect(composition.wikiMaintenance).toBeNull();
    expect(composition).not.toHaveProperty("evidenceAdapter");
    expect(composition).not.toHaveProperty("rawStore");
    expect(composition.loadRun().events).toEqual([]);
  });

  it.each(["evidenceState", "principalResolver", "accessPolicy"])(
    "fails closed when %s authority is absent",
    (key) => {
      const { options, root } = setup();
      delete options.wikiMaintenance.readAuthorities[key];
      expect(() => createAgentEvolutionRuntimeComposition(options)).toThrow(
        "readAuthorities",
      );
      expect(fs.readdirSync(root)).toEqual([]);
    },
  );

  it("requires an explicit synchronous evidence commit coordinator", () => {
    const { options, root } = setup();
    delete options.wikiMaintenance.commitCoordinator;
    expect(() => createAgentEvolutionRuntimeComposition(options)).toThrow(
      "wikiMaintenance",
    );
    expect(fs.readdirSync(root)).toEqual([]);
    options.wikiMaintenance.commitCoordinator = {
      async acquireCurrentEvidence() {
        throw new Error("not a synchronous lease");
      },
    };
    expect(() => createAgentEvolutionRuntimeComposition(options)).toThrow(
      "synchronous",
    );
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("rejects caller-provided trust/maintainer ports and absent reader identities", () => {
    const { options } = setup();
    options.wikiMaintenance.maintainer.resolveEvidence = () => ({
      trustedProjection: true,
    });
    expect(() => createAgentEvolutionRuntimeComposition(options)).toThrow(
      "wikiMaintenance.maintainer",
    );
    delete options.wikiMaintenance.maintainer.resolveEvidence;
    options.wikiMaintenance.principalEnvelope = "";
    expect(() => createAgentEvolutionRuntimeComposition(options)).toThrow(
      "principal envelope",
    );
  });

  it("runs real ingress through current Reader and commits a durable Wiki across reopening", async () => {
    const { options, authority } = setup();
    const composition = createAgentEvolutionRuntimeComposition(options);
    const refs = await ingestBaseline(composition, authority);
    expect(refs).toHaveLength(2);
    expect(Object.keys(composition.wikiMaintenance).sort()).toEqual([
      "loadWiki",
      "maintain",
    ]);
    const result = await composition.wikiMaintenance.maintain({
      evidenceRefs: refs,
      effectiveAt: NOW,
    });
    expect(result.state.patterns["pat-composed-verification"].status).toBe(
      "corroborated",
    );
    const reopened = createAgentEvolutionRuntimeComposition(options);
    expect(reopened.wikiMaintenance.loadWiki().stateDigest).toBe(
      result.stateDigest,
    );
    expect(reopened.loadRun().projection.status).toBe("completed");
    const before = reopened.wikiMaintenance.loadWiki().stateDigest;
    authority.revoke(refs[0]);
    await retainCompositionEvidence(reopened, authority);
    await expect(
      reopened.wikiMaintenance.maintain({
        evidenceRefs: refs,
        effectiveAt: NOW,
      }),
    ).rejects.toMatchObject({ code: "CC_EVOLUTION_PROJECTION_ACCESS_DENIED" });
    expect(reopened.wikiMaintenance.loadWiki().stateDigest).toBe(before);
  });

  it("honors a current policy denial and allows legitimate work when policy is restored", async () => {
    const { options, authority } = setup();
    const composition = createAgentEvolutionRuntimeComposition(options);
    const refs = await ingestBaseline(composition, authority);
    const before = composition.wikiMaintenance.loadWiki().stateDigest;
    authority.setAccessAllowed(false);
    await expect(
      composition.wikiMaintenance.maintain({
        evidenceRefs: refs,
        effectiveAt: NOW,
      }),
    ).rejects.toMatchObject({ code: "CC_EVOLUTION_PROJECTION_ACCESS_DENIED" });
    expect(composition.wikiMaintenance.loadWiki().stateDigest).toBe(before);
    authority.setAccessAllowed(true);
    await expect(
      composition.wikiMaintenance.maintain({
        evidenceRefs: refs,
        effectiveAt: NOW,
      }),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("does not let untrusted user claims reach the derivation callback", async () => {
    const { options, authority } = setup();
    let derived = 0;
    options.wikiMaintenance.maintainer.derive = () => {
      derived += 1;
      return { operations: [] };
    };
    const composition = createAgentEvolutionRuntimeComposition(options);
    await composition.evolutionIngress.ingestUserPrompt(
      "I claim every test passed",
    );
    await composition.evolutionIngress.complete();
    const refs = await retainCompositionEvidence(composition, authority);
    await expect(
      composition.wikiMaintenance.maintain({
        evidenceRefs: refs,
        effectiveAt: NOW,
      }),
    ).rejects.toMatchObject({ code: "CC_EVOLUTION_PROJECTION_QUARANTINED" });
    expect(derived).toBe(0);
    expect(composition.wikiMaintenance.loadWiki().state.revision).toBe(0);
  });
});
