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

function relayCredentialDigest(publicKey) {
  return createHash("sha256").update(unb64(publicKey)).digest("hex");
}

function samePendingRelayRequest(left, right) {
  return (
    left.peerId === right.peerId &&
    left.key.equals(right.key) &&
    left.mobilePublicKey === right.mobilePublicKey &&
    left.pairingTokenDigest === right.pairingTokenDigest &&
    left.initialEnvelopeSequence === right.initialEnvelopeSequence &&
    left.initialEnvelopeTranscriptHash ===
      right.initialEnvelopeTranscriptHash &&
    left.expectedPrincipalId === right.expectedPrincipalId &&
    left.expectedCredentialDigest === right.expectedCredentialDigest &&
    left.expectedSessionEpoch === right.expectedSessionEpoch &&
    left.expectedMembershipEpoch === right.expectedMembershipEpoch &&
    left.baselineAuthorityGeneration === right.baselineAuthorityGeneration &&
    left.baselineMembershipEpoch === right.baselineMembershipEpoch &&
    left.baselineMembershipStatus === right.baselineMembershipStatus &&
    sameStringArray(left.expectedScopes, right.expectedScopes) &&
    sameStringArray(left.expectedCapabilities, right.expectedCapabilities) &&
    sameStringArray(
      left.authority.authorizedScopes,
      right.authority.authorizedScopes,
    ) &&
    left.authority.expiresAtMs === right.authority.expiresAtMs &&
    left.authority.coordinatorId === right.authority.coordinatorId &&
    left.authority.serverInstanceId === right.authority.serverInstanceId &&
    left.authority.authorityVersion === right.authority.authorityVersion
  );
}

function createRelayMembershipAcceptance(
  sessionId,
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
  const normalizedPublicKey = canonicalPublicKey(mobilePublicKey);
  const normalizedScopes = normalizeRelayAuthorityScopes(scopes);
  const normalizedCapabilities = normalizeRelayCapabilities(capabilities);
  if (
    typeof pairingTokenDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(pairingTokenDigest) ||
    typeof principalId !== "string" ||
    principalId.length === 0 ||
    typeof sessionEpoch !== "string" ||
    !/^[1-9]\d*$/.test(sessionEpoch) ||
    typeof membershipEpoch !== "string" ||
    !/^[1-9]\d*$/.test(membershipEpoch)
  ) {
    throw new Error("Remote relay membership acceptance binding is invalid");
  }
  return Object.freeze({
    sessionId,
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
    faultHooks = null,
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
    this._faultHooks = faultHooks || {};
    this.keys = new Map();
    this.pairingMaterial = new Map();
    this.relayPeerBindings = new Map();
    this.acceptedRelayMemberships = new Map();
    this.pendingCommittedRelayAcceptances = new Map();
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
    this.discardPendingRelayMembershipCommit(peerId);
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
    const revokesThisPeer =
      message?.type === "session.revoked" &&
      message.remoteSessionId === this.sessionId;
    const key = this.keys.get(peerId);
    if (!key) {
      // A durable join can be authoritative while its candidate key is still
      // pending publication. A courtesy revoke cannot be encrypted in that
      // window, but it must still retire the process-local recovery marker so
      // a later, legitimately re-authorized generation is not blocked.
      if (revokesThisPeer) this.clearRelayPeer(peerId);
      throw new Error(`No encryption key for peer: ${peerId}`);
    }
    const sequence = ++this.sendSequence;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(this.sessionId, this.localPeerId, sequence));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), "utf8"),
      cipher.final(),
    ]);
    const envelope = {
      v: 1,
      sessionId: this.sessionId,
      senderId: this.localPeerId,
      sequence,
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
      tag: b64(cipher.getAuthTag()),
    };
    if (revokesThisPeer) {
      // The ciphertext is complete; remove every local generation for this
      // peer before the courtesy revoke frame is physically sent.
      this.clearRelayPeer(peerId);
    }
    return envelope;
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
      envelopeTranscriptHash: relayEnvelopeTranscriptHash(envelope),
      authority,
      possessionCapability,
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
    this.discardPendingRelayMembershipCommit(candidate.peerId);
  }

  /**
   * Arm recovery before invoking the durable coordinator/registry. This moves
   * the verified candidate out of the opaque stage and binds its exact request,
   * authority instance, and pre-join authority generation without publishing
   * a live peer key, replay high-water mark, or acceptance receipt.
   */
  armPendingRelayMembershipCommit(
    stage,
    { authoritySnapshot, scopes, capabilities } = {},
  ) {
    const candidate = stagedRelayPairings.get(stage);
    const snapshot = authoritySnapshot;
    if (
      !candidate ||
      candidate.owner !== this ||
      !candidate.authority ||
      snapshot?.sessionId !== this.sessionId ||
      snapshot.status !== "active" ||
      !/^[1-9]\d*$/.test(String(snapshot.sessionEpoch)) ||
      !/^\d+$/.test(String(snapshot.authorityGeneration)) ||
      !Array.isArray(snapshot.members)
    ) {
      throw new Error("Remote relay pairing stage is invalid or stale");
    }
    const expectedScopes = normalizeRelayAuthorityScopes(scopes);
    const expectedCapabilities = normalizeRelayCapabilities(capabilities);
    if (
      expectedScopes.some(
        (scope) => !candidate.authority.authorizedScopes.includes(scope),
      )
    ) {
      throw new Error("Remote relay membership request exceeds its authority");
    }
    const expectedCredentialDigest = relayCredentialDigest(
      candidate.mobilePublicKey,
    );
    const expectedPrincipalId = `relay-x25519:${expectedCredentialDigest}`;
    const baselineMember = snapshot.members.find(
      (member) => member.principalId === expectedPrincipalId,
    );
    if (baselineMember?.status === "active") {
      throw new Error("Remote relay principal is already active");
    }
    if (
      baselineMember &&
      baselineMember.credentialKeySha256 !== expectedCredentialDigest
    ) {
      throw new Error("Remote relay authority credential binding changed");
    }
    const pending = Object.freeze({
      phase: "prepared",
      peerId: candidate.peerId,
      key: candidate.key,
      mobilePublicKey: candidate.mobilePublicKey,
      pairingTokenDigest: candidate.pairingTokenDigest,
      initialEnvelopeSequence: candidate.envelopeSequence,
      initialEnvelopeTranscriptHash: candidate.envelopeTranscriptHash,
      localHighWater: candidate.envelopeSequence,
      authority: candidate.authority,
      possessionCapability: candidate.possessionCapability,
      expectedPrincipalId,
      expectedCredentialDigest,
      expectedSessionEpoch: String(snapshot.sessionEpoch),
      expectedMembershipEpoch: baselineMember
        ? String(BigInt(baselineMember.membershipEpoch) + 1n)
        : "1",
      expectedScopes,
      expectedCapabilities,
      baselineAuthorityGeneration: String(snapshot.authorityGeneration),
      baselineMembershipEpoch: baselineMember?.membershipEpoch || null,
      baselineMembershipStatus: baselineMember?.status || null,
      receipt: null,
    });
    const existing = this.pendingCommittedRelayAcceptances.get(
      candidate.peerId,
    );
    if (existing && !samePendingRelayRequest(existing, pending)) {
      throw new Error(
        "Remote relay peer already has a different pending membership commit",
      );
    }
    if (!existing) {
      this.pendingCommittedRelayAcceptances.set(candidate.peerId, pending);
    } else if (candidate.possessionCapability) {
      relayPossessionCapabilities.delete(candidate.possessionCapability);
    }
    stagedRelayPairings.delete(stage);
    return existing || pending;
  }

  completePendingCommittedRelayAcceptance(peerId, acceptance) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId);
    if (!pending) {
      throw new Error("Remote relay committed acceptance is unavailable");
    }
    // This boundary is deliberately after RemoteSessionRegistry.joinRelayMember
    // has returned (including its local transport attachment). A coordinator
    // commit that fails before registry attachment remains fail-closed because
    // this three-file slice has no trusted public reattach operation.
    this._faultHooks.afterRelayRegistryCommit?.({
      sessionId: this.sessionId,
      peerId,
      expectedPrincipalId: pending.expectedPrincipalId,
      expectedSessionEpoch: pending.expectedSessionEpoch,
      expectedMembershipEpoch: pending.expectedMembershipEpoch,
    });
    const receipt = createRelayMembershipAcceptance(
      this.sessionId,
      peerId,
      acceptance,
    );
    if (
      receipt.mobilePublicKey !== pending.mobilePublicKey ||
      receipt.pairingTokenDigest !== pending.pairingTokenDigest ||
      receipt.principalId !== pending.expectedPrincipalId ||
      receipt.sessionEpoch !== pending.expectedSessionEpoch ||
      receipt.membershipEpoch !== pending.expectedMembershipEpoch ||
      !sameStringArray(receipt.scopes, pending.expectedScopes) ||
      !sameStringArray(receipt.capabilities, pending.expectedCapabilities)
    ) {
      throw new Error("Remote relay membership acceptance binding is invalid");
    }
    this.pendingCommittedRelayAcceptances.set(
      peerId,
      Object.freeze({ ...pending, phase: "committed", receipt }),
    );
    return receipt;
  }

  resolvePendingRelayMembershipCommit(
    peerId,
    authorityRead,
    authorityDescriptor,
  ) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId);
    const session = authorityRead?.session;
    const statement = authorityRead?.statement;
    if (
      !pending ||
      !session ||
      session.sessionId !== this.sessionId ||
      authorityDescriptor?.coordinatorId !== pending.authority.coordinatorId ||
      authorityDescriptor?.serverInstanceId !==
        pending.authority.serverInstanceId ||
      authorityDescriptor?.authorityVersion !==
        pending.authority.authorityVersion ||
      statement?.coordinatorId !== pending.authority.coordinatorId ||
      statement?.authorityVersion !== pending.authority.authorityVersion ||
      statement?.generation !== String(session.authorityGeneration) ||
      statement?.payload?.sessionId !== session.sessionId ||
      statement?.payload?.sessionEpoch !== session.sessionEpoch
    ) {
      return Object.freeze({ status: "fenced", receipt: null });
    }
    const member = session.members?.find(
      (candidate) => candidate.principalId === pending.expectedPrincipalId,
    );
    const generationAdvanced =
      /^\d+$/.test(String(session.authorityGeneration)) &&
      BigInt(session.authorityGeneration) >
        BigInt(pending.baselineAuthorityGeneration);
    if (
      generationAdvanced &&
      session.status === "active" &&
      String(session.sessionEpoch) === pending.expectedSessionEpoch &&
      member?.status === "active" &&
      member.credentialKeySha256 === pending.expectedCredentialDigest &&
      String(member.membershipEpoch) === pending.expectedMembershipEpoch &&
      sameStringArray(
        normalizeRelayAuthorityScopes(member.scopes),
        pending.expectedScopes,
      )
    ) {
      const receipt = createRelayMembershipAcceptance(this.sessionId, peerId, {
        mobilePublicKey: pending.mobilePublicKey,
        pairingTokenDigest: pending.pairingTokenDigest,
        principalId: pending.expectedPrincipalId,
        sessionEpoch: pending.expectedSessionEpoch,
        membershipEpoch: pending.expectedMembershipEpoch,
        scopes: pending.expectedScopes,
        capabilities: pending.expectedCapabilities,
        statement: authorityRead.statement || null,
      });
      this.pendingCommittedRelayAcceptances.set(
        peerId,
        Object.freeze({ ...pending, phase: "committed", receipt }),
      );
      return Object.freeze({ status: "committed", receipt });
    }
    const baselineMemberUnchanged = pending.baselineMembershipEpoch
      ? member?.status === pending.baselineMembershipStatus &&
        String(member.membershipEpoch) === pending.baselineMembershipEpoch &&
        member.credentialKeySha256 === pending.expectedCredentialDigest
      : !member;
    if (
      session.status === "active" &&
      String(session.sessionEpoch) === pending.expectedSessionEpoch &&
      baselineMemberUnchanged
    ) {
      return Object.freeze({ status: "not-committed", receipt: null });
    }
    return Object.freeze({ status: "fenced", receipt: null });
  }

  discardPendingRelayMembershipCommit(peerId) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId);
    if (!pending) return false;
    if (pending.possessionCapability) {
      relayPossessionCapabilities.delete(pending.possessionCapability);
    }
    this.pendingCommittedRelayAcceptances.delete(peerId);
    return true;
  }

  /**
   * Publish a previously armed durable outcome. Pending is deleted last, so a
   * synchronous failure at either injected boundary can safely re-enter this
   * method without lowering an already-observed replay high-water mark.
   */
  finalizeCommittedRelayAcceptance(peerId) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId);
    if (!pending) {
      const accepted = this.acceptedRelayMemberships.get(peerId);
      if (accepted) return accepted;
      throw new Error("Remote relay committed acceptance is unavailable");
    }
    if (pending.phase !== "committed" || !pending.receipt) {
      throw new Error("Remote relay committed acceptance is not authoritative");
    }
    const outstandingCapability = this.outstandingRelayCapabilities.get(peerId);
    if (outstandingCapability) {
      relayPossessionCapabilities.delete(outstandingCapability);
    }
    this.pendingRelayCapabilities.delete(peerId);
    this.outstandingRelayCapabilities.delete(peerId);
    this.pairingMaterial.delete(peerId);
    this.keys.set(peerId, pending.key);
    this.relayPeerBindings.set(peerId, {
      mobilePublicKey: pending.mobilePublicKey,
      pairingTokenDigest: pending.pairingTokenDigest,
    });
    // The candidate key starts a distinct sequence generation. Never mix an
    // old live key's high-water into it; pending-local authenticated progress
    // becomes live only with the exact committed authority tuple.
    this.receivedSequences.set(peerId, pending.localHighWater);
    this.acceptedRelayMemberships.delete(peerId);
    this._faultHooks.afterCommittedRelayKeyPublication?.({
      sessionId: this.sessionId,
      peerId,
      principalId: pending.receipt.principalId,
      sessionEpoch: pending.receipt.sessionEpoch,
      membershipEpoch: pending.receipt.membershipEpoch,
    });
    this.acceptedRelayMemberships.set(peerId, pending.receipt);
    this.pendingCommittedRelayAcceptances.delete(peerId);
    this._faultHooks.afterCommittedRelayReceiptPublication?.({
      sessionId: this.sessionId,
      peerId,
      principalId: pending.receipt.principalId,
      sessionEpoch: pending.receipt.sessionEpoch,
      membershipEpoch: pending.receipt.membershipEpoch,
    });
    return pending.receipt;
  }

  decryptPendingCommittedRelayAcceptance(peerId, envelope) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId);
    if (!pending || envelope?.senderId !== peerId) {
      throw new Error("Remote relay committed acceptance is unavailable");
    }
    const previous = pending.localHighWater;
    const message = decryptEnvelopeWithKey(
      this.sessionId,
      pending.key,
      envelope,
      previous,
    );
    // Keep retry progress isolated from the live key generation until fresh
    // authority readback and exact tuple validation permit final publication.
    this.pendingCommittedRelayAcceptances.set(
      peerId,
      Object.freeze({ ...pending, localHighWater: envelope.sequence }),
    );
    return message;
  }

  readPendingCommittedRelayAcceptance(
    peerId,
    { mobilePublicKey, pairingTokenDigest, capabilities } = {},
  ) {
    const receipt =
      this.pendingCommittedRelayAcceptances.get(peerId)?.receipt || null;
    const normalizedPublicKey = canonicalPublicKey(mobilePublicKey);
    const normalizedCapabilities = normalizeRelayCapabilities(capabilities);
    if (
      !receipt ||
      receipt.mobilePublicKey !== normalizedPublicKey ||
      receipt.pairingTokenDigest !== pairingTokenDigest ||
      !sameStringArray(receipt.capabilities, normalizedCapabilities)
    ) {
      throw new Error(
        "Remote relay committed acceptance is unavailable or mismatched",
      );
    }
    return receipt;
  }

  hasPendingCommittedRelayAcceptance(peerId) {
    return this.pendingCommittedRelayAcceptances.has(peerId);
  }

  readPendingRelayMembershipRequest(
    peerId,
    { mobilePublicKey, pairingTokenDigest, capabilities } = {},
  ) {
    const pending = this.pendingCommittedRelayAcceptances.get(peerId) || null;
    const normalizedPublicKey = canonicalPublicKey(mobilePublicKey);
    const normalizedCapabilities = normalizeRelayCapabilities(capabilities);
    if (
      !pending ||
      pending.mobilePublicKey !== normalizedPublicKey ||
      pending.pairingTokenDigest !== pairingTokenDigest ||
      !sameStringArray(pending.expectedCapabilities, normalizedCapabilities)
    ) {
      throw new Error(
        "Remote relay pending membership request is unavailable or mismatched",
      );
    }
    return Object.freeze({
      sessionId: this.sessionId,
      mobilePeerId: peerId,
      pairingTokenDigest: pending.pairingTokenDigest,
      expectedPrincipalId: pending.expectedPrincipalId,
      expectedSessionEpoch: pending.expectedSessionEpoch,
      expectedMembershipEpoch: pending.expectedMembershipEpoch,
      scopes: pending.expectedScopes,
      capabilities: pending.expectedCapabilities,
      phase: pending.phase,
    });
  }

  clearRelayPeer(peerId) {
    const outstandingCapability = this.outstandingRelayCapabilities.get(peerId);
    if (outstandingCapability) {
      relayPossessionCapabilities.delete(outstandingCapability);
    }
    this.discardPendingRelayMembershipCommit(peerId);
    this.pendingRelayCapabilities.delete(peerId);
    this.outstandingRelayCapabilities.delete(peerId);
    this.pairingMaterial.delete(peerId);
    this.keys.delete(peerId);
    this.relayPeerBindings.delete(peerId);
    this.receivedSequences.delete(peerId);
    this.acceptedRelayMemberships.delete(peerId);
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
    const receipt = createRelayMembershipAcceptance(this.sessionId, peerId, {
      mobilePublicKey,
      pairingTokenDigest,
      principalId,
      sessionEpoch,
      membershipEpoch,
      scopes,
      capabilities,
      statement,
    });
    if (
      !peer ||
      peer.mobilePublicKey !== receipt.mobilePublicKey ||
      peer.pairingTokenDigest !== receipt.pairingTokenDigest
    ) {
      throw new Error("Remote relay membership acceptance binding is invalid");
    }
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
