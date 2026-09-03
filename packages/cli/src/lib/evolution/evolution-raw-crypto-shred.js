import { createHash } from "node:crypto";

export const EVOLUTION_RAW_CRYPTO_SHRED_SCHEMA =
  "chainlesschain.evolution-raw-crypto-shred/v1";
export const EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA =
  "chainlesschain.evolution-raw-deletion-tombstone/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function capture(ports, name) {
  if (typeof ports?.[name] !== "function")
    throw new TypeError(`Raw crypto-shred port ${name} is required`);
  return ports[name].bind(ports);
}

function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function digest(value, name) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${name} is invalid`);
  return value;
}

function verifyPruningCall(call, tenantId) {
  const request = call?.request;
  if (
    request?.tenantId !== tenantId ||
    request.operation !== "crypto-shred" ||
    !DIGEST.test(call?.requestDigest ?? "") ||
    call.requestDigest !==
      hash("chainlesschain.governed-wiki-pruning-operation/v1", request)
  )
    throw new Error("Raw crypto-shred request is not pruning-plan-bound");
  const payload = request.payload;
  if (
    typeof payload?.rawArtifactRef !== "string" ||
    !payload.rawArtifactRef.startsWith(`artifact://${tenantId}/raw/`) ||
    typeof payload.keyRef !== "string" ||
    !payload.keyRef.startsWith(`kms://${tenantId}/`)
  )
    throw new Error("Raw crypto-shred target is cross-tenant or incomplete");
  for (const [value, name] of [
    [request.planDigest, "planDigest"],
    [request.wikiStateDigest, "wikiStateDigest"],
    [payload.sourceDigest, "sourceDigest"],
    [payload.rawCipherDigest, "rawCipherDigest"],
    [payload.receiptDigest, "deletionReceiptDigest"],
  ])
    digest(value, name);
  string(payload.evidenceRef, "evidenceRef");
  string(payload.artifactRef, "artifactRef");
  return request;
}

export class EvolutionRawCryptoShred {
  constructor({ tenantId, ports } = {}) {
    this.tenantId = string(tenantId, "tenantId");
    this._verifyDeletionReceipt = capture(ports, "verifyDeletionReceipt");
    this._destroyKey = capture(ports, "destroyKey");
    this._confirmKeyDestroyed = capture(ports, "confirmKeyDestroyed");
    this._retainTombstone = capture(ports, "retainTombstone");
  }

  async shred(call) {
    const request = verifyPruningCall(call, this.tenantId);
    const target = request.payload;
    const deletion = await this._verifyDeletionReceipt({
      tenantId: this.tenantId,
      receiptDigest: target.receiptDigest,
    });
    if (
      deletion?.authenticated !== true ||
      deletion.decision !== "delete" ||
      deletion.tenantId !== this.tenantId ||
      deletion.receiptDigest !== target.receiptDigest ||
      deletion.evidenceRef !== target.evidenceRef ||
      deletion.sourceDigest !== target.sourceDigest ||
      deletion.artifactRef !== target.artifactRef ||
      deletion.rawArtifactRef !== target.rawArtifactRef ||
      deletion.rawCipherDigest !== target.rawCipherDigest ||
      deletion.keyRef !== target.keyRef
    )
      throw new Error("Raw deletion receipt was substituted");
    const destructionCore = {
      schema: EVOLUTION_RAW_CRYPTO_SHRED_SCHEMA,
      tenantId: this.tenantId,
      planDigest: request.planDigest,
      wikiStateDigest: request.wikiStateDigest,
      evidenceRef: target.evidenceRef,
      rawArtifactRef: target.rawArtifactRef,
      rawCipherDigest: target.rawCipherDigest,
      keyRef: target.keyRef,
      deletionReceiptDigest: target.receiptDigest,
    };
    const destructionRequest = freeze({
      ...destructionCore,
      requestDigest: hash(EVOLUTION_RAW_CRYPTO_SHRED_SCHEMA, destructionCore),
    });
    const destroyed = await this._destroyKey(destructionRequest);
    if (
      destroyed?.authenticated !== true ||
      destroyed.durable !== true ||
      destroyed.destroyed !== true ||
      destroyed.keyRef !== target.keyRef ||
      destroyed.requestDigest !== destructionRequest.requestDigest ||
      !DIGEST.test(destroyed.receiptDigest ?? "")
    )
      throw new Error("Raw encryption key destruction was not durable");
    const confirmation = await this._confirmKeyDestroyed({
      tenantId: this.tenantId,
      keyRef: target.keyRef,
      destructionReceiptDigest: destroyed.receiptDigest,
    });
    if (
      confirmation?.authenticated !== true ||
      confirmation.destroyed !== true ||
      confirmation.keyRef !== target.keyRef ||
      confirmation.destructionReceiptDigest !== destroyed.receiptDigest ||
      !DIGEST.test(confirmation.receiptDigest ?? "")
    )
      throw new Error("Raw encryption key destruction could not be confirmed");
    const tombstoneCore = {
      schema: EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA,
      tenantId: this.tenantId,
      pruningRequestDigest: call.requestDigest,
      destructionRequestDigest: destructionRequest.requestDigest,
      destructionReceiptDigest: destroyed.receiptDigest,
      confirmationReceiptDigest: confirmation.receiptDigest,
      evidenceRef: target.evidenceRef,
      rawArtifactRef: target.rawArtifactRef,
      rawCipherDigest: target.rawCipherDigest,
      deletionReceiptDigest: target.receiptDigest,
    };
    const tombstone = freeze({
      ...tombstoneCore,
      tombstoneDigest: hash(
        EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA,
        tombstoneCore,
      ),
    });
    const retained = await this._retainTombstone({ tombstone });
    if (
      retained?.authenticated !== true ||
      retained.durable !== true ||
      retained.tombstoneDigest !== tombstone.tombstoneDigest ||
      !DIGEST.test(retained.receiptDigest ?? "")
    )
      throw new Error("Raw deletion tombstone was not durably retained");
    return freeze({
      authenticated: true,
      durable: true,
      requestDigest: call.requestDigest,
      receiptDigest: retained.receiptDigest,
      tombstoneDigest: tombstone.tombstoneDigest,
    });
  }
}
