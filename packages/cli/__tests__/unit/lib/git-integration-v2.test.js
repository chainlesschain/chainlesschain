import { describe, test, expect, beforeEach } from "vitest";
import {
  GIT_REPO_MATURITY_V2,
  GIT_COMMIT_LIFECYCLE_V2,
  setMaxActiveGitReposPerOwnerV2,
  getMaxActiveGitReposPerOwnerV2,
  setMaxPendingGitCommitsPerRepoV2,
  getMaxPendingGitCommitsPerRepoV2,
  setGitRepoIdleMsV2,
  getGitRepoIdleMsV2,
  setGitCommitStuckMsV2,
  getGitCommitStuckMsV2,
  _resetStateGitIntegrationV2,
  registerGitRepoV2,
  activateGitRepoV2,
  archiveGitRepoV2,
  decommissionGitRepoV2,
  touchGitRepoV2,
  getGitRepoV2,
  listGitReposV2,
  createGitCommitV2,
  startGitCommitV2,
  commitGitCommitV2,
  failGitCommitV2,
  cancelGitCommitV2,
  getGitCommitV2,
  listGitCommitsV2,
  autoArchiveIdleGitReposV2,
  autoFailStuckGitCommitsV2,
  getGitIntegrationGovStatsV2,
} from "../../../src/lib/git-integration.js";

beforeEach(() => {
  _resetStateGitIntegrationV2();
});

describe("Git V2 enums", () => {
  test("repo maturity", () => {
    expect(GIT_REPO_MATURITY_V2.PENDING).toBe("pending");
    expect(GIT_REPO_MATURITY_V2.ACTIVE).toBe("active");
    expect(GIT_REPO_MATURITY_V2.ARCHIVED).toBe("archived");
    expect(GIT_REPO_MATURITY_V2.DECOMMISSIONED).toBe("decommissioned");
  });
  test("commit lifecycle", () => {
    expect(GIT_COMMIT_LIFECYCLE_V2.QUEUED).toBe("queued");
    expect(GIT_COMMIT_LIFECYCLE_V2.COMMITTING).toBe("committing");
    expect(GIT_COMMIT_LIFECYCLE_V2.COMMITTED).toBe("committed");
    expect(GIT_COMMIT_LIFECYCLE_V2.FAILED).toBe("failed");
    expect(GIT_COMMIT_LIFECYCLE_V2.CANCELLED).toBe("cancelled");
  });
  test("frozen", () => {
    expect(Object.isFrozen(GIT_REPO_MATURITY_V2)).toBe(true);
    expect(Object.isFrozen(GIT_COMMIT_LIFECYCLE_V2)).toBe(true);
  });
});

describe("Git V2 config", () => {
  test("defaults", () => {
    expect(getMaxActiveGitReposPerOwnerV2()).toBe(10);
    expect(getMaxPendingGitCommitsPerRepoV2()).toBe(20);
    expect(getGitRepoIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getGitCommitStuckMsV2()).toBe(5 * 60 * 1000);
  });
  test("set max active", () => {
    setMaxActiveGitReposPerOwnerV2(5);
    expect(getMaxActiveGitReposPerOwnerV2()).toBe(5);
  });
  test("set max pending", () => {
    setMaxPendingGitCommitsPerRepoV2(7);
    expect(getMaxPendingGitCommitsPerRepoV2()).toBe(7);
  });
  test("set idle ms", () => {
    setGitRepoIdleMsV2(100);
    expect(getGitRepoIdleMsV2()).toBe(100);
  });
  test("set stuck ms", () => {
    setGitCommitStuckMsV2(50);
    expect(getGitCommitStuckMsV2()).toBe(50);
  });
  test("reject non-positive", () => {
    expect(() => setMaxActiveGitReposPerOwnerV2(0)).toThrow();
    expect(() => setMaxActiveGitReposPerOwnerV2(-1)).toThrow();
  });
  test("floor fractional", () => {
    setMaxActiveGitReposPerOwnerV2(5.9);
    expect(getMaxActiveGitReposPerOwnerV2()).toBe(5);
  });
});

describe("Git V2 repo lifecycle", () => {
  test("register", () => {
    const r = registerGitRepoV2({ id: "r1", owner: "u1" });
    expect(r.status).toBe("pending");
    expect(r.branch).toBe("main");
  });
  test("register with branch", () => {
    const r = registerGitRepoV2({ id: "r1", owner: "u1", branch: "dev" });
    expect(r.branch).toBe("dev");
  });
  test("register reject duplicate", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    expect(() => registerGitRepoV2({ id: "r1", owner: "u1" })).toThrow();
  });
  test("register reject missing id", () => {
    expect(() => registerGitRepoV2({ owner: "u1" })).toThrow();
  });
  test("register reject missing owner", () => {
    expect(() => registerGitRepoV2({ id: "r1" })).toThrow();
  });
  test("activate pending → active", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    const r = activateGitRepoV2("r1");
    expect(r.status).toBe("active");
    expect(r.activatedAt).toBeTruthy();
  });
  test("archive active → archived", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    activateGitRepoV2("r1");
    const r = archiveGitRepoV2("r1");
    expect(r.status).toBe("archived");
  });
  test("activate archived → active (recovery)", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    const before = activateGitRepoV2("r1").activatedAt;
    archiveGitRepoV2("r1");
    const r = activateGitRepoV2("r1");
    expect(r.status).toBe("active");
    expect(r.activatedAt).toBe(before);
  });
  test("decommission from active", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    activateGitRepoV2("r1");
    const r = decommissionGitRepoV2("r1");
    expect(r.status).toBe("decommissioned");
    expect(r.decommissionedAt).toBeTruthy();
  });
  test("decommission from pending", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    const r = decommissionGitRepoV2("r1");
    expect(r.status).toBe("decommissioned");
  });
  test("terminal no transitions", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    decommissionGitRepoV2("r1");
    expect(() => activateGitRepoV2("r1")).toThrow();
    expect(() => archiveGitRepoV2("r1")).toThrow();
  });
  test("touch terminal throws", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    decommissionGitRepoV2("r1");
    expect(() => touchGitRepoV2("r1")).toThrow();
  });
  test("touch updates", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    activateGitRepoV2("r1");
    const r = touchGitRepoV2("r1");
    expect(r.lastTouchedAt).toBeTruthy();
  });
  test("get / list", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    expect(getGitRepoV2("r1").id).toBe("r1");
    expect(getGitRepoV2("nope")).toBeNull();
    expect(listGitReposV2().length).toBe(1);
  });
});

describe("Git V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveGitReposPerOwnerV2(2);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    registerGitRepoV2({ id: "r2", owner: "u1" });
    registerGitRepoV2({ id: "r3", owner: "u1" });
    activateGitRepoV2("r1");
    activateGitRepoV2("r2");
    expect(() => activateGitRepoV2("r3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveGitReposPerOwnerV2(2);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    registerGitRepoV2({ id: "r2", owner: "u1" });
    activateGitRepoV2("r1");
    activateGitRepoV2("r2");
    archiveGitRepoV2("r1");
    const r = activateGitRepoV2("r1");
    expect(r.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveGitReposPerOwnerV2(1);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    registerGitRepoV2({ id: "r2", owner: "u2" });
    activateGitRepoV2("r1");
    activateGitRepoV2("r2");
  });
});

describe("Git V2 commit lifecycle", () => {
  test("create", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    const c = createGitCommitV2({ id: "c1", repoId: "r1" });
    expect(c.status).toBe("queued");
    expect(c.message).toBe("");
  });
  test("create with message", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    const c = createGitCommitV2({ id: "c1", repoId: "r1", message: "init" });
    expect(c.message).toBe("init");
  });
  test("create rejects unknown repo", () => {
    expect(() => createGitCommitV2({ id: "c1", repoId: "nope" })).toThrow();
  });
  test("create rejects duplicate", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    expect(() => createGitCommitV2({ id: "c1", repoId: "r1" })).toThrow();
  });
  test("start queued → committing", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    const c = startGitCommitV2("c1");
    expect(c.status).toBe("committing");
    expect(c.startedAt).toBeTruthy();
  });
  test("commit committing → committed", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    const c = commitGitCommitV2("c1");
    expect(c.status).toBe("committed");
    expect(c.settledAt).toBeTruthy();
  });
  test("fail committing → failed", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    const c = failGitCommitV2("c1", "oops");
    expect(c.status).toBe("failed");
    expect(c.metadata.failReason).toBe("oops");
  });
  test("cancel queued → cancelled", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    const c = cancelGitCommitV2("c1", "abort");
    expect(c.status).toBe("cancelled");
    expect(c.metadata.cancelReason).toBe("abort");
  });
  test("cancel committing → cancelled", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    const c = cancelGitCommitV2("c1");
    expect(c.status).toBe("cancelled");
  });
  test("terminal no transitions", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    commitGitCommitV2("c1");
    expect(() => failGitCommitV2("c1")).toThrow();
  });
  test("get / list", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    expect(getGitCommitV2("c1").id).toBe("c1");
    expect(getGitCommitV2("nope")).toBeNull();
    expect(listGitCommitsV2().length).toBe(1);
  });
});

describe("Git V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingGitCommitsPerRepoV2(2);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    createGitCommitV2({ id: "c2", repoId: "r1" });
    expect(() => createGitCommitV2({ id: "c3", repoId: "r1" })).toThrow(
      /max pending/,
    );
  });
  test("terminal frees slot", () => {
    setMaxPendingGitCommitsPerRepoV2(2);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    createGitCommitV2({ id: "c2", repoId: "r1" });
    startGitCommitV2("c1");
    commitGitCommitV2("c1");
    createGitCommitV2({ id: "c3", repoId: "r1" });
  });
  test("per-repo scope", () => {
    setMaxPendingGitCommitsPerRepoV2(1);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    registerGitRepoV2({ id: "r2", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    createGitCommitV2({ id: "c2", repoId: "r2" });
  });
});

describe("Git V2 auto flips", () => {
  test("autoArchiveIdleGitReposV2", () => {
    setGitRepoIdleMsV2(100);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    activateGitRepoV2("r1");
    const { count } = autoArchiveIdleGitReposV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getGitRepoV2("r1").status).toBe("archived");
  });
  test("autoFailStuckGitCommitsV2", () => {
    setGitCommitStuckMsV2(100);
    registerGitRepoV2({ id: "r1", owner: "u1" });
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    const { count } = autoFailStuckGitCommitsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1);
    expect(getGitCommitV2("c1").status).toBe("failed");
    expect(getGitCommitV2("c1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("Git V2 stats", () => {
  test("empty defaults", () => {
    const s = getGitIntegrationGovStatsV2();
    expect(s.totalGitReposV2).toBe(0);
    expect(s.totalGitCommitsV2).toBe(0);
    for (const k of ["pending", "active", "archived", "decommissioned"])
      expect(s.reposByStatus[k]).toBe(0);
    for (const k of [
      "queued",
      "committing",
      "committed",
      "failed",
      "cancelled",
    ])
      expect(s.commitsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerGitRepoV2({ id: "r1", owner: "u1" });
    activateGitRepoV2("r1");
    createGitCommitV2({ id: "c1", repoId: "r1" });
    startGitCommitV2("c1");
    const s = getGitIntegrationGovStatsV2();
    expect(s.totalGitReposV2).toBe(1);
    expect(s.totalGitCommitsV2).toBe(1);
    expect(s.reposByStatus.active).toBe(1);
    expect(s.commitsByStatus.committing).toBe(1);
  });
});
