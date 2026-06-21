/**
 * current-user-context — actor-identity hardening for privileged IPC.
 *
 * Proves resolveActorDid derives the acting user from the authenticated
 * main-process identity: report mode is pure observation (claimed returned
 * verbatim), enforce mode overrides a spoofed/absent claim with the authenticated
 * DID and refuses a privileged action when no user is unlocked, and off is a
 * no-op.
 */
const ctx = require("../current-user-context.js");
const {
  setCurrentUserProvider,
  getCurrentUserDid,
  resolveActorDid,
  resolveActorMode,
} = ctx;

const ME = "did:chainlesschain:me-1234567890";
const OTHER = "did:chainlesschain:attacker-999";

afterEach(() => setCurrentUserProvider(null));

describe("current-user-context / provider", () => {
  it("returns null when no provider is set", () => {
    setCurrentUserProvider(null);
    expect(getCurrentUserDid()).toBe(null);
  });

  it("returns the provider's DID, or null for non-string / throwing providers", () => {
    setCurrentUserProvider(() => ME);
    expect(getCurrentUserDid()).toBe(ME);
    setCurrentUserProvider(() => null);
    expect(getCurrentUserDid()).toBe(null);
    setCurrentUserProvider(() => 12345);
    expect(getCurrentUserDid()).toBe(null);
    setCurrentUserProvider(() => {
      throw new Error("did manager exploded");
    });
    expect(getCurrentUserDid()).toBe(null); // swallowed, no crash
  });
});

describe("current-user-context / resolveActorMode", () => {
  const orig = process.env.CC_IPC_ACTOR_GUARD;
  afterEach(() => {
    if (orig === undefined) {
      delete process.env.CC_IPC_ACTOR_GUARD;
    } else {
      process.env.CC_IPC_ACTOR_GUARD = orig;
    }
  });
  it("defaults to report", () => {
    delete process.env.CC_IPC_ACTOR_GUARD;
    expect(resolveActorMode()).toBe("report");
  });
  it("honors enforce + off", () => {
    process.env.CC_IPC_ACTOR_GUARD = "enforce";
    expect(resolveActorMode()).toBe("enforce");
    process.env.CC_IPC_ACTOR_GUARD = "0";
    expect(resolveActorMode()).toBe("off");
  });
});

describe("current-user-context / resolveActorDid — report (default, no change)", () => {
  const report = {
    field: "grantedBy",
    channel: "perm:grant",
    getMode: () => "report",
  };

  it("returns a spoofed claim VERBATIM (observe only, logged)", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(OTHER, report)).toBe(OTHER);
  });

  it("returns the claim verbatim when it matches the authenticated user", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(ME, report)).toBe(ME);
  });

  it("returns claimed verbatim even when no user is unlocked", () => {
    setCurrentUserProvider(() => null);
    expect(resolveActorDid(OTHER, report)).toBe(OTHER);
    expect(resolveActorDid(undefined, report)).toBe(undefined);
  });
});

describe("current-user-context / resolveActorDid — enforce (authoritative)", () => {
  const enforce = {
    field: "grantedBy",
    channel: "perm:grant",
    getMode: () => "enforce",
  };

  it("OVERRIDES a spoofed claim with the authenticated DID", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(OTHER, enforce)).toBe(ME);
  });

  it("fills in the authenticated DID when the claim is absent", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(undefined, enforce)).toBe(ME);
    expect(resolveActorDid("", enforce)).toBe(ME);
  });

  it("returns the authenticated DID when the claim already matches", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(ME, enforce)).toBe(ME);
  });

  it("THROWS on a privileged action when no user is unlocked", () => {
    setCurrentUserProvider(() => null);
    expect(() => resolveActorDid(OTHER, enforce)).toThrow(
      "no authenticated user",
    );
  });
});

describe("current-user-context / resolveActorDid — off (no-op)", () => {
  it("returns claimed verbatim and ignores the authenticated user", () => {
    setCurrentUserProvider(() => ME);
    expect(resolveActorDid(OTHER, { channel: "x", getMode: () => "off" })).toBe(
      OTHER,
    );
  });
});
