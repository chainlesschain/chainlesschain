import {
  capturePruningData as capture,
  pruningDigest as digest,
} from "./governed-wiki-pruning-journal.js";
export const WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-authorization/v1";
export const WORKBENCH_ROLLBACK_POLICY_SCHEMA =
  "chainlesschain.evolution-workbench-rollback-policy/v1";
const KEYS = [
  "schema",
  "tenantId",
  "skillName",
  "planDigest",
  "requestedBy",
  "reason",
  "automated",
  "issuedAt",
  "expiresAt",
  "receiptDigest",
  "signature",
];
export function digestWorkbenchRollbackAuthorization(core) {
  return digest(WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA, capture(core));
}
export function verifyWorkbenchRollbackAuthorization(input, plan, now) {
  const value = capture(input);
  if (
    !value ||
    Object.keys(value).length !== KEYS.length ||
    KEYS.some((key) => !Object.hasOwn(value, key))
  )
    throw new TypeError("Workbench rollback authorization fields are invalid");
  const { signature, receiptDigest, ...core } = value;
  if (
    value.schema !== WORKBENCH_ROLLBACK_AUTHORIZATION_SCHEMA ||
    value.automated !== false ||
    ["tenantId", "skillName", "planDigest", "requestedBy", "reason"].some(
      (key) => value[key] !== plan[key],
    ) ||
    typeof signature !== "string" ||
    signature.length < 32 ||
    signature.length > 16_384 ||
    receiptDigest !== digestWorkbenchRollbackAuthorization(core) ||
    !Number.isFinite(now) ||
    typeof value.issuedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.issuedAt) > now ||
    Date.parse(value.expiresAt) <= now ||
    Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 600_000
  )
    throw new Error(
      "Workbench rollback authorization is stale, automated or not exactly bound",
    );
  return value;
}
