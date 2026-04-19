import { describe, test, expect, beforeEach } from "vitest";
import {
  USER_PROFILE_MATURITY_V2,
  USER_PREF_LIFECYCLE_V2,
  setMaxActiveUserProfilesPerOwnerV2,
  getMaxActiveUserProfilesPerOwnerV2,
  setMaxPendingUserPrefsPerProfileV2,
  getMaxPendingUserPrefsPerProfileV2,
  setUserProfileIdleMsV2,
  getUserProfileIdleMsV2,
  setUserPrefStuckMsV2,
  getUserPrefStuckMsV2,
  _resetStateUserProfileV2,
  registerUserProfileV2,
  activateUserProfileV2,
  dormantUserProfileV2,
  archiveUserProfileV2,
  touchUserProfileV2,
  getUserProfileV2,
  listUserProfilesV2,
  createUserPrefV2,
  applyUserPrefV2,
  rejectUserPrefV2,
  supersedeUserPrefV2,
  cancelUserPrefV2,
  getUserPrefV2,
  listUserPrefsV2,
  autoDormantIdleUserProfilesV2,
  autoCancelStaleUserPrefsV2,
  getUserProfileGovStatsV2,
} from "../../../src/lib/user-profile.js";

beforeEach(() => {
  _resetStateUserProfileV2();
});

describe("UserProfile V2 enums", () => {
  test("profile maturity", () => {
    expect(USER_PROFILE_MATURITY_V2.PENDING).toBe("pending");
    expect(USER_PROFILE_MATURITY_V2.ACTIVE).toBe("active");
    expect(USER_PROFILE_MATURITY_V2.DORMANT).toBe("dormant");
    expect(USER_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived");
  });
  test("pref lifecycle", () => {
    expect(USER_PREF_LIFECYCLE_V2.PROPOSED).toBe("proposed");
    expect(USER_PREF_LIFECYCLE_V2.APPLIED).toBe("applied");
    expect(USER_PREF_LIFECYCLE_V2.REJECTED).toBe("rejected");
    expect(USER_PREF_LIFECYCLE_V2.SUPERSEDED).toBe("superseded");
    expect(USER_PREF_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(USER_PROFILE_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(USER_PREF_LIFECYCLE_V2)).toBe(true);
  });
});

describe("UserProfile V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveUserProfilesPerOwnerV2()).toBe(5);
    expect(getMaxPendingUserPrefsPerProfileV2()).toBe(20);
    expect(getUserProfileIdleMsV2()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(getUserPrefStuckMsV2()).toBe(7 * 24 * 60 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveUserProfilesPerOwnerV2(3);
    expect(getMaxActiveUserProfilesPerOwnerV2()).toBe(3);
  });
  test("set max pending", () => {
    setMaxPendingUserPrefsPerProfileV2(4);
    expect(getMaxPendingUserPrefsPerProfileV2()).toBe(4);
  });
  test("set idle/stuck ms", () => {
    setUserProfileIdleMsV2(100);
    expect(getUserProfileIdleMsV2()).toBe(100);
    setUserPrefStuckMsV2(50);
    expect(getUserPrefStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveUserProfilesPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveUserProfilesPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveUserProfilesPerOwnerV2(5.9);
    expect(getMaxActiveUserProfilesPerOwnerV2()).toBe(5);
  });
});

describe("UserProfile V2 profile lifecycle", () => {
  test("register", () => {
    const p = registerUserProfileV2({ id: "p1", owner: "u1" });
    expect(p.status).toBe("pending");
    expect(p.handle).toBe("p1");
  });
  test("register with handle", () => {
    const p = registerUserProfileV2({ id: "p1", owner: "u1", handle: "alice" });
    expect(p.handle).toBe("alice");
  });
  test("register reject duplicate/missing", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    expect(() => registerUserProfileV2({ id: "p1", owner: "u1" })).toThrow();
    expect(() => registerUserProfileV2({ owner: "u1" })).toThrow();
    expect(() => registerUserProfileV2({ id: "p1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    const p = activateUserProfileV2("p1");
    expect(p.status).toBe("active");
    expect(p.activatedAt).toBeTruthy();
  });
  test("dormant active → dormant", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    activateUserProfileV2("p1");
    const p = dormantUserProfileV2("p1");
    expect(p.status).toBe("dormant");
  });
  test("activate dormant → active (recovery)", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    const before = activateUserProfileV2("p1").activatedAt;
    dormantUserProfileV2("p1");
    const p = activateUserProfileV2("p1");
    expect(p.activatedAt).toBe(before);
  });
  test("archive from any non-terminal", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    const p = archiveUserProfileV2("p1");
    expect(p.status).toBe("archived");
    expect(p.archivedAt).toBeTruthy();
  });
  test("terminal no transitions", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    archiveUserProfileV2("p1");
    expect(() => activateUserProfileV2("p1")).toThrow();
    expect(() => touchUserProfileV2("p1")).toThrow();
  });
  test("touch updates", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    activateUserProfileV2("p1");
    const p = touchUserProfileV2("p1");
    expect(p.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    expect(getUserProfileV2("p1").id).toBe("p1");
    expect(getUserProfileV2("nope")).toBeNull();
    expect(listUserProfilesV2().length).toBe(1);
  });
});

describe("UserProfile V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveUserProfilesPerOwnerV2(2);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    registerUserProfileV2({ id: "p2", owner: "u1" });
    registerUserProfileV2({ id: "p3", owner: "u1" });
    activateUserProfileV2("p1");
    activateUserProfileV2("p2");
    expect(() => activateUserProfileV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveUserProfilesPerOwnerV2(2);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    registerUserProfileV2({ id: "p2", owner: "u1" });
    activateUserProfileV2("p1");
    activateUserProfileV2("p2");
    dormantUserProfileV2("p1");
    const p = activateUserProfileV2("p1");
    expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveUserProfilesPerOwnerV2(1);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    registerUserProfileV2({ id: "p2", owner: "u2" });
    activateUserProfileV2("p1");
    activateUserProfileV2("p2");
  });
});

describe("UserProfile V2 pref lifecycle", () => {
  test("create", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    const r = createUserPrefV2({ id: "r1", profileId: "p1" });
    expect(r.status).toBe("proposed");
    expect(r.key).toBe("");
  });
  test("create with key", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    const r = createUserPrefV2({ id: "r1", profileId: "p1", key: "theme" });
    expect(r.key).toBe("theme");
  });
  test("create rejects unknown profile/duplicate", () => {
    expect(() => createUserPrefV2({ id: "r1", profileId: "nope" })).toThrow();
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    expect(() => createUserPrefV2({ id: "r1", profileId: "p1" })).toThrow();
  });
  test("apply proposed → applied", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    const r = applyUserPrefV2("r1");
    expect(r.status).toBe("applied");
    expect(r.settledAt).toBeTruthy();
  });
  test("reject proposed → rejected", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    const r = rejectUserPrefV2("r1", "no");
    expect(r.status).toBe("rejected");
    expect(r.metadata.rejectReason).toBe("no");
  });
  test("supersede applied → superseded", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    applyUserPrefV2("r1");
    const r = supersedeUserPrefV2("r1");
    expect(r.status).toBe("superseded");
  });
  test("cancel proposed → cancelled", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    const r = cancelUserPrefV2("r1", "abort");
    expect(r.status).toBe("cancelled");
    expect(r.metadata.cancelReason).toBe("abort");
  });
  test("terminal no transitions", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    rejectUserPrefV2("r1");
    expect(() => applyUserPrefV2("r1")).toThrow();
  });
  test("get / list", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    expect(getUserPrefV2("r1").id).toBe("r1");
    expect(getUserPrefV2("nope")).toBeNull();
    expect(listUserPrefsV2().length).toBe(1);
  });
});

describe("UserProfile V2 pending cap", () => {
  test("enforce at create (proposed only)", () => {
    setMaxPendingUserPrefsPerProfileV2(2);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    createUserPrefV2({ id: "r2", profileId: "p1" });
    expect(() => createUserPrefV2({ id: "r3", profileId: "p1" })).toThrow(
      /max pending/,
    );
  });
  test("applied frees slot (only proposed counts)", () => {
    setMaxPendingUserPrefsPerProfileV2(2);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    createUserPrefV2({ id: "r2", profileId: "p1" });
    applyUserPrefV2("r1");
    createUserPrefV2({ id: "r3", profileId: "p1" });
  });
});

describe("UserProfile V2 auto flips", () => {
  test("autoDormantIdleUserProfilesV2", () => {
    setUserProfileIdleMsV2(100);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    activateUserProfileV2("p1");
    const { count } = autoDormantIdleUserProfilesV2({
      now: Date.now() + 10000,
    });
    expect(count).toBe(1);
    expect(getUserProfileV2("p1").status).toBe("dormant");
  });
  test("autoCancelStaleUserPrefsV2", () => {
    setUserPrefStuckMsV2(100);
    registerUserProfileV2({ id: "p1", owner: "u1" });
    createUserPrefV2({ id: "r1", profileId: "p1" });
    const { count } = autoCancelStaleUserPrefsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getUserPrefV2("r1").status).toBe("cancelled");
    expect(getUserPrefV2("r1").metadata.cancelReason).toBe("auto-cancel-stale");
  });
});

describe("UserProfile V2 stats", () => {
  test("empty defaults", () => {
    const s = getUserProfileGovStatsV2();
    expect(s.totalUserProfilesV2).toBe(0);
    expect(s.totalUserPrefsV2).toBe(0);
    for (const k of ["pending", "active", "dormant", "archived"])
      expect(s.profilesByStatus[k]).toBe(0);
    for (const k of [
      "proposed",
      "applied",
      "rejected",
      "superseded",
      "cancelled",
    ])
      expect(s.prefsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerUserProfileV2({ id: "p1", owner: "u1" });
    activateUserProfileV2("p1");
    createUserPrefV2({ id: "r1", profileId: "p1" });
    applyUserPrefV2("r1");
    const s = getUserProfileGovStatsV2();
    expect(s.profilesByStatus.active).toBe(1);
    expect(s.prefsByStatus.applied).toBe(1);
  });
});
