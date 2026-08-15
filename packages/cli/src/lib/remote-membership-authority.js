/**
 * Durable, same-machine authority for client-hosted Remote Session members.
 *
 * A WebSocket connection id is not, by itself, durable proof that a remote
 * approval still comes from a paired principal. This store gives every
 * session and membership activation a monotonically increasing epoch. The WS
 * server persists create/join/revoke/close transitions before changing its
 * in-memory registry, then forwards the exact epochs it authorized. The local
 * approval bridge re-checks those epochs under the same cross-process lock and
 * performs the approval CAS inside that lock.
 *
 * `principalId` is the current server process's connection/relay identity; the
 * registry does not reconstruct live sockets or sessions from this file after
 * a server restart. This is deliberately a same-OS-user,
 * same-machine/file-authority
 * boundary. It does not claim consensus, quorum revocation, fencing across
 * independent hosts, detection of an offline store rollback after every
 * observing process exits, or cancellation of a side effect dispatched after
 * an approval CAS has already won.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getMachineSecurityAnchorDir } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

export const REMOTE_MEMBERSHIP_AUTHORITY_VERSION =
  "durable-monotonic-membership-epoch-v1";
export const REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE_CODE =
  "CC_REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE";
export const REMOTE_MEMBERSHIP_AUTHORITY_ROLLBACK_CODE =
  "CC_REMOTE_MEMBERSHIP_AUTHORITY_ROLLBACK";

const STORE_VERSION = 1;
const LABEL = "Remote membership authority";
const VALID_SCOPES = new Set(["observe", "prompt", "approve", "interrupt"]);
const VALID_EVENT_TYPES = new Set([
  "session.created",
  "member.joined",
  "member.revoked",
  "session.closed",
]);

function requiredId(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function parseEpoch(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new TypeError(`${label} must be a canonical positive integer`);
  }
  return BigInt(value);
}

function parseGeneration(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical non-negative integer`);
  }
  return BigInt(value);
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError("membership scopes must be a non-empty array");
  }
  const normalized = [...new Set(scopes.map((scope) => String(scope)))];
  for (const scope of normalized) {
    if (!VALID_SCOPES.has(scope)) {
      throw new TypeError(`unsupported membership scope: ${scope}`);
    }
  }
  return normalized;
}

function authorityError(code, message, cause, filePath) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "RemoteMembershipAuthorityError";
  error.code = code;
  error.filePath = filePath;
  return error;
}

function unavailableError(cause, filePath) {
  if (
    cause?.code === REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE_CODE ||
    cause?.code === REMOTE_MEMBERSHIP_AUTHORITY_ROLLBACK_CODE
  ) {
    return cause;
  }
  return authorityError(
    REMOTE_MEMBERSHIP_AUTHORITY_UNAVAILABLE_CODE,
    "Remote membership authority is unavailable; remote approval is denied",
    cause,
    filePath,
  );
}

function rollbackError(observed, current, filePath) {
  const error = authorityError(
    REMOTE_MEMBERSHIP_AUTHORITY_ROLLBACK_CODE,
    `Remote membership authority rolled back from ${current} to ${observed}; remote approval is denied`,
    null,
    filePath,
  );
  error.observedGeneration = String(observed);
  error.currentGeneration = String(current);
  return error;
}

function cloneMember(member) {
  return {
    principalId: member.principalId,
    membershipEpoch: member.membershipEpoch,
    status: member.status,
    scopes: [...member.scopes],
  };
}

function cloneSession(session) {
  return {
    sessionId: session.sessionId,
    agentSessionId: session.agentSessionId,
    hostPrincipalId: session.hostPrincipalId,
    sessionEpoch: session.sessionEpoch,
    expiresAt: session.expiresAt,
    status: session.status,
    members: new Map(
      [...session.members].map(([principalId, member]) => [
        principalId,
        cloneMember(member),
      ]),
    ),
  };
}

function replayStore(store, { missing = false } = {}) {
  if (missing && Object.keys(store).length === 0) {
    return { generation: 0n, events: [], sessions: new Map() };
  }
  if (store.version !== STORE_VERSION) {
    throw new TypeError(
      `unsupported Remote membership authority version: ${String(store.version)}`,
    );
  }
  const generation = parseGeneration(store.generation, "generation");
  if (!Array.isArray(store.events)) {
    throw new TypeError("events must be an array");
  }

  const sessions = new Map();
  let previousGeneration = 0n;
  for (const [index, event] of store.events.entries()) {
    const prefix = `events[${index}]`;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError(`${prefix} must be an object`);
    }
    const eventGeneration = parseEpoch(
      event.generation,
      `${prefix}.generation`,
    );
    const eventPrevious = parseGeneration(
      event.previousGeneration,
      `${prefix}.previousGeneration`,
    );
    if (
      eventPrevious !== previousGeneration ||
      eventGeneration !== previousGeneration + 1n
    ) {
      throw new TypeError(`${prefix} breaks the generation chain`);
    }
    if (!VALID_EVENT_TYPES.has(event.type)) {
      throw new TypeError(`${prefix}.type is unsupported`);
    }
    requiredId(event.eventId, `${prefix}.eventId`);
    const sessionId = requiredId(event.sessionId, `${prefix}.sessionId`);
    if (!Number.isSafeInteger(event.occurredAtMs) || event.occurredAtMs < 0) {
      throw new TypeError(`${prefix}.occurredAtMs must be a safe timestamp`);
    }

    if (event.type === "session.created") {
      if (sessions.has(sessionId)) {
        throw new TypeError(`${prefix} recreates an existing session`);
      }
      const agentSessionId = requiredId(
        event.agentSessionId,
        `${prefix}.agentSessionId`,
      );
      const hostPrincipalId = requiredId(
        event.principalId,
        `${prefix}.principalId`,
      );
      const scopes = normalizeScopes(event.scopes);
      if (
        !Number.isSafeInteger(event.expiresAt) ||
        event.expiresAt <= event.occurredAtMs
      ) {
        throw new TypeError(`${prefix}.expiresAt must be after creation`);
      }
      const epoch = String(eventGeneration);
      sessions.set(sessionId, {
        sessionId,
        agentSessionId,
        hostPrincipalId,
        sessionEpoch: epoch,
        expiresAt: event.expiresAt,
        status: "active",
        members: new Map([
          [
            hostPrincipalId,
            {
              principalId: hostPrincipalId,
              membershipEpoch: epoch,
              status: "active",
              scopes,
            },
          ],
        ]),
      });
    } else {
      const session = sessions.get(sessionId);
      if (!session || session.status !== "active") {
        throw new TypeError(`${prefix} targets an inactive session`);
      }
      if (event.expectedSessionEpoch !== session.sessionEpoch) {
        throw new TypeError(`${prefix} has a stale session epoch`);
      }

      if (event.type === "member.joined") {
        const principalId = requiredId(
          event.principalId,
          `${prefix}.principalId`,
        );
        const prior = session.members.get(principalId) || null;
        const expectedPrior = prior ? prior.membershipEpoch : null;
        if ((event.previousMembershipEpoch ?? null) !== expectedPrior) {
          throw new TypeError(`${prefix} has a stale prior membership epoch`);
        }
        session.members.set(principalId, {
          principalId,
          membershipEpoch: String(eventGeneration),
          status: "active",
          scopes: normalizeScopes(event.scopes),
        });
      } else if (event.type === "member.revoked") {
        const principalId = requiredId(
          event.principalId,
          `${prefix}.principalId`,
        );
        const member = session.members.get(principalId);
        if (!member || member.status !== "active") {
          throw new TypeError(`${prefix} targets an inactive member`);
        }
        if (event.expectedMembershipEpoch !== member.membershipEpoch) {
          throw new TypeError(`${prefix} has a stale membership epoch`);
        }
        member.status = "revoked";
        member.membershipEpoch = String(eventGeneration);
      } else {
        if (event.principalId !== session.hostPrincipalId) {
          throw new TypeError(`${prefix} was not closed by its host`);
        }
        session.status = "closed";
      }
    }
    previousGeneration = eventGeneration;
  }

  if (previousGeneration !== generation) {
    throw new TypeError("generation does not match the durable event chain");
  }
  return { generation, events: [...store.events], sessions };
}

function activeVerdict(snapshot, binding, requiredScope, now = null) {
  let sessionId;
  let principalId;
  try {
    sessionId = requiredId(binding?.sessionId, "sessionId");
    principalId = requiredId(binding?.principalId, "principalId");
  } catch {
    return { ok: false, reason: "membership-binding-required" };
  }
  let sessionEpoch;
  let membershipEpoch;
  try {
    sessionEpoch = String(parseEpoch(binding?.sessionEpoch, "sessionEpoch"));
    membershipEpoch = String(
      parseEpoch(binding?.membershipEpoch, "membershipEpoch"),
    );
  } catch {
    return { ok: false, reason: "membership-epoch-required" };
  }
  const session = snapshot.sessions.get(sessionId);
  if (!session) return { ok: false, reason: "membership-session-unknown" };
  if (session.status !== "active") {
    return { ok: false, reason: "membership-session-closed" };
  }
  if (Number.isSafeInteger(now) && session.expiresAt <= now) {
    return { ok: false, reason: "membership-session-expired" };
  }
  if (session.sessionEpoch !== sessionEpoch) {
    return { ok: false, reason: "stale-session-epoch" };
  }
  const member = session.members.get(principalId);
  if (!member) return { ok: false, reason: "membership-unknown" };
  if (member.status !== "active") {
    return { ok: false, reason: "membership-revoked" };
  }
  if (member.membershipEpoch !== membershipEpoch) {
    return { ok: false, reason: "stale-membership-epoch" };
  }
  if (requiredScope && !member.scopes.includes(requiredScope)) {
    return { ok: false, reason: "membership-scope-denied" };
  }
  return {
    ok: true,
    reason: null,
    binding: Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
      sessionId,
      principalId,
      sessionEpoch,
      membershipEpoch,
      scopes: Object.freeze([...member.scopes]),
    }),
  };
}

export function getRemoteMembershipAuthorityPath() {
  return path.join(
    getMachineSecurityAnchorDir(),
    "remote-membership-authority-v1.json",
  );
}

export class DurableRemoteMembershipAuthority {
  constructor({
    filePath = getRemoteMembershipAuthorityPath(),
    now = () => Date.now(),
    createEventId = randomUUID,
    lockOptions,
    lock = withFileLock,
  } = {}) {
    if (!path.isAbsolute(filePath)) {
      throw new TypeError("Remote membership authority path must be absolute");
    }
    this.filePath = path.resolve(filePath);
    this._now = now;
    this._createEventId = createEventId;
    this._lockOptions = lockOptions;
    this._lock = lock;
    this._observedGeneration = 0n;
  }

  _observe(generation) {
    if (generation < this._observedGeneration) {
      throw rollbackError(generation, this._observedGeneration, this.filePath);
    }
    this._observedGeneration = generation;
  }

  _readUnlocked() {
    const existed = fs.existsSync(this.filePath);
    const snapshot = replayStore(readSecurityStore(this.filePath, LABEL), {
      missing: !existed,
    });
    this._observe(snapshot.generation);
    return snapshot;
  }

  _mutate(makeEvent) {
    try {
      const result = mutateSecurityStore(
        this.filePath,
        LABEL,
        (draft) => {
          const snapshot = replayStore(draft, {
            missing: !fs.existsSync(this.filePath),
          });
          this._observe(snapshot.generation);
          const nextGeneration = snapshot.generation + 1n;
          const event = {
            eventId: requiredId(this._createEventId(), "eventId"),
            generation: String(nextGeneration),
            previousGeneration: String(snapshot.generation),
            occurredAtMs: this._now(),
            ...makeEvent(snapshot, String(nextGeneration)),
          };
          draft.version = STORE_VERSION;
          draft.generation = String(nextGeneration);
          draft.events = [...snapshot.events, event];
          const verified = replayStore(draft);
          const session = verified.sessions.get(event.sessionId);
          const member = event.principalId
            ? session?.members.get(event.principalId)
            : null;
          return {
            generation: nextGeneration,
            session: session ? cloneSession(session) : null,
            member: member ? cloneMember(member) : null,
          };
        },
        { ...this._lockOptions, lock: this._lock },
      );
      this._observe(result.generation);
      return result;
    } catch (cause) {
      throw unavailableError(cause, this.filePath);
    }
  }

  createSession({
    sessionId,
    agentSessionId,
    hostPrincipalId,
    scopes,
    expiresAt,
  } = {}) {
    const normalizedSessionId = requiredId(sessionId, "sessionId");
    const normalizedAgentSessionId = requiredId(
      agentSessionId,
      "agentSessionId",
    );
    const normalizedHost = requiredId(hostPrincipalId, "hostPrincipalId");
    const normalizedScopes = normalizeScopes(scopes);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this._now()) {
      throw new TypeError("expiresAt must be a future safe timestamp");
    }
    const result = this._mutate((snapshot) => {
      if (snapshot.sessions.has(normalizedSessionId)) {
        throw new Error("Remote membership session already exists");
      }
      return {
        type: "session.created",
        sessionId: normalizedSessionId,
        agentSessionId: normalizedAgentSessionId,
        principalId: normalizedHost,
        scopes: normalizedScopes,
        expiresAt,
      };
    });
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
      sessionEpoch: result.session.sessionEpoch,
      membershipEpoch: result.member.membershipEpoch,
    });
  }

  joinMember({ sessionId, principalId, scopes, expectedSessionEpoch } = {}) {
    const normalizedSessionId = requiredId(sessionId, "sessionId");
    const normalizedPrincipal = requiredId(principalId, "principalId");
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedSessionEpoch = String(
      parseEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const result = this._mutate((snapshot) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      if (!session || session.status !== "active") {
        throw new Error("Remote membership session is not active");
      }
      if (session.sessionEpoch !== normalizedSessionEpoch) {
        throw new Error("Remote membership session epoch is stale");
      }
      if (session.hostPrincipalId === normalizedPrincipal) {
        throw new Error("Cannot replace the host membership through join");
      }
      const previous = session.members.get(normalizedPrincipal) || null;
      return {
        type: "member.joined",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: normalizedSessionEpoch,
        principalId: normalizedPrincipal,
        previousMembershipEpoch: previous?.membershipEpoch || null,
        scopes: normalizedScopes,
      };
    });
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
      sessionEpoch: result.session.sessionEpoch,
      membershipEpoch: result.member.membershipEpoch,
    });
  }

  revokeMember({
    sessionId,
    principalId,
    expectedSessionEpoch,
    expectedMembershipEpoch,
  } = {}) {
    const normalizedSessionId = requiredId(sessionId, "sessionId");
    const normalizedPrincipal = requiredId(principalId, "principalId");
    const normalizedSessionEpoch = String(
      parseEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const normalizedMembershipEpoch = String(
      parseEpoch(expectedMembershipEpoch, "expectedMembershipEpoch"),
    );
    const result = this._mutate((snapshot) => {
      const verdict = activeVerdict(
        snapshot,
        {
          sessionId: normalizedSessionId,
          principalId: normalizedPrincipal,
          sessionEpoch: normalizedSessionEpoch,
          membershipEpoch: normalizedMembershipEpoch,
        },
        null,
        this._now(),
      );
      if (!verdict.ok) {
        throw new Error(`Remote membership revoke rejected: ${verdict.reason}`);
      }
      const session = snapshot.sessions.get(normalizedSessionId);
      if (session.hostPrincipalId === normalizedPrincipal) {
        throw new Error("Cannot revoke the host membership");
      }
      return {
        type: "member.revoked",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: normalizedSessionEpoch,
        principalId: normalizedPrincipal,
        expectedMembershipEpoch: normalizedMembershipEpoch,
      };
    });
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
      revokedEpoch: String(result.generation),
    });
  }

  closeSession({ sessionId, hostPrincipalId, expectedSessionEpoch } = {}) {
    const normalizedSessionId = requiredId(sessionId, "sessionId");
    const normalizedHost = requiredId(hostPrincipalId, "hostPrincipalId");
    const normalizedSessionEpoch = String(
      parseEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const result = this._mutate((snapshot) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      if (!session || session.status !== "active") {
        throw new Error("Remote membership session is not active");
      }
      if (
        session.hostPrincipalId !== normalizedHost ||
        session.sessionEpoch !== normalizedSessionEpoch
      ) {
        throw new Error("Remote membership session close CAS is stale");
      }
      return {
        type: "session.closed",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: normalizedSessionEpoch,
        principalId: normalizedHost,
      };
    });
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_AUTHORITY_VERSION,
      closedEpoch: String(result.generation),
    });
  }

  /**
   * Hold the membership lock while `task` performs the approval-store CAS.
   * A revoke either linearizes first (task is never called) or waits until the
   * already-authorized approval CAS has completed. This does not retroactively
   * cancel a tool side effect dispatched after that CAS.
   */
  withActiveMembership(binding, requiredScope, task) {
    if (typeof task !== "function") throw new TypeError("task is required");
    if (task.constructor?.name === "AsyncFunction") {
      throw new TypeError(
        "membership-fenced task must be synchronous so the lock covers its CAS",
      );
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), {
        recursive: true,
        mode: 0o700,
      });
      return this._lock(
        this.filePath,
        () => {
          const snapshot = this._readUnlocked();
          const verdict = activeVerdict(
            snapshot,
            binding,
            requiredScope,
            this._now(),
          );
          if (!verdict.ok) return verdict;
          const value = task(verdict.binding);
          if (value && typeof value.then === "function") {
            throw new TypeError(
              "membership-fenced task returned a Promise before the lock could cover its CAS",
            );
          }
          return {
            ...verdict,
            value,
          };
        },
        {
          timeoutMs: 2000,
          staleMs: 30000,
          failIfUnavailable: true,
          ...this._lockOptions,
        },
      );
    } catch (cause) {
      if (
        cause instanceof TypeError &&
        cause.message.startsWith("membership-fenced task")
      ) {
        throw cause;
      }
      throw unavailableError(cause, this.filePath);
    }
  }

  readMembership(binding, requiredScope = null) {
    return this.withActiveMembership(binding, requiredScope, (current) =>
      Object.freeze({ ...current, scopes: Object.freeze([...current.scopes]) }),
    );
  }
}
