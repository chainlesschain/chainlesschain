"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generateKeyHex } = require("../lib/key-providers");
const { TARGET_VERSION } = require("../lib/migrations");
const { LocalVault } = require("../lib/vault");

const NOW = 1_700_000_000_000;
const SCOPE_A = "account:qq-pc:aaaaaaaa";
const SCOPE_B = "account:qq-pc:bbbbbbbb";
const CANONICAL_ID = "c2c_msg_table:9007199254740993123";

function identity(adapter, originalId, scope = SCOPE_A) {
  return { adapter, scope, originalId };
}

describe("LocalVault source identity infrastructure", () => {
  let tmpDir;
  let vaultPath;
  let key;
  let vault;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-source-identity-"));
    vaultPath = path.join(tmpDir, "vault.db");
    key = generateKeyHex();
    vault = new LocalVault({ path: vaultPath, key, skipAudit: true });
    vault.open();
  });

  afterEach(() => {
    if (vault) {
      try {
        vault.close();
      } catch {
        // Best-effort test cleanup.
      }
      vault = null;
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("migration v11 creates constrained alias and observation tables", () => {
    expect(TARGET_VERSION).toBeGreaterThanOrEqual(11);
    expect(vault.schemaVersion()).toBe(TARGET_VERSION);

    const aliasColumns = vault.db
      .prepare("PRAGMA table_info(source_identity_aliases)")
      .all()
      .map((column) => column.name);
    expect(aliasColumns).toEqual([
      "entity_type",
      "alias_adapter",
      "alias_scope",
      "alias_original_id",
      "canonical_adapter",
      "canonical_scope",
      "canonical_original_id",
      "created_at",
    ]);

    const observationColumns = vault.db
      .prepare("PRAGMA table_info(raw_event_observations)")
      .all()
      .map((column) => column.name);
    expect(observationColumns).toEqual([
      "adapter",
      "scope",
      "canonical_original_id",
      "producer",
      "producer_original_id",
      "first_captured_at",
      "last_captured_at",
      "payload",
    ]);

    const indexNames = vault.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name IN (
             'source_identity_aliases',
             'raw_event_observations'
           )`,
      )
      .all()
      .map((row) => row.name);
    expect(indexNames).toContain("idx_source_identity_aliases_canonical");
    expect(indexNames).toContain("idx_raw_event_observations_canonical");
    expect(indexNames).toContain("idx_raw_event_observations_captured");
  });

  it("upgrades a v10 vault without changing existing normalized or raw data", () => {
    vault.putRawEvent({
      adapter: "qq-pc",
      scope: SCOPE_A,
      originalId: "legacy-raw-id",
      capturedAt: NOW,
      payload: { text: "preserved" },
    });
    vault.db.exec("DROP TABLE source_identity_aliases");
    vault.db.exec("DROP TABLE raw_event_observations");
    vault.db
      .prepare(
        "UPDATE _meta SET value = '10', updated_at = ? WHERE key = 'schema_version'",
      )
      .run(NOW);
    vault.close();

    const reopened = new LocalVault({
      path: vaultPath,
      key,
      skipAudit: true,
    });
    reopened.open();
    vault = reopened;

    expect(vault.schemaVersion()).toBe(TARGET_VERSION);
    expect(vault.queryRawEvents({ adapter: "qq-pc", scope: SCOPE_A })).toEqual([
      expect.objectContaining({
        originalId: "legacy-raw-id",
        payload: { text: "preserved" },
      }),
    ]);
    expect(vault.stats()).toMatchObject({
      rawEvents: 1,
      rawObservations: 0,
      sourceIdentityAliases: 0,
    });
  });

  it("keeps direct, sidecar, and Android observations for one canonical event", () => {
    const common = {
      adapter: "qq-pc",
      scope: SCOPE_A,
      canonicalOriginalId: CANONICAL_ID,
      producerOriginalId: "9007199254740993123",
      capturedAt: NOW,
    };
    vault.putRawObservation({
      ...common,
      producer: "qq-pc/direct",
      payload: { text: "direct", senderUin: "10001" },
    });
    vault.putRawObservation({
      ...common,
      producer: "qq-pc/sidecar",
      payload: { text: "sidecar", senderUid: "u_10001" },
    });
    vault.putRawObservation({
      ...common,
      producer: "qq-pc/android",
      payload: { text: "android", readState: 1 },
    });

    expect(vault.stats().rawObservations).toBe(3);
    const rows = vault.queryRawObservations({
      adapter: "qq-pc",
      scope: SCOPE_A,
      canonicalOriginalId: CANONICAL_ID,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.producer)).toEqual([
      "qq-pc/android",
      "qq-pc/direct",
      "qq-pc/sidecar",
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          producer: "qq-pc/direct",
          producerOriginalId: "9007199254740993123",
          payload: { text: "direct", senderUin: "10001" },
        }),
        expect.objectContaining({
          producer: "qq-pc/android",
          payload: { text: "android", readState: 1 },
        }),
      ]),
    );
  });

  it("deduplicates one producer observation while retaining its time range and latest payload", () => {
    const record = {
      adapter: "qq-pc",
      scope: SCOPE_A,
      canonicalOriginalId: CANONICAL_ID,
      producer: "qq-pc/android",
      producerOriginalId: "android-row-1",
    };
    vault.putRawObservation({
      ...record,
      capturedAt: NOW,
      payload: { readState: 0, version: "first" },
    });
    vault.putRawObservation({
      ...record,
      canonicalOriginalId: `${CANONICAL_ID}:corrected`,
      capturedAt: NOW + 100,
      payload: { readState: 1, version: "latest" },
    });
    vault.putRawObservation({
      ...record,
      capturedAt: NOW - 100,
      payload: { readState: 0, version: "older" },
    });

    expect(vault.stats().rawObservations).toBe(1);
    expect(vault.queryRawObservations()).toEqual([
      {
        adapter: "qq-pc",
        scope: SCOPE_A,
        canonicalOriginalId: `${CANONICAL_ID}:corrected`,
        producer: "qq-pc/android",
        producerOriginalId: "android-row-1",
        firstCapturedAt: NOW - 100,
        lastCapturedAt: NOW + 100,
        payload: { readState: 1, version: "latest" },
      },
    ]);
  });

  it("isolates identical producer keys across account scopes", () => {
    const common = {
      adapter: "qq-pc",
      canonicalOriginalId: CANONICAL_ID,
      producer: "qq-pc/direct",
      producerOriginalId: "same-row",
      capturedAt: NOW,
    };
    vault.putRawObservation({
      ...common,
      scope: SCOPE_A,
      payload: { account: "A" },
    });
    vault.putRawObservation({
      ...common,
      scope: SCOPE_B,
      payload: { account: "B" },
    });

    expect(vault.queryRawObservations({ scope: SCOPE_A })).toEqual([
      expect.objectContaining({ scope: SCOPE_A, payload: { account: "A" } }),
    ]);
    expect(vault.queryRawObservations({ scope: SCOPE_B })).toEqual([
      expect.objectContaining({ scope: SCOPE_B, payload: { account: "B" } }),
    ]);
  });

  it("filters and pages observations deterministically", () => {
    for (const [canonicalOriginalId, producer, producerOriginalId] of [
      ["message:2", "qq-pc/sidecar", "row-3"],
      ["message:1", "qq-pc/sidecar", "row-2"],
      ["message:1", "qq-pc/direct", "row-1"],
    ]) {
      vault.putRawObservation({
        adapter: "qq-pc",
        scope: SCOPE_A,
        canonicalOriginalId,
        producer,
        producerOriginalId,
        capturedAt: NOW,
        payload: { producerOriginalId },
      });
    }

    expect(
      vault
        .queryRawObservations({
          adapter: "qq-pc",
          scope: SCOPE_A,
          limit: 2,
        })
        .map((row) => row.producerOriginalId),
    ).toEqual(["row-1", "row-2"]);
    expect(
      vault
        .queryRawObservations({
          adapter: "qq-pc",
          scope: SCOPE_A,
          limit: 2,
          offset: 2,
        })
        .map((row) => row.producerOriginalId),
    ).toEqual(["row-3"]);
    expect(
      vault.queryRawObservations({ producer: "qq-pc/direct" }),
    ).toHaveLength(1);
  });

  it("rejects malformed observations before writing anything", () => {
    const valid = {
      adapter: "qq-pc",
      scope: SCOPE_A,
      canonicalOriginalId: CANONICAL_ID,
      producer: "qq-pc/direct",
      producerOriginalId: "row-1",
      capturedAt: NOW,
      payload: {},
    };

    expect(() => vault.putRawObservation({ ...valid, adapter: "" })).toThrow(
      /adapter/,
    );
    expect(() => vault.putRawObservation({ ...valid, scope: null })).toThrow(
      /scope/,
    );
    expect(() =>
      vault.putRawObservation({ ...valid, canonicalOriginalId: "" }),
    ).toThrow(/canonicalOriginalId/);
    expect(() => vault.putRawObservation({ ...valid, producer: "" })).toThrow(
      /producer/,
    );
    expect(() =>
      vault.putRawObservation({ ...valid, producerOriginalId: "" }),
    ).toThrow(/producerOriginalId/);
    expect(() =>
      vault.putRawObservation({
        ...valid,
        capturedAt: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(/capturedAt/);
    const circular = {};
    circular.self = circular;
    expect(() =>
      vault.putRawObservation({ ...valid, payload: circular }),
    ).toThrow(/JSON-serializable/);
    expect(() => vault.queryRawObservations({ limit: 0 })).toThrow(/limit/);
    expect(() => vault.queryRawObservations({ offset: -1 })).toThrow(/offset/);
    expect(vault.stats().rawObservations).toBe(0);
  });

  it("registers and resolves account-scoped aliases without losing 19-digit ids", () => {
    const alias = identity("qq-pc-sidecar", "legacy:40033:40003");
    const canonical = identity("qq-pc", CANONICAL_ID);

    const inserted = vault.registerSourceAlias({
      entityType: "event",
      alias,
      canonical,
      createdAt: NOW,
    });
    expect(inserted).toEqual({
      changes: 1,
      entityType: "event",
      alias,
      canonical,
    });
    expect(vault.resolveSourceIdentity("event", alias)).toEqual(canonical);
    expect(vault.resolveSourceIdentity("event", canonical)).toEqual(canonical);
    expect(vault.resolveSourceIdentity("person", alias)).toEqual(alias);

    const repeated = vault.registerSourceAlias({
      entityType: "event",
      alias,
      canonical,
      createdAt: NOW + 1,
    });
    expect(repeated.changes).toBe(0);
    expect(
      vault.db
        .prepare(
          `SELECT created_at
           FROM source_identity_aliases
           WHERE entity_type = 'event'`,
        )
        .get().created_at,
    ).toBe(NOW);
    expect(vault.stats().sourceIdentityAliases).toBe(1);
  });

  it("allows the same producer identity to resolve differently per account scope", () => {
    const aliasA = identity("qq-pc-sidecar", "sidecar:row-1", SCOPE_A);
    const aliasB = identity("qq-pc-sidecar", "sidecar:row-1", SCOPE_B);
    const canonicalA = identity("qq-pc", "c2c_msg_table:1", SCOPE_A);
    const canonicalB = identity("qq-pc", "c2c_msg_table:2", SCOPE_B);

    vault.registerSourceAlias({
      entityType: "event",
      alias: aliasA,
      canonical: canonicalA,
      createdAt: NOW,
    });
    vault.registerSourceAlias({
      entityType: "event",
      alias: aliasB,
      canonical: canonicalB,
      createdAt: NOW,
    });

    expect(vault.resolveSourceIdentity("event", aliasA)).toEqual(canonicalA);
    expect(vault.resolveSourceIdentity("event", aliasB)).toEqual(canonicalB);
    expect(vault.stats().sourceIdentityAliases).toBe(2);
  });

  it("flattens a canonical alias target to its immutable root", () => {
    const root = identity("qq-pc", CANONICAL_ID);
    const intermediate = identity("qq-pc-android", "android:row-1");
    const leaf = identity("qq-pc-sidecar", "sidecar:row-1");

    vault.registerSourceAlias({
      entityType: "event",
      alias: intermediate,
      canonical: root,
      createdAt: NOW,
    });
    vault.registerSourceAlias({
      entityType: "event",
      alias: leaf,
      canonical: intermediate,
      createdAt: NOW + 1,
    });

    expect(vault.resolveSourceIdentity("event", leaf)).toEqual(root);
    const stored = vault.db
      .prepare(
        `SELECT canonical_adapter, canonical_scope, canonical_original_id
         FROM source_identity_aliases
         WHERE entity_type = 'event'
           AND alias_adapter = ?
           AND alias_scope = ?
           AND alias_original_id = ?`,
      )
      .get(leaf.adapter, leaf.scope, leaf.originalId);
    expect(stored).toEqual({
      canonical_adapter: root.adapter,
      canonical_scope: root.scope,
      canonical_original_id: root.originalId,
    });
  });

  it("fails closed on self aliases, conflicting remaps, and canonical re-rooting", () => {
    const alias = identity("qq-pc-sidecar", "sidecar:row-1");
    const canonical = identity("qq-pc", CANONICAL_ID);
    const other = identity("qq-pc", "c2c_msg_table:2");

    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias,
        canonical: alias,
      }),
    ).toThrow(expect.objectContaining({ code: "SOURCE_IDENTITY_ALIAS_SELF" }));

    vault.registerSourceAlias({
      entityType: "event",
      alias,
      canonical,
      createdAt: NOW,
    });
    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias,
        canonical: other,
      }),
    ).toThrow(
      expect.objectContaining({ code: "SOURCE_IDENTITY_ALIAS_CONFLICT" }),
    );
    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias: canonical,
        canonical: other,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "SOURCE_IDENTITY_CANONICAL_IMMUTABLE",
      }),
    );
    expect(vault.stats().sourceIdentityAliases).toBe(1);
    expect(vault.resolveSourceIdentity("event", alias)).toEqual(canonical);
  });

  it("validates alias entity types, identities, scopes, and timestamps", () => {
    const alias = identity("qq-pc-sidecar", "sidecar:row-1");
    const canonical = identity("qq-pc", CANONICAL_ID);

    expect(() =>
      vault.registerSourceAlias({
        entityType: "unknown",
        alias,
        canonical,
      }),
    ).toThrow(/entityType/);
    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias: { ...alias, scope: null },
        canonical,
      }),
    ).toThrow(/scope/);
    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias: { ...alias, originalId: "" },
        canonical,
      }),
    ).toThrow(/originalId/);
    expect(() =>
      vault.registerSourceAlias({
        entityType: "event",
        alias,
        canonical,
        createdAt: 0,
      }),
    ).toThrow(/createdAt/);
    expect(vault.stats().sourceIdentityAliases).toBe(0);
  });

  it("detects a corrupted alias cycle instead of looping", () => {
    const a = identity("qq-pc-sidecar", "sidecar:a");
    const b = identity("qq-pc-android", "android:b");
    const insert = vault.db.prepare(
      `INSERT INTO source_identity_aliases (
         entity_type,
         alias_adapter,
         alias_scope,
         alias_original_id,
         canonical_adapter,
         canonical_scope,
         canonical_original_id,
         created_at
       ) VALUES ('event', ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      a.adapter,
      a.scope,
      a.originalId,
      b.adapter,
      b.scope,
      b.originalId,
      NOW,
    );
    insert.run(
      b.adapter,
      b.scope,
      b.originalId,
      a.adapter,
      a.scope,
      a.originalId,
      NOW,
    );

    expect(() => vault.resolveSourceIdentity("event", a)).toThrow(
      expect.objectContaining({ code: "SOURCE_IDENTITY_ALIAS_CYCLE" }),
    );
  });

  it("enforces table constraints even for direct SQL writes", () => {
    expect(() =>
      vault.db
        .prepare(
          `INSERT INTO source_identity_aliases (
             entity_type,
             alias_adapter,
             alias_scope,
             alias_original_id,
             canonical_adapter,
             canonical_scope,
             canonical_original_id,
             created_at
           ) VALUES ('unknown', 'a', '', '1', 'b', '', '2', ?)`,
        )
        .run(NOW),
    ).toThrow();
    expect(() =>
      vault.db
        .prepare(
          `INSERT INTO source_identity_aliases (
             entity_type,
             alias_adapter,
             alias_scope,
             alias_original_id,
             canonical_adapter,
             canonical_scope,
             canonical_original_id,
             created_at
           ) VALUES ('event', 'a', '', '1', 'a', '', '1', ?)`,
        )
        .run(NOW),
    ).toThrow();
    expect(() =>
      vault.db
        .prepare(
          `INSERT INTO raw_event_observations (
             adapter,
             scope,
             canonical_original_id,
             producer,
             producer_original_id,
             first_captured_at,
             last_captured_at,
             payload
           ) VALUES ('qq-pc', '', 'message:1', 'direct', 'row-1', ?, ?, '{}')`,
        )
        .run(NOW, NOW - 1),
    ).toThrow();
  });
});
