import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSCIMTables,
  listUsers,
  createUser,
  getUser,
  deleteUser,
  listConnectors,
  addConnector,
  syncProvision,
  getStatus,
  _resetState,
} from "../../src/lib/scim-manager.js";

describe("scim-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSCIMTables(db);
  });

  describe("ensureSCIMTables", () => {
    it("creates scim_resources and scim_sync_log tables", () => {
      expect(db.tables.has("scim_resources")).toBe(true);
      expect(db.tables.has("scim_sync_log")).toBe(true);
    });

    it("is idempotent", () => {
      ensureSCIMTables(db);
      expect(db.tables.has("scim_resources")).toBe(true);
    });
  });

  describe("createUser", () => {
    it("creates a user", () => {
      const u = createUser(db, "alice", "Alice Smith", "alice@example.com");
      expect(u.id).toBeDefined();
      expect(u.userName).toBe("alice");
      expect(u.displayName).toBe("Alice Smith");
      expect(u.email).toBe("alice@example.com");
      expect(u.active).toBe(true);
    });

    it("throws on missing username", () => {
      expect(() => createUser(db, "")).toThrow("Username is required");
    });

    it("throws on duplicate username", () => {
      createUser(db, "alice");
      expect(() => createUser(db, "alice")).toThrow("User already exists");
    });

    it("defaults display name to username", () => {
      const u = createUser(db, "bob");
      expect(u.displayName).toBe("bob");
    });

    it("persists to database", () => {
      createUser(db, "alice");
      const rows = db.data.get("scim_resources") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getUser", () => {
    it("returns null for unknown user", () => {
      expect(getUser("nonexistent")).toBeNull();
    });

    it("returns user by ID", () => {
      const u = createUser(db, "alice");
      const found = getUser(u.id);
      expect(found.userName).toBe("alice");
    });
  });

  describe("deleteUser", () => {
    it("deletes a user", () => {
      const u = createUser(db, "alice");
      const result = deleteUser(db, u.id);
      expect(result.success).toBe(true);
      expect(getUser(u.id)).toBeNull();
    });

    it("throws on unknown user", () => {
      expect(() => deleteUser(db, "nonexistent")).toThrow("User not found");
    });
  });

  describe("listUsers", () => {
    it("returns empty initially", () => {
      const r = listUsers();
      expect(r.totalResults).toBe(0);
      expect(r.resources).toEqual([]);
    });

    it("lists all users", () => {
      createUser(db, "alice");
      createUser(db, "bob");
      const r = listUsers();
      expect(r.totalResults).toBe(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) createUser(db, `user${i}`);
      const r = listUsers({ limit: 3 });
      expect(r.resources.length).toBe(3);
      expect(r.totalResults).toBe(5);
    });
  });

  describe("addConnector / listConnectors", () => {
    it("returns empty initially", () => {
      expect(listConnectors()).toEqual([]);
    });

    it("adds a connector", () => {
      const c = addConnector(db, "Okta", "okta", { apiKey: "xxx" });
      expect(c.id).toBeDefined();
      expect(c.name).toBe("Okta");
      expect(c.provider).toBe("okta");
      expect(c.status).toBe("active");
    });

    it("throws on missing name", () => {
      expect(() => addConnector(db, "")).toThrow("Connector name is required");
    });

    it("lists connectors", () => {
      addConnector(db, "Okta", "okta");
      addConnector(db, "Azure AD", "azure");
      expect(listConnectors().length).toBe(2);
    });
  });

  describe("syncProvision", () => {
    it("syncs via connector", () => {
      const c = addConnector(db, "Okta", "okta");
      const r = syncProvision(db, c.id);
      expect(r.success).toBe(true);
      expect(r.connector).toBe("Okta");
    });

    it("throws on unknown connector", () => {
      expect(() => syncProvision(db, "nonexistent")).toThrow(
        "Connector not found",
      );
    });

    it("logs sync operation", () => {
      const c = addConnector(db, "Okta", "okta");
      syncProvision(db, c.id);
      const rows = db.data.get("scim_sync_log") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("returns zeros initially", () => {
      const s = getStatus();
      expect(s.users).toBe(0);
      expect(s.connectors).toBe(0);
      expect(s.syncOperations).toBe(0);
      expect(s.lastSync).toBeNull();
    });

    it("reflects current state", () => {
      createUser(db, "alice");
      const c = addConnector(db, "Okta", "okta");
      syncProvision(db, c.id);
      const s = getStatus();
      expect(s.users).toBe(1);
      expect(s.connectors).toBe(1);
      expect(s.syncOperations).toBe(1);
      expect(s.lastSync).toBeDefined();
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface Tests — identity lifecycle + sync-job lifecycle
 * ═══════════════════════════════════════════════════════════════ */

import {
  IDENTITY_LIFECYCLE_V2,
  SYNC_JOB_V2,
  SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR,
  SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR,
  SCIM_DEFAULT_IDENTITY_IDLE_MS,
  SCIM_DEFAULT_SYNC_STUCK_MS,
  getMaxProvisionedPerConnectorV2,
  setMaxProvisionedPerConnectorV2,
  getMaxRunningSyncPerConnectorV2,
  setMaxRunningSyncPerConnectorV2,
  getIdentityIdleMsV2,
  setIdentityIdleMsV2,
  getSyncStuckMsV2,
  setSyncStuckMsV2,
  getProvisionedCountV2,
  getRunningSyncCountV2,
  registerIdentityV2,
  getIdentityV2,
  listIdentitiesV2,
  setIdentityStatusV2,
  provisionIdentityV2,
  suspendIdentityV2,
  deprovisionIdentityV2,
  touchIdentityV2,
  createSyncJobV2,
  getSyncJobV2,
  listSyncJobsV2,
  setSyncJobStatusV2,
  startSyncJobV2,
  succeedSyncJobV2,
  failSyncJobV2,
  cancelSyncJobV2,
  autoDeprovisionIdleIdentitiesV2,
  autoFailStuckSyncJobsV2,
  getScimManagerStatsV2,
  _resetStateScimManagerV2,
} from "../../src/lib/scim-manager.js";

describe("scim-manager V2", () => {
  beforeEach(() => {
    _resetStateScimManagerV2();
  });

  describe("enums + defaults", () => {
    it("exposes 4 identity statuses + 5 sync-job statuses", () => {
      expect(Object.values(IDENTITY_LIFECYCLE_V2)).toHaveLength(4);
      expect(Object.values(SYNC_JOB_V2)).toHaveLength(5);
    });

    it("defaults match exported constants", () => {
      expect(getMaxProvisionedPerConnectorV2()).toBe(
        SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR,
      );
      expect(getMaxRunningSyncPerConnectorV2()).toBe(
        SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR,
      );
      expect(getIdentityIdleMsV2()).toBe(SCIM_DEFAULT_IDENTITY_IDLE_MS);
      expect(getSyncStuckMsV2()).toBe(SCIM_DEFAULT_SYNC_STUCK_MS);
    });
  });

  describe("config setters", () => {
    it("accepts positive integers + floors floats", () => {
      setMaxProvisionedPerConnectorV2(500.7);
      setMaxRunningSyncPerConnectorV2(3.4);
      setIdentityIdleMsV2(1000.7);
      setSyncStuckMsV2(2000.9);
      expect(getMaxProvisionedPerConnectorV2()).toBe(500);
      expect(getMaxRunningSyncPerConnectorV2()).toBe(3);
      expect(getIdentityIdleMsV2()).toBe(1000);
      expect(getSyncStuckMsV2()).toBe(2000);
    });

    it("rejects ≤0 / NaN", () => {
      expect(() => setMaxProvisionedPerConnectorV2(0)).toThrow(/positive/);
      expect(() => setMaxRunningSyncPerConnectorV2(NaN)).toThrow(/positive/);
      expect(() => setIdentityIdleMsV2(-1)).toThrow(/positive/);
      expect(() => setSyncStuckMsV2("nope")).toThrow(/positive/);
    });
  });

  describe("registerIdentityV2", () => {
    it("creates pending identity with metadata copy", () => {
      const i = registerIdentityV2("i1", {
        connectorId: "c1",
        externalId: "alice@example.com",
        metadata: { source: "okta" },
      });
      expect(i.status).toBe("pending");
      expect(i.provisionedAt).toBeNull();
      expect(i.metadata).toEqual({ source: "okta" });
    });

    it("rejects bad inputs + duplicates", () => {
      expect(() =>
        registerIdentityV2("", { connectorId: "c", externalId: "x" }),
      ).toThrow();
      expect(() =>
        registerIdentityV2("i", { connectorId: "", externalId: "x" }),
      ).toThrow();
      expect(() =>
        registerIdentityV2("i", { connectorId: "c", externalId: "" }),
      ).toThrow();
      registerIdentityV2("dup", { connectorId: "c", externalId: "x" });
      expect(() =>
        registerIdentityV2("dup", { connectorId: "c", externalId: "x" }),
      ).toThrow(/already exists/);
    });

    it("returns defensive copies", () => {
      registerIdentityV2("i", {
        connectorId: "c",
        externalId: "x",
        metadata: { x: 1 },
      });
      const got = getIdentityV2("i");
      got.metadata.x = 999;
      expect(getIdentityV2("i").metadata.x).toBe(1);
    });
  });

  describe("identity lifecycle transitions", () => {
    beforeEach(() => {
      registerIdentityV2("i1", { connectorId: "c1", externalId: "alice" });
    });

    it("pending → provisioned stamps provisionedAt once", () => {
      const r = provisionIdentityV2("i1", { now: 1000 });
      expect(r.provisionedAt).toBe(1000);
      suspendIdentityV2("i1");
      const r2 = provisionIdentityV2("i1", { now: 3000 });
      expect(r2.provisionedAt).toBe(1000);
    });

    it("provisioned ↔ suspended recovery", () => {
      provisionIdentityV2("i1");
      suspendIdentityV2("i1");
      expect(getIdentityV2("i1").status).toBe("suspended");
      provisionIdentityV2("i1");
      expect(getIdentityV2("i1").status).toBe("provisioned");
    });

    it("deprovisioned terminal stamps deprovisionedAt", () => {
      const r = deprovisionIdentityV2("i1", { now: 500 });
      expect(r.status).toBe("deprovisioned");
      expect(r.deprovisionedAt).toBe(500);
      expect(() => provisionIdentityV2("i1")).toThrow(/terminal/);
    });

    it("rejects unknown next state", () => {
      expect(() => setIdentityStatusV2("i1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal transitions", () => {
      expect(() => suspendIdentityV2("i1")).toThrow(/cannot transition/);
    });

    it("throws on unknown id", () => {
      expect(() => provisionIdentityV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-connector provisioned cap", () => {
    it("enforces cap on pending → provisioned", () => {
      setMaxProvisionedPerConnectorV2(2);
      registerIdentityV2("a", { connectorId: "c1", externalId: "1" });
      registerIdentityV2("b", { connectorId: "c1", externalId: "2" });
      registerIdentityV2("c", { connectorId: "c1", externalId: "3" });
      provisionIdentityV2("a");
      provisionIdentityV2("b");
      expect(() => provisionIdentityV2("c")).toThrow(/cap/);
    });

    it("does not enforce cap on suspended → provisioned recovery", () => {
      setMaxProvisionedPerConnectorV2(1);
      registerIdentityV2("a", { connectorId: "c1", externalId: "1" });
      provisionIdentityV2("a");
      suspendIdentityV2("a");
      expect(() => provisionIdentityV2("a")).not.toThrow();
    });

    it("getProvisionedCountV2 counts only provisioned", () => {
      registerIdentityV2("a", { connectorId: "c1", externalId: "1" });
      registerIdentityV2("b", { connectorId: "c1", externalId: "2" });
      provisionIdentityV2("a");
      provisionIdentityV2("b");
      suspendIdentityV2("b");
      expect(getProvisionedCountV2("c1")).toBe(1);
    });
  });

  describe("touchIdentityV2", () => {
    it("updates lastSeenAt", () => {
      registerIdentityV2("i", { connectorId: "c", externalId: "x" });
      const t = touchIdentityV2("i", { now: 5000 });
      expect(t.lastSeenAt).toBe(5000);
    });

    it("throws on unknown id", () => {
      expect(() => touchIdentityV2("nope")).toThrow(/not found/);
    });
  });

  describe("createSyncJobV2", () => {
    it("creates queued sync job", () => {
      const j = createSyncJobV2("j1", { connectorId: "c1" });
      expect(j.status).toBe("queued");
      expect(j.kind).toBe("full");
    });

    it("rejects bad inputs + duplicates", () => {
      expect(() => createSyncJobV2("", { connectorId: "c" })).toThrow();
      expect(() => createSyncJobV2("j", { connectorId: "" })).toThrow();
      createSyncJobV2("dup", { connectorId: "c" });
      expect(() => createSyncJobV2("dup", { connectorId: "c" })).toThrow(
        /already exists/,
      );
    });
  });

  describe("sync-job lifecycle transitions", () => {
    beforeEach(() => {
      createSyncJobV2("j1", { connectorId: "c1" });
    });

    it("queued → running stamps startedAt once", () => {
      const r = startSyncJobV2("j1", { now: 100 });
      expect(r.startedAt).toBe(100);
    });

    it("running → succeeded stamps finishedAt", () => {
      startSyncJobV2("j1");
      const r = succeedSyncJobV2("j1", { now: 500 });
      expect(r.status).toBe("succeeded");
      expect(r.finishedAt).toBe(500);
    });

    it("running → failed stamps finishedAt", () => {
      startSyncJobV2("j1");
      const r = failSyncJobV2("j1", { now: 600 });
      expect(r.status).toBe("failed");
      expect(r.finishedAt).toBe(600);
    });

    it("queued → cancelled stamps finishedAt", () => {
      const r = cancelSyncJobV2("j1", { now: 50 });
      expect(r.status).toBe("cancelled");
      expect(r.finishedAt).toBe(50);
    });

    it("terminals are sticky", () => {
      cancelSyncJobV2("j1");
      expect(() => startSyncJobV2("j1")).toThrow(/terminal/);
    });

    it("queued → succeeded forbidden", () => {
      expect(() => succeedSyncJobV2("j1")).toThrow(/cannot transition/);
    });

    it("rejects unknown next state", () => {
      expect(() => setSyncJobStatusV2("j1", "bogus")).toThrow(/unknown/);
    });

    it("throws on unknown id", () => {
      expect(() => startSyncJobV2("ghost")).toThrow(/not found/);
    });
  });

  describe("per-connector running-sync cap", () => {
    it("enforces cap on queued → running", () => {
      setMaxRunningSyncPerConnectorV2(2);
      createSyncJobV2("a", { connectorId: "c1" });
      createSyncJobV2("b", { connectorId: "c1" });
      createSyncJobV2("c", { connectorId: "c1" });
      startSyncJobV2("a");
      startSyncJobV2("b");
      expect(() => startSyncJobV2("c")).toThrow(/cap/);
    });

    it("getRunningSyncCountV2 counts only running", () => {
      createSyncJobV2("a", { connectorId: "c1" });
      createSyncJobV2("b", { connectorId: "c1" });
      startSyncJobV2("a");
      startSyncJobV2("b");
      succeedSyncJobV2("b");
      expect(getRunningSyncCountV2("c1")).toBe(1);
    });
  });

  describe("listIdentitiesV2 / listSyncJobsV2", () => {
    it("filters identities by connector + status", () => {
      registerIdentityV2("a", { connectorId: "c1", externalId: "1" });
      registerIdentityV2("b", { connectorId: "c1", externalId: "2" });
      registerIdentityV2("c", { connectorId: "c2", externalId: "3" });
      provisionIdentityV2("a");
      expect(listIdentitiesV2({ connectorId: "c1" })).toHaveLength(2);
      expect(listIdentitiesV2({ status: "provisioned" })).toHaveLength(1);
    });

    it("filters sync-jobs by connector + status", () => {
      createSyncJobV2("a", { connectorId: "c1" });
      createSyncJobV2("b", { connectorId: "c1" });
      startSyncJobV2("a");
      expect(listSyncJobsV2({ connectorId: "c1" })).toHaveLength(2);
      expect(listSyncJobsV2({ status: "running" })).toHaveLength(1);
    });
  });

  describe("autoDeprovisionIdleIdentitiesV2", () => {
    it("deprovisions provisioned/suspended identities idle past window", () => {
      setIdentityIdleMsV2(1000);
      registerIdentityV2("a", { connectorId: "c", externalId: "1", now: 0 });
      registerIdentityV2("b", { connectorId: "c", externalId: "2", now: 0 });
      provisionIdentityV2("a", { now: 0 });
      provisionIdentityV2("b", { now: 5000 });
      const flipped = autoDeprovisionIdleIdentitiesV2({ now: 2000 });
      expect(flipped.map((i) => i.id)).toEqual(["a"]);
      expect(getIdentityV2("a").status).toBe("deprovisioned");
      expect(getIdentityV2("a").deprovisionedAt).toBe(2000);
    });

    it("ignores pending identities", () => {
      setIdentityIdleMsV2(1);
      registerIdentityV2("p", { connectorId: "c", externalId: "1", now: 0 });
      const flipped = autoDeprovisionIdleIdentitiesV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckSyncJobsV2", () => {
    it("fails running jobs whose startedAt exceeds stuck window", () => {
      setSyncStuckMsV2(1000);
      createSyncJobV2("a", { connectorId: "c", now: 0 });
      createSyncJobV2("b", { connectorId: "c", now: 0 });
      startSyncJobV2("a", { now: 0 });
      startSyncJobV2("b", { now: 5000 });
      const flipped = autoFailStuckSyncJobsV2({ now: 2000 });
      expect(flipped.map((j) => j.id)).toEqual(["a"]);
      expect(getSyncJobV2("a").status).toBe("failed");
      expect(getSyncJobV2("a").finishedAt).toBe(2000);
    });

    it("ignores queued or terminal jobs", () => {
      setSyncStuckMsV2(1);
      createSyncJobV2("q", { connectorId: "c", now: 0 });
      const flipped = autoFailStuckSyncJobsV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getScimManagerStatsV2", () => {
    it("zero-init all enum buckets", () => {
      const s = getScimManagerStatsV2();
      expect(s.identitiesByStatus).toEqual({
        pending: 0,
        provisioned: 0,
        suspended: 0,
        deprovisioned: 0,
      });
      expect(s.syncJobsByStatus).toEqual({
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("reflects live state", () => {
      registerIdentityV2("i", { connectorId: "c", externalId: "x" });
      provisionIdentityV2("i");
      createSyncJobV2("j1", { connectorId: "c" });
      startSyncJobV2("j1");
      succeedSyncJobV2("j1");
      const s = getScimManagerStatsV2();
      expect(s.identitiesByStatus.provisioned).toBe(1);
      expect(s.syncJobsByStatus.succeeded).toBe(1);
    });
  });

  describe("_resetStateScimManagerV2", () => {
    it("clears Maps + restores default config", () => {
      registerIdentityV2("i", { connectorId: "c", externalId: "x" });
      setMaxProvisionedPerConnectorV2(99);
      _resetStateScimManagerV2();
      expect(getScimManagerStatsV2().totalIdentitiesV2).toBe(0);
      expect(getMaxProvisionedPerConnectorV2()).toBe(
        SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR,
      );
    });
  });
});
