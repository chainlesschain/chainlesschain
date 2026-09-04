import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";
import { createStructuredMemoryAgentControlPlaneFixture } from "../fixtures/structured-memory-agent-control-plane.js";

const fixtures = [];
const digest = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function request(memoryId, contentDigest) {
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId: "tenant-memory-revocation",
    streamId: "pilot-memory:wiki-outcomes",
    operationId: `skill-revocation:${digest("outcome").slice(7)}:${digest("memory-dependency").slice(7)}`,
    transitionDigest: digest("outcome"),
    candidateId: digest("candidate"),
    skillName: "safe-refactor",
    occurredAt: "2026-09-02T00:00:00.000Z",
    sourceReceiptDigest: digest("rollback"),
    resolutionDigest: digest("resolution"),
    dependency: {
      kind: "memory",
      ref: memoryId,
      digest: contentDigest,
      disposition: "quarantine",
    },
  };
  return {
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  };
}

describe("structured Memory rollback propagation", () => {
  it("quarantines a promoted procedural Memory and recovers append response loss", async () => {
    const fixture = createStructuredMemoryAgentControlPlaneFixture({
      tenantId: "tenant-memory-revocation",
    });
    fixtures.push(fixture);
    const memoryId = `skill-release:safe-refactor:${digest("release")}`;
    const contentDigest = digest("skill-content");
    await fixture.seedProceduralMemory({
      memoryId,
      contentDigest,
      artifactRef: digest("release"),
      evidenceRefs: [digest("promotion")],
    });
    const input = request(memoryId, contentDigest);
    fixture.ledgerState.failAfterType = "memory.event.persisted";

    await expect(fixture.controlPlane.quarantineMemory(input)).rejects.toThrow(
      /response loss/,
    );
    const recovered = await fixture.controlPlane.quarantineMemory(input);
    const reopened = fixture.open();
    const retried = await reopened.quarantineMemory(input);

    expect(recovered).toEqual(retried);
    expect(recovered).toMatchObject({
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      requestDigest: input.requestDigest,
      dependencyKind: "memory",
      disposition: "quarantine",
    });
    expect(reopened.memory.projection().memories[memoryId]).toBeUndefined();
    expect(reopened.memory.projection().quarantines[memoryId]).toMatchObject({
      contentDigest,
      metadata: { revocationPropagationRequestDigest: input.requestDigest },
    });
  });
});
