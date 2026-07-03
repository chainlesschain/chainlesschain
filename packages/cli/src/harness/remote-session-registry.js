import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";

export const REMOTE_SESSION_PROTOCOL_VERSION = "1.0";
export const REMOTE_SESSION_SCOPES = Object.freeze([
  "observe",
  "prompt",
  "approve",
  "interrupt",
]);

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

function publicSession(session) {
  return {
    protocolVersion: REMOTE_SESSION_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    agentSessionId: session.agentSessionId,
    name: session.name,
    hostClientId: session.hostClientId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    memberCount: session.members.size,
  };
}

/** In-memory authorization state for one local CLI process. */
export class RemoteSessionRegistry {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.tokenTtlMs = options.tokenTtlMs || DEFAULT_TOKEN_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.sessions = new Map();
    this.tokens = new Map();
  }

  create({ hostClientId, agentSessionId, name, scopes } = {}) {
    if (!hostClientId) throw new Error("hostClientId is required");
    if (!agentSessionId) throw new Error("agentSessionId is required");
    const now = this.now();
    const session = {
      sessionId: randomUUID(),
      agentSessionId,
      name: name || agentSessionId,
      hostClientId,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      members: new Map([
        [
          hostClientId,
          {
            clientId: hostClientId,
            scopes: REMOTE_SESSION_SCOPES,
            joinedAt: now,
          },
        ],
      ]),
    };
    this.sessions.set(session.sessionId, session);
    return {
      session: publicSession(session),
      pairing: this.issuePairingToken(session.sessionId, { scopes }),
    };
  }

  issuePairingToken(sessionId, { scopes } = {}) {
    const session = this.requireSession(sessionId);
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.tokens.set(sessionId, {
      digest: hashToken(token),
      scopes: normalizeScopes(scopes),
      createdAt: now,
      expiresAt: Math.min(now + this.tokenTtlMs, session.expiresAt),
    });
    return { token, expiresAt: this.tokens.get(sessionId).expiresAt };
  }

  join({ sessionId, clientId, token } = {}) {
    if (!clientId) throw new Error("clientId is required");
    const session = this.requireSession(sessionId);
    const pairing = this.tokens.get(sessionId);
    if (!pairing || pairing.expiresAt <= this.now()) {
      this.tokens.delete(sessionId);
      throw new Error("Pairing token is missing or expired");
    }
    if (!tokensMatch(token, pairing.digest)) {
      throw new Error("Invalid pairing token");
    }
    // Pairing credentials are deliberately one-time. The host must explicitly
    // issue another token for each additional device.
    this.tokens.delete(sessionId);
    const member = { clientId, scopes: pairing.scopes, joinedAt: this.now() };
    session.members.set(clientId, member);
    return { session: publicSession(session), member: { ...member } };
  }

  authorize(sessionId, clientId, scope) {
    const session = this.requireSession(sessionId);
    const member = session.members.get(clientId);
    if (!member)
      throw new Error("Client is not paired with this remote session");
    if (!member.scopes.includes(scope)) {
      throw new Error(`Remote session scope required: ${scope}`);
    }
    return { session, member };
  }

  members(sessionId) {
    const session = this.requireSession(sessionId);
    return [...session.members.values()].map((member) => ({ ...member }));
  }

  /**
   * Host-only view of every paired device on a session. The host flag lets the
   * UI keep the host row un-revocable and label it distinctly.
   */
  listDevices(sessionId, hostClientId) {
    const session = this.requireSession(sessionId);
    if (hostClientId && session.hostClientId !== hostClientId) {
      throw new Error("Only the host can list paired devices");
    }
    return {
      session: publicSession(session),
      devices: [...session.members.values()].map((member) => ({
        clientId: member.clientId,
        scopes: [...member.scopes],
        joinedAt: member.joinedAt,
        isHost: member.clientId === session.hostClientId,
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
    if (session.hostClientId !== hostClientId) {
      throw new Error("Only the host can revoke devices");
    }
    if (clientId === session.hostClientId) {
      throw new Error("Cannot revoke the host device");
    }
    const member = session.members.get(clientId);
    if (!member)
      throw new Error("Device is not paired with this remote session");
    session.members.delete(clientId);
    return { session: publicSession(session), member: { ...member } };
  }

  findHosted(agentSessionId, hostClientId) {
    const matches = [];
    for (const session of this.sessions.values()) {
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
      if (!session.members.delete(clientId)) continue;
      if (session.hostClientId === clientId) {
        this.sessions.delete(sessionId);
        this.tokens.delete(sessionId);
        affected.push({ sessionId, closed: true });
      } else {
        affected.push({ sessionId, closed: false });
      }
    }
    return affected;
  }

  close(sessionId, clientId) {
    const session = this.requireSession(sessionId);
    if (session.hostClientId !== clientId) {
      throw new Error("Only the host can close a Remote Session");
    }
    this.sessions.delete(sessionId);
    this.tokens.delete(sessionId);
    return publicSession(session);
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Remote session not found");
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      this.tokens.delete(sessionId);
      throw new Error("Remote session expired");
    }
    return session;
  }
}
