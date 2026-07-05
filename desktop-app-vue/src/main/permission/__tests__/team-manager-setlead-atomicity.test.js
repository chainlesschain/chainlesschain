/**
 * TeamManager.setLead must maintain the exactly-one-lead invariant atomically.
 * It (1) points org_teams.lead_did at the new lead, (2) demotes the current
 * lead member to 'member', and (3) promotes the new member to 'lead' — three
 * writes across two tables with no transaction. If the promote (3) fails after
 * the demote (2), the team is left with ZERO members holding team_role='lead'
 * while org_teams.lead_did points at a member who is still a plain 'member' —
 * a corrupt, self-inconsistent lead state that survives (roles are read back
 * straight from these tables).
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { TeamManager } = require("../team-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE org_teams (
      id TEXT PRIMARY KEY, org_id TEXT, name TEXT, description TEXT,
      parent_team_id TEXT, lead_did TEXT, lead_name TEXT, avatar TEXT,
      settings TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE org_team_members (
      id TEXT PRIMARY KEY, team_id TEXT, member_did TEXT, member_name TEXT,
      team_role TEXT, joined_at INTEGER, invited_by TEXT);
  `);
  const manager = new TeamManager({ getDatabase: () => sqlite });
  return { sqlite, manager };
}

function seedTeamWithLead(sqlite) {
  const now = 1;
  sqlite
    .prepare(
      "INSERT INTO org_teams (id, org_id, name, lead_did, lead_name, created_at, updated_at) VALUES ('t1','o1','T','alice','Alice',?,?)",
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO org_team_members (id, team_id, member_did, member_name, team_role, joined_at) VALUES ('m-alice','t1','alice','Alice','lead',?)",
    )
    .run(now);
  sqlite
    .prepare(
      "INSERT INTO org_team_members (id, team_id, member_did, member_name, team_role, joined_at) VALUES ('m-bob','t1','bob','Bob','member',?)",
    )
    .run(now);
}

function roleOf(sqlite, did) {
  return sqlite
    .prepare(
      "SELECT team_role FROM org_team_members WHERE team_id = 't1' AND member_did = ?",
    )
    .get(did).team_role;
}

describe("TeamManager.setLead — exactly-one-lead atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(() => {
    ({ sqlite, manager } = makeManager());
    seedTeamWithLead(sqlite);
  });

  it("rolls back the demotion + lead pointer if the promotion fails", async () => {
    // Fail ONLY the promote (new lead) write, after the demote would run.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE org_team_members SET team_role = 'lead'/.test(sql)) {
        throw new Error("simulated promote write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.setLead("t1", "bob", "Bob")).rejects.toThrow(
      /promote/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: alice still the sole lead, bob still a member, pointer unchanged.
    expect(roleOf(sqlite, "alice")).toBe("lead");
    expect(roleOf(sqlite, "bob")).toBe("member");
    expect(
      sqlite.prepare("SELECT lead_did FROM org_teams WHERE id = 't1'").get()
        .lead_did,
    ).toBe("alice");
    // Exactly one lead.
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM org_team_members WHERE team_id = 't1' AND team_role = 'lead'",
        )
        .get().c,
    ).toBe(1);
  });

  it("a successful setLead moves the lead role exactly once", async () => {
    await manager.setLead("t1", "bob", "Bob");
    expect(roleOf(sqlite, "alice")).toBe("member");
    expect(roleOf(sqlite, "bob")).toBe("lead");
    expect(
      sqlite.prepare("SELECT lead_did FROM org_teams WHERE id = 't1'").get()
        .lead_did,
    ).toBe("bob");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM org_team_members WHERE team_id = 't1' AND team_role = 'lead'",
        )
        .get().c,
    ).toBe(1);
  });
});
