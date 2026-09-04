import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  captureSkillRetrievalRevocationReader,
  openSkillRetrievalRevocationAuthority,
} from "../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function request(overrides = {}) {
  const tenantId = overrides.tenantId ?? "tenant-a";
  const skillName = overrides.skillName ?? "repair-tests";
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId,
    streamId: "pilot-stream",
    operationId: `skill-revocation:${D("transition").slice(7)}:${D("dependency").slice(7)}`,
    transitionDigest: D("transition"),
    candidateId: D("candidate"),
    skillName,
    occurredAt: "2026-09-05T08:00:00.000Z",
    sourceReceiptDigest: D("source-receipt"),
    resolutionDigest: D("resolution"),
    dependency: {
      kind: "retrieval-index",
      ref: `skill-content:${tenantId}:${skillName}`,
      digest: D("skill-content"),
      disposition: "invalidate",
    },
    ...overrides,
  };
  return {
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  };
}

function durablePorts({ loseCommitResponse = false } = {}) {
  let state = null;
  let commits = 0;
  return {
    get commits() {
      return commits;
    },
    async load() {
      return {
        authenticated: true,
        durable: true,
        found: state !== null,
        state: state === null ? null : structuredClone(state),
        receiptDigest: D(state?.stateDigest ?? "empty"),
      };
    },
    async commit({ state: next, expectedStateDigest }) {
      if ((state?.stateDigest ?? null) !== expectedStateDigest) {
        throw new Error("CAS conflict");
      }
      state = structuredClone(next);
      commits += 1;
      if (loseCommitResponse && commits === 1) {
        throw new Error("commit response lost");
      }
      return {
        authenticated: true,
        durable: true,
        committed: true,
        stateDigest: next.stateDigest,
        receiptDigest: D(`commit:${commits}`),
      };
    },
  };
}

describe("Skill retrieval revocation authority", () => {
  it("durably invalidates a digest and makes retries idempotent", async () => {
    const ports = durablePorts();
    const authority = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant-a",
      ports,
    });
    const input = request();
    const first = await authority.invalidateRetrieval(input);
    const second = await authority.invalidateRetrieval(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      dependencyKind: "retrieval-index",
      dependencyDigest: D("skill-content"),
    });
    expect(ports.commits).toBe(1);
    expect(
      captureSkillRetrievalRevocationReader(authority).inspect({
        skillName: "repair-tests",
        contentDigest: D("skill-content"),
      }),
    ).toMatchObject({ invalidated: true, receiptDigest: input.requestDigest });
  });

  it("recovers when durable commit succeeds but its response is lost", async () => {
    const ports = durablePorts({ loseCommitResponse: true });
    const authority = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant-a",
      ports,
    });
    await expect(
      authority.invalidateRetrieval(request()),
    ).resolves.toMatchObject({
      applied: true,
      idempotent: true,
    });
    const reopened = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant-a",
      ports,
    });
    expect(
      reopened.inspect({
        skillName: "repair-tests",
        contentDigest: D("skill-content"),
      }).invalidated,
    ).toBe(true);
    expect(ports.commits).toBe(1);
  });

  it("rejects tenant drift, tampering, and unbranded readers", async () => {
    const ports = durablePorts();
    const authority = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant-a",
      ports,
    });
    const tampered = request();
    tampered.dependency.ref = "skill-content:tenant-b:repair-tests";
    await expect(authority.invalidateRetrieval(tampered)).rejects.toThrow(
      "not exactly bound",
    );
    expect(ports.commits).toBe(0);
    expect(() =>
      captureSkillRetrievalRevocationReader({ inspect() {} }),
    ).toThrow("branded");
  });
});
