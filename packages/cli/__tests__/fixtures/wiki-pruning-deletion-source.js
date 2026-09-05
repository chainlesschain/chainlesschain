import { createHmac } from "node:crypto";
import {
  EvolutionRawDeletionLedgerAdapter,
  EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA,
  digestEvolutionRawDeletionReceipt,
} from "../../src/lib/evolution/evolution-raw-deletion-ledger-adapter.js";
import {
  pruningCanonical,
  pruningDigest,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

// Real retained deletion authority records; test-only signing identity. This
// fixture never pretends to operate a KMS or to prove that a key was destroyed.
export function wikiPruningDeletionSource(resources, wiki) {
  const material = (receipt) => {
    const core = structuredClone(receipt);
    delete core.receiptDigest;
    delete core.attestation.value;
    return pruningCanonical(core);
  };
  const sign = (receipt) =>
    createHmac("sha256", "test-only-pruning-privacy")
      .update(material(receipt))
      .digest("base64url");
  const trust = {
    algorithm: "hmac-sha256",
    issuer: "authority:test-pruning-privacy",
    keyId: "key://tests/pruning-privacy",
    trustPolicyDigest: pruningDigest("test-privacy-policy", {}),
  };
  const adapter = new EvolutionRawDeletionLedgerAdapter({
    descriptor: {
      ...resources.descriptor,
      authorityId: "authority:test-pruning-deletion-ledger",
      revision: 1,
      handlerArtifactDigest: pruningDigest("test-deletion-handler", {}),
    },
    artifactPorts: resources.artifactPorts,
    ledgerArtifactResolver: resources.resolver,
    ledger: resources.backend.ledger,
    now: resources.clock,
    deletionReceiptVerifier: {
      verify: ({ receipt }) =>
        Object.entries(trust).every(
          ([key, value]) => receipt.attestation[key] === value,
        ) && receipt.attestation.value === sign(receipt),
    },
  });
  function receipt() {
    const source = wiki.loadWiki().state.evidence["ev-maintenance"];
    if (!source)
      throw new Error("seed Wiki evidence before requesting deletion");
    const core = {
      schema: EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA,
      tenantId: resources.descriptor.tenantId,
      decision: "delete",
      evidenceRef: source.ref,
      sourceDigest: source.sourceDigest,
      artifactRef: source.artifactRef,
      rawArtifactRef: `artifact://${resources.descriptor.tenantId}/raw/dependency`,
      rawCipherDigest: pruningDigest("test-only-ciphertext", {}),
      keyRef: `kms://${resources.descriptor.tenantId}/dependency`,
      issuedAt: new Date(resources.clock()).toISOString(),
      attestation: { ...trust, value: "pending" },
    };
    core.attestation.value = sign(core);
    return { ...core, receiptDigest: digestEvolutionRawDeletionReceipt(core) };
  }
  return {
    receipt,
    retain: () => adapter.retainDeletionReceipt({ receipt: receipt() }),
    resolve: (request) => adapter.resolveDeletionReceipt(request),
  };
}
