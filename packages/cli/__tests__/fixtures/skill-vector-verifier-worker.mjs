import { createHash } from "node:crypto";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (
  request.schema !== "chainlesschain.skill-vector-process-request/v1" ||
  request.role !== "verifier" ||
  process.env.CC_SKILL_VECTOR_PARENT_SECRET
) {
  process.exitCode = 2;
} else {
  const payload = request.payload;
  const authenticated =
    payload.attestation?.schema ===
      "chainlesschain.skill-vector-attestation/v1" &&
    payload.attestation?.keyId === "fixture:provider-key" &&
    payload.attestation?.value === "fixture-provider-attestation-value";
  process.stdout.write(
    JSON.stringify({
      authenticated,
      durable: true,
      tenantId: payload.tenantId,
      requestDigest: payload.requestDigest,
      resultDigest: payload.resultDigest,
      receiptDigest: digest(`fixture:verified:${payload.resultDigest}`),
    }),
  );
}
