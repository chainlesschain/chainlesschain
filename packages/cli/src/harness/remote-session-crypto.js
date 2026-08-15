import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "crypto";

const PROTOCOL = "chainlesschain.remote-session.e2ee.v1";
const PAIRING_SCHEME = "chainlesschain://remote-session/pair#";
const RELAY_POSSESSION_SCHEMA =
  "chainlesschain.remote-session.relay-possession-capability/v1";
const relayPossessionCapabilities = new WeakMap();
const stagedRelayPairings = new WeakMap();
const RELAY_AUTHORITY_SCOPES = new Set([
  "observe",
  "prompt",
  "approve",
  "interrupt",
]);

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function unb64(value) {
  return Buffer.from(value, "base64url");
}

function exportPublicKey(key) {
  return b64(key.export({ type: "spki", format: "der" }));
}

function importPublicKey(value) {
  let der = unb64(value);
  if (der.length === 32) {
    // RFC 8410 SubjectPublicKeyInfo prefix for a raw X25519 public key.
    der = Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), der]);
  }
  return createPublicKey({ key: der, type: "spki", format: "der" });
}

function canonicalPublicKey(value) {
  const key = importPublicKey(value);
  if (key.asymmetricKeyType !== "x25519") {
    throw new Error("Remote Session peer key must be X25519");
  }
  return exportPublicKey(key);
}

function digest(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value)
    .digest("hex");
}

export function remoteSessionPairingTokenDigest(pairingToken) {
  if (typeof pairingToken !== "string" || pairingToken.length === 0) {
    throw new Error("Remote Session pairing token is required");
  }
  return digest("chainlesschain.remote-session.pairing-token.v1", pairingToken);
}

function relayEnvelopeTranscriptHash(envelope) {
  const normalized = {
    v: envelope.v,
    sessionId: envelope.sessionId,
    senderId: envelope.senderId,
    sequence: envelope.sequence,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag,
  };
  return digest(
    "chainlesschain.remote-session.relay-envelope.v1",
    JSON.stringify(normalized),
  );
}

export function consumeRemoteRelayPossessionCapability(
  capability,
  {
    sessionId,
    mobilePeerId,
    mobilePublicKey,
    pairingTokenDigest,
    coordinatorId,
    serverInstanceId,
    authorityVersion,
  } = {},
) {
  const proof = relayPossessionCapabilities.get(capability);
  // Consume before checking the caller's expectation. A confused-deputy or
  // stale binding attempt cannot probe and then reuse the capability.
  relayPossessionCapabilities.delete(capability);
  const expectedPublicKey = canonicalPublicKey(mobilePublicKey);
  if (
    !proof ||
    proof.sessionId !== sessionId ||
    proof.mobilePeerId !== mobilePeerId ||
    proof.mobilePublicKey !== expectedPublicKey ||
    proof.pairingTokenDigest !== pairingTokenDigest ||
    proof.coordinatorId !== coordinatorId ||
    proof.serverInstanceId !== serverInstanceId ||
    proof.authorityVersion !== authorityVersion
  ) {
    throw new Error("Remote relay possession capability is invalid or stale");
  }
  return Object.freeze({
    ...proof,
    authorizedScopes: Object.freeze([...proof.authorizedScopes]),
  });
}

function normalizeRelayAuthorityScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("Durable Remote relay scopes are required");
  }
  const normalized = [...new Set(scopes.map(String))].sort();
  if (normalized.some((scope) => !RELAY_AUTHORITY_SCOPES.has(scope))) {
    throw new Error("Durable Remote relay scopes are invalid");
  }
  return Object.freeze(normalized);
}

function normalizeRelayCapabilities(capabilities) {
  if (capabilities == null) return Object.freeze([]);
  if (!Array.isArray(capabilities) || capabilities.length > 32) {
    throw new Error("Durable Remote relay capabilities are invalid");
  }
  const normalized = [...new Set(capabilities)];
  if (
    normalized.some(
      (capability) =>
        typeof capability !== "string" ||
        capability.length === 0 ||
        capability.length > 128 ||
        capability.includes("\0"),
    )
  ) {
    throw new Error("Durable Remote relay capabilities are invalid");
  }
  return Object.freeze(normalized.sort());
}

function sameStringArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function decryptEnvelopeWithKey(
  sessionId,
  key,
  envelope,
  previousSequence = 0,
) {
  if (envelope?.v !== 1 || envelope.sessionId !== sessionId) {
    throw new Error("Invalid encrypted Remote Session envelope");
  }
  if (
    !Number.isSafeInteger(envelope.sequence) ||
    envelope.sequence <= previousSequence
  ) {
    throw new Error("Remote Session replay or out-of-order envelope rejected");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      unb64(envelope.nonce),
    );
    decipher.setAAD(aad(sessionId, envelope.senderId, envelope.sequence));
    decipher.setAuthTag(unb64(envelope.tag));
    const plaintext = Buffer.concat([
      decipher.update(unb64(envelope.ciphertext)),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Remote Session envelope authentication failed: ${error.message}`,
    );
  }
}

function aad(sessionId, senderId, sequence) {
  return Buffer.from(
    `${PROTOCOL}\n${sessionId}\n${senderId}\n${sequence}`,
    "utf8",
  );
}

function deriveKey(privateKey, peerPublicKey, sessionId, pairingToken) {
  const secret = diffieHellman({ privateKey, publicKey: peerPublicKey });
  const salt = createHash("sha256").update(pairingToken, "utf8").digest();
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      salt,
      Buffer.from(`${PROTOCOL}:${sessionId}`),
      32,
    ),
  );
}

export function createRemoteSessionKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: exportPublicKey(publicKey),
    privateKey: b64(privateKey.export({ type: "pkcs8", format: "der" })),
  };
}

export function createRemotePairingUri({
  relayUrl,
  remoteSessionId,
  hostPeerId,
  hostPublicKey,
  pairingToken,
  expiresAt,
}) {
  if (
    !relayUrl ||
    !remoteSessionId ||
    !hostPeerId ||
    !hostPublicKey ||
    !pairingToken
  ) {
    throw new Error("Incomplete Remote Session pairing payload");
  }
  const payload = {
    v: 1,
    relayUrl,
    remoteSessionId,
    hostPeerId,
    hostPublicKey,
    pairingToken,
    expiresAt,
  };
  return `${PAIRING_SCHEME}${b64(JSON.stringify(payload))}`;
}

export function parseRemotePairingUri(uri, now = Date.now()) {
  if (typeof uri !== "string" || !uri.startsWith(PAIRING_SCHEME)) {
    throw new Error("Invalid Remote Session pairing URI");
  }
  let payload;
  try {
    payload = JSON.parse(
      unb64(uri.slice(PAIRING_SCHEME.length)).toString("utf8"),
    );
  } catch {
    throw new Error("Malformed Remote Session pairing payload");
  }
  if (
    payload.v !== 1 ||
    !payload.relayUrl ||
    !payload.remoteSessionId ||
    !payload.hostPeerId ||
    !payload.hostPublicKey ||
    !payload.pairingToken
  ) {
    throw new Error("Incomplete Remote Session pairing payload");
  }
  if (payload.expiresAt && payload.expiresAt <= now) {
    throw new Error("Remote Session pairing payload expired");
  }
  return payload;
}

export class RemoteSessionCryptoContext {
  constructor({
    sessionId,
    localPeerId,
    privateKey,
    publicKey,
    now = () => Date.now(),
  } = {}) {
    if (!sessionId || !localPeerId)
      throw new Error("sessionId and localPeerId are required");
    let keyPair;
    if (!privateKey || !publicKey) keyPair = createRemoteSessionKeyPair();
    this.sessionId = sessionId;
    this.localPeerId = localPeerId;
    this.privateKey = createPrivateKey({
      key: unb64(privateKey || keyPair.privateKey),
      type: "pkcs8",
      format: "der",
    });
    this.publicKey = publicKey || keyPair.publicKey;
    this._now = now;
    this.keys = new Map();
    this.pairingMaterial = new Map();
    this.relayPeerBindings = new Map();
    this.acceptedRelayMemberships = new Map();
    this.pendingRelayCapabilities = new Map();
    this.outstandingRelayCapabilities = new Map();
    this.sendSequence = 0;
    this.receivedSequences = new Map();
  }

  pair(peerId, peerPublicKey, pairingToken) {
    return this._pair(peerId, peerPublicKey, pairingToken, null);
  }

  pairForDurableMembership(
    peerId,
    peerPublicKey,
    pairingToken,
    {
      authorizedScopes,
      expiresAtMs,
      coordinatorId,
      serverInstanceId,
      authorityVersion,
    } = {},
  ) {
    const normalizedExpiry = Number(expiresAtMs);
    if (
      !Number.isSafeInteger(normalizedExpiry) ||
      normalizedExpiry <= this._now()
    ) {
      throw new Error("Durable Remote relay pairing authority is expired");
    }
    if (
      typeof coordinatorId !== "string" ||
      coordinatorId.length === 0 ||
      typeof serverInstanceId !== "string" ||
      serverInstanceId.length === 0 ||
      typeof authorityVersion !== "string" ||
      authorityVersion.length === 0
    ) {
      throw new Error("Durable Remote relay authority domain is required");
    }
    return this._pair(peerId, peerPublicKey, pairingToken, {
      authorizedScopes: normalizeRelayAuthorityScopes(authorizedScopes),
      expiresAtMs: normalizedExpiry,
      coordinatorId,
      serverInstanceId,
      authorityVersion,
    });
  }

  _pair(peerId, peerPublicKey, pairingToken, durableAuthority) {
    if (!peerId || !peerPublicKey || !pairingToken)
      throw new Error("Incomplete peer key material");
    // Preserve the legacy re-pair/rotated-token behavior. Re-pairing replaces
    // the transport key, but first invalidates any not-yet-consumed authority
    // capability minted under the old key/token tuple.
    const outstandingCapability = this.outstandingRelayCapabilities.get(peerId);
    if (outstandingCapability) {
      relayPossessionCapabilities.delete(outstandingCapability);
    }
    this.pendingRelayCapabilities.delete(peerId);
    this.outstandingRelayCapabilities.delete(peerId);
    const normalizedPublicKey = canonicalPublicKey(peerPublicKey);
    this.acceptedRelayMemberships.delete(peerId);
    this.keys.set(
      peerId,
      deriveKey(
        this.privateKey,
        importPublicKey(normalizedPublicKey),
        this.sessionId,
        pairingToken,
      ),
    );
    this.pairingMaterial.set(peerId, {
      mobilePublicKey: normalizedPublicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(pairingToken),
      authorizedScopes: durableAuthority?.authorizedScopes || null,
      expiresAtMs: durableAuthority?.expiresAtMs || null,
      coordinatorId: durableAuthority?.coordinatorId || null,
      serverInstanceId: durableAuthority?.serverInstanceId || null,
      authorityVersion: durableAuthority?.authorityVersion || null,
    });
    this.relayPeerBindings.set(peerId, {
      mobilePublicKey: normalizedPublicKey,
      pairingTokenDigest: remoteSessionPairingTokenDigest(pairingToken),
    });
  }

  encrypt(peerId, message) {
    const key = this.keys.get(peerId);
    if (!key) throw new Error(`No encryption key for peer: ${peerId}`);
    const sequence = ++this.sendSequence;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(this.sessionId, this.localPeerId, sequence));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), "utf8"),
      cipher.final(),
    ]);
    return {
      v: 1,
      sessionId: this.sessionId,
      senderId: this.localPeerId,
      sequence,
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
      tag: b64(cipher.getAuthTag()),
    };
  }

  decrypt(envelope) {
    if (envelope?.v !== 1 || envelope.sessionId !== this.sessionId) {
      throw new Error("Invalid encrypted Remote Session envelope");
    }
    const key = this.keys.get(envelope.senderId);
    if (!key)
      throw new Error(`No encryption key for peer: ${envelope.senderId}`);
    const previous = this.receivedSequences.get(envelope.senderId) || 0;
    if (
      !Number.isSafeInteger(envelope.sequence) ||
      envelope.sequence <= previous
    ) {
      throw new Error(
        "Remote Session replay or out-of-order envelope rejected",
      );
    }
    const message = decryptEnvelopeWithKey(
      this.sessionId,
      key,
      envelope,
      previous,
    );
    this.receivedSequences.set(envelope.senderId, envelope.sequence);
    const pairing = this.pairingMaterial.get(envelope.senderId);
    if (
      pairing &&
      pairing.authorizedScopes !== null &&
      pairing.coordinatorId !== null &&
      pairing.serverInstanceId !== null &&
      pairing.authorityVersion !== null &&
      pairing.expiresAtMs > this._now() &&
      message?.type === "pair.join" &&
      typeof message.token === "string" &&
      remoteSessionPairingTokenDigest(message.token) ===
        pairing.pairingTokenDigest
    ) {
      const proof = Object.freeze({
        schema: RELAY_POSSESSION_SCHEMA,
        sessionId: this.sessionId,
        mobilePeerId: envelope.senderId,
        mobilePublicKey: pairing.mobilePublicKey,
        pairingTokenDigest: pairing.pairingTokenDigest,
        coordinatorId: pairing.coordinatorId,
        serverInstanceId: pairing.serverInstanceId,
        authorityVersion: pairing.authorityVersion,
        authorizedScopes: pairing.authorizedScopes,
        pairingExpiresAtMs: pairing.expiresAtMs,
        envelopeSequence: envelope.sequence,
        envelopeTranscriptHash: relayEnvelopeTranscriptHash(envelope),
      });
      relayPossessionCapabilities.set(proof, { ...proof });
      this.pendingRelayCapabilities.set(envelope.senderId, proof);
      this.outstandingRelayCapabilities.set(envelope.senderId, proof);
      this.pairingMaterial.delete(envelope.senderId);
    }
    return message;
  }

  /**
   * Authenticate a prospective relay pairing without changing the live peer
   * key, replay high-water mark, or an accepted-membership receipt. The caller
   * commits the opaque stage only after the membership transition succeeds.
   */
  stageRelayPairing(
    peerId,
    peerPublicKey,
    pairingToken,
    envelope,
    durableAuthority = null,
  ) {
    if (!peerId || !peerPublicKey || !pairingToken) {
      throw new Error("Incomplete peer key material");
    }
    if (envelope?.senderId !== peerId) {
      throw new Error("Remote Session relay peer binding is invalid");
    }
    const normalizedPublicKey = canonicalPublicKey(peerPublicKey);
    const pairingTokenDigest = remoteSessionPairingTokenDigest(pairingToken);
    let authority = null;
    if (durableAuthority !== null) {
      const normalizedExpiry = Number(durableAuthority?.expiresAtMs);
      if (
        !Number.isSafeInteger(normalizedExpiry) ||
        normalizedExpiry <= this._now()
      ) {
        throw new Error("Durable Remote relay pairing authority is expired");
      }
      if (
        typeof durableAuthority?.coordinatorId !== "string" ||
        durableAuthority.coordinatorId.length === 0 ||
        typeof durableAuthority?.serverInstanceId !== "string" ||
        durableAuthority.serverInstanceId.length === 0 ||
        typeof durableAuthority?.authorityVersion !== "string" ||
        durableAuthority.authorityVersion.length === 0
      ) {
        throw new Error("Durable Remote relay authority domain is required");
      }
      authority = Object.freeze({
        authorizedScopes: normalizeRelayAuthorityScopes(
          durableAuthority.authorizedScopes,
        ),
        expiresAtMs: normalizedExpiry,
        coordinatorId: durableAuthority.coordinatorId,
        serverInstanceId: durableAuthority.serverInstanceId,
        authorityVersion: durableAuthority.authorityVersion,
      });
    }
    const key = deriveKey(
      this.privateKey,
      importPublicKey(normalizedPublicKey),
      this.sessionId,
      pairingToken,
    );
    // A new key/token tuple starts a new encrypted sequence space. Nothing is
    // published to the live maps until commitStagedRelayPairing().
    const message = decryptEnvelopeWithKey(this.sessionId, key, envelope, 0);
    if (
      message?.type !== "pair.join" ||
      message.remoteSessionId !== this.sessionId ||
      message.token !== pairingToken
    ) {
      throw new Error("Invalid encrypted Remote Session pairing request");
    }
    let possessionCapability = null;
    if (authority) {
      const proof = Object.freeze({
        schema: RELAY_POSSESSION_SCHEMA,
        sessionId: this.sessionId,
        mobilePeerId: peerId,
        mobilePublicKey: normalizedPublicKey,
        pairingTokenDigest,
        coordinatorId: authority.coordinatorId,
        serverInstanceId: authority.serverInstanceId,
        authorityVersion: authority.authorityVersion,
        authorizedScopes: authority.authorizedScopes,
        pairingExpiresAtMs: authority.expiresAtMs,
        envelopeSequence: envelope.sequence,
        envelopeTranscriptHash: relayEnvelopeTranscriptHash(envelope),
      });
      relayPossessionCapabilities.set(proof, { ...proof });
      possessionCapability = proof;
    }
    const stage = Object.freeze({});
    stagedRelayPairings.set(stage, {
      owner: this,
      peerId,
      key,
      mobilePublicKey: normalizedPublicKey,
      pairingTokenDigest,
      envelopeSequence: envelope.sequence,
    });
    return Object.freeze({
      message,
      stage,
      possessionCapability,
    });
  }

  commitStagedRelayPairing(stage) {
    const candidate = stagedRelayPairings.get(stage);
    stagedRelayPairings.delete(stage);
    if (!candidate || candidate.owner !== this) {
      throw new Error("Remote relay pairing stage is invalid or stale");
    }
    const outstandingCapability = this.outstandingRelayCapabilities.get(
      candidate.peerId,
    );
    if (outstandingCapability) {
      relayPossessionCapabilities.delete(outstandingCapability);
    }
    this.pendingRelayCapabilities.delete(candidate.peerId);
    this.outstandingRelayCapabilities.delete(candidate.peerId);
    this.pairingMaterial.delete(candidate.peerId);
    this.keys.set(candidate.peerId, candidate.key);
    this.relayPeerBindings.set(candidate.peerId, {
      mobilePublicKey: candidate.mobilePublicKey,
      pairingTokenDigest: candidate.pairingTokenDigest,
    });
    this.receivedSequences.set(candidate.peerId, candidate.envelopeSequence);
    this.acceptedRelayMemberships.delete(candidate.peerId);
  }

  takeRelayPossessionCapability(peerId) {
    const capability = this.pendingRelayCapabilities.get(peerId);
    this.pendingRelayCapabilities.delete(peerId);
    if (!capability) {
      throw new Error(
        "No authenticated Remote relay pairing transcript is available",
      );
    }
    return capability;
  }

  /**
   * Keep the exact, already-committed relay membership tuple in this crypto
   * process. It is deliberately not persisted: it only reconciles an ACK lost
   * while the same host process still owns the authenticated DH/AEAD context.
   */
  rememberRelayMembershipAcceptance(
    peerId,
    {
      mobilePublicKey,
      pairingTokenDigest,
      principalId,
      sessionEpoch,
      membershipEpoch,
      scopes,
      capabilities,
      statement = null,
    } = {},
  ) {
    const peer = this.relayPeerBindings.get(peerId);
    const normalizedPublicKey = canonicalPublicKey(mobilePublicKey);
    const normalizedScopes = normalizeRelayAuthorityScopes(scopes);
    const normalizedCapabilities = normalizeRelayCapabilities(capabilities);
    if (
      !peer ||
      peer.mobilePublicKey !== normalizedPublicKey ||
      peer.pairingTokenDigest !== pairingTokenDigest ||
      typeof principalId !== "string" ||
      principalId.length === 0 ||
      typeof sessionEpoch !== "string" ||
      !/^[1-9]\d*$/.test(sessionEpoch) ||
      typeof membershipEpoch !== "string" ||
      !/^[1-9]\d*$/.test(membershipEpoch)
    ) {
      throw new Error("Remote relay membership acceptance binding is invalid");
    }
    const receipt = Object.freeze({
      sessionId: this.sessionId,
      mobilePeerId: peerId,
      mobilePublicKey: normalizedPublicKey,
      pairingTokenDigest,
      principalId,
      sessionEpoch,
      membershipEpoch,
      scopes: normalizedScopes,
      capabilities: normalizedCapabilities,
      statement,
    });
    this.acceptedRelayMemberships.set(peerId, receipt);
    return receipt;
  }

  readRelayMembershipAcceptance(
    peerId,
    { mobilePublicKey, pairingTokenDigest, capabilities } = {},
  ) {
    const receipt = this.acceptedRelayMemberships.get(peerId);
    const normalizedPublicKey = canonicalPublicKey(mobilePublicKey);
    const normalizedCapabilities = normalizeRelayCapabilities(capabilities);
    if (
      !receipt ||
      receipt.mobilePublicKey !== normalizedPublicKey ||
      receipt.pairingTokenDigest !== pairingTokenDigest ||
      !sameStringArray(receipt.capabilities, normalizedCapabilities)
    ) {
      throw new Error(
        "Remote relay membership acceptance is unavailable or mismatched",
      );
    }
    return receipt;
  }

  hasRelayMembershipAcceptance(peerId) {
    return this.acceptedRelayMemberships.has(peerId);
  }
}
