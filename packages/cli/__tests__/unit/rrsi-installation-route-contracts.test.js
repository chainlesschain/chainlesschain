import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildRrsiInstallationRouteRoot,
  buildRrsiInstallationRoutes,
  buildRrsiInstallationRouteHighwater,
  verifyRrsiInstallationRouteSnapshot,
  checkRrsiInstallationAnchorContinuation,
  RRSI_INSTALLATION_ROUTE_HIGHWATER_SCHEMA,
} from "../../src/lib/evolution/rrsi-installation-route-contracts.js";
import { rrsiEnvelope, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  makeRouteFixture,
  routeDigest,
  signRouteAnchor,
} from "../fixtures/rrsi-installation-route.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const snapshot = ({ root, routes, highwater }) => ({ root, routes, highwater });
function rootInput(root) {
  return Object.fromEntries(
    [
      "installationId",
      "tenantId",
      "routingScope",
      "rootPublicKeySpki",
      "rootPublicKeyDigest",
    ].map((name) => [name, root[name]]),
  );
}

describe("selected installation route declarations", () => {
  it("checks genuinely signed declarations but retains every authority HOLD", () => {
    const fixture = makeRouteFixture();
    const input = snapshot(fixture);
    const result = verifyRrsiInstallationRouteSnapshot(input);
    expect(result).toMatchObject({
      declaredRouteConsistent: true,
      signaturesVerifiedRelativeToDeclaredKey: true,
      selectedContextOnly: true,
      rootAuthorityVerified: false,
      routingPinVerified: false,
      historyTransferVerified: false,
      journalPrefixVerified: false,
      restrictionHistoryVerified: false,
      crossProcessRollbackProtectionVerified: false,
      tenantWideIndexAuthorityVerified: false,
      generationProvenanceVerified: false,
      grantsMutationOrPromotionAuthority: false,
      decision: "HOLD",
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(verifyRrsiInstallationRouteSnapshot(copy(input))).toEqual(result);
  });
  it("accepts exact anchor idempotence without adding another route record", () => {
    const fixture = makeRouteFixture(),
      packet = fixture.routes.packets[1];
    expect(
      checkRrsiInstallationAnchorContinuation({
        previous: packet,
        next: copy(packet),
      }).continuation,
    ).toBe("same-anchor");
    expect(() =>
      buildRrsiInstallationRoutes({
        root: fixture.root,
        packets: [...fixture.routes.packets, packet],
      }),
    ).toThrow(/duplicate anchor/);
  });
  it("checks a single declared successor without claiming journal/history transfer", () => {
    const fixture = makeRouteFixture();
    const result = checkRrsiInstallationAnchorContinuation({
      previous: fixture.routes.packets[0],
      next: fixture.routes.packets[1],
    });
    expect(result).toMatchObject({
      continuation: "declared-successor",
      historyTransferVerified: false,
      decision: "HOLD",
    });
  });
  it.each([
    "deploymentId",
    "tenantId",
    "ledgerIdentity",
    "artifactScope",
    "storageGraphDigest",
  ])("rejects a valid signature that changes fixed %s", (field) => {
    const fixture = makeRouteFixture(),
      next = copy(fixture.secondInput);
    if (field === "tenantId") {
      next.tenantId = "tenant-b";
      next.indexId = `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", next.tenantId).slice(7)}`;
    } else if (field === "ledgerIdentity") {
      next.ledgerIdentity.epoch = "epoch-other";
      next.checkpoint.epoch = "epoch-other";
    } else if (field === "artifactScope")
      next.artifactScope.audience = "other-audience";
    else
      next[field] = field.endsWith("Digest")
        ? routeDigest("other")
        : "deployment-b";
    const signed = signRouteAnchor(next, fixture.keys);
    expect(() =>
      checkRrsiInstallationAnchorContinuation({
        previous: fixture.routes.packets[0],
        next: signed,
      }),
    ).toThrow(new RegExp(`cannot change ${field}`));
  });
  it.each([
    "checkpoint",
    "restriction-count",
    "restriction-tail",
    "restriction-set",
  ])(
    "refuses %s changes even with a real signature and increasing revision",
    (field) => {
      const fixture = makeRouteFixture(),
        next = copy(fixture.secondInput);
      if (field === "checkpoint") {
        next.checkpoint.sequence++;
        next.checkpoint.headDigest = routeDigest("new-head");
      } else if (field === "restriction-count")
        next.restrictionHistory.recordCount++;
      else if (field === "restriction-tail")
        next.restrictionHistory.tailRecordDigest = routeDigest("new-tail");
      else next.restrictionHistory.restrictionsDigest = routeDigest("new-set");
      expect(() =>
        checkRrsiInstallationAnchorContinuation({
          previous: fixture.routes.packets[0],
          next: signRouteAnchor(next, fixture.keys),
        }),
      ).toThrow(/requires independent/);
    },
  );
  it("rejects a same-revision checkpoint conflict rather than returning idempotence", () => {
    const fixture = makeRouteFixture(),
      next = copy(fixture.secondInput);
    next.checkpoint.headDigest = routeDigest("fork");
    expect(() =>
      checkRrsiInstallationAnchorContinuation({
        previous: fixture.routes.packets[1],
        next: signRouteAnchor(next, fixture.keys),
      }),
    ).toThrow(/same revision has a different anchor/);
  });
  it.each([
    "rollback",
    "jump",
    "wrong-predecessor",
    "shared-scope",
    "different-key",
  ])("rejects genuinely signed %s", (mode) => {
    const fixture = makeRouteFixture(),
      previous = fixture.routes.packets[1];
    const next = {
      ...copy(fixture.secondInput),
      revision: 3,
      previousAnchorDigest: previous.anchor.anchorDigest,
    };
    let keys = fixture.keys,
      message;
    if (mode === "rollback") {
      Object.assign(next, copy(fixture.firstInput));
      message = /increase exactly once/;
    } else if (mode === "jump") {
      next.revision = 4;
      message = /increase exactly once/;
    } else if (mode === "wrong-predecessor") {
      next.previousAnchorDigest = routeDigest("different predecessor");
      message = /predecessor differs/;
    } else if (mode === "shared-scope") {
      next.routingScope = "shared-tenant-authority";
      message = /scope must be installation/;
    } else {
      keys = generateKeyPairSync("ed25519");
      next.rootPublicKeyDigest = routeDigest(
        keys.publicKey.export({ format: "der", type: "spki" }),
      );
      message = /cannot change root key/;
    }
    expect(() =>
      checkRrsiInstallationAnchorContinuation({
        previous,
        next: signRouteAnchor(next, keys),
      }),
    ).toThrow(message);
  });
  it.each([
    "no-genesis",
    "empty",
    "too-many",
    "wrong-tenant",
    "wrong-root",
    "invalid-signature",
  ])("rejects incomplete route history %s", (mode) => {
    const fixture = makeRouteFixture();
    let packets = copy(fixture.routes.packets);
    if (mode === "no-genesis") packets.shift();
    else if (mode === "empty") packets = [];
    else if (mode === "too-many") packets = Array(65).fill(packets[0]);
    else if (mode === "wrong-tenant")
      packets = makeRouteFixture({ tenantId: "tenant-b", keys: fixture.keys })
        .routes.packets;
    else if (mode === "wrong-root") packets = makeRouteFixture().routes.packets;
    else packets[1].signature = "A".repeat(86);
    expect(() =>
      buildRrsiInstallationRoutes({ root: fixture.root, packets }),
    ).toThrow();
  });
  it.each([
    "installationId",
    "tenantId",
    "rootRecordDigest",
    "routesDigest",
    "anchorRevision",
    "anchorDigest",
    "checkpoint",
    "restrictionHistory",
  ])("rejects a recomputed highwater with conflicting %s", (field) => {
    const fixture = makeRouteFixture();
    const core = Object.fromEntries(
      [
        "installationId",
        "tenantId",
        "rootRecordDigest",
        "routesDigest",
        "anchorRevision",
        "anchorDigest",
        "checkpoint",
        "restrictionHistory",
      ].map((name) => [name, copy(fixture.highwater[name])]),
    );
    if (field === "anchorRevision") core.anchorRevision = 1;
    else if (field === "checkpoint")
      core.checkpoint.headDigest = routeDigest("fork");
    else if (field === "restrictionHistory")
      core.restrictionHistory.recordCount--;
    else
      core[field] = field.endsWith("Digest")
        ? routeDigest("different")
        : "different-id";
    const highwater = rrsiEnvelope(
      RRSI_INSTALLATION_ROUTE_HIGHWATER_SCHEMA,
      "highwaterDigest",
      core,
    );
    expect(() =>
      verifyRrsiInstallationRouteSnapshot({ ...snapshot(fixture), highwater }),
    ).toThrow(/envelope, digest, or structural flags mismatch/);
  });
  it("rejects an older complete highwater rather than adopting a lower routes tail", () => {
    const fixture = makeRouteFixture();
    const one = buildRrsiInstallationRoutes({
      root: fixture.root,
      packets: [fixture.routes.packets[0]],
    });
    const old = buildRrsiInstallationRouteHighwater({
      root: fixture.root,
      routes: one,
    });
    expect(() =>
      verifyRrsiInstallationRouteSnapshot({
        ...snapshot(fixture),
        highwater: old,
      }),
    ).toThrow();
  });
  it.each(["scope", "key-digest", "noncanonical-key", "wrong-type"])(
    "rejects root declarations with %s",
    (mode) => {
      const fixture = makeRouteFixture(),
        value = rootInput(fixture.root);
      if (mode === "scope") value.routingScope = "shared-tenant-authority";
      else if (mode === "key-digest")
        value.rootPublicKeyDigest = routeDigest("wrong");
      else if (mode === "noncanonical-key") value.rootPublicKeySpki += "=";
      else value.rootPublicKeySpki = 1;
      expect(() => buildRrsiInstallationRouteRoot(value)).toThrow();
    },
  );
  it("rejects accessors and proxies without invoking caller code", () => {
    const fixture = makeRouteFixture(),
      touched = vi.fn(),
      value = rootInput(fixture.root);
    Object.defineProperty(value, "tenantId", {
      enumerable: true,
      get: touched,
    });
    expect(() => buildRrsiInstallationRouteRoot(value)).toThrow();
    expect(() =>
      verifyRrsiInstallationRouteSnapshot(
        new Proxy(snapshot(fixture), { get: touched }),
      ),
    ).toThrow();
    expect(() =>
      verifyRrsiInstallationRouteSnapshot({
        ...snapshot(fixture),
        verifier: touched,
      }),
    ).toThrow();
    expect(touched).not.toHaveBeenCalled();
  });
  it("rejects a caller-selected index before it can be signed", () => {
    const fixture = makeRouteFixture();
    expect(() =>
      signRouteAnchor(
        { ...fixture.secondInput, indexId: "rrsi-text.changed" },
        fixture.keys,
      ),
    ).toThrow(/index ID/);
  });
  it("checks the full 64-anchor bound without granting installer or history authority", () => {
    const fixture = makeRouteFixture();
    const packets = [fixture.routes.packets[0]];
    for (let revision = 2; revision <= 64; revision++)
      packets.push(
        signRouteAnchor(
          {
            ...fixture.firstInput,
            revision,
            previousAnchorDigest: packets.at(-1).anchor.anchorDigest,
          },
          fixture.keys,
        ),
      );
    const routes = buildRrsiInstallationRoutes({ root: fixture.root, packets });
    const highwater = buildRrsiInstallationRouteHighwater({
      root: fixture.root,
      routes,
    });
    expect(
      verifyRrsiInstallationRouteSnapshot({
        root: fixture.root,
        routes,
        highwater,
      }),
    ).toMatchObject({
      anchorRevision: 64,
      routingPinVerified: false,
      decision: "HOLD",
    });
  });
  it("does not claim a signature binds the unsigned installation label", () => {
    const fixture = makeRouteFixture();
    const root = buildRrsiInstallationRouteRoot({
      ...rootInput(fixture.root),
      installationId: "installation-b",
    });
    const routes = buildRrsiInstallationRoutes({
      root,
      packets: fixture.routes.packets,
    });
    const highwater = buildRrsiInstallationRouteHighwater({ root, routes });
    expect(routes.packets).toEqual(fixture.routes.packets);
    expect(
      verifyRrsiInstallationRouteSnapshot({ root, routes, highwater }),
    ).toMatchObject({
      installationId: "installation-b",
      signaturesVerifiedRelativeToDeclaredKey: true,
      installationBindingSignatureVerified: false,
      rootAuthorityVerified: false,
      routingPinVerified: false,
      decision: "HOLD",
    });
  });
  it.each([
    ["root", "rootRecordDigest"],
    ["routes", "routesDigest"],
    ["highwater", "highwaterDigest"],
  ])("rejects a recomputed authenticated flag on %s", (name, digestField) => {
    const value = copy(snapshot(makeRouteFixture()));
    value[name].authenticated = true;
    delete value[name][digestField];
    value[name][digestField] = rrsiHash(value[name].schema, value[name]);
    expect(() => verifyRrsiInstallationRouteSnapshot(value)).toThrow(
      /envelope, digest, or structural flags mismatch/,
    );
  });
});
