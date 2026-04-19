/**
 * ActivityPub C2S Bridge — actors, outbox/inbox, follow graph.
 *
 * In-memory + SQLite persistence. Implements the W3C ActivityPub Client-to-Server
 * surface: actors publish activities to their outbox, receive in their inbox.
 * Network delivery is simulated via `deliverToInbox` (no real HTTP signatures here).
 *
 * Activity vocabulary covered:
 *   Create(Note) · Follow · Accept · Undo(Follow) · Like · Announce
 *
 * Actor / activity / object IDs follow ActivityStreams 2.0 convention:
 *   https://<origin>/users/<username>
 *   https://<origin>/activities/<uuid>
 *   https://<origin>/notes/<uuid>
 */

import crypto from "crypto";

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const DEFAULT_ORIGIN = "https://local.chainlesschain";

const _actors = new Map(); // id → actor
const _activities = new Map(); // id → activity record { direction, ownerId, activity }
const _follows = new Map(); // `${follower}|${followee}` → { state, createdAt }

/* ── Schema ────────────────────────────────────────────────── */

export function ensureActivityPubTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ap_actors (
      id TEXT PRIMARY KEY,
      username TEXT,
      name TEXT,
      summary TEXT,
      inbox_url TEXT,
      outbox_url TEXT,
      is_local INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ap_activities (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      owner_id TEXT,
      type TEXT,
      direction TEXT,
      object_json TEXT,
      published TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ap_follows (
      follower_id TEXT NOT NULL,
      followee_id TEXT NOT NULL,
      state TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, followee_id)
    )
  `);
}

/* ── Helpers ───────────────────────────────────────────────── */

function _now() {
  return new Date().toISOString();
}

function _actorUrl(origin, username) {
  return `${origin.replace(/\/$/, "")}/users/${username}`;
}

function _resolveActorId(ref) {
  if (!ref) return null;
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  // bare username — look up a local actor
  for (const actor of _actors.values()) {
    if (actor.isLocal && actor.username === ref) return actor.id;
  }
  return null;
}

function _requireActor(ref) {
  const id = _resolveActorId(ref);
  if (!id) throw new Error(`Actor not found: ${ref}`);
  const actor = _actors.get(id);
  if (!actor) throw new Error(`Actor not found: ${ref}`);
  return actor;
}

function _persistActivity(db, record) {
  db.prepare(
    `INSERT INTO ap_activities (id, actor_id, owner_id, type, direction, object_json, published, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.activity.id,
    record.activity.actor,
    record.ownerId,
    record.activity.type,
    record.direction,
    JSON.stringify(record.activity),
    record.activity.published,
    _now(),
  );
}

/* ── Actors ────────────────────────────────────────────────── */

export function createActor(
  db,
  { username, name, summary, origin = DEFAULT_ORIGIN, remoteId } = {},
) {
  if (!remoteId && !username) throw new Error("username is required");
  const isLocal = !remoteId;
  const id = remoteId || _actorUrl(origin, username);

  if (_actors.has(id)) {
    return { success: true, actor: _actors.get(id), existed: true };
  }

  const actor = {
    id,
    type: "Person",
    username: username || null,
    preferredUsername: username || null,
    name: name || username || null,
    summary: summary || null,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    isLocal,
    createdAt: _now(),
  };

  _actors.set(id, actor);

  db.prepare(
    `INSERT INTO ap_actors (id, username, name, summary, inbox_url, outbox_url, is_local, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actor.id,
    actor.username,
    actor.name,
    actor.summary,
    actor.inbox,
    actor.outbox,
    actor.isLocal ? 1 : 0,
    actor.createdAt,
  );

  return { success: true, actor, existed: false };
}

export function listActors({ local } = {}) {
  let actors = [..._actors.values()];
  if (local === true) actors = actors.filter((a) => a.isLocal);
  if (local === false) actors = actors.filter((a) => !a.isLocal);
  return actors;
}

export function getActor(ref) {
  const id = _resolveActorId(ref);
  return id ? _actors.get(id) || null : null;
}

/* ── Publishing (outbox) ───────────────────────────────────── */

export function publishNote(
  db,
  { actor: actorRef, content, to, cc, inReplyTo } = {},
) {
  if (!actorRef) throw new Error("actor is required");
  if (content === undefined || content === null || content === "") {
    throw new Error("content is required");
  }
  const actor = _requireActor(actorRef);
  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const noteId = `${origin}/notes/${crypto.randomUUID()}`;
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const audienceTo =
    Array.isArray(to) && to.length > 0 ? to : [PUBLIC_AUDIENCE];
  const audienceCc =
    Array.isArray(cc) && cc.length > 0 ? cc : [actor.followers];

  const note = {
    id: noteId,
    type: "Note",
    attributedTo: actor.id,
    content,
    to: audienceTo,
    cc: audienceCc,
    published,
    ...(inReplyTo ? { inReplyTo } : {}),
  };

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Create",
    actor: actor.id,
    object: note,
    to: audienceTo,
    cc: audienceCc,
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);

  return { success: true, activity };
}

export function follow(db, { actor: actorRef, target } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!target) throw new Error("target is required");
  const actor = _requireActor(actorRef);
  const targetId = target.startsWith("http") ? target : _resolveActorId(target);
  if (!targetId) throw new Error(`Target actor not found: ${target}`);
  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Follow",
    actor: actor.id,
    object: targetId,
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);

  const key = `${actor.id}|${targetId}`;
  _follows.set(key, { state: "pending", createdAt: published });
  db.prepare(
    `INSERT OR REPLACE INTO ap_follows (follower_id, followee_id, state, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(actor.id, targetId, "pending", published);

  return { success: true, activity };
}

export function acceptFollow(db, { actor: actorRef, followActivityId } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!followActivityId) throw new Error("followActivityId is required");
  const actor = _requireActor(actorRef);
  const followRec = _activities.get(followActivityId);
  if (!followRec || followRec.activity.type !== "Follow") {
    throw new Error(`Follow activity not found: ${followActivityId}`);
  }
  if (followRec.activity.object !== actor.id) {
    throw new Error("Accept can only be issued by the Follow target");
  }
  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Accept",
    actor: actor.id,
    object: followRec.activity,
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);

  const key = `${followRec.activity.actor}|${actor.id}`;
  const state = {
    state: "accepted",
    createdAt: _follows.get(key)?.createdAt || published,
  };
  _follows.set(key, state);
  db.prepare(
    `UPDATE ap_follows SET state = ? WHERE follower_id = ? AND followee_id = ?`,
  ).run("accepted", followRec.activity.actor, actor.id);

  return { success: true, activity };
}

export function undoFollow(db, { actor: actorRef, target } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!target) throw new Error("target is required");
  const actor = _requireActor(actorRef);
  const targetId = target.startsWith("http") ? target : _resolveActorId(target);
  if (!targetId) throw new Error(`Target actor not found: ${target}`);

  // Find the most recent Follow activity for this pair
  let followActivity = null;
  for (const rec of _activities.values()) {
    if (
      rec.direction === "outbox" &&
      rec.activity.type === "Follow" &&
      rec.activity.actor === actor.id &&
      rec.activity.object === targetId
    ) {
      followActivity = rec.activity;
    }
  }
  if (!followActivity) {
    throw new Error(`No Follow activity found for ${actor.id} → ${targetId}`);
  }

  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Undo",
    actor: actor.id,
    object: followActivity,
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);

  const key = `${actor.id}|${targetId}`;
  _follows.delete(key);
  db.prepare(
    `DELETE FROM ap_follows WHERE follower_id = ? AND followee_id = ?`,
  ).run(actor.id, targetId);

  return { success: true, activity };
}

export function like(db, { actor: actorRef, object } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!object) throw new Error("object is required");
  const actor = _requireActor(actorRef);
  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Like",
    actor: actor.id,
    object,
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);
  return { success: true, activity };
}

export function announce(db, { actor: actorRef, object } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!object) throw new Error("object is required");
  const actor = _requireActor(actorRef);
  const published = _now();
  const origin = actor.id.split("/users/")[0];
  const activityId = `${origin}/activities/${crypto.randomUUID()}`;

  const activity = {
    "@context": CONTEXT,
    id: activityId,
    type: "Announce",
    actor: actor.id,
    object,
    to: [PUBLIC_AUDIENCE],
    cc: [actor.followers],
    published,
  };

  const record = { direction: "outbox", ownerId: actor.id, activity };
  _activities.set(activity.id, record);
  _persistActivity(db, record);
  return { success: true, activity };
}

/* ── Inbox (C2S simulation) ────────────────────────────────── */

/**
 * Deliver an activity into a local actor's inbox. In real ActivityPub this
 * would be an HTTP POST with an HTTP Signature header; here we just record it.
 *
 * Side effects on accepted activity types:
 *   - Follow → create pending ap_follows row (mirror of sender's side)
 *   - Accept(Follow) → mark ap_follows row as accepted
 *   - Undo(Follow) → delete ap_follows row
 */
export function deliverToInbox(db, { actor: actorRef, activity } = {}) {
  if (!actorRef) throw new Error("actor is required");
  if (!activity || !activity.type || !activity.actor) {
    throw new Error("activity with type and actor is required");
  }
  const owner = _requireActor(actorRef);
  const delivered = {
    ...activity,
    id:
      activity.id ||
      `${activity.actor.split("/users/")[0]}/activities/${crypto.randomUUID()}`,
    published: activity.published || _now(),
  };

  const record = {
    direction: "inbox",
    ownerId: owner.id,
    activity: delivered,
  };
  _activities.set(delivered.id, record);
  _persistActivity(db, record);

  // Side-effects on follow graph
  if (delivered.type === "Follow" && delivered.object === owner.id) {
    const key = `${delivered.actor}|${owner.id}`;
    _follows.set(key, { state: "pending", createdAt: delivered.published });
    db.prepare(
      `INSERT OR REPLACE INTO ap_follows (follower_id, followee_id, state, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(delivered.actor, owner.id, "pending", delivered.published);
  } else if (
    delivered.type === "Accept" &&
    typeof delivered.object === "object" &&
    delivered.object?.type === "Follow"
  ) {
    const followActor = delivered.object.actor;
    const followTarget = delivered.object.object;
    if (followActor === owner.id) {
      const key = `${followActor}|${followTarget}`;
      const existing = _follows.get(key);
      _follows.set(key, {
        state: "accepted",
        createdAt: existing?.createdAt || delivered.published,
      });
      db.prepare(
        `UPDATE ap_follows SET state = ? WHERE follower_id = ? AND followee_id = ?`,
      ).run("accepted", followActor, followTarget);
    }
  } else if (
    delivered.type === "Undo" &&
    typeof delivered.object === "object" &&
    delivered.object?.type === "Follow" &&
    delivered.object?.object === owner.id
  ) {
    const key = `${delivered.object.actor}|${owner.id}`;
    _follows.delete(key);
    db.prepare(
      `DELETE FROM ap_follows WHERE follower_id = ? AND followee_id = ?`,
    ).run(delivered.object.actor, owner.id);
  }

  return { success: true, activity: delivered };
}

/* ── Reads ─────────────────────────────────────────────────── */

export function getOutbox(actorRef, { limit = 50, types } = {}) {
  const actor = _requireActor(actorRef);
  const items = [..._activities.values()]
    .filter((r) => r.direction === "outbox" && r.ownerId === actor.id)
    .map((r) => r.activity);
  const filtered = types ? items.filter((a) => types.includes(a.type)) : items;
  return filtered.slice(0, limit);
}

export function getInbox(actorRef, { limit = 50, types } = {}) {
  const actor = _requireActor(actorRef);
  const items = [..._activities.values()]
    .filter((r) => r.direction === "inbox" && r.ownerId === actor.id)
    .map((r) => r.activity);
  const filtered = types ? items.filter((a) => types.includes(a.type)) : items;
  return filtered.slice(0, limit);
}

export function listFollowers(actorRef, { state } = {}) {
  const actor = _requireActor(actorRef);
  const rows = [];
  for (const [key, value] of _follows.entries()) {
    const [followerId, followeeId] = key.split("|");
    if (followeeId === actor.id) {
      if (state && value.state !== state) continue;
      rows.push({ id: followerId, ...value });
    }
  }
  return rows;
}

export function listFollowing(actorRef, { state } = {}) {
  const actor = _requireActor(actorRef);
  const rows = [];
  for (const [key, value] of _follows.entries()) {
    const [followerId, followeeId] = key.split("|");
    if (followerId === actor.id) {
      if (state && value.state !== state) continue;
      rows.push({ id: followeeId, ...value });
    }
  }
  return rows;
}

/* ── Fediverse search ──────────────────────────────────────── */

function _tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

function _scoreMatch(haystack, needleTokens) {
  if (!haystack) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const token of needleTokens) {
    if (!token) continue;
    if (lower === token) score += 5;
    else if (lower.startsWith(token)) score += 3;
    else if (lower.includes(token)) score += 1;
  }
  return score;
}

/**
 * Search actors by preferredUsername / name / summary.
 * Scope: 'local' | 'remote' | 'all' (default 'all').
 */
export function searchActors(query, { limit = 20, scope = "all" } = {}) {
  const tokens = _tokenize(query || "");
  if (tokens.length === 0) return [];
  let pool = [..._actors.values()];
  if (scope === "local") pool = pool.filter((a) => a.isLocal);
  else if (scope === "remote") pool = pool.filter((a) => !a.isLocal);

  const scored = pool
    .map((actor) => {
      const score =
        _scoreMatch(actor.username, tokens) * 2 +
        _scoreMatch(actor.name, tokens) +
        _scoreMatch(actor.summary, tokens);
      return { actor, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ actor, score }) => ({ ...actor, score }));
}

/**
 * Search Create(Note) activities by content.
 * Filters: authorId (full actor URL or local username), since/until (ISO), scope.
 */
export function searchNotes(
  query,
  { limit = 20, author, since, until, scope = "all" } = {},
) {
  const tokens = _tokenize(query || "");
  if (tokens.length === 0) return [];

  const authorId = author ? _resolveActorId(author) : null;

  const sinceTs = since ? new Date(since).getTime() : null;
  const untilTs = until ? new Date(until).getTime() : null;

  const entries = [];
  for (const rec of _activities.values()) {
    const activity = rec.activity;
    if (activity.type !== "Create") continue;
    const note = activity.object;
    if (!note || note.type !== "Note") continue;
    if (authorId && activity.actor !== authorId) continue;

    if (scope !== "all") {
      const authorActor = _actors.get(activity.actor);
      const isLocal = authorActor ? authorActor.isLocal : false;
      if (scope === "local" && !isLocal) continue;
      if (scope === "remote" && isLocal) continue;
    }

    if (sinceTs || untilTs) {
      const ts = activity.published
        ? new Date(activity.published).getTime()
        : null;
      if (sinceTs && (!ts || ts < sinceTs)) continue;
      if (untilTs && (!ts || ts > untilTs)) continue;
    }

    const score = _scoreMatch(note.content, tokens);
    if (score > 0) {
      entries.push({
        activityId: activity.id,
        noteId: note.id,
        actor: activity.actor,
        content: note.content,
        published: activity.published,
        score,
      });
    }
  }

  return entries.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _actors.clear();
  _activities.clear();
  _follows.clear();
}

export const _constants = { PUBLIC_AUDIENCE, CONTEXT, DEFAULT_ORIGIN };


// ===== V2 Surface: ActivityPub Bridge governance overlay (CLI v0.135.0) =====
export const AP_ACTOR_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", SUSPENDED: "suspended", DEACTIVATED: "deactivated",
});
export const AP_ACTIVITY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", DELIVERING: "delivering", DELIVERED: "delivered", FAILED: "failed", CANCELLED: "cancelled",
});

const _apActorTrans = new Map([
  [AP_ACTOR_MATURITY_V2.PENDING, new Set([AP_ACTOR_MATURITY_V2.ACTIVE, AP_ACTOR_MATURITY_V2.DEACTIVATED])],
  [AP_ACTOR_MATURITY_V2.ACTIVE, new Set([AP_ACTOR_MATURITY_V2.SUSPENDED, AP_ACTOR_MATURITY_V2.DEACTIVATED])],
  [AP_ACTOR_MATURITY_V2.SUSPENDED, new Set([AP_ACTOR_MATURITY_V2.ACTIVE, AP_ACTOR_MATURITY_V2.DEACTIVATED])],
  [AP_ACTOR_MATURITY_V2.DEACTIVATED, new Set()],
]);
const _apActorTerminal = new Set([AP_ACTOR_MATURITY_V2.DEACTIVATED]);
const _apActTrans = new Map([
  [AP_ACTIVITY_LIFECYCLE_V2.QUEUED, new Set([AP_ACTIVITY_LIFECYCLE_V2.DELIVERING, AP_ACTIVITY_LIFECYCLE_V2.CANCELLED])],
  [AP_ACTIVITY_LIFECYCLE_V2.DELIVERING, new Set([AP_ACTIVITY_LIFECYCLE_V2.DELIVERED, AP_ACTIVITY_LIFECYCLE_V2.FAILED, AP_ACTIVITY_LIFECYCLE_V2.CANCELLED])],
  [AP_ACTIVITY_LIFECYCLE_V2.DELIVERED, new Set()],
  [AP_ACTIVITY_LIFECYCLE_V2.FAILED, new Set()],
  [AP_ACTIVITY_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _apActors = new Map();
const _apActs = new Map();
let _apMaxActivePerOwner = 15;
let _apMaxPendingPerActor = 25;
let _apActorIdleMs = 24 * 60 * 60 * 1000;
let _apActStuckMs = 3 * 60 * 1000;

function _apPos(n, lbl) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${lbl} must be positive integer`); return v; }

export function setMaxActiveApActorsPerOwnerV2(n) { _apMaxActivePerOwner = _apPos(n, "maxActiveApActorsPerOwner"); }
export function getMaxActiveApActorsPerOwnerV2() { return _apMaxActivePerOwner; }
export function setMaxPendingApActivitiesPerActorV2(n) { _apMaxPendingPerActor = _apPos(n, "maxPendingApActivitiesPerActor"); }
export function getMaxPendingApActivitiesPerActorV2() { return _apMaxPendingPerActor; }
export function setApActorIdleMsV2(n) { _apActorIdleMs = _apPos(n, "apActorIdleMs"); }
export function getApActorIdleMsV2() { return _apActorIdleMs; }
export function setApActivityStuckMsV2(n) { _apActStuckMs = _apPos(n, "apActivityStuckMs"); }
export function getApActivityStuckMsV2() { return _apActStuckMs; }

export function _resetStateActivityPubBridgeV2() {
  _apActors.clear(); _apActs.clear();
  _apMaxActivePerOwner = 15; _apMaxPendingPerActor = 25;
  _apActorIdleMs = 24 * 60 * 60 * 1000; _apActStuckMs = 3 * 60 * 1000;
}

export function registerApActorV2({ id, owner, handle, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_apActors.has(id)) throw new Error(`activitypub actor ${id} already registered`);
  const now = Date.now();
  const a = { id, owner, handle: handle || id, status: AP_ACTOR_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, deactivatedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _apActors.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}
function _apCheckA(from, to) { const al = _apActorTrans.get(from); if (!al || !al.has(to)) throw new Error(`invalid activitypub actor transition ${from} → ${to}`); }
function _apCountActive(owner) { let n = 0; for (const a of _apActors.values()) if (a.owner === owner && a.status === AP_ACTOR_MATURITY_V2.ACTIVE) n++; return n; }

export function activateApActorV2(id) {
  const a = _apActors.get(id); if (!a) throw new Error(`activitypub actor ${id} not found`);
  _apCheckA(a.status, AP_ACTOR_MATURITY_V2.ACTIVE);
  const recovery = a.status === AP_ACTOR_MATURITY_V2.SUSPENDED;
  if (!recovery) { const c = _apCountActive(a.owner); if (c >= _apMaxActivePerOwner) throw new Error(`max active activitypub actors per owner (${_apMaxActivePerOwner}) reached for ${a.owner}`); }
  const now = Date.now(); a.status = AP_ACTOR_MATURITY_V2.ACTIVE; a.updatedAt = now; a.lastTouchedAt = now; if (!a.activatedAt) a.activatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function suspendApActorV2(id) { const a = _apActors.get(id); if (!a) throw new Error(`activitypub actor ${id} not found`); _apCheckA(a.status, AP_ACTOR_MATURITY_V2.SUSPENDED); a.status = AP_ACTOR_MATURITY_V2.SUSPENDED; a.updatedAt = Date.now(); return { ...a, metadata: { ...a.metadata } }; }
export function deactivateApActorV2(id) { const a = _apActors.get(id); if (!a) throw new Error(`activitypub actor ${id} not found`); _apCheckA(a.status, AP_ACTOR_MATURITY_V2.DEACTIVATED); const now = Date.now(); a.status = AP_ACTOR_MATURITY_V2.DEACTIVATED; a.updatedAt = now; if (!a.deactivatedAt) a.deactivatedAt = now; return { ...a, metadata: { ...a.metadata } }; }
export function touchApActorV2(id) { const a = _apActors.get(id); if (!a) throw new Error(`activitypub actor ${id} not found`); if (_apActorTerminal.has(a.status)) throw new Error(`cannot touch terminal activitypub actor ${id}`); const now = Date.now(); a.lastTouchedAt = now; a.updatedAt = now; return { ...a, metadata: { ...a.metadata } }; }
export function getApActorV2(id) { const a = _apActors.get(id); if (!a) return null; return { ...a, metadata: { ...a.metadata } }; }
export function listApActorsV2() { return [..._apActors.values()].map((a) => ({ ...a, metadata: { ...a.metadata } })); }

function _apCountPending(aid) { let n = 0; for (const ac of _apActs.values()) if (ac.actorId === aid && (ac.status === AP_ACTIVITY_LIFECYCLE_V2.QUEUED || ac.status === AP_ACTIVITY_LIFECYCLE_V2.DELIVERING)) n++; return n; }

export function createApActivityV2({ id, actorId, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!actorId || typeof actorId !== "string") throw new Error("actorId is required");
  if (_apActs.has(id)) throw new Error(`activitypub activity ${id} already exists`);
  if (!_apActors.has(actorId)) throw new Error(`activitypub actor ${actorId} not found`);
  const pending = _apCountPending(actorId);
  if (pending >= _apMaxPendingPerActor) throw new Error(`max pending activitypub activities per actor (${_apMaxPendingPerActor}) reached for ${actorId}`);
  const now = Date.now();
  const ac = { id, actorId, kind: kind || "Note", status: AP_ACTIVITY_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _apActs.set(id, ac);
  return { ...ac, metadata: { ...ac.metadata } };
}
function _apCheckAct(from, to) { const al = _apActTrans.get(from); if (!al || !al.has(to)) throw new Error(`invalid activitypub activity transition ${from} → ${to}`); }
export function startApActivityV2(id) { const ac = _apActs.get(id); if (!ac) throw new Error(`activitypub activity ${id} not found`); _apCheckAct(ac.status, AP_ACTIVITY_LIFECYCLE_V2.DELIVERING); const now = Date.now(); ac.status = AP_ACTIVITY_LIFECYCLE_V2.DELIVERING; ac.updatedAt = now; if (!ac.startedAt) ac.startedAt = now; return { ...ac, metadata: { ...ac.metadata } }; }
export function deliverApActivityV2(id) { const ac = _apActs.get(id); if (!ac) throw new Error(`activitypub activity ${id} not found`); _apCheckAct(ac.status, AP_ACTIVITY_LIFECYCLE_V2.DELIVERED); const now = Date.now(); ac.status = AP_ACTIVITY_LIFECYCLE_V2.DELIVERED; ac.updatedAt = now; if (!ac.settledAt) ac.settledAt = now; return { ...ac, metadata: { ...ac.metadata } }; }
export function failApActivityV2(id, reason) { const ac = _apActs.get(id); if (!ac) throw new Error(`activitypub activity ${id} not found`); _apCheckAct(ac.status, AP_ACTIVITY_LIFECYCLE_V2.FAILED); const now = Date.now(); ac.status = AP_ACTIVITY_LIFECYCLE_V2.FAILED; ac.updatedAt = now; if (!ac.settledAt) ac.settledAt = now; if (reason) ac.metadata.failReason = String(reason); return { ...ac, metadata: { ...ac.metadata } }; }
export function cancelApActivityV2(id, reason) { const ac = _apActs.get(id); if (!ac) throw new Error(`activitypub activity ${id} not found`); _apCheckAct(ac.status, AP_ACTIVITY_LIFECYCLE_V2.CANCELLED); const now = Date.now(); ac.status = AP_ACTIVITY_LIFECYCLE_V2.CANCELLED; ac.updatedAt = now; if (!ac.settledAt) ac.settledAt = now; if (reason) ac.metadata.cancelReason = String(reason); return { ...ac, metadata: { ...ac.metadata } }; }
export function getApActivityV2(id) { const ac = _apActs.get(id); if (!ac) return null; return { ...ac, metadata: { ...ac.metadata } }; }
export function listApActivitiesV2() { return [..._apActs.values()].map((ac) => ({ ...ac, metadata: { ...ac.metadata } })); }

export function autoSuspendIdleApActorsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const a of _apActors.values()) if (a.status === AP_ACTOR_MATURITY_V2.ACTIVE && (t - a.lastTouchedAt) >= _apActorIdleMs) { a.status = AP_ACTOR_MATURITY_V2.SUSPENDED; a.updatedAt = t; flipped.push(a.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckApActivitiesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const ac of _apActs.values()) if (ac.status === AP_ACTIVITY_LIFECYCLE_V2.DELIVERING && ac.startedAt != null && (t - ac.startedAt) >= _apActStuckMs) { ac.status = AP_ACTIVITY_LIFECYCLE_V2.FAILED; ac.updatedAt = t; if (!ac.settledAt) ac.settledAt = t; ac.metadata.failReason = "auto-fail-stuck"; flipped.push(ac.id); } return { flipped, count: flipped.length }; }

export function getActivityPubBridgeStatsV2() {
  const actorsByStatus = {}; for (const s of Object.values(AP_ACTOR_MATURITY_V2)) actorsByStatus[s] = 0; for (const a of _apActors.values()) actorsByStatus[a.status]++;
  const activitiesByStatus = {}; for (const s of Object.values(AP_ACTIVITY_LIFECYCLE_V2)) activitiesByStatus[s] = 0; for (const ac of _apActs.values()) activitiesByStatus[ac.status]++;
  return { totalActorsV2: _apActors.size, totalActivitiesV2: _apActs.size, maxActiveApActorsPerOwner: _apMaxActivePerOwner, maxPendingApActivitiesPerActor: _apMaxPendingPerActor, apActorIdleMs: _apActorIdleMs, apActivityStuckMs: _apActStuckMs, actorsByStatus, activitiesByStatus };
}
