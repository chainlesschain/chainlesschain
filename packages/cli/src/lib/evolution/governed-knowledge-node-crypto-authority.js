import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { types as utilTypes } from "node:util";

export const GOVERNED_KNOWLEDGE_CRYPTO_AUTHORITY_SCHEMA =
  "chainlesschain.governed-knowledge-node-crypto-authority/v1";

const AUTHORITIES = new WeakSet();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SIGNATURE_KEYS = new Set(["algorithm", "keyId", "value"]);
const CIPHER_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 12 * 1024 * 1024;

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function plainRecord(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function keyObject(value, kind, label) {
  let key;
  try {
    if (
      value &&
      typeof value === "object" &&
      !utilTypes.isProxy(value) &&
      value.type === kind
    ) {
      key = value;
    } else {
      key =
        kind === "private" ? createPrivateKey(value) : createPublicKey(value);
    }
  } catch {
    throw new TypeError(`${label} is not a valid ${kind} key`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be Ed25519`);
  }
  return key;
}

function publicKeyId(key) {
  const spki = key.export({ format: "der", type: "spki" });
  return `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`;
}

function scopeBinding(value) {
  const source = plainRecord(value, "knowledge metadata");
  const tenantId = identifier(source.tenantId, "knowledge tenantId");
  const knowledgeId = identifier(source.knowledgeId, "knowledgeId");
  const scope = identifier(source.scope, "knowledge scope");
  const scopeId = identifier(source.scopeId, "knowledge scopeId");
  const action = identifier(source.action, "knowledge action");
  if (!["project", "team", "org"].includes(scope)) {
    throw new Error("shared knowledge encryption scope is invalid");
  }
  if (!["upsert", "tombstone", "revoke"].includes(action)) {
    throw new Error("shared knowledge action is invalid");
  }
  if (!DIGEST.test(source.contentDigest ?? "")) {
    throw new TypeError("knowledge contentDigest is invalid");
  }
  plainRecord(source.vectorClock, "knowledge vectorClock");
  return Object.freeze({
    schema: GOVERNED_KNOWLEDGE_CRYPTO_AUTHORITY_SCHEMA,
    tenantId,
    knowledgeId,
    scope,
    scopeId,
    action,
    contentDigest: source.contentDigest,
    vectorClock: structuredClone(source.vectorClock),
  });
}

function aadFor(value) {
  return Buffer.from(canonical(scopeBinding(value)), "utf8");
}

function normalizeScopeKeys(scopeKeys, tenantId) {
  if (
    !Array.isArray(scopeKeys) ||
    scopeKeys.length < 1 ||
    scopeKeys.length > 256
  ) {
    throw new TypeError("scopeKeys must contain 1..256 keys");
  }
  const byScope = new Map();
  const byReference = new Map();
  for (const input of scopeKeys) {
    const record = plainRecord(input, "scope key");
    const keyTenantId = identifier(record.tenantId, "scope key tenantId");
    const scope = identifier(record.scope, "scope key scope");
    const scopeId = identifier(record.scopeId, "scope key scopeId");
    const keyRef = identifier(record.keyRef, "scope key keyRef");
    if (
      keyTenantId !== tenantId ||
      !["project", "team", "org"].includes(scope)
    ) {
      throw new Error("scope key crossed its tenant or scope boundary");
    }
    if (!Buffer.isBuffer(record.key) || record.key.length !== 32) {
      throw new TypeError("scope key must be a 32-byte AES key");
    }
    const binding = `${scope}\0${scopeId}`;
    if (byReference.has(keyRef)) throw new Error("scope keyRef is duplicated");
    byReference.set(keyRef, {
      tenantId,
      scope,
      scopeId,
      keyRef,
      key: Buffer.from(record.key),
    });
    if (record.active === true) {
      if (byScope.has(binding))
        throw new Error("scope has multiple active keys");
      byScope.set(binding, byReference.get(keyRef));
    }
  }
  if (byScope.size < 1)
    throw new Error("no active scope encryption key exists");
  return { byScope, byReference };
}

function normalizePeers(peers, tenantId) {
  if (!Array.isArray(peers) || peers.length < 1 || peers.length > 256) {
    throw new TypeError("peerIdentities must contain 1..256 devices");
  }
  const result = new Map();
  const keyIds = new Set();
  for (const input of peers) {
    const peer = plainRecord(input, "peer identity");
    if (identifier(peer.tenantId, "peer tenantId") !== tenantId) {
      throw new Error("peer identity crossed its tenant boundary");
    }
    const deviceId = identifier(peer.deviceId, "peer deviceId");
    const publicKey = keyObject(peer.publicKey, "public", "peer publicKey");
    const keyId = publicKeyId(publicKey);
    if (peer.keyId !== undefined && peer.keyId !== keyId) {
      throw new Error("peer keyId does not bind its Ed25519 public key");
    }
    if (result.has(deviceId))
      throw new Error("peer device identity is duplicated");
    if (keyIds.has(keyId)) {
      throw new Error("peer Ed25519 key is assigned to multiple devices");
    }
    keyIds.add(keyId);
    result.set(deviceId, { publicKey, keyId });
  }
  return result;
}

function signatureMessage(envelopeDigest) {
  if (!DIGEST.test(envelopeDigest ?? "")) {
    throw new TypeError("envelopeDigest is invalid");
  }
  return Buffer.from(
    `chainlesschain.governed-knowledge-envelope-signature/v1\0${envelopeDigest}`,
    "utf8",
  );
}

export function createGovernedKnowledgeNodeCryptoAuthority({
  tenantId: tenantIdInput,
  deviceId: deviceIdInput,
  privateKey: privateKeyInput,
  scopeKeys,
  peerIdentities,
  random = randomBytes,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const deviceId = identifier(deviceIdInput, "deviceId");
  if (typeof random !== "function" || utilTypes.isProxy(random)) {
    throw new TypeError("random must be a non-proxy function");
  }
  const privateKey = keyObject(privateKeyInput, "private", "privateKey");
  const ownPublicKey = createPublicKey(privateKey);
  const ownKeyId = publicKeyId(ownPublicKey);
  const keys = normalizeScopeKeys(scopeKeys, tenantId);
  const peers = normalizePeers(peerIdentities, tenantId);
  const ownPeer = peers.get(deviceId);
  if (!ownPeer || ownPeer.keyId !== ownKeyId) {
    throw new Error("device private key is not pinned in peer identities");
  }

  const authority = Object.freeze({
    schema: GOVERNED_KNOWLEDGE_CRYPTO_AUTHORITY_SCHEMA,
    tenantId,
    deviceId,
    keyId: ownKeyId,
    async encrypt({ knowledge, plaintext } = {}) {
      const aad = aadFor(knowledge);
      const binding = `${knowledge.scope}\0${knowledge.scopeId}`;
      const scopeKey = keys.byScope.get(binding);
      if (!scopeKey)
        throw new Error("no active key exists for knowledge scope");
      if (
        !Buffer.isBuffer(plaintext) ||
        plaintext.length < 1 ||
        plaintext.length > MAX_PLAINTEXT_BYTES
      ) {
        throw new TypeError("knowledge plaintext is empty or unbounded");
      }
      const nonce = Buffer.from(random(NONCE_BYTES));
      if (nonce.length !== NONCE_BYTES) {
        throw new Error("crypto authority returned an invalid nonce");
      }
      const cipher = createCipheriv("aes-256-gcm", scopeKey.key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const ciphertext = Buffer.concat([
        Buffer.from([CIPHER_VERSION]),
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]);
      return Object.freeze({
        ciphertext,
        ciphertextDigest: sha256(ciphertext),
        keyRef: scopeKey.keyRef,
      });
    },
    async decrypt({ envelope } = {}) {
      const source = plainRecord(envelope, "knowledge envelope");
      if (source.tenantId !== tenantId)
        throw new Error("envelope tenant mismatch");
      const scopeKey = keys.byReference.get(source.keyRef);
      if (
        !scopeKey ||
        scopeKey.scope !== source.scope ||
        scopeKey.scopeId !== source.scopeId
      ) {
        throw new Error("envelope key is not authorized for its scope");
      }
      const ciphertext = Buffer.from(source.ciphertext ?? "", "base64");
      if (
        ciphertext.length <= 1 + NONCE_BYTES + TAG_BYTES ||
        ciphertext[0] !== CIPHER_VERSION ||
        sha256(ciphertext) !== source.ciphertextDigest
      ) {
        throw new Error("encrypted knowledge payload is invalid");
      }
      const nonce = ciphertext.subarray(1, 1 + NONCE_BYTES);
      const tag = ciphertext.subarray(
        1 + NONCE_BYTES,
        1 + NONCE_BYTES + TAG_BYTES,
      );
      const body = ciphertext.subarray(1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", scopeKey.key, nonce);
      decipher.setAAD(aadFor(source));
      decipher.setAuthTag(tag);
      try {
        return Object.freeze({
          plaintext: Buffer.concat([decipher.update(body), decipher.final()]),
        });
      } catch {
        throw new Error("encrypted knowledge authentication failed");
      }
    },
    async sign({ envelopeDigest } = {}) {
      return Object.freeze({
        algorithm: "Ed25519",
        keyId: ownKeyId,
        value: sign(
          null,
          signatureMessage(envelopeDigest),
          privateKey,
        ).toString("base64url"),
      });
    },
    async verify({ core, envelopeDigest, signature } = {}) {
      const source = plainRecord(core, "knowledge envelope core");
      const peer = peers.get(source.senderDeviceId);
      if (
        source.tenantId !== tenantId ||
        !peer ||
        !signature ||
        typeof signature !== "object" ||
        Array.isArray(signature) ||
        Object.keys(signature).some((key) => !SIGNATURE_KEYS.has(key)) ||
        signature.algorithm !== "Ed25519" ||
        signature.keyId !== peer.keyId ||
        typeof signature.value !== "string"
      ) {
        return false;
      }
      let bytes;
      try {
        bytes = Buffer.from(signature.value, "base64url");
      } catch {
        return false;
      }
      return (
        bytes.length === 64 &&
        bytes.toString("base64url") === signature.value &&
        verify(null, signatureMessage(envelopeDigest), peer.publicKey, bytes)
      );
    },
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function isGovernedKnowledgeNodeCryptoAuthority(value) {
  return AUTHORITIES.has(value);
}
