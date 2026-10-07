import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildRrsiTenantIndexAnchor,
  verifyRrsiTenantIndexAnchor,
  verifyRrsiTenantIndexAnchorSignature,
  serializeRrsiTenantIndexAnchorSignatureMessage,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-contracts.js";
import { rrsiHash, rrsiCanonical } from "../../src/lib/evolution/rrsi-data.js";
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
let keys, second;
beforeAll(() => {
  keys = generateKeyPairSync("ed25519");
  second = generateKeyPairSync("ed25519");
});
function input() {
  const ledgerIdentity = {
    ledgerId: "ledger-test",
    identityDigest: digest("identity"),
    epoch: "epoch-test",
  };
  return {
    deploymentId: "test-deployment",
    tenantId: "tenant-a",
    routingScope: "installation",
    indexId: `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", "tenant-a").slice(7)}`,
    ledgerIdentity,
    artifactScope: {
      artifactTenantId: "tenant-a-artifacts",
      audience: "rrsi-runtime",
      purpose: "evolution-ledger",
    },
    storageGraphDigest: digest("graph"),
    rootPublicKeyDigest: digest(
      keys.publicKey.export({ format: "der", type: "spki" }),
    ),
    revision: 1,
    previousAnchorDigest: null,
    checkpoint: { ...ledgerIdentity, sequence: 7, headDigest: digest("head") },
    restrictionHistory: {
      recordCount: 2,
      tailRecordDigest: digest("tail"),
      restrictionsDigest: digest("prohibitions"),
    },
  };
}
function packet(anchor = buildRrsiTenantIndexAnchor(input())) {
  return {
    anchor,
    publicKeySpki: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    signature: sign(
      null,
      serializeRrsiTenantIndexAnchorSignatureMessage(anchor),
      keys.privateKey,
    ).toString("base64url"),
  };
}
describe("signed tenant index anchor declarations without root authority", () => {
  it("detaches and freezes the exact declaration without authenticating its checkpoint or pin", () => {
    const value = input();
    const anchor = buildRrsiTenantIndexAnchor(value);
    value.artifactScope.audience = "changed";
    expect(anchor.artifactScope.audience).toBe("rrsi-runtime");
    expect(Object.isFrozen(anchor.checkpoint)).toBe(true);
    expect(
      verifyRrsiTenantIndexAnchor(JSON.parse(JSON.stringify(anchor))),
    ).toEqual(anchor);
    expect(anchor).toMatchObject({
      structuralOnly: true,
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
  });
  it.each(["installation", "shared-tenant-authority"])(
    "never converts caller self-signing into %s authority",
    (routingScope) => {
      const anchor = buildRrsiTenantIndexAnchor({ ...input(), routingScope });
      const result = verifyRrsiTenantIndexAnchorSignature(packet(anchor));
      expect(result).toMatchObject({
        signatureVerifiedRelativeToKey: true,
        rootAuthorityVerified: false,
        routingPinVerified: false,
        historyTransferVerified: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
        authenticated: false,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
  );
  it.each([
    "deploymentId",
    "tenantId",
    "storageGraphDigest",
    "rootPublicKeyDigest",
    "routingScope",
    "artifactScope",
    "ledgerIdentity",
    "checkpoint",
    "restrictionHistory.tailRecordDigest",
    "restrictionHistory.restrictionsDigest",
    "revision",
  ])("binds signed %s exactly", (field) => {
    const valid = packet();
    const changed = input();
    if (field === "routingScope")
      changed.routingScope = "shared-tenant-authority";
    else if (field === "artifactScope")
      changed.artifactScope.audience = "other-audience";
    else if (field === "ledgerIdentity") {
      changed.ledgerIdentity.identityDigest = digest("other-identity");
      changed.checkpoint.identityDigest = changed.ledgerIdentity.identityDigest;
    } else if (field === "checkpoint") {
      changed.checkpoint.sequence++;
      changed.checkpoint.headDigest = digest("other-head");
    } else if (field.startsWith("restrictionHistory."))
      changed.restrictionHistory[field.split(".")[1]] =
        digest("other-restrictions");
    else if (field === "revision") {
      changed.revision = 2;
      changed.previousAnchorDigest = digest("prior-anchor");
    } else
      changed[field] = field.endsWith("Digest")
        ? digest("other")
        : "another-id";
    if (field === "tenantId")
      changed.indexId = `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", changed.tenantId).slice(7)}`;
    valid.anchor = buildRrsiTenantIndexAnchor(changed);
    expect(() => verifyRrsiTenantIndexAnchorSignature(valid)).toThrow(
      field === "rootPublicKeyDigest"
        ? /public key differs from the declared root digest/
        : /signature was rejected/,
    );
  });
  it.each(["authenticated", "readyForExecution", "qualifiesForPromotion"])(
    "rejects forged %s even with a recomputed structural digest",
    (field) => {
      const anchor = JSON.parse(
        JSON.stringify(buildRrsiTenantIndexAnchor(input())),
      );
      anchor[field] = true;
      delete anchor.anchorDigest;
      anchor.anchorDigest = rrsiHash(anchor.schema, anchor);
      expect(() => verifyRrsiTenantIndexAnchor(anchor)).toThrow();
    },
  );
  it("rejects a different signer and a signature from another domain", () => {
    const value = packet();
    value.signature = sign(
      null,
      serializeRrsiTenantIndexAnchorSignatureMessage(value.anchor),
      second.privateKey,
    ).toString("base64url");
    expect(() => verifyRrsiTenantIndexAnchorSignature(value)).toThrow(
      /signature was rejected/,
    );
    value.signature = sign(
      null,
      Buffer.from(
        `another-anchor-signature-domain/v1\0${rrsiCanonical(value.anchor)}`,
      ),
      keys.privateKey,
    ).toString("base64url");
    expect(() => verifyRrsiTenantIndexAnchorSignature(value)).toThrow(
      /signature was rejected/,
    );
  });
  it.each(["publicKeySpki", "signature"])(
    "rejects noncanonical %s encodings",
    (field) => {
      const value = packet();
      value[field] += "=";
      expect(() => verifyRrsiTenantIndexAnchorSignature(value)).toThrow();
    },
  );
  it.each([
    (value) => {
      value.indexId = "caller-index";
    },
    (value) => {
      value.checkpoint.epoch = "other-epoch";
    },
    (value) => {
      value.previousAnchorDigest = digest("unexpected");
    },
    (value) => {
      value.revision = 2;
    },
    (value) => {
      value.restrictionHistory.recordCount = 257;
    },
    (value) => {
      value.restrictionHistory.recordCount = 0;
    },
    (value) => {
      value.artifactScope.purpose = "skill-release-transition";
    },
  ])("rejects inconsistent anchor bounds or scope %#", (change) => {
    const value = input();
    change(value);
    expect(() => buildRrsiTenantIndexAnchor(value)).toThrow();
  });
  it("permits a declared successor but does not certify migration or preserved restrictions", () => {
    const first = buildRrsiTenantIndexAnchor(input());
    const next = buildRrsiTenantIndexAnchor({
      ...input(),
      revision: 2,
      previousAnchorDigest: first.anchorDigest,
    });
    expect(
      verifyRrsiTenantIndexAnchorSignature(packet(next))
        .historyTransferVerified,
    ).toBe(false);
  });
  it("accepts an explicit empty history only as an unverified declaration", () => {
    const value = input();
    value.restrictionHistory.recordCount = 0;
    value.restrictionHistory.tailRecordDigest = null;
    expect(
      verifyRrsiTenantIndexAnchorSignature(
        packet(buildRrsiTenantIndexAnchor(value)),
      ).routingPinVerified,
    ).toBe(false);
  });
  it("rejects getters, proxy traps and arbitrary verifier callbacks without invoking them", () => {
    const touched = vi.fn();
    const value = input();
    Object.defineProperty(value, "tenantId", {
      enumerable: true,
      get: touched,
    });
    expect(() => buildRrsiTenantIndexAnchor(value)).toThrow();
    expect(() =>
      buildRrsiTenantIndexAnchor(new Proxy(input(), { get: touched })),
    ).toThrow();
    expect(() =>
      verifyRrsiTenantIndexAnchorSignature({ ...packet(), verifier: touched }),
    ).toThrow();
    expect(touched).not.toHaveBeenCalled();
  });
});
