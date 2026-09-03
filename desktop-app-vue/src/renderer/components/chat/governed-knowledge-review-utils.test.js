import { describe, expect, it } from "vitest";

import GovernedKnowledgeReviewDrawer from "./GovernedKnowledgeReviewDrawer.vue";
import {
  buildGovernedKnowledgeMergeRequest,
  validateGovernedKnowledgeConflictResponse,
} from "./governed-knowledge-review-utils.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const conflict = {
  conflictEnvelopeDigest: digest("1"),
  knowledgeId: "knowledge:1",
  scope: "team",
  scopeId: "team:1",
  action: "upsert",
  senderDeviceId: "device:remote",
  localContentDigest: digest("2"),
  remoteContentDigest: digest("3"),
  remoteVectorClock: { "device:remote": 2 },
  committedAt: "2026-09-04T00:00:00.000Z",
};

describe("Governed knowledge Desktop reviewer boundary", () => {
  it("compiles the reviewer drawer", () => {
    expect(GovernedKnowledgeReviewDrawer).toMatchObject({
      __name: "GovernedKnowledgeReviewDrawer",
    });
  });

  it("accepts only the bounded redacted conflict projection", () => {
    const result = {
      schema: "chainlesschain.governed-knowledge-review-list/v1",
      tenantId: "tenant:1",
      deviceId: "device:local",
      items: [conflict],
      nextCursor: null,
      total: 1,
    };
    expect(
      validateGovernedKnowledgeConflictResponse({ success: true, result }),
    ).toBe(result);
    expect(() =>
      validateGovernedKnowledgeConflictResponse({
        success: true,
        result: {
          ...result,
          items: [{ ...conflict, ciphertext: "secret" }],
        },
      }),
    ).toThrow(/not redacted/u);
    expect(() =>
      validateGovernedKnowledgeConflictResponse({
        success: true,
        result: { ...result, approvalReceipt: { signature: "secret" } },
      }),
    ).toThrow(/projection is invalid/u);
  });

  it("builds the exact merge request from JSON and a human reason", () => {
    expect(
      buildGovernedKnowledgeMergeRequest(
        conflict,
        '{"knowledgeId":"knowledge:1"}',
        "  reconciled offline edits  ",
      ),
    ).toEqual({
      conflictEnvelopeDigest: conflict.conflictEnvelopeDigest,
      mergedRecord: { knowledgeId: "knowledge:1" },
      reason: "reconciled offline edits",
    });
  });

  it("rejects forged conflicts, malformed records, and empty reasons", () => {
    expect(() =>
      buildGovernedKnowledgeMergeRequest(
        { ...conflict, conflictEnvelopeDigest: "forged" },
        "{}",
        "reviewed",
      ),
    ).toThrow(/valid conflict/u);
    expect(() =>
      buildGovernedKnowledgeMergeRequest(conflict, "not-json", "reviewed"),
    ).toThrow(/valid JSON/u);
    expect(() =>
      buildGovernedKnowledgeMergeRequest(conflict, "{}", " "),
    ).toThrow(/human merge reason/u);
  });
});
