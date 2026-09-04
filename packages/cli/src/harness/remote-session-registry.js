import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";

export const REMOTE_SESSION_PROTOCOL_VERSION = "1.0";
export const REMOTE_SESSION_SCOPES = Object.freeze([
  "observe",
  "prompt",
  "approve",
  "interrupt",
]);
export const REMOTE_APPROVAL_BINDING_CAPABILITY = "approval-binding-v1";

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest();
}

function tokensMatch(token, digest) {
  const candidate = hashToken(token);
  return (
    candidate.length === digest.length && timingSafeEqual(candidate, digest)
  );
}

function normalizeScopes(scopes) {
  const requested = scopes || REMOTE_SESSION_SCOPES;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TypeError("Remote session scopes must be a non-empty array");
  }
  const unique = [...new Set(requested)];
  for (const scope of unique) {
    if (!REMOTE_SESSION_SCOPES.includes(scope)) {
      throw new Error(`Unsupported remote session scope: ${scope}`);
    }
  }
  return unique;
}

function normalizeCapabilities(capabilities) {
  if (capabilities == null) return [];
  if (!Array.isArray(capabilities) || capabilities.length > 32) {
    throw new TypeError("Remote session capabilities must be a bounded array");
  }
  const normalized = [...new Set(capabilities)];
  for (const capability of normalized) {
    if (
      typeof capability !== "string" ||
      capability.length === 0 ||
      capability.length > 128 ||
      capability.includes("\0")
    ) {
      throw new TypeError("Remote session capability is invalid");
    }
  }
  return normalized.sort();
}

/**
 * Org-level constraints an administrator can impose on Remote Sessions. Lives
 * next to the registry (its single enforcement point) so both the direct WS
 * join and the relay pairing path go through the same checks. Permissive by
 * default — an unconfigured policy is a no-op.
 */
export class RemoteSessionPolicy {
  constructor({
    allowedScopes = null,
    maxDevices = null,
    maxSessionTtlMs = null,
    maxTokenTtlMs = null,
    allowRelayPairing = true,
    policyVersion = null,
  } = {}) {
    this.allowedScopes = allowedScopes ? [...new Set(allowedScopes)] : null;
    if (this.allowedScopes) {
      if (this.allowedScopes.length === 0) {
        throw new Error("allowedScopes cannot be empty");
      }
      for (const scope of this.allowedScopes) {
        if (!REMOTE_SESSION_SCOPES.includes(scope)) {
          throw new Error(`Unknown scope in org policy: ${scope}`);
        }
      }
    }
    this.maxDevices =
      maxDevices == null ? null : Math.max(0, Math.floor(maxDevices));
    this.maxSessionTtlMs =
      maxSessionTtlMs == null ? null : Math.max(1, Math.floor(maxSessionTtlMs));
    this.maxTokenTtlMs =
      maxTokenTtlMs == null ? null : Math.max(1, Math.floor(maxTokenTtlMs));
    this.allowRelayPairing = allowRelayPairing !== false;
    const authorityMaterial = JSON.stringify({
      allowedScopes: this.allowedScopes ? [...this.allowedScopes].sort() : null,
      allowRelayPairing: this.allowRelayPairing,
      maxDevices: this.maxDevices,
    });
    this.policyVersion =
      policyVersion == null
        ? `remote-session-policy:sha256:${createHash("sha256")
            .update(authorityMaterial, "utf8")
            .digest("hex")}`
        : String(policyVersion);
    if (
      this.policyVersion.length === 0 ||
      this.policyVersion.length > 512 ||
      this.policyVersion.includes("\0")
    ) {
      throw new TypeError("policyVersion must be a non-empty bounded string");
    }
  }

  /**
   * Narrow requested scopes to the org-allowed set. Throws only when the request
   * and the allow-list are wholly disjoint (i.e. nothing could be granted).
   */
  applyScopes(requestedScopes) {
    if (!this.allowedScopes) {
      return { scopes: requestedScopes || null, narrowed: false };
    }
    const requested =
      requestedScopes && requestedScopes.length
        ? [...new Set(requestedScopes)]
        : [...REMOTE_SESSION_SCOPES];
    const granted = requested.filter((scope) =>
      this.allowedScopes.includes(scope),
    );
    if (granted.length === 0) {
      throw new Error("Remote session scopes are not permitted by org policy");
    }
    return { scopes: granted, narrowed: granted.length !== requested.length };
  }

  capSessionTtl(ttlMs) {
    return this.maxSessionTtlMs == null
      ? ttlMs
      : Math.min(ttlMs, this.maxSessionTtlMs);
  }

  capTokenTtl(ttlMs) {
    return this.maxTokenTtlMs == null
      ? ttlMs
      : Math.min(ttlMs, this.maxTokenTtlMs);
  }

  enforceJoin({ deviceCount, via } = {}) {
    if (via === "relay" && !this.allowRelayPairing) {
      throw new Error("Relay pairing is disabled by org policy");
    }
    if (this.maxDevices != null && deviceCount >= this.maxDevices) {
      throw new Error("Org policy device limit reached");
    }
  }

  describe() {
    return {
      allowedScopes: this.allowedScopes,
      maxDevices: this.maxDevices,
      maxSessionTtlMs: this.maxSessionTtlMs,
      maxTokenTtlMs: this.maxTokenTtlMs,
      allowRelayPairing: this.allowRelayPairing,
      policyVersion: this.policyVersion,
    };
  }

  authorityDescriptor() {
    return Object.freeze({
      allowedScopes:
        this.allowedScopes === null
          ? null
          : Object.freeze([...this.allowedScopes].sort()),
      maxDevices: this.maxDevices,
      allowRelayPairing: this.allowRelayPairing,
      policyVersion: this.policyVersion,
    });
  }

  static fromEnv(env = {}) {
    const options = {};
    const scopes = env.CHAINLESSCHAIN_REMOTE_SESSION_ALLOWED_SCOPES;
    if (scopes) {
      options.allowedScopes = scopes
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
    }
    const num = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    if (env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_DEVICES != null) {
      options.maxDevices = num(env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_DEVICES);
    }
    if (env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_SESSION_TTL_MS != null) {
      options.maxSessionTtlMs = num(
        env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_SESSION_TTL_MS,
      );
    }
    if (env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_TOKEN_TTL_MS != null) {
      options.maxTokenTtlMs = num(
        env.CHAINLESSCHAIN_REMOTE_SESSION_MAX_TOKEN_TTL_MS,
      );
    }
    if (env.CHAINLESSCHAIN_REMOTE_SESSION_ALLOW_RELAY != null) {
      options.allowRelayPairing = !/^(0|false|no|off)$/i.test(
        String(env.CHAINLESSCHAIN_REMOTE_SESSION_ALLOW_RELAY).trim(),
      );
    }
    return new RemoteSessionPolicy(options);
  }
}

function publicSession(session) {
  return {
    protocolVersion: REMOTE_SESSION_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    agentSessionId: session.agentSessionId,
    name: session.name,
    hostClientId: session.hostPrincipalId || session.hostClientId,
    ...(session.hostPrincipalId
      ? {
          hostPrincipalId: session.hostPrincipalId,
          hostConnected: Boolean(session.hostClientId),
        }
      : {}),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    memberCount: session.members.size,
    ...(session.membershipAuthority
      ? {
          membershipAuthority: session.membershipAuthority,
          sessionEpoch: session.sessionEpoch,
        }
      : {}),
  };
}

function transportBindingKey(sessionId, transportClientId) {
  return JSON.stringify([String(sessionId), String(transportClientId)]);
}

function publicMember(member, session) {
  return {
    clientId: member.principalId || member.clientId,
    ...(member.principalId ? { principalId: member.principalId } : {}),
    scopes: [...member.scopes],
    joinedAt: member.joinedAt,
    pushToken: member.pushToken || null,
    pushProvider: member.pushToken ? member.pushProvider || null : null,
    ...(member.membershipEpoch
      ? { membershipEpoch: member.membershipEpoch }
      : {}),
    ...(member.membershipQuarantined ? { membershipQuarantined: true } : {}),
    ...(session?.hostPrincipalId
      ? { connected: Boolean(member.transportClientId) }
      : {}),
  };
}

/** In-memory authorization state for one local CLI process. */
export class RemoteSessionRegistry {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.tokenTtlMs = options.tokenTtlMs || DEFAULT_TOKEN_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.policy = options.policy || new RemoteSessionPolicy();
    // A factory keeps ordinary/in-memory Remote Session tests and deployments
    // from touching the machine security store. Client-hosted approval bridges
    // explicitly require this authority and trigger its lazy construction.
    this._membershipAuthority = options.membershipAuthority ?? null;
    this._membershipCoordinator = options.membershipCoordinator ?? null;
    this._refreshCoordinatorOnEnumeration =
      options.refreshCoordinatorOnEnumeration === true;
    this.sessions = new Map();
    this.tokens = new Map();
    this._transportBindings = new Map();
    this._pendingAuthentication = new Map();
    this._coordinatorHydrated = false;
    this._coordinatorHydrationError = null;
    if (
      this._membershipCoordinator &&
      typeof this._membershipCoordinator !== "function"
    ) {
      try {
        this._hydrateCoordinatorSessions(this._membershipCoordinator);
      } catch (error) {
        // Construction remains side-effect safe/retryable. Every durable use
        // retries the authoritative read and still fails closed if it remains
        // unavailable.
        this._coordinatorHydrated = false;
        this._coordinatorHydrationError = error;
      }
    }
  }

  _resolveMembershipCoordinator() {
    if (typeof this._membershipCoordinator === "function") {
      this._membershipCoordinator = this._membershipCoordinator();
    }
    if (
      !this._membershipCoordinator ||
      typeof this._membershipCoordinator.listSessionSnapshots !== "function" ||
      typeof this._membershipCoordinator.getSessionSnapshot !== "function" ||
      typeof this._membershipCoordinator.trustDescriptor !== "function"
    ) {
      throw new Error("Durable Remote membership coordinator is unavailable");
    }
    return this._membershipCoordinator;
  }

  _requireMembershipCoordinator() {
    const coordinator = this._resolveMembershipCoordinator();
    if (!this._coordinatorHydrated) {
      this._hydrateCoordinatorSessions(coordinator);
    }
    return coordinator;
  }

  _hydrateCoordinatorSessions(coordinator) {
    try {
      const snapshots = coordinator.listSessionSnapshots({ activeOnly: false });
      const live = new Set();
      for (const snapshot of snapshots) {
        if (snapshot.expiresAt <= this.now() || snapshot.status !== "active") {
          this._clearCoordinatorSession(snapshot.sessionId);
          continue;
        }
        live.add(snapshot.sessionId);
        this._syncCoordinatorSnapshot(snapshot, coordinator);
      }
      for (const [sessionId, session] of this.sessions) {
        if (session.hostPrincipalId && !live.has(sessionId)) {
          this._clearCoordinatorSession(sessionId);
        }
      }
      this._coordinatorHydrated = true;
      this._coordinatorHydrationError = null;
    } catch (error) {
      this._coordinatorHydrated = false;
      this._coordinatorHydrationError = error;
      throw error;
    }
  }

  _clearCoordinatorSession(sessionId) {
    for (const [key, binding] of this._transportBindings) {
      if (binding.sessionId === sessionId) this._transportBindings.delete(key);
    }
    for (const [challengeId, pending] of this._pendingAuthentication) {
      if (pending.sessionId === sessionId) {
        this._pendingAuthentication.delete(challengeId);
      }
    }
    this.sessions.delete(sessionId);
    this.tokens.delete(sessionId);
  }

  _refreshCoordinatorSession(sessionId) {
    const coordinator = this._requireMembershipCoordinator();
    const current = coordinator.getSessionSnapshot(sessionId);
    if (
      !current ||
      current.session.status !== "active" ||
      current.session.expiresAt <= this.now()
    ) {
      this._clearCoordinatorSession(sessionId);
      return current?.session || null;
    }
    return this._syncCoordinatorSnapshot(current.session, coordinator);
  }

  _syncCoordinatorSnapshot(snapshot, coordinator = null) {
    const authority = coordinator || this._resolveMembershipCoordinator();
    const previous = this.sessions.get(snapshot.sessionId) || null;
    const priorMembers = previous?.members || new Map();
    for (const [key, binding] of this._transportBindings) {
      if (binding.sessionId === snapshot.sessionId) {
        this._transportBindings.delete(key);
      }
    }
    const members = new Map();
    for (const durableMember of snapshot.members) {
      const prior = priorMembers.get(durableMember.principalId) || null;
      const sameActiveMembership =
        prior?.status === "active" &&
        durableMember.status === "active" &&
        prior.membershipEpoch === durableMember.membershipEpoch;
      const member = {
        principalId: durableMember.principalId,
        clientId: durableMember.principalId,
        scopes: [...durableMember.scopes],
        joinedAt: prior?.joinedAt || snapshot.createdAt,
        pushToken: sameActiveMembership ? prior.pushToken || null : null,
        pushProvider:
          sameActiveMembership && prior.pushToken
            ? prior.pushProvider || null
            : null,
        membershipEpoch: durableMember.membershipEpoch,
        status: durableMember.status,
        transportClientId:
          durableMember.status === "active"
            ? sameActiveMembership
              ? prior.transportClientId || null
              : null
            : null,
      };
      members.set(member.principalId, member);
      if (member.transportClientId) {
        this._transportBindings.set(
          transportBindingKey(snapshot.sessionId, member.transportClientId),
          { sessionId: snapshot.sessionId, principalId: member.principalId },
        );
      }
    }
    const host = members.get(snapshot.hostPrincipalId) || null;
    const session = {
      sessionId: snapshot.sessionId,
      agentSessionId: snapshot.agentSessionId,
      name: previous?.name || snapshot.agentSessionId,
      hostPrincipalId: snapshot.hostPrincipalId,
      hostClientId: host?.transportClientId || null,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      status: snapshot.status,
      members,
      membershipAuthority: authority.trustDescriptor().authorityVersion,
      sessionEpoch: snapshot.sessionEpoch,
      authorityGeneration: snapshot.authorityGeneration,
      leases: new Map(snapshot.leases.map((lease) => [lease.leaseId, lease])),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  _attachTransport(session, principalId, transportClientId) {
    const member = session.members.get(principalId);
    if (!member || member.status !== "active") {
      throw new Error("Remote membership principal is not active");
    }
    const occupied = this._transportBindings.get(
      transportBindingKey(session.sessionId, transportClientId),
    );
    if (occupied && occupied.principalId !== principalId) {
      throw new Error("Remote transport is already bound to another principal");
    }
    if (member.transportClientId) {
      this._transportBindings.delete(
        transportBindingKey(session.sessionId, member.transportClientId),
      );
    }
    member.transportClientId = transportClientId;
    this._transportBindings.set(
      transportBindingKey(session.sessionId, transportClientId),
      { sessionId: session.sessionId, principalId },
    );
    if (principalId === session.hostPrincipalId) {
      session.hostClientId = transportClientId;
    }
    return member;
  }

  _principalForTransport(session, transportClientId) {
    if (!session.hostPrincipalId) return transportClientId;
    const binding = this._transportBindings.get(
      transportBindingKey(session.sessionId, transportClientId),
    );
    return binding?.principalId || null;
  }

  _requireMembershipAuthority() {
    if (typeof this._membershipAuthority === "function") {
      this._membershipAuthority = this._membershipAuthority();
    }
    if (!this._membershipAuthority) {
      throw new Error(
        "Durable Remote membership authority is required for client-hosted approvals",
      );
    }
    return this._membershipAuthority;
  }

  create({
    hostClientId,
    agentSessionId,
    name,
    scopes,
    durableMembership = false,
    hostCredentialPublicKeySpki = null,
  } = {}) {
    if (!hostClientId) throw new Error("hostClientId is required");
    if (!agentSessionId) throw new Error("agentSessionId is required");
    const now = this.now();
    const expiresAt = now + this.policy.capSessionTtl(this.sessionTtlMs);
    const sessionId = randomUUID();
    const coordinator =
      durableMembership && this._membershipCoordinator
        ? this._requireMembershipCoordinator()
        : null;
    const durable = coordinator
      ? coordinator.createSession({
          sessionId,
          agentSessionId,
          scopes: REMOTE_SESSION_SCOPES,
          expiresAt,
          hostCredentialPublicKeySpki,
          joinPolicy: this.policy.authorityDescriptor(),
        })
      : durableMembership
        ? this._requireMembershipAuthority().createSession({
            sessionId,
            agentSessionId,
            hostPrincipalId: hostClientId,
            scopes: REMOTE_SESSION_SCOPES,
            expiresAt,
          })
        : null;
    if (coordinator) {
      const session = this._syncCoordinatorSnapshot(durable.statement.payload);
      session.name = name || agentSessionId;
      return {
        session: publicSession(session),
        pairing: this.issuePairingToken(session.sessionId, { scopes }),
        bootstrap: Object.freeze({
          trust: durable.trust,
          statement: durable.statement,
          hostPrincipalId: durable.hostPrincipalId,
          membershipEpoch: durable.membershipEpoch,
          hostCredentialPublicKeySpki: durable.hostCredentialPublicKeySpki,
        }),
      };
    }
    const session = {
      sessionId,
      agentSessionId,
      name: name || agentSessionId,
      hostClientId,
      createdAt: now,
      expiresAt,
      members: new Map([
        [
          hostClientId,
          {
            clientId: hostClientId,
            scopes: REMOTE_SESSION_SCOPES,
            joinedAt: now,
            ...(durable ? { membershipEpoch: durable.membershipEpoch } : {}),
          },
        ],
      ]),
      ...(durable
        ? {
            membershipAuthority: durable.authorityVersion,
            sessionEpoch: durable.sessionEpoch,
          }
        : {}),
    };
    this.sessions.set(session.sessionId, session);
    return {
      session: publicSession(session),
      pairing: this.issuePairingToken(session.sessionId, { scopes }),
    };
  }

  pairingInvitation(sessionId, token) {
    const session = this.requireSession(sessionId);
    const pairing = this.tokens.get(sessionId);
    if (!pairing || pairing.expiresAt <= this.now()) {
      this.tokens.delete(sessionId);
      throw new Error("Pairing token is missing or expired");
    }
    if (!tokensMatch(token, pairing.digest)) {
      throw new Error("Invalid pairing token");
    }
    return Object.freeze({
      session,
      scopes: Object.freeze([...pairing.scopes]),
      expiresAt: pairing.expiresAt,
    });
  }

  issueMemberJoinChallenge({
    sessionId,
    transportClientId,
    token,
    credentialPublicKey,
    connectionNonce,
    capabilities = null,
  } = {}) {
    const invitation = this.pairingInvitation(sessionId, token);
    const session = invitation.session;
    if (!session.hostPrincipalId) {
      throw new Error("Durable direct membership challenge is unavailable");
    }
    const deviceCount = [...session.members.values()].filter(
      (member) =>
        member.principalId !== session.hostPrincipalId &&
        member.status === "active",
    ).length;
    this.policy.enforceJoin({ deviceCount, via: "direct" });
    const challenge =
      this._requireMembershipCoordinator().issueMemberJoinChallenge({
        sessionId,
        expectedSessionEpoch: session.sessionEpoch,
        scopes: invitation.scopes,
        credentialPublicKey,
        connectionNonce,
        ttlMs: Math.max(1, invitation.expiresAt - this.now()),
        capabilities,
        joinPolicy: this.policy.authorityDescriptor(),
      });
    this._pendingAuthentication.set(challenge.challengeId, {
      purpose: "member.join",
      sessionId,
      transportClientId,
      pairingDigest: Buffer.from(this.tokens.get(sessionId).digest),
      pairingExpiresAt: invitation.expiresAt,
    });
    return challenge;
  }

  completeMemberJoin({
    challengeId,
    transportClientId,
    connectionNonce,
    signature,
    pushToken = null,
    pushProvider = null,
  } = {}) {
    const pending = this._pendingAuthentication.get(challengeId);
    this._pendingAuthentication.delete(challengeId);
    if (
      !pending ||
      pending.purpose !== "member.join" ||
      pending.transportClientId !== transportClientId ||
      pending.pairingExpiresAt <= this.now()
    ) {
      throw new Error("Remote membership join proof is stale");
    }
    const currentPairing = this.tokens.get(pending.sessionId);
    if (
      !currentPairing ||
      currentPairing.digest.length !== pending.pairingDigest.length ||
      !timingSafeEqual(currentPairing.digest, pending.pairingDigest)
    ) {
      throw new Error("Remote membership pairing invitation changed");
    }
    const joined = this._requireMembershipCoordinator().joinMember({
      challengeId,
      connectionNonce,
      signature,
    });
    this.tokens.delete(pending.sessionId);
    const session = this._syncCoordinatorSnapshot(joined.statement.payload);
    const member = this._attachTransport(
      session,
      joined.principalId,
      transportClientId,
    );
    member.pushToken = pushToken || null;
    member.pushProvider = pushToken ? pushProvider || null : null;
    return {
      session: publicSession(session),
      member: publicMember(member, session),
      nextConnectionNonce: joined.nextConnectionNonce,
      statement: joined.statement,
    };
  }

  issueSessionResumeChallenge({
    sessionId,
    principalId,
    transportClientId,
    connectionNonce,
  } = {}) {
    const challenge =
      this._requireMembershipCoordinator().issueSessionResumeChallenge({
        sessionId,
        principalId,
        connectionNonce,
      });
    this._pendingAuthentication.set(challenge.challengeId, {
      purpose: "session.resume",
      sessionId,
      principalId,
      transportClientId,
    });
    return challenge;
  }

  completeSessionResume({
    challengeId,
    transportClientId,
    connectionNonce,
    signature,
  } = {}) {
    const pending = this._pendingAuthentication.get(challengeId);
    this._pendingAuthentication.delete(challengeId);
    if (
      !pending ||
      pending.purpose !== "session.resume" ||
      pending.transportClientId !== transportClientId
    ) {
      throw new Error("Remote membership resume proof is stale");
    }
    const resumed = this._requireMembershipCoordinator().resumeSession({
      challengeId,
      connectionNonce,
      signature,
    });
    if (
      resumed.session.sessionId !== pending.sessionId ||
      resumed.principalId !== pending.principalId
    ) {
      throw new Error("Remote membership resume binding changed");
    }
    const session = this._syncCoordinatorSnapshot(resumed.session);
    const member = this._attachTransport(
      session,
      resumed.principalId,
      transportClientId,
    );
    return {
      session: publicSession(session),
      member: publicMember(member, session),
      nextConnectionNonce: resumed.nextConnectionNonce,
      statement: resumed.statement,
      trust: resumed.trust,
    };
  }

  issueSessionReenableChallenge({
    sessionId,
    principalId,
    transportClientId,
    connectionNonce,
    newHostCredentialPublicKeySpki = null,
  } = {}) {
    const coordinator = this._requireMembershipCoordinator();
    const challenge = coordinator.issueSessionReenableChallenge({
      sessionId,
      principalId,
      connectionNonce,
      newHostCredentialPublicKeySpki,
      scopes: REMOTE_SESSION_SCOPES,
      expiresAt: this.now() + this.policy.capSessionTtl(this.sessionTtlMs),
      joinPolicy: this.policy.authorityDescriptor(),
    });
    this._pendingAuthentication.set(challenge.challengeId, {
      purpose: "session.reenable",
      sessionId,
      principalId,
      nextPrincipalId: challenge.nextPrincipalId,
      transportClientId,
    });
    return challenge;
  }

  completeSessionReenable({
    challengeId,
    transportClientId,
    connectionNonce,
    signature,
  } = {}) {
    const pending = this._pendingAuthentication.get(challengeId);
    this._pendingAuthentication.delete(challengeId);
    if (
      !pending ||
      pending.purpose !== "session.reenable" ||
      pending.transportClientId !== transportClientId
    ) {
      throw new Error("Remote membership re-enable proof is stale");
    }
    const reenabled = this._requireMembershipCoordinator().reenableSession({
      challengeId,
      connectionNonce,
      signature,
    });
    if (
      reenabled.sessionId !== pending.sessionId ||
      reenabled.hostPrincipalId !== pending.nextPrincipalId
    ) {
      throw new Error("Remote membership re-enable binding changed");
    }
    const session = this._syncCoordinatorSnapshot(reenabled.statement.payload);
    const member = this._attachTransport(
      session,
      reenabled.hostPrincipalId,
      transportClientId,
    );
    return {
      session: publicSession(session),
      member: publicMember(member, session),
      nextConnectionNonce: reenabled.nextConnectionNonce,
      statement: reenabled.statement,
      trust: reenabled.trust,
    };
  }

  terminalSnapshot(sessionId) {
    const current =
      this._requireMembershipCoordinator().getSessionSnapshot(sessionId);
    if (!current || current.session.status !== "closed") {
      throw new Error("Remote membership session has no terminal tombstone");
    }
    this._clearCoordinatorSession(sessionId);
    return current;
  }

  joinRelayMember({
    sessionId,
    transportClientId,
    token,
    mobilePublicKey,
    pairingTokenDigest,
    possessionCapability,
    capabilities = null,
    pushToken = null,
    pushProvider = null,
  } = {}) {
    const invitation = this.pairingInvitation(sessionId, token);
    const session = invitation.session;
    if (!session.hostPrincipalId) {
      throw new Error("Durable relay membership is unavailable");
    }
    const deviceCount = [...session.members.values()].filter(
      (member) =>
        member.principalId !== session.hostPrincipalId &&
        member.status === "active",
    ).length;
    this.policy.enforceJoin({ deviceCount, via: "relay" });
    const negotiatedCapabilities = normalizeCapabilities(capabilities);
    const negotiatedScopes = invitation.scopes.filter(
      (scope) =>
        scope !== "approve" ||
        negotiatedCapabilities.includes(REMOTE_APPROVAL_BINDING_CAPABILITY),
    );
    if (negotiatedScopes.length === 0) {
      throw new Error(
        "Remote relay capabilities do not authorize any requested scope",
      );
    }
    const joined = this._requireMembershipCoordinator().joinRelayMember({
      sessionId,
      expectedSessionEpoch: session.sessionEpoch,
      scopes: negotiatedScopes,
      mobilePeerId: transportClientId,
      mobilePublicKey,
      pairingTokenDigest,
      possessionCapability,
      capabilities: negotiatedCapabilities,
      joinPolicy: this.policy.authorityDescriptor(),
    });
    this.tokens.delete(sessionId);
    const updated = this._syncCoordinatorSnapshot(joined.statement.payload);
    const member = this._attachTransport(
      updated,
      joined.principalId,
      transportClientId,
    );
    member.pushToken = pushToken || null;
    member.pushProvider = pushToken ? pushProvider || null : null;
    return {
      session: publicSession(updated),
      member: publicMember(member, updated),
      statement: joined.statement,
      capabilities: Object.freeze([...negotiatedCapabilities]),
    };
  }

  issuePairingToken(sessionId, { scopes } = {}) {
    const session = this.requireSession(sessionId);
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const { scopes: applied, narrowed } = this.policy.applyScopes(scopes);
    const grantedScopes = normalizeScopes(applied);
    this.tokens.set(sessionId, {
      digest: hashToken(token),
      scopes: grantedScopes,
      createdAt: now,
      expiresAt: Math.min(
        now + this.policy.capTokenTtl(this.tokenTtlMs),
        session.expiresAt,
      ),
    });
    return {
      token,
      expiresAt: this.tokens.get(sessionId).expiresAt,
      scopes: grantedScopes,
      policyNarrowed: narrowed,
    };
  }

  join({
    sessionId,
    clientId,
    token,
    via = "direct",
    pushToken = null,
    pushProvider = null,
  } = {}) {
    if (!clientId) throw new Error("clientId is required");
    const session = this.requireSession(sessionId);
    if (session.hostPrincipalId) {
      throw new Error(
        "Durable membership requires a possession-proof join protocol",
      );
    }
    const pairing = this.tokens.get(sessionId);
    if (!pairing || pairing.expiresAt <= this.now()) {
      this.tokens.delete(sessionId);
      throw new Error("Pairing token is missing or expired");
    }
    if (!tokensMatch(token, pairing.digest)) {
      throw new Error("Invalid pairing token");
    }
    if (clientId === session.hostClientId) {
      throw new Error("Cannot replace the host membership through pairing");
    }
    // Org policy is enforced only after the token proves the caller is invited,
    // so a device-limit / relay-disabled message never leaks to unauthenticated
    // probes. Existing (non-host) devices count against the limit.
    const deviceCount = [...session.members.values()].filter(
      (member) => member.clientId !== session.hostClientId,
    ).length;
    this.policy.enforceJoin({ deviceCount, via });
    const durable = session.membershipAuthority
      ? this._requireMembershipAuthority().joinMember({
          sessionId,
          principalId: clientId,
          scopes: pairing.scopes,
          expectedSessionEpoch: session.sessionEpoch,
        })
      : null;
    // Pairing credentials are deliberately one-time. The host must explicitly
    // issue another token for each additional device. For durable sessions the
    // authority commit happens first, so a persistence failure stays retryable.
    this.tokens.delete(sessionId);
    const member = {
      clientId,
      scopes: pairing.scopes,
      joinedAt: this.now(),
      pushToken: pushToken || null,
      pushProvider: pushToken ? pushProvider || null : null,
      ...(durable ? { membershipEpoch: durable.membershipEpoch } : {}),
    };
    session.members.set(clientId, member);
    return { session: publicSession(session), member: { ...member } };
  }

  /**
   * A device registers (or refreshes / clears) its own vendor push token after
   * pairing — e.g. once FCM assigns one. Only an existing member may set its own
   * token. A null token clears push for that device.
   */
  registerPush(sessionId, clientId, { token = null, provider = null } = {}) {
    const session = this.requireSession(sessionId);
    const principalId = this._principalForTransport(session, clientId);
    const member = session.members.get(principalId || clientId);
    if (!member || (member.status && member.status !== "active")) {
      throw new Error("Device is not paired with this remote session");
    }
    member.pushToken = token || null;
    member.pushProvider = token ? provider || null : null;
    return {
      clientId,
      hasPush: Boolean(member.pushToken),
      provider: member.pushProvider,
    };
  }

  /** Non-host members that carry a push token, for wake-up dispatch. */
  pushTargets(sessionId, { excludeClientId } = {}) {
    const session = this.requireSession(sessionId);
    const targets = [];
    for (const member of session.members.values()) {
      if (member.status && member.status !== "active") continue;
      if (
        (session.hostPrincipalId &&
          member.principalId === session.hostPrincipalId) ||
        (!session.hostPrincipalId && member.clientId === session.hostClientId)
      )
        continue;
      if (
        excludeClientId &&
        (member.clientId === excludeClientId ||
          member.transportClientId === excludeClientId)
      )
        continue;
      if (!member.pushToken) continue;
      targets.push({
        clientId: member.clientId,
        ...(session.hostPrincipalId
          ? { transportClientId: member.transportClientId || null }
          : {}),
        pushToken: member.pushToken,
        pushProvider: member.pushProvider,
      });
    }
    return targets;
  }

  authorize(sessionId, clientId, scope) {
    const session = this.requireSession(sessionId);
    if (session.membershipQuarantined) {
      throw new Error(
        "Remote membership session is quarantined after an unknown durable transition",
      );
    }
    const principalId = this._principalForTransport(session, clientId);
    const member = session.members.get(principalId || clientId);
    if (!member)
      throw new Error("Client is not paired with this remote session");
    if (member.status && member.status !== "active") {
      throw new Error("Remote membership principal is not active");
    }
    if (member.membershipQuarantined) {
      throw new Error(
        "Remote membership is quarantined after an unknown durable transition",
      );
    }
    if (!member.scopes.includes(scope)) {
      throw new Error(`Remote session scope required: ${scope}`);
    }
    let membership = null;
    if (session.hostPrincipalId) {
      const verdict = this._requireMembershipCoordinator().readMembership(
        {
          sessionId,
          principalId: member.principalId,
          sessionEpoch: session.sessionEpoch,
          membershipEpoch: member.membershipEpoch,
        },
        scope,
      );
      if (!verdict.ok) {
        throw new Error(
          `Remote membership coordinator denied: ${verdict.reason}`,
        );
      }
      membership = verdict.binding;
    } else if (session.membershipAuthority) {
      const verdict = this._requireMembershipAuthority().readMembership(
        {
          sessionId,
          principalId: clientId,
          sessionEpoch: session.sessionEpoch,
          membershipEpoch: member.membershipEpoch,
        },
        scope,
      );
      if (!verdict.ok) {
        throw new Error(
          `Remote membership authority denied: ${verdict.reason}`,
        );
      }
      membership = verdict.binding;
    }
    return { session, member, membership };
  }

  members(sessionId) {
    const session = this.requireSession(sessionId);
    return [...session.members.values()]
      .filter((member) => !member.status || member.status === "active")
      .map((member) => ({
        ...publicMember(member, session),
        transportClientId: member.transportClientId || member.clientId,
      }));
  }

  /**
   * Host-only view of every paired device on a session. The host flag lets the
   * UI keep the host row un-revocable and label it distinctly.
   */
  listDevices(sessionId, hostClientId) {
    const session = this.requireSession(sessionId);
    const hostPrincipal = hostClientId
      ? this._principalForTransport(session, hostClientId)
      : null;
    if (
      hostClientId &&
      (session.hostPrincipalId
        ? hostPrincipal !== session.hostPrincipalId
        : session.hostClientId !== hostClientId)
    ) {
      throw new Error("Only the host can list paired devices");
    }
    return {
      session: publicSession(session),
      devices: [...session.members.values()].map((member) => ({
        clientId: member.principalId || member.clientId,
        ...(member.principalId ? { principalId: member.principalId } : {}),
        scopes: [...member.scopes],
        joinedAt: member.joinedAt,
        isHost: session.hostPrincipalId
          ? member.principalId === session.hostPrincipalId
          : member.clientId === session.hostClientId,
        ...(session.hostPrincipalId
          ? { connected: Boolean(member.transportClientId) }
          : {}),
        hasPush: Boolean(member.pushToken),
        pushProvider: member.pushProvider || null,
        ...(member.status ? { status: member.status } : {}),
      })),
    };
  }

  /**
   * Host-initiated revocation of a single paired device. The host cannot revoke
   * itself (use close() to end the whole session). Returns the removed member so
   * callers can push a revocation notice to that device.
   */
  revokeMember(sessionId, hostClientId, clientId) {
    if (!clientId) throw new Error("clientId is required");
    const session = this.requireSession(sessionId);
    const hostPrincipal = this._principalForTransport(session, hostClientId);
    if (
      session.hostPrincipalId
        ? hostPrincipal !== session.hostPrincipalId
        : session.hostClientId !== hostClientId
    ) {
      throw new Error("Only the host can revoke devices");
    }
    if (clientId === (session.hostPrincipalId || session.hostClientId)) {
      throw new Error("Cannot revoke the host device");
    }
    const member = session.members.get(clientId);
    if (!member)
      throw new Error("Device is not paired with this remote session");
    const notificationTransportId = member.transportClientId || member.clientId;
    let resultSession = session;
    let resultMember = member;
    let membershipStatement = null;
    if (session.hostPrincipalId) {
      try {
        const host = session.members.get(session.hostPrincipalId);
        const revoked = this._requireMembershipCoordinator().revokeMember({
          sessionId,
          principalId: clientId,
          hostPrincipalId: session.hostPrincipalId,
          expectedSessionEpoch: session.sessionEpoch,
          expectedMembershipEpoch: member.membershipEpoch,
          expectedHostMembershipEpoch: host.membershipEpoch,
        });
        resultSession = this._syncCoordinatorSnapshot(
          revoked.statement.payload,
        );
        resultMember = resultSession.members.get(clientId);
        membershipStatement = revoked.statement;
      } catch (error) {
        member.membershipQuarantined = true;
        throw error;
      }
    } else if (session.membershipAuthority) {
      try {
        this._requireMembershipAuthority().revokeMember({
          sessionId,
          principalId: clientId,
          expectedSessionEpoch: session.sessionEpoch,
          expectedMembershipEpoch: member.membershipEpoch,
        });
      } catch (error) {
        // The durable outcome may be unknown. Keep the record for diagnostics,
        // but locally quarantine it so no later frame can authorize.
        member.membershipQuarantined = true;
        throw error;
      }
    }
    if (!session.hostPrincipalId) session.members.delete(clientId);
    return {
      session: publicSession(resultSession),
      member: {
        ...publicMember(resultMember, resultSession),
        transportClientId: notificationTransportId,
      },
      ...(membershipStatement ? { statement: membershipStatement } : {}),
    };
  }

  findHosted(agentSessionId, hostClientId) {
    const hasDurableSession = [...this.sessions.values()].some((session) =>
      Boolean(session.hostPrincipalId),
    );
    if (
      this._membershipCoordinator &&
      (this._refreshCoordinatorOnEnumeration ||
        this._coordinatorHydrated ||
        hasDurableSession)
    ) {
      // Enumeration cannot rely on the one-time startup hydration: another
      // server may have created, closed, or re-enabled a durable session since
      // this process started. Explicit coordinator deployments and processes
      // already serving durable sessions refresh before matching local
      // transport attachments. A lazy default coordinator must stay unopened
      // for purely in-memory sessions.
      this._hydrateCoordinatorSessions(this._resolveMembershipCoordinator());
    }
    const matches = [];
    for (const sessionId of [...this.sessions.keys()]) {
      let session;
      try {
        session = this.requireSession(sessionId);
      } catch {
        continue;
      }
      if (
        session.agentSessionId === agentSessionId &&
        session.hostClientId === hostClientId &&
        session.expiresAt > this.now()
      ) {
        matches.push(session);
      }
    }
    return matches;
  }

  removeClient(clientId) {
    const affected = [];
    for (const [sessionId, session] of this.sessions) {
      const principalId = this._principalForTransport(session, clientId);
      const member = session.members.get(principalId || clientId);
      if (!member) continue;
      if (session.hostPrincipalId) {
        this._transportBindings.delete(
          transportBindingKey(sessionId, clientId),
        );
        member.transportClientId = null;
        if (member.principalId === session.hostPrincipalId) {
          session.hostClientId = null;
        }
        affected.push({
          sessionId,
          closed: false,
          detached: true,
          principalId: member.principalId,
        });
        continue;
      }
      if (session.hostClientId === clientId) {
        if (session.membershipAuthority) {
          try {
            this._requireMembershipAuthority().closeSession({
              sessionId,
              hostPrincipalId: clientId,
              expectedSessionEpoch: session.sessionEpoch,
            });
          } catch (error) {
            session.membershipQuarantined = true;
            throw error;
          }
        }
        this.sessions.delete(sessionId);
        this.tokens.delete(sessionId);
        affected.push({ sessionId, closed: true });
      } else {
        if (session.membershipAuthority) {
          try {
            this._requireMembershipAuthority().revokeMember({
              sessionId,
              principalId: clientId,
              expectedSessionEpoch: session.sessionEpoch,
              expectedMembershipEpoch: member.membershipEpoch,
            });
          } catch (error) {
            member.membershipQuarantined = true;
            throw error;
          }
        }
        session.members.delete(clientId);
        affected.push({ sessionId, closed: false });
      }
    }
    return affected;
  }

  close(sessionId, clientId) {
    const session = this.requireSession(sessionId);
    const hostPrincipal = this._principalForTransport(session, clientId);
    if (
      session.hostPrincipalId
        ? hostPrincipal !== session.hostPrincipalId
        : session.hostClientId !== clientId
    ) {
      throw new Error("Only the host can close a Remote Session");
    }
    let durableClose = null;
    if (session.hostPrincipalId) {
      try {
        const host = session.members.get(session.hostPrincipalId);
        durableClose = this._requireMembershipCoordinator().closeSession({
          sessionId,
          hostPrincipalId: session.hostPrincipalId,
          expectedSessionEpoch: session.sessionEpoch,
          expectedHostMembershipEpoch: host.membershipEpoch,
        });
      } catch (error) {
        session.membershipQuarantined = true;
        throw error;
      }
    } else if (session.membershipAuthority) {
      try {
        this._requireMembershipAuthority().closeSession({
          sessionId,
          hostPrincipalId: clientId,
          expectedSessionEpoch: session.sessionEpoch,
        });
      } catch (error) {
        session.membershipQuarantined = true;
        throw error;
      }
    }
    this.sessions.delete(sessionId);
    this.tokens.delete(sessionId);
    const closedSession = publicSession(session);
    return durableClose
      ? {
          session: closedSession,
          statement: durableClose.statement,
          terminal: durableClose.terminal === true,
          alreadyClosed: durableClose.alreadyClosed === true,
        }
      : closedSession;
  }

  requireSession(sessionId) {
    let session = this.sessions.get(sessionId) || null;
    if ((session?.hostPrincipalId || !session) && this._membershipCoordinator) {
      const durable = this._refreshCoordinatorSession(sessionId);
      if (durable?.status && durable.status !== "active") {
        throw new Error("Remote session is durably closed");
      }
      session = this.sessions.get(sessionId) || null;
    }
    if (!session) throw new Error("Remote session not found");
    if (session.expiresAt <= this.now()) {
      if (session.membershipAuthority && !session.hostPrincipalId) {
        try {
          this._requireMembershipAuthority().closeSession({
            sessionId,
            hostPrincipalId: session.hostClientId,
            expectedSessionEpoch: session.sessionEpoch,
          });
        } catch (error) {
          session.membershipQuarantined = true;
          throw error;
        }
      }
      this.sessions.delete(sessionId);
      this.tokens.delete(sessionId);
      throw new Error("Remote session expired");
    }
    return session;
  }
}
