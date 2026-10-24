import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function encodedMessage(message) {
  if (typeof message === "string") return Buffer.from(message, "utf8");
  if (Buffer.isBuffer(message)) return message;
  return Buffer.from(canonical(message), "utf8");
}

/** Process-local immutable key/policy; external revocable authorities differ. */
export function createLocalUiSigningAuthority(label, tenantId, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  const trust = Object.freeze({
    algorithm: "ed25519",
    keyId: `local://${tenantId}/${label}`,
    trustPolicyDigest: `sha256:${createHash("sha256").update(`chainlesschain.local-ui.${label}.policy/v1`).digest("hex")}`,
  });
  // Every verifier input is captured and immutable for this authority's entire
  // lifetime. The existing witness cache still rehashes fresh stored bytes.
  const trustEpoch = `sha256:${createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .update("\0")
    .update(canonical(trust))
    .digest("hex")}`;
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign({ message }) {
        return {
          ...trust,
          value: sign(null, encodedMessage(message), privateKey).toString(
            "base64url",
          ),
        };
      },
    }),
    verifier: Object.freeze({
      getTrustEpoch: () => trustEpoch,
      verify({ message, signature }) {
        return (
          signature?.algorithm === trust.algorithm &&
          signature?.keyId === trust.keyId &&
          signature?.trustPolicyDigest === trust.trustPolicyDigest &&
          verify(
            null,
            encodedMessage(message),
            publicKey,
            Buffer.from(signature.value || "", "base64url"),
          )
        );
      },
    }),
  });
}
