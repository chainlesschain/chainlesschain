import { createHash } from "node:crypto";

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const hash = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (
  request.schema !== "chainlesschain.skill-vector-process-request/v1" ||
  request.role !== "provider" ||
  process.env.CC_SKILL_VECTOR_PARENT_SECRET
) {
  process.exitCode = 2;
} else {
  const payload = request.payload;
  const result = {
    schema: "chainlesschain.skill-vector-result/v1",
    tenantId: payload.tenantId,
    requestDigest: payload.requestDigest,
    corpusDigest: payload.corpusDigest,
    modelId: "fixture:embedding",
    modelRevision: "fixture:revision:1",
    indexDigest: digest("fixture:index"),
    scores: payload.corpus.map(({ digest: contentDigest }, index) => ({
      digest: contentDigest,
      score: (index + 1) / payload.corpus.length,
    })),
    attestation: {
      schema: "chainlesschain.skill-vector-attestation/v1",
      algorithm: "fixture-signature",
      keyId: "fixture:provider-key",
      value: "fixture-provider-attestation-value",
    },
  };
  result.resultDigest = hash("chainlesschain.skill-vector-result/v1", {
    schema: result.schema,
    tenantId: result.tenantId,
    requestDigest: result.requestDigest,
    corpusDigest: result.corpusDigest,
    modelId: result.modelId,
    modelRevision: result.modelRevision,
    indexDigest: result.indexDigest,
    scores: result.scores,
  });
  process.stdout.write(JSON.stringify(result));
}
