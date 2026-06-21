/**
 * rbac-authority — authorization gate for privileged RBAC-engine ops.
 *
 * Proves an org owner/admin (or owner_did) may manage permissions while a plain
 * member / unknown actor is denied under enforce (and merely logged under
 * report), with off / no-org / no-actor / db-error handled safely.
 */
const {
  requireOrgManageAuthority,
  resolveRbacMode,
  _actorOrgRole,
  _isOrgOwner,
} = require("../rbac-authority.js");
const { setCurrentUserProvider } = require("../current-user-context.js");

const ME = "did:chainlesschain:actor-1";

// Fake better-sqlite3 db: answers the members + organizations lookups.
function fakeDb({ memberRole = null, owner = false } = {}) {
  return {
    prepare(sql) {
      return {
        get() {
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
