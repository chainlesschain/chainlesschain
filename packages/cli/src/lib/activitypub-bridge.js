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
