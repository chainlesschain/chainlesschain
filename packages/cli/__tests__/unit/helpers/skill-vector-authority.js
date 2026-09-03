import { createHash } from "node:crypto";

import {
  SKILL_VECTOR_ATTESTATION_SCHEMA,
  SKILL_VECTOR_RESULT_SCHEMA,
  createSkillVectorAuthority,
  digestSkillVectorResult,
} from "../../../src/lib/skill-vector-authority.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function createTestSkillVectorAuthority(tenantId) {
  return createSkillVectorAuthority({
    tenantId,
    provider: {
      score: async (request) => {
        const result = {
          schema: SKILL_VECTOR_RESULT_SCHEMA,
          tenantId,
          requestDigest: request.requestDigest,
          corpusDigest: request.corpusDigest,
          modelId: "embedding:test-model",
          modelRevision: "revision:1",
          indexDigest: digest(`index:${tenantId}`),
          scores: request.corpus.map(({ digest: contentDigest }) => ({
            digest: contentDigest,
            score: 0.5,
          })),
          attestation: {
            schema: SKILL_VECTOR_ATTESTATION_SCHEMA,
            algorithm: "test-signature",
            keyId: "key:test-vector",
            value: "A".repeat(32),
          },
        };
        return { ...result, resultDigest: digestSkillVectorResult(result) };
      },
    },
    verifier: {
      verify: async (request) => ({
        authenticated: true,
        durable: true,
        tenantId,
        requestDigest: request.requestDigest,
        resultDigest: request.resultDigest,
        receiptDigest: digest(`receipt:${request.resultDigest}`),
      }),
    },
  });
}
