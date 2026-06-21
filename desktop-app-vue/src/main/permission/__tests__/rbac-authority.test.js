/**
 * rbac-authority — authorization gate for privileged RBAC-engine ops.
 *
 * Proves an org owner/admin (or owner_did) may manage permissions while a plain
 * member / unknown actor is denied under enforce (and merely logged under
 * report), with off / no-org / no-actor / db-error handled safely.
 */
const {
  requireOrgManageAuthority,
  requireOrgManageAuthorityForGrant,
  requireOrgManageAuthorityForGrants,
  requireCanDelegate,
  resolveRbacMode,
  _actorOrgRole,
  _isOrgOwner,
} = require("../rbac-authority.js");
const { setCurrentUserProvider } = require("../current-user-context.js");

const ME = "did:chainlesschain:actor-1";

// Fake better-sqlite3 db: answers the members + organizations + grant lookups.
function fakeDb({
  memberRole = null,
  owner = false,
  grantOrg = undefined,
} = {}) {
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("permission_grants")) {
            return grantOrg ? { org_id: grantOrg } : undefined;
          }
          if (sql.includes("organization_members")) {
            return memberRole ? { role: memberRole } : undefined;
          }
          if (sql.includes("organizations")) {
            return owner ? { ok: 1 } : undefined;
          }
          return undefined;
        },
      };
    },
  };
}
// Fake PermissionEngine for delegation checks.
const engineHolding = (heldMap) => ({
  async checkPermission({ permission }) {
    return { success: true, hasPermission: !!heldMap[permission] };
  },
});
const throwingDb = {
  prepare() {
    throw new Error("no such table: organization_members");
  },
};

beforeEach(() => setCurrentUserProvider(null));

describe("rbac-authority / resolveRbacMode", () => {
  const orig = process.env.CC_IPC_RBAC_GUARD;
  afterEach(() => {
    if (orig === undefined) {
      delete process.env.CC_IPC_RBAC_GUARD;
    } else {
      process.env.CC_IPC_RBAC_GUARD = orig;
    }
  });
  it("defaults to report; honors enforce + off", () => {
    delete process.env.CC_IPC_RBAC_GUARD;
    expect(resolveRbacMode()).toBe("report");
    process.env.CC_IPC_RBAC_GUARD = "enforce";
    expect(resolveRbacMode()).toBe("enforce");
    process.env.CC_IPC_RBAC_GUARD = "0";
    expect(resolveRbacMode()).toBe("off");
  });
});

describe("rbac-authority / helpers", () => {
  it("_actorOrgRole returns the role, null when not a member, throws on db error", () => {
    expect(_actorOrgRole(fakeDb({ memberRole: "admin" }), "o", ME)).toBe(
      "admin",
    );
    expect(_actorOrgRole(fakeDb({}), "o", ME)).toBe(null);
    // a real db error propagates (so the guard can fail OPEN, not deny)
    expect(() => _actorOrgRole(throwingDb, "o", ME)).toThrow();
  });
  it("_isOrgOwner reflects owner_did match", () => {
    expect(_isOrgOwner(fakeDb({ owner: true }), "o", ME)).toBe(true);
    expect(_isOrgOwner(fakeDb({ owner: false }), "o", ME)).toBe(false);
  });
});

describe("rbac-authority / requireOrgManageAuthority — enforce", () => {
  const enforce = (db, extra = {}) =>
    requireOrgManageAuthority(db, {
      orgId: "org-1",
      channel: "perm:grant-permission",
      actorDid: ME,
      getMode: () => "enforce",
      ...extra,
    });

  it("allows an owner-role member", () => {
    expect(enforce(fakeDb({ memberRole: "owner" }))).toBe(true);
  });
  it("allows an admin-role member", () => {
    expect(enforce(fakeDb({ memberRole: "admin" }))).toBe(true);
  });
  it("allows the org owner_did even without a membership row", () => {
    expect(enforce(fakeDb({ memberRole: null, owner: true }))).toBe(true);
  });
  it("DENIES a plain member", () => {
    expect(() => enforce(fakeDb({ memberRole: "member" }))).toThrow(
      "not authorized",
    );
  });
  it("DENIES an unknown actor (no membership, not owner)", () => {
    expect(() => enforce(fakeDb({}))).toThrow("not authorized");
  });
  it("DENIES when there is no authenticated actor", () => {
    expect(() =>
      enforce(fakeDb({ memberRole: "owner" }), { actorDid: null }),
    ).toThrow("not authorized");
  });
  it("FAILS OPEN (allows) on a db/authority-check error", () => {
    expect(enforce(throwingDb)).toBe(true);
  });
  it("allows when there is no org scope to check", () => {
    expect(
      enforce(fakeDb({ memberRole: "member" }), { orgId: undefined }),
    ).toBe(true);
  });
});

describe("rbac-authority / requireOrgManageAuthorityForGrant (revoke)", () => {
  const enf = (db, extra = {}) =>
    requireOrgManageAuthorityForGrant(db, {
      grantId: "g1",
      channel: "perm:revoke-permission",
      actorDid: ME,
      getMode: () => "enforce",
      ...extra,
    });
  it("authorizes via the grant's org (owner ok, member denied)", () => {
    expect(enf(fakeDb({ grantOrg: "org-1", memberRole: "owner" }))).toBe(true);
    expect(() =>
      enf(fakeDb({ grantOrg: "org-1", memberRole: "member" })),
    ).toThrow("not authorized");
  });
  it("allows when the grant is not found", () => {
    expect(enf(fakeDb({ grantOrg: undefined }))).toBe(true);
  });
  it("fails open on a db error", () => {
    expect(enf(throwingDb)).toBe(true);
  });
});

describe("rbac-authority / requireOrgManageAuthorityForGrants (bulk)", () => {
  const enf = (db, grants) =>
    requireOrgManageAuthorityForGrants(db, {
      grants,
      channel: "perm:bulk-grant",
      actorDid: ME,
      getMode: () => "enforce",
    });
  it("allows when the actor manages every target org", () => {
    expect(
      enf(fakeDb({ memberRole: "owner" }), [{ orgId: "o1" }, { orgId: "o1" }]),
    ).toBe(true);
  });
  it("denies if any target org is unauthorized", () => {
    expect(() =>
      enf(fakeDb({ memberRole: "member" }), [{ orgId: "o1" }]),
    ).toThrow("not authorized");
  });
  it("allows an empty batch", () => {
    expect(enf(fakeDb({}), [])).toBe(true);
  });
});

describe("rbac-authority / requireCanDelegate", () => {
  it("allows when the delegator holds all delegated permissions", async () => {
    await expect(
      requireCanDelegate(engineHolding({ read: true, write: true }), {
        orgId: "o",
        delegatorDid: ME,
        permissions: ["read", "write"],
        getMode: () => "enforce",
      }),
    ).resolves.toBe(true);
  });
  it("DENIES delegating an unheld permission (enforce)", async () => {
    await expect(
      requireCanDelegate(engineHolding({ read: true }), {
        orgId: "o",
        delegatorDid: ME,
        permissions: ["read", "admin"],
        getMode: () => "enforce",
      }),
    ).rejects.toThrow("cannot delegate");
  });
  it("report: an unheld permission is allowed (logged)", async () => {
    await expect(
      requireCanDelegate(engineHolding({}), {
        orgId: "o",
        delegatorDid: ME,
        permissions: ["admin"],
        getMode: () => "report",
      }),
    ).resolves.toBe(true);
  });
  it("enforce: a delegation with no authenticated delegator throws", async () => {
    await expect(
      requireCanDelegate(engineHolding({}), {
        orgId: "o",
        delegatorDid: null,
        permissions: ["x"],
        getMode: () => "enforce",
      }),
    ).rejects.toThrow("no authenticated delegator");
  });
  it("empty permissions / off → allow", async () => {
    await expect(
      requireCanDelegate(engineHolding({}), {
        delegatorDid: ME,
        permissions: [],
        getMode: () => "enforce",
      }),
    ).resolves.toBe(true);
    await expect(
      requireCanDelegate(engineHolding({}), {
        delegatorDid: ME,
        permissions: ["x"],
        getMode: () => "off",
      }),
    ).resolves.toBe(true);
  });
});

describe("rbac-authority / requireOrgManageAuthority — report + off", () => {
  it("report: a plain member is ALLOWED (logged, not denied)", () => {
    expect(
      requireOrgManageAuthority(fakeDb({ memberRole: "member" }), {
        orgId: "org-1",
        channel: "perm:grant-permission",
        actorDid: ME,
        getMode: () => "report",
      }),
    ).toBe(true);
  });
  it("off: no check at all", () => {
    expect(
      requireOrgManageAuthority(throwingDb, {
        orgId: "org-1",
        channel: "x",
        actorDid: ME,
        getMode: () => "off",
      }),
    ).toBe(true);
  });
});
