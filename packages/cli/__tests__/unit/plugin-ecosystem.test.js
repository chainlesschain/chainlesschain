import { describe, it, expect, beforeEach } from "vitest";
import {
  REVIEW_SEVERITY,
  PUBLISH_STATUS,
  REVENUE_TYPE,
  INSTALL_STATUS,
  DEP_KIND,
  SANDBOX_RESULT,
  DEFAULT_DEVELOPER_SHARE,
  ensurePluginEcosystemTables,
  registerPlugin,
  getPlugin,
  listPlugins,
  updatePluginStats,
  addDependency,
  listDependencies,
  resolveDependencies,
  installPlugin,
  listInstalls,
  uninstallPlugin,
  aiReviewCode,
  getReview,
  listReviews,
  recordSandboxTest,
  getSandboxTest,
  listSandboxTests,
  submitForReview,
  approvePlugin,
  rejectPlugin,
  publishPlugin,
  recordRevenue,
  getDeveloperRevenue,
  recommend,
  getConfig,
  getStats,
  // V2
  PLUGIN_MATURITY_V2,
  INSTALL_LIFECYCLE_V2,
  PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER,
  PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER,
  PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS,
  PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS,
  setMaxActivePluginsPerDeveloper,
  setMaxPendingInstallsPerUser,
  setAutoDeprecateAfterMs,
  setAutoArchiveAfterMs,
  getMaxActivePluginsPerDeveloper,
  getMaxPendingInstallsPerUser,
  getAutoDeprecateAfterMs,
  getAutoArchiveAfterMs,
  getActivePluginCount,
  getPendingInstallCount,
  registerPluginV2,
  getMaturityV2,
  setPluginMaturityV2,
  deprecatePlugin,
  archivePluginV2,
  removePluginV2,
  touchPluginActivity,
  submitInstallV2,
  getInstallStatusV2,
  setInstallStatusV2,
  resolveInstall,
  completeInstall,
  failInstall,
  uninstallInstallV2,
  retryFailedInstall,
  autoDeprecateStalePlugins,
  autoArchiveLongDeprecated,
  getEcosystemStatsV2,
  _resetStateV2,
} from "../../src/lib/plugin-ecosystem.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("plugin-ecosystem", () => {
  let db;
  beforeEach(() => {
    db = new MockDatabase();
    ensurePluginEcosystemTables(db);
  });

  /* ── Constants & config ─────────────────────── */

  describe("constants & config", () => {
    it("defines 4 review severities", () => {
      expect(Object.values(REVIEW_SEVERITY)).toEqual([
        "info",
        "warning",
        "critical",
        "blocker",
      ]);
    });

    it("defines 5 publish statuses", () => {
      expect(Object.values(PUBLISH_STATUS)).toEqual([
        "draft",
        "reviewing",
        "approved",
        "rejected",
        "published",
      ]);
    });

    it("defines 4 revenue types", () => {
      expect(Object.values(REVENUE_TYPE)).toHaveLength(4);
      expect(REVENUE_TYPE.DOWNLOAD).toBe("download");
    });

    it("defines 5 install statuses", () => {
      expect(Object.values(INSTALL_STATUS)).toHaveLength(5);
    });

    it("defines 3 dep kinds", () => {
      expect(Object.values(DEP_KIND)).toEqual(["required", "optional", "peer"]);
    });

    it("defines 4 sandbox results", () => {
      expect(Object.values(SANDBOX_RESULT)).toHaveLength(4);
    });

    it("default developer share is 0.7", () => {
      expect(DEFAULT_DEVELOPER_SHARE).toBe(0.7);
    });

    it("getConfig returns rules + defaults + catalogs", () => {
      const c = getConfig();
      expect(c.reviewSeverities).toHaveLength(4);
      expect(c.reviewRules.length).toBeGreaterThan(5);
      expect(c.defaults.developerShare).toBe(0.7);
      expect(c.defaults.sandboxMemoryMb).toBe(256);
    });
  });

  /* ── Plugin registry ────────────────────────── */

  describe("registerPlugin", () => {
    it("creates a plugin in draft status", () => {
      const p = registerPlugin(db, {
        name: "hello",
        version: "1.0.0",
        developerId: "dev-1",
        category: "utility",
      });
      expect(p.name).toBe("hello");
      expect(p.status).toBe(PUBLISH_STATUS.DRAFT);
      expect(p.downloadCount).toBe(0);
    });

    it("requires name, version, developerId", () => {
      expect(() =>
        registerPlugin(db, { version: "1", developerId: "d" }),
      ).toThrow(/name is required/);
      expect(() => registerPlugin(db, { name: "x", developerId: "d" })).toThrow(
        /version is required/,
      );
      expect(() => registerPlugin(db, { name: "x", version: "1" })).toThrow(
        /developerId is required/,
      );
    });

    it("stores manifest as JSON", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
        manifest: { entry: "index.js", permissions: ["fs"] },
      });
      expect(p.manifest).toEqual({ entry: "index.js", permissions: ["fs"] });
    });

    it("listPlugins filters by status + developer", () => {
      registerPlugin(db, { name: "a", version: "1", developerId: "d1" });
      registerPlugin(db, { name: "b", version: "1", developerId: "d2" });
      expect(listPlugins(db, { status: PUBLISH_STATUS.DRAFT })).toHaveLength(2);
      expect(listPlugins(db, { developerId: "d1" })).toHaveLength(1);
    });

    it("updatePluginStats updates download count and rating", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
      const updated = updatePluginStats(db, p.id, {
        downloadCount: 50,
        avgRating: 4.5,
      });
      expect(updated.downloadCount).toBe(50);
      expect(updated.avgRating).toBe(4.5);
    });
  });

  /* ── Dependencies ───────────────────────────── */

  describe("dependencies", () => {
    let a, b, c;
    beforeEach(() => {
      a = registerPlugin(db, { name: "a", version: "1", developerId: "d" });
      b = registerPlugin(db, { name: "b", version: "1", developerId: "d" });
      c = registerPlugin(db, { name: "c", version: "1", developerId: "d" });
    });

    it("addDependency + listDependencies", () => {
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1.0.0" });
      const deps = listDependencies(db, a.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].depPluginId).toBe(b.id);
      expect(deps[0].kind).toBe(DEP_KIND.REQUIRED);
    });

    it("rejects unknown kind", () => {
      expect(() =>
        addDependency(db, a.id, {
          depPluginId: b.id,
          depVersion: "1",
          kind: "bogus",
        }),
      ).toThrow(/Unknown dep kind/);
    });

    it("resolveDependencies walks the tree transitively", () => {
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1.0.0" });
      addDependency(db, b.id, { depPluginId: c.id, depVersion: "1.0.0" });
      const resolved = resolveDependencies(db, a.id);
      expect(resolved.dependencies.map((d) => d.depPluginId).sort()).toEqual(
        [b.id, c.id].sort(),
      );
      expect(resolved.conflicts).toEqual([]);
      expect(resolved.circular).toEqual([]);
    });

    it("resolveDependencies detects circular", () => {
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1" });
      addDependency(db, b.id, { depPluginId: a.id, depVersion: "1" });
      const resolved = resolveDependencies(db, a.id);
      expect(resolved.circular.length).toBeGreaterThan(0);
    });

    it("resolveDependencies detects version conflicts", () => {
      addDependency(db, a.id, { depPluginId: c.id, depVersion: "1.0.0" });
      addDependency(db, b.id, { depPluginId: c.id, depVersion: "2.0.0" });
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1.0.0" });
      const resolved = resolveDependencies(db, a.id);
      expect(resolved.conflicts.length).toBe(1);
      expect(resolved.conflicts[0].depPluginId).toBe(c.id);
    });

    it("resolveDependencies skips OPTIONAL deps", () => {
      addDependency(db, a.id, {
        depPluginId: b.id,
        depVersion: "1",
        kind: DEP_KIND.OPTIONAL,
      });
      const resolved = resolveDependencies(db, a.id);
      expect(resolved.dependencies).toHaveLength(0);
    });
  });

  /* ── Installation ───────────────────────────── */

  describe("installPlugin", () => {
    it("installs successfully and bumps download count", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
      const { install } = installPlugin(db, {
        userId: "user-1",
        pluginId: p.id,
      });
      expect(install.status).toBe(INSTALL_STATUS.INSTALLED);
      expect(getPlugin(db, p.id).downloadCount).toBe(1);
    });

    it("fails install on circular dependencies", () => {
      const a = registerPlugin(db, {
        name: "a",
        version: "1",
        developerId: "d",
      });
      const b = registerPlugin(db, {
        name: "b",
        version: "1",
        developerId: "d",
      });
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1" });
      addDependency(db, b.id, { depPluginId: a.id, depVersion: "1" });

      const { install } = installPlugin(db, {
        userId: "u",
        pluginId: a.id,
      });
      expect(install.status).toBe(INSTALL_STATUS.FAILED);
      expect(install.errorMessage).toMatch(/circular/i);
    });

    it("fails install on version conflicts", () => {
      const a = registerPlugin(db, {
        name: "a",
        version: "1",
        developerId: "d",
      });
      const b = registerPlugin(db, {
        name: "b",
        version: "1",
        developerId: "d",
      });
      const c = registerPlugin(db, {
        name: "c",
        version: "1",
        developerId: "d",
      });
      addDependency(db, a.id, { depPluginId: c.id, depVersion: "1.0.0" });
      addDependency(db, b.id, { depPluginId: c.id, depVersion: "2.0.0" });
      addDependency(db, a.id, { depPluginId: b.id, depVersion: "1.0.0" });

      const { install } = installPlugin(db, { userId: "u", pluginId: a.id });
      expect(install.status).toBe(INSTALL_STATUS.FAILED);
      expect(install.errorMessage).toMatch(/version conflict/i);
    });

    it("throws for missing userId / unknown plugin", () => {
      expect(() => installPlugin(db, { pluginId: "x" })).toThrow(/userId/);
      expect(() =>
        installPlugin(db, { userId: "u", pluginId: "nope" }),
      ).toThrow(/not found/);
    });

    it("listInstalls filters by user / status", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
      installPlugin(db, { userId: "u1", pluginId: p.id });
      installPlugin(db, { userId: "u2", pluginId: p.id });
      expect(listInstalls(db, { userId: "u1" })).toHaveLength(1);
      expect(
        listInstalls(db, { status: INSTALL_STATUS.INSTALLED }),
      ).toHaveLength(2);
    });

    it("uninstallPlugin flips status", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
      const { install } = installPlugin(db, { userId: "u", pluginId: p.id });
      const updated = uninstallPlugin(db, install.id);
      expect(updated.status).toBe(INSTALL_STATUS.UNINSTALLED);
    });

    it("uninstall refuses double-uninstall", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
      const { install } = installPlugin(db, { userId: "u", pluginId: p.id });
      uninstallPlugin(db, install.id);
      expect(() => uninstallPlugin(db, install.id)).toThrow(
        /already uninstalled/,
      );
    });
  });

  /* ── AI review ─────────────────────────────── */

  describe("aiReviewCode", () => {
    let plugin;
    beforeEach(() => {
      plugin = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
    });

    it("flags eval() as blocker", () => {
      const r = aiReviewCode(db, plugin.id, { sourceCode: "eval('bad')" });
      expect(r.severity).toBe(REVIEW_SEVERITY.BLOCKER);
      expect(r.issues.some((i) => i.ruleId === "code-injection-eval")).toBe(
        true,
      );
      expect(r.score).toBeLessThan(100);
    });

    it("flags new Function as critical", () => {
      const r = aiReviewCode(db, plugin.id, {
        sourceCode: "var f = new Function('x', 'return x');",
      });
      expect(
        r.issues.some((i) => i.ruleId === "code-injection-new-function"),
      ).toBe(true);
    });

    it("flags hardcoded secrets as blocker", () => {
      const r = aiReviewCode(db, plugin.id, {
        sourceCode: 'const API_KEY = "sk_test_fake_placeholder_key";',
      });
      expect(r.severity).toBe(REVIEW_SEVERITY.BLOCKER);
      expect(r.issues.some((i) => i.ruleId === "hardcoded-secret")).toBe(true);
    });

    it("clean code passes with score 100", () => {
      const r = aiReviewCode(db, plugin.id, {
        sourceCode: "function add(a, b) { return a + b; }",
      });
      expect(r.score).toBe(100);
      expect(r.issues).toHaveLength(0);
      expect(r.severity).toBe(REVIEW_SEVERITY.INFO);
    });

    it("strictness=strict applies 1.5x penalty multiplier", () => {
      const code = "eval('x');";
      const standard = aiReviewCode(db, plugin.id, {
        sourceCode: code,
        strictness: "standard",
      });
      const strict = aiReviewCode(db, plugin.id, {
        sourceCode: code,
        strictness: "strict",
      });
      expect(strict.score).toBeLessThan(standard.score);
    });

    it("strictness=lenient applies 0.6x penalty multiplier", () => {
      const code = "eval('x'); eval('y');";
      const standard = aiReviewCode(db, plugin.id, {
        sourceCode: code,
        strictness: "standard",
      });
      const lenient = aiReviewCode(db, plugin.id, {
        sourceCode: code,
        strictness: "lenient",
      });
      expect(lenient.score).toBeGreaterThan(standard.score);
    });

    it("getReview + listReviews", () => {
      const r = aiReviewCode(db, plugin.id, { sourceCode: "eval('x')" });
      expect(getReview(db, r.id).id).toBe(r.id);
      expect(listReviews(db, { pluginId: plugin.id })).toHaveLength(1);
    });

    it("throws for unknown plugin", () => {
      expect(() => aiReviewCode(db, "nope", { sourceCode: "" })).toThrow(
        /not found/,
      );
    });
  });

  /* ── Sandbox testing ───────────────────────── */

  describe("sandbox testing", () => {
    let plugin;
    beforeEach(() => {
      plugin = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
    });

    it("records a passed test", () => {
      const t = recordSandboxTest(db, plugin.id, {
        result: SANDBOX_RESULT.PASSED,
        metrics: { memMb: 42 },
        durationMs: 123,
      });
      expect(t.result).toBe(SANDBOX_RESULT.PASSED);
      expect(t.metrics.memMb).toBe(42);
      expect(t.durationMs).toBe(123);
    });

    it("rejects unknown result", () => {
      expect(() =>
        recordSandboxTest(db, plugin.id, { result: "bogus" }),
      ).toThrow(/Unknown sandbox result/);
    });

    it("listSandboxTests filters by result", () => {
      recordSandboxTest(db, plugin.id, { result: SANDBOX_RESULT.PASSED });
      recordSandboxTest(db, plugin.id, { result: SANDBOX_RESULT.FAILED });
      expect(
        listSandboxTests(db, { result: SANDBOX_RESULT.FAILED }),
      ).toHaveLength(1);
    });

    it("getSandboxTest roundtrip", () => {
      const t = recordSandboxTest(db, plugin.id, {
        result: SANDBOX_RESULT.TIMEOUT,
        logs: ["timed out"],
      });
      expect(getSandboxTest(db, t.id).logs).toEqual(["timed out"]);
    });
  });

  /* ── Publish flow ──────────────────────────── */

  describe("publish flow", () => {
    let plugin;
    beforeEach(() => {
      plugin = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
      });
    });

    it("full flow: draft → reviewing → approved → published", () => {
      expect(submitForReview(db, plugin.id).status).toBe(
        PUBLISH_STATUS.REVIEWING,
      );
      expect(approvePlugin(db, plugin.id).status).toBe(PUBLISH_STATUS.APPROVED);
      const pub = publishPlugin(db, plugin.id, {
        sourceCode: "module.exports = {}",
        changelog: "initial",
      });
      expect(pub.status).toBe(PUBLISH_STATUS.PUBLISHED);
      expect(pub.sourceHash).toBeTruthy();
      expect(pub.publishedAt).toBeTruthy();
    });

    it("rejectPlugin sets status to rejected and stores rejection review", () => {
      submitForReview(db, plugin.id);
      const rejected = rejectPlugin(db, plugin.id, "missing license");
      expect(rejected.status).toBe(PUBLISH_STATUS.REJECTED);
      const reviews = listReviews(db, { pluginId: plugin.id });
      expect(reviews.some((r) => r.strictness === "rejection")).toBe(true);
    });

    it("can resubmit after rejection", () => {
      submitForReview(db, plugin.id);
      rejectPlugin(db, plugin.id);
      expect(submitForReview(db, plugin.id).status).toBe(
        PUBLISH_STATUS.REVIEWING,
      );
    });

    it("cannot submit published plugin", () => {
      submitForReview(db, plugin.id);
      approvePlugin(db, plugin.id);
      publishPlugin(db, plugin.id);
      expect(() => submitForReview(db, plugin.id)).toThrow(/Cannot submit/);
    });

    it("cannot approve draft", () => {
      expect(() => approvePlugin(db, plugin.id)).toThrow(/must be reviewing/);
    });

    it("cannot publish non-approved plugin", () => {
      expect(() => publishPlugin(db, plugin.id)).toThrow(/must be approved/);
    });
  });

  /* ── Revenue ───────────────────────────────── */

  describe("revenue", () => {
    let plugin;
    beforeEach(() => {
      plugin = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d-1",
      });
    });

    it("recordRevenue splits via default ratio 70/30", () => {
      const r = recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.SUBSCRIPTION,
        amount: 100,
      });
      expect(r.developerShare).toBeCloseTo(70, 5);
      expect(r.platformShare).toBeCloseTo(30, 5);
    });

    it("recordRevenue accepts custom ratio", () => {
      const r = recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.DONATION,
        amount: 50,
        developerShareRatio: 0.9,
      });
      expect(r.developerShare).toBeCloseTo(45, 5);
      expect(r.platformShare).toBeCloseTo(5, 5);
    });

    it("recordRevenue rejects bad inputs", () => {
      expect(() =>
        recordRevenue(db, {
          developerId: "d",
          pluginId: "p",
          type: "bogus",
          amount: 10,
        }),
      ).toThrow(/Unknown revenue type/);
      expect(() =>
        recordRevenue(db, {
          developerId: "d",
          pluginId: "p",
          type: REVENUE_TYPE.DONATION,
          amount: -1,
        }),
      ).toThrow(/non-negative/);
      expect(() =>
        recordRevenue(db, {
          developerId: "d",
          pluginId: "p",
          type: REVENUE_TYPE.DONATION,
          amount: 10,
          developerShareRatio: 1.5,
        }),
      ).toThrow(/ratio/i);
    });

    it("getDeveloperRevenue aggregates across events", () => {
      recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.DOWNLOAD,
        amount: 10,
      });
      recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.SUBSCRIPTION,
        amount: 50,
      });
      const agg = getDeveloperRevenue(db, "d-1");
      expect(agg.eventCount).toBe(2);
      expect(agg.totalGross).toBe(60);
      expect(agg.byType.download).toBe(10);
      expect(agg.byType.subscription).toBe(50);
      expect(agg.byPlugin[plugin.id]).toBe(60);
    });

    it("increments revenue_total on plugin entry", () => {
      recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.PREMIUM,
        amount: 100,
      });
      recordRevenue(db, {
        developerId: "d-1",
        pluginId: plugin.id,
        type: REVENUE_TYPE.PREMIUM,
        amount: 50,
      });
      expect(getPlugin(db, plugin.id).revenueTotal).toBe(150);
    });
  });

  /* ── Recommendation ────────────────────────── */

  describe("recommend", () => {
    let userId, utilA, utilB, gameA;

    beforeEach(() => {
      userId = "user-1";
      // Populate published catalog
      utilA = registerPlugin(db, {
        name: "utilA",
        version: "1",
        developerId: "d",
        category: "utility",
      });
      utilB = registerPlugin(db, {
        name: "utilB",
        version: "1",
        developerId: "d",
        category: "utility",
      });
      gameA = registerPlugin(db, {
        name: "gameA",
        version: "1",
        developerId: "d",
        category: "game",
      });
      for (const p of [utilA, utilB, gameA]) {
        submitForReview(db, p.id);
        approvePlugin(db, p.id);
        publishPlugin(db, p.id);
      }
      updatePluginStats(db, utilA.id, { downloadCount: 1000, avgRating: 4.5 });
      updatePluginStats(db, utilB.id, { downloadCount: 10, avgRating: 3 });
      updatePluginStats(db, gameA.id, { downloadCount: 500, avgRating: 4 });
    });

    it("returns published plugins ordered by score", () => {
      const r = recommend(db, { userId });
      expect(r.recommendations.length).toBeGreaterThan(0);
      // utilA has higher downloads + rating than utilB → should rank higher
      const utilAIdx = r.recommendations.findIndex(
        (rec) => rec.plugin.id === utilA.id,
      );
      const utilBIdx = r.recommendations.findIndex(
        (rec) => rec.plugin.id === utilB.id,
      );
      expect(utilAIdx).toBeLessThan(utilBIdx);
    });

    it("excludes already installed plugins", () => {
      installPlugin(db, { userId, pluginId: utilA.id });
      const r = recommend(db, { userId });
      expect(
        r.recommendations.find((rec) => rec.plugin.id === utilA.id),
      ).toBeUndefined();
    });

    it("weighs user's favored categories", () => {
      // Install a utility plugin so "utility" becomes a preferred category
      installPlugin(db, { userId, pluginId: utilB.id });
      const r = recommend(db, { userId });
      // utilA (utility) should outrank gameA because categoryAffinity=1 for utility
      const utilAIdx = r.recommendations.findIndex(
        (rec) => rec.plugin.id === utilA.id,
      );
      const gameAIdx = r.recommendations.findIndex(
        (rec) => rec.plugin.id === gameA.id,
      );
      expect(utilAIdx).toBeLessThan(gameAIdx);
      expect(r.userCategories[0].category).toBe("utility");
    });

    it("respects limit", () => {
      const r = recommend(db, { userId, limit: 1 });
      expect(r.recommendations).toHaveLength(1);
    });

    it("throws without userId", () => {
      expect(() => recommend(db, {})).toThrow(/userId/);
    });
  });

  /* ── Stats ─────────────────────────────────── */

  describe("getStats", () => {
    it("reports zeros on empty DB", () => {
      const s = getStats(db);
      expect(s.totalPlugins).toBe(0);
      expect(s.totalInstalls).toBe(0);
      expect(s.totalRevenueGross).toBe(0);
    });

    it("aggregates across all tables", () => {
      const p = registerPlugin(db, {
        name: "x",
        version: "1",
        developerId: "d",
        category: "util",
      });
      installPlugin(db, { userId: "u", pluginId: p.id });
      aiReviewCode(db, p.id, { sourceCode: "eval('x')" });
      recordSandboxTest(db, p.id, { result: SANDBOX_RESULT.PASSED });
      recordRevenue(db, {
        developerId: "d",
        pluginId: p.id,
        type: REVENUE_TYPE.DOWNLOAD,
        amount: 5,
      });
      const s = getStats(db);
      expect(s.totalPlugins).toBe(1);
      expect(s.pluginsByStatus.draft).toBe(1);
      expect(s.pluginsByCategory.util).toBe(1);
      expect(s.totalInstalls).toBe(1);
      expect(s.totalReviews).toBe(1);
      expect(s.totalSandboxTests).toBe(1);
      expect(s.totalRevenueGross).toBe(5);
      expect(s.totalDeveloperShare).toBeCloseTo(3.5, 5);
    });
  });

  /* ── E2E flow ──────────────────────────────── */

  describe("end-to-end scenario", () => {
    it("developer registers → reviews → publishes → earns revenue", () => {
      const plugin = registerPlugin(db, {
        name: "p",
        version: "1",
        developerId: "dev-42",
        category: "utility",
      });
      const review = aiReviewCode(db, plugin.id, {
        sourceCode: "function hi(){ return 1; }",
      });
      expect(review.score).toBe(100);

      submitForReview(db, plugin.id);
      approvePlugin(db, plugin.id);
      publishPlugin(db, plugin.id, {
        sourceCode: "module.exports = function(){};",
      });

      const { install } = installPlugin(db, {
        userId: "alice",
        pluginId: plugin.id,
      });
      expect(install.status).toBe(INSTALL_STATUS.INSTALLED);

      recordRevenue(db, {
        developerId: "dev-42",
        pluginId: plugin.id,
        type: REVENUE_TYPE.SUBSCRIPTION,
        amount: 20,
      });

      const agg = getDeveloperRevenue(db, "dev-42");
      expect(agg.totalGross).toBe(20);
      expect(agg.totalDeveloperShare).toBeCloseTo(14, 5);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase 64 V2 — maturity + install lifecycles, caps, auto-flip
  // ═══════════════════════════════════════════════════════════════

  describe("Phase 64 V2", () => {
    beforeEach(() => _resetStateV2());

    describe("frozen enums", () => {
      it("defines 4 maturity statuses", () => {
        expect(Object.values(PLUGIN_MATURITY_V2)).toEqual([
          "active",
          "deprecated",
          "archived",
          "removed",
        ]);
        expect(() => {
          PLUGIN_MATURITY_V2.ACTIVE = "x";
        }).toThrow();
      });

      it("defines 5 install lifecycle statuses", () => {
        expect(Object.values(INSTALL_LIFECYCLE_V2)).toEqual([
          "pending",
          "resolving",
          "installed",
          "failed",
          "uninstalled",
        ]);
      });

      it("exports defaults", () => {
        expect(PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER).toBe(20);
        expect(PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER).toBe(5);
        expect(PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS).toBe(
          180 * 24 * 60 * 60 * 1000,
        );
        expect(PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS).toBe(
          90 * 24 * 60 * 60 * 1000,
        );
      });
    });

    describe("config mutators", () => {
      it("setMaxActivePluginsPerDeveloper floors + rejects non-positive", () => {
        expect(setMaxActivePluginsPerDeveloper(30.9)).toBe(30);
        expect(getMaxActivePluginsPerDeveloper()).toBe(30);
        expect(() => setMaxActivePluginsPerDeveloper(0)).toThrow(
          /positive integer/,
        );
        expect(() => setMaxActivePluginsPerDeveloper(-1)).toThrow();
        expect(() => setMaxActivePluginsPerDeveloper(NaN)).toThrow();
      });

      it("setMaxPendingInstallsPerUser floors + rejects", () => {
        expect(setMaxPendingInstallsPerUser(10)).toBe(10);
        expect(getMaxPendingInstallsPerUser()).toBe(10);
        expect(() => setMaxPendingInstallsPerUser(-5)).toThrow();
      });

      it("setAutoDeprecateAfterMs floors + rejects", () => {
        expect(setAutoDeprecateAfterMs(1000.5)).toBe(1000);
        expect(getAutoDeprecateAfterMs()).toBe(1000);
        expect(() => setAutoDeprecateAfterMs(0)).toThrow();
      });

      it("setAutoArchiveAfterMs floors + rejects", () => {
        expect(setAutoArchiveAfterMs(500)).toBe(500);
        expect(getAutoArchiveAfterMs()).toBe(500);
        expect(() => setAutoArchiveAfterMs(-1)).toThrow();
      });

      it("_resetStateV2 restores defaults", () => {
        setMaxActivePluginsPerDeveloper(999);
        setMaxPendingInstallsPerUser(999);
        setAutoDeprecateAfterMs(1);
        setAutoArchiveAfterMs(1);
        _resetStateV2();
        expect(getMaxActivePluginsPerDeveloper()).toBe(20);
        expect(getMaxPendingInstallsPerUser()).toBe(5);
        expect(getAutoDeprecateAfterMs()).toBe(
          PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS,
        );
        expect(getAutoArchiveAfterMs()).toBe(
          PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS,
        );
      });
    });

    describe("registerPluginV2", () => {
      it("tags new plugin as ACTIVE", () => {
        const entry = registerPluginV2(db, {
          pluginId: "p1",
          developerId: "dev-1",
        });
        expect(entry.status).toBe(PLUGIN_MATURITY_V2.ACTIVE);
        expect(entry.developerId).toBe("dev-1");
        expect(entry.reason).toBeNull();
        expect(entry.metadata).toEqual({});
      });

      it("throws on missing pluginId", () => {
        expect(() => registerPluginV2(db, { developerId: "dev-1" })).toThrow(
          /pluginId is required/,
        );
      });

      it("throws on missing developerId", () => {
        expect(() => registerPluginV2(db, { pluginId: "p1" })).toThrow(
          /developerId is required/,
        );
      });

      it("throws on duplicate", () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        expect(() =>
          registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" }),
        ).toThrow(/already registered/);
      });

      it("preserves metadata", () => {
        const entry = registerPluginV2(db, {
          pluginId: "p1",
          developerId: "dev-1",
          metadata: { category: "dev-tools" },
        });
        expect(entry.metadata).toEqual({ category: "dev-tools" });
      });

      it("enforces per-developer active cap", () => {
        setMaxActivePluginsPerDeveloper(2);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p2", developerId: "dev-1" });
        expect(() =>
          registerPluginV2(db, { pluginId: "p3", developerId: "dev-1" }),
        ).toThrow(/Max active plugins reached.*dev-1/);
        // Other developer unaffected
        expect(
          registerPluginV2(db, { pluginId: "p4", developerId: "dev-2" }).status,
        ).toBe("active");
      });
    });

    describe("setPluginMaturityV2", () => {
      beforeEach(() => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
      });

      it("active → deprecated → archived → active path", () => {
        expect(deprecatePlugin(db, "p1", "old").status).toBe("deprecated");
        expect(archivePluginV2(db, "p1", "cleanup").status).toBe("archived");
        expect(
          setPluginMaturityV2(db, "p1", "active", { reason: "revived" }).status,
        ).toBe("active");
      });

      it("deprecated → removed is allowed", () => {
        deprecatePlugin(db, "p1");
        expect(removePluginV2(db, "p1", "gone").status).toBe("removed");
      });

      it("active → removed is NOT allowed", () => {
        expect(() => removePluginV2(db, "p1")).toThrow(/Invalid transition/);
      });

      it("throws on terminal (removed)", () => {
        deprecatePlugin(db, "p1");
        removePluginV2(db, "p1");
        expect(() => setPluginMaturityV2(db, "p1", "active")).toThrow(
          /terminal/,
        );
      });

      it("throws on unknown plugin", () => {
        expect(() => setPluginMaturityV2(db, "nope", "deprecated")).toThrow(
          /not registered/,
        );
      });

      it("throws on invalid status", () => {
        expect(() => setPluginMaturityV2(db, "p1", "zombie")).toThrow(
          /Invalid maturity status/,
        );
      });

      it("patch-merges metadata", () => {
        registerPluginV2(db, {
          pluginId: "p2",
          developerId: "dev-1",
          metadata: { a: 1 },
        });
        const entry = setPluginMaturityV2(db, "p2", "deprecated", {
          reason: "r",
          metadata: { b: 2 },
        });
        expect(entry.metadata).toEqual({ a: 1, b: 2 });
        expect(entry.reason).toBe("r");
      });

      it("getMaturityV2 returns null for unknown", () => {
        expect(getMaturityV2("nope")).toBeNull();
      });
    });

    describe("touchPluginActivity", () => {
      it("bumps lastActivityAt", async () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        const before = getMaturityV2("p1").lastActivityAt;
        await new Promise((r) => setTimeout(r, 5));
        const after = touchPluginActivity("p1").lastActivityAt;
        expect(after).toBeGreaterThan(before);
      });

      it("throws on unknown", () => {
        expect(() => touchPluginActivity("nope")).toThrow(/not registered/);
      });
    });

    describe("submitInstallV2", () => {
      it("tags new install as PENDING", () => {
        const entry = submitInstallV2(db, {
          installId: "i1",
          userId: "u1",
          pluginId: "p1",
        });
        expect(entry.status).toBe(INSTALL_LIFECYCLE_V2.PENDING);
        expect(entry.userId).toBe("u1");
        expect(entry.pluginId).toBe("p1");
      });

      it("throws on missing fields", () => {
        expect(() =>
          submitInstallV2(db, { userId: "u1", pluginId: "p1" }),
        ).toThrow(/installId/);
        expect(() =>
          submitInstallV2(db, { installId: "i1", pluginId: "p1" }),
        ).toThrow(/userId/);
        expect(() =>
          submitInstallV2(db, { installId: "i1", userId: "u1" }),
        ).toThrow(/pluginId/);
      });

      it("throws on duplicate", () => {
        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p1" });
        expect(() =>
          submitInstallV2(db, {
            installId: "i1",
            userId: "u1",
            pluginId: "p1",
          }),
        ).toThrow(/already registered/);
      });

      it("rejects install for archived plugin", () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        archivePluginV2(db, "p1");
        expect(() =>
          submitInstallV2(db, {
            installId: "i1",
            userId: "u1",
            pluginId: "p1",
          }),
        ).toThrow(/not installable/);
      });

      it("allows install for deprecated plugin (grace period)", () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        expect(
          submitInstallV2(db, {
            installId: "i1",
            userId: "u1",
            pluginId: "p1",
          }).status,
        ).toBe("pending");
      });

      it("allows install for unregistered plugin (V2 state opt-in)", () => {
        expect(
          submitInstallV2(db, {
            installId: "i1",
            userId: "u1",
            pluginId: "unknown",
          }).status,
        ).toBe("pending");
      });

      it("enforces per-user pending cap", () => {
        setMaxPendingInstallsPerUser(2);
        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p1" });
        submitInstallV2(db, { installId: "i2", userId: "u1", pluginId: "p2" });
        expect(() =>
          submitInstallV2(db, {
            installId: "i3",
            userId: "u1",
            pluginId: "p3",
          }),
        ).toThrow(/Max pending installs reached.*u1/);
      });

      it("per-user cap scopes correctly", () => {
        setMaxPendingInstallsPerUser(1);
        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p1" });
        expect(
          submitInstallV2(db, {
            installId: "i2",
            userId: "u2",
            pluginId: "p1",
          }).status,
        ).toBe("pending");
      });
    });

    describe("setInstallStatusV2 + shortcuts", () => {
      beforeEach(() => {
        submitInstallV2(db, {
          installId: "i1",
          userId: "u1",
          pluginId: "p1",
        });
      });

      it("pending → resolving → installed → uninstalled", () => {
        expect(resolveInstall(db, "i1", "start").status).toBe("resolving");
        expect(completeInstall(db, "i1", "done").status).toBe("installed");
        expect(uninstallInstallV2(db, "i1", "bye").status).toBe("uninstalled");
      });

      it("pending → failed → pending (retry) → installed", () => {
        expect(failInstall(db, "i1", "boom").status).toBe("failed");
        expect(retryFailedInstall(db, "i1", "try again").status).toBe(
          "pending",
        );
        resolveInstall(db, "i1");
        expect(completeInstall(db, "i1").status).toBe("installed");
      });

      it("resolving → failed is allowed", () => {
        resolveInstall(db, "i1");
        expect(failInstall(db, "i1", "network").status).toBe("failed");
      });

      it("failed → uninstalled (abandon) is allowed", () => {
        failInstall(db, "i1");
        expect(uninstallInstallV2(db, "i1", "abandon").status).toBe(
          "uninstalled",
        );
      });

      it("installed → pending is NOT allowed", () => {
        resolveInstall(db, "i1");
        completeInstall(db, "i1");
        expect(() => retryFailedInstall(db, "i1")).toThrow(
          /Invalid transition/,
        );
      });

      it("throws on terminal (uninstalled)", () => {
        uninstallInstallV2(db, "i1", "bye");
        expect(() => resolveInstall(db, "i1")).toThrow(/terminal/);
      });

      it("throws on unknown install", () => {
        expect(() => resolveInstall(db, "nope")).toThrow(/not found/);
      });

      it("throws on invalid status", () => {
        expect(() => setInstallStatusV2(db, "i1", "zombie")).toThrow(
          /Invalid install status/,
        );
      });

      it("patch-merges metadata", () => {
        submitInstallV2(db, {
          installId: "i2",
          userId: "u1",
          pluginId: "p2",
          metadata: { a: 1 },
        });
        const entry = setInstallStatusV2(db, "i2", "resolving", {
          reason: "r",
          metadata: { b: 2 },
        });
        expect(entry.metadata).toEqual({ a: 1, b: 2 });
        expect(entry.reason).toBe("r");
      });
    });

    describe("counts", () => {
      it("getActivePluginCount: zero initially + scopes by developer", () => {
        expect(getActivePluginCount()).toBe(0);
        expect(getActivePluginCount("dev-1")).toBe(0);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p2", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p3", developerId: "dev-2" });
        expect(getActivePluginCount()).toBe(3);
        expect(getActivePluginCount("dev-1")).toBe(2);
        expect(getActivePluginCount("dev-2")).toBe(1);
      });

      it("getActivePluginCount counts only ACTIVE", () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p2", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        expect(getActivePluginCount("dev-1")).toBe(1);
      });

      it("getPendingInstallCount counts PENDING + RESOLVING", () => {
        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p1" });
        submitInstallV2(db, { installId: "i2", userId: "u1", pluginId: "p2" });
        resolveInstall(db, "i2");
        submitInstallV2(db, { installId: "i3", userId: "u2", pluginId: "p3" });
        expect(getPendingInstallCount()).toBe(3);
        expect(getPendingInstallCount("u1")).toBe(2);
        expect(getPendingInstallCount("u2")).toBe(1);
      });

      it("getPendingInstallCount excludes INSTALLED / FAILED / UNINSTALLED", () => {
        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p1" });
        submitInstallV2(db, { installId: "i2", userId: "u1", pluginId: "p2" });
        submitInstallV2(db, { installId: "i3", userId: "u1", pluginId: "p3" });
        resolveInstall(db, "i1");
        completeInstall(db, "i1");
        failInstall(db, "i2");
        expect(getPendingInstallCount("u1")).toBe(1);
      });
    });

    describe("autoDeprecateStalePlugins", () => {
      it("flips stale ACTIVE plugins to DEPRECATED", () => {
        setAutoDeprecateAfterMs(100);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        const now = Date.now();
        const flipped = autoDeprecateStalePlugins(db, now + 1000);
        expect(flipped).toHaveLength(1);
        expect(flipped[0].pluginId).toBe("p1");
        expect(flipped[0].reason).toBe("stale");
        expect(getMaturityV2("p1").status).toBe("deprecated");
      });

      it("skips fresh plugins", () => {
        setAutoDeprecateAfterMs(10_000);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        const flipped = autoDeprecateStalePlugins(db, Date.now());
        expect(flipped).toHaveLength(0);
        expect(getMaturityV2("p1").status).toBe("active");
      });

      it("skips non-active plugins", () => {
        setAutoDeprecateAfterMs(100);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        const flipped = autoDeprecateStalePlugins(db, Date.now() + 1000);
        expect(flipped).toHaveLength(0);
      });
    });

    describe("autoArchiveLongDeprecated", () => {
      it("flips long-deprecated plugins to ARCHIVED", () => {
        setAutoArchiveAfterMs(100);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        const flipped = autoArchiveLongDeprecated(db, Date.now() + 1000);
        expect(flipped).toHaveLength(1);
        expect(flipped[0].reason).toBe("long-deprecated");
        expect(getMaturityV2("p1").status).toBe("archived");
      });

      it("skips non-deprecated plugins", () => {
        setAutoArchiveAfterMs(100);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        const flipped = autoArchiveLongDeprecated(db, Date.now() + 1000);
        expect(flipped).toHaveLength(0);
      });

      it("skips fresh deprecated plugins", () => {
        setAutoArchiveAfterMs(10_000);
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        deprecatePlugin(db, "p1");
        const flipped = autoArchiveLongDeprecated(db, Date.now());
        expect(flipped).toHaveLength(0);
      });
    });

    describe("getEcosystemStatsV2", () => {
      it("zero-init with default config", () => {
        const s = getEcosystemStatsV2();
        expect(s.totalPluginsV2).toBe(0);
        expect(s.totalInstallsV2).toBe(0);
        expect(s.maxActivePluginsPerDeveloper).toBe(20);
        expect(s.maxPendingInstallsPerUser).toBe(5);
        expect(s.maturityByStatus).toEqual({
          active: 0,
          deprecated: 0,
          archived: 0,
          removed: 0,
        });
        expect(s.installsByStatus).toEqual({
          pending: 0,
          resolving: 0,
          installed: 0,
          failed: 0,
          uninstalled: 0,
        });
      });

      it("aggregates across statuses", () => {
        registerPluginV2(db, { pluginId: "p1", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p2", developerId: "dev-1" });
        registerPluginV2(db, { pluginId: "p3", developerId: "dev-2" });
        deprecatePlugin(db, "p1");
        archivePluginV2(db, "p1");

        submitInstallV2(db, { installId: "i1", userId: "u1", pluginId: "p2" });
        submitInstallV2(db, { installId: "i2", userId: "u1", pluginId: "p3" });
        resolveInstall(db, "i2");
        completeInstall(db, "i2");

        const s = getEcosystemStatsV2();
        expect(s.totalPluginsV2).toBe(3);
        expect(s.totalInstallsV2).toBe(2);
        expect(s.maturityByStatus.active).toBe(2);
        expect(s.maturityByStatus.archived).toBe(1);
        expect(s.installsByStatus.pending).toBe(1);
        expect(s.installsByStatus.installed).toBe(1);
      });
    });
  });
});
