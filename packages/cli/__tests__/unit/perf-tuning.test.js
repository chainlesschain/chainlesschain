import { describe, it, expect, beforeEach } from "vitest";
import {
  ALERT_LEVELS,
  RECOMMENDATION_STATUS,
  BUILTIN_RULES,
  DEFAULT_MAX_SAMPLES,
  DEFAULT_SAMPLE_INTERVAL_MS,
  DEFAULT_ALERT_THRESHOLDS,
  ensurePerfTables,
  getPerfConfig,
  setPerfConfig,
  collectSampleRaw,
  collectSample,
  listSamples,
  getLatestSample,
  clearHistory,
  listRules,
  getRule,
  setRuleEnabled,
  evaluateRules,
  listRecommendations,
  applyRecommendation,
  dismissRecommendation,
  listHistory,
  getAlerts,
  getPerfStats,
  getPerformanceReport,
} from "../../src/lib/perf-tuning.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("perf-tuning", () => {
  let db;
  beforeEach(() => {
    db = new MockDatabase();
    ensurePerfTables(db);
  });

  describe("schema & catalogs", () => {
    it("defines 5 built-in rules", () => {
      expect(BUILTIN_RULES).toHaveLength(5);
      expect(BUILTIN_RULES.map((r) => r.id).sort()).toEqual([
        "cpu-saturation",
        "db-slow-queries",
        "heap-leak",
        "load-average",
        "memory-pressure",
      ]);
    });

    it("every rule has required fields", () => {
      for (const r of BUILTIN_RULES) {
        expect(r.id).toBeTruthy();
        expect(r.name).toBeTruthy();
        expect(r.condition.metric).toBeTruthy();
        expect([">", ">=", "<", "<=", "=="]).toContain(r.condition.op);
        expect(typeof r.condition.value).toBe("number");
        expect(r.consecutiveRequired).toBeGreaterThan(0);
        expect(r.cooldownMs).toBeGreaterThan(0);
        expect(Object.values(ALERT_LEVELS)).toContain(r.severity);
      }
    });

    it("exposes 3 alert levels and 3 recommendation statuses", () => {
      expect(Object.values(ALERT_LEVELS).sort()).toEqual([
        "critical",
        "info",
        "warning",
      ]);
      expect(Object.values(RECOMMENDATION_STATUS).sort()).toEqual([
        "applied",
        "dismissed",
        "pending",
      ]);
    });

    it("ensurePerfTables creates all 5 tables", () => {
      ensurePerfTables(db); // idempotent
      for (const t of [
        "perf_samples",
        "perf_rule_state",
        "perf_recommendations",
        "perf_tuning_history",
        "perf_config",
      ]) {
        expect(db.tables.has(t)).toBe(true);
      }
    });
  });

  describe("config", () => {
    it("getPerfConfig returns defaults when empty", () => {
      const c = getPerfConfig(db);
      expect(c.maxSamples).toBe(DEFAULT_MAX_SAMPLES);
      expect(c.sampleIntervalMs).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
      expect(c.thresholds).toEqual(DEFAULT_ALERT_THRESHOLDS);
    });

    it("setPerfConfig persists scalar overrides", () => {
      setPerfConfig(db, { maxSamples: 100, sampleIntervalMs: 5000 });
      const c = getPerfConfig(db);
      expect(c.maxSamples).toBe(100);
      expect(c.sampleIntervalMs).toBe(5000);
    });

    it("setPerfConfig merges threshold overrides", () => {
      setPerfConfig(db, { thresholds: { cpuPercent: 50 } });
      const c = getPerfConfig(db);
      expect(c.thresholds.cpuPercent).toBe(50);
      expect(c.thresholds.memoryPercent).toBe(
        DEFAULT_ALERT_THRESHOLDS.memoryPercent,
      );
    });
  });

  describe("sampling", () => {
    it("collectSampleRaw returns numeric metrics", () => {
      const s = collectSampleRaw();
      expect(typeof s.ts).toBe("number");
      expect(typeof s.cpuPercent).toBe("number");
      expect(typeof s.memoryPercent).toBe("number");
      expect(typeof s.heapPercent).toBe("number");
      expect(typeof s.loadPerCore).toBe("number");
      expect(s.extra.slowQueries).toBe(0);
    });

    it("collectSampleRaw accepts slowQueries input", () => {
      const s = collectSampleRaw({ slowQueries: 12 });
      expect(s.extra.slowQueries).toBe(12);
    });

    it("collectSample persists row", () => {
      const s = collectSample(db);
      expect(s.id).toBeTruthy();
      const all = listSamples(db, { limit: 10 });
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(s.id);
    });

    it("ring buffer trims to maxSamples after insert", () => {
      setPerfConfig(db, { maxSamples: 3 });
      for (let i = 0; i < 5; i++) collectSample(db);
      const all = listSamples(db, { limit: 100 });
      expect(all).toHaveLength(3);
    });

    it("listSamples filters by sinceMs", () => {
      const s = collectSample(db);
      // rewind ts into the past
      db.data.get("perf_samples")[0].ts = s.ts - 60_000;
      collectSample(db);
      const recent = listSamples(db, { limit: 10, sinceMs: 5_000 });
      expect(recent).toHaveLength(1);
    });

    it("getLatestSample returns the newest row", () => {
      const s1 = collectSample(db);
      const s2 = collectSample(db);
      const latest = getLatestSample(db);
      expect(latest.id).toBe(s2.id);
      expect(latest.ts).toBeGreaterThanOrEqual(s1.ts);
    });

    it("getLatestSample returns null on empty", () => {
      expect(getLatestSample(db)).toBeNull();
    });

    it("clearHistory wipes samples", () => {
      collectSample(db);
      collectSample(db);
      const r = clearHistory(db);
      expect(r.cleared).toBe(2);
      expect(listSamples(db, { limit: 10 })).toHaveLength(0);
    });
  });

  describe("rules", () => {
    it("listRules returns builtins with defaults", () => {
      const rules = listRules(db);
      expect(rules).toHaveLength(5);
      for (const r of rules) {
        expect(r.enabled).toBe(true);
        expect(r.consecutiveCount).toBe(0);
        expect(r.totalTriggered).toBe(0);
        expect(r.lastTriggeredAt).toBeNull();
      }
    });

    it("getRule returns one rule by id", () => {
      const r = getRule(db, "memory-pressure");
      expect(r.id).toBe("memory-pressure");
      expect(r.severity).toBe(ALERT_LEVELS.WARNING);
    });

    it("getRule returns null for unknown", () => {
      expect(getRule(db, "ghost")).toBeNull();
    });

    it("setRuleEnabled(false) disables and persists", () => {
      const r = setRuleEnabled(db, "memory-pressure", false);
      expect(r.updated).toBe(true);
      const rule = getRule(db, "memory-pressure");
      expect(rule.enabled).toBe(false);
    });

    it("setRuleEnabled rejects unknown rule", () => {
      const r = setRuleEnabled(db, "ghost", true);
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("unknown_rule");
    });
  });

  describe("evaluateRules — synthetic samples", () => {
    const hotSample = (over = {}) => ({
      ts: Date.now(),
      cpuPercent: 95,
      memoryPercent: 90,
      heapPercent: 95,
      loadPerCore: 2.0,
      load1: 16.0,
      heapUsed: 100,
      heapTotal: 100,
      rss: 100,
      freeMem: 0,
      totalMem: 100,
      extra: { slowQueries: 20 },
      ...over,
    });

    it("no trigger before hysteresis fills", () => {
      const r = evaluateRules(db, { sample: hotSample() });
      expect(r.triggered).toHaveLength(0);
      for (const s of r.skipped.filter((x) => x.reason === "hysteresis")) {
        expect(s.consecutive).toBe(1);
      }
    });

    it("triggers after consecutive matches hit the required count", () => {
      const sample = hotSample();
      const allTriggered = new Set();
      for (let i = 0; i < 6; i++) {
        const out = evaluateRules(db, { sample });
        for (const t of out.triggered) allTriggered.add(t.ruleId);
      }
      expect(allTriggered.has("memory-pressure")).toBe(true);
      expect(allTriggered.has("cpu-saturation")).toBe(true);
    });

    it("cooldown prevents re-trigger on same cycle", () => {
      const sample = hotSample();
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample });
      const again = evaluateRules(db, { sample });
      const cooled = again.skipped.filter((s) => s.reason === "cooldown");
      expect(cooled.length).toBeGreaterThan(0);
    });

    it("condition-unmet resets consecutive counter", () => {
      const hot = hotSample();
      evaluateRules(db, { sample: hot });
      evaluateRules(db, { sample: hot });
      const cool = {
        ...hot,
        cpuPercent: 10,
        memoryPercent: 10,
        heapPercent: 10,
        loadPerCore: 0.1,
        extra: { slowQueries: 0 },
      };
      evaluateRules(db, { sample: cool });
      const state = getRule(db, "memory-pressure");
      expect(state.consecutiveCount).toBe(0);
    });

    it("writes a recommendation when a rule triggers", () => {
      const sample = hotSample();
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample });
      const recs = listRecommendations(db, { limit: 100 });
      const pending = recs.filter((r) => r.status === "pending");
      expect(pending.length).toBeGreaterThan(0);
      const memRec = recs.find((r) => r.ruleId === "memory-pressure");
      expect(memRec).toBeTruthy();
      expect(memRec.metric).toBe("memoryPercent");
    });

    it("disabled rule is skipped with reason=disabled", () => {
      setRuleEnabled(db, "cpu-saturation", false);
      const r = evaluateRules(db, { sample: hotSample() });
      const cpuSkip = r.skipped.find((s) => s.ruleId === "cpu-saturation");
      expect(cpuSkip.reason).toBe("disabled");
    });

    it("slowQueries rule fires off extra.slowQueries", () => {
      const sample = hotSample();
      const allTriggered = new Set();
      for (let i = 0; i < 3; i++) {
        const out = evaluateRules(db, { sample });
        for (const t of out.triggered) allTriggered.add(t.ruleId);
      }
      expect(allTriggered.has("db-slow-queries")).toBe(true);
    });

    it("increments totalTriggered counter", () => {
      const sample = hotSample();
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample });
      const r = getRule(db, "memory-pressure");
      expect(r.totalTriggered).toBeGreaterThan(0);
      expect(r.lastTriggeredAt).toBeTruthy();
    });

    it("falls back to latest sample when no sample arg", () => {
      collectSample(db);
      const r = evaluateRules(db);
      expect(r.sample.ts).toBeTruthy();
    });
  });

  describe("recommendations", () => {
    const hotSample = () => ({
      ts: Date.now(),
      cpuPercent: 99,
      memoryPercent: 95,
      heapPercent: 99,
      loadPerCore: 2.5,
      load1: 20,
      heapUsed: 100,
      heapTotal: 100,
      rss: 100,
      freeMem: 0,
      totalMem: 100,
      extra: { slowQueries: 30 },
    });

    it("listRecommendations filters by status", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const pending = listRecommendations(db, { status: "pending" });
      const applied = listRecommendations(db, { status: "applied" });
      expect(pending.length).toBeGreaterThan(0);
      expect(applied).toHaveLength(0);
    });

    it("applyRecommendation transitions pending → applied", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const [first] = listRecommendations(db, { status: "pending" });
      const r = applyRecommendation(db, first.id, { note: "ok" });
      expect(r.applied).toBe(true);
      const after = listRecommendations(db, { limit: 100 }).find(
        (x) => x.id === first.id,
      );
      expect(after.status).toBe("applied");
      expect(after.note).toBe("ok");
    });

    it("applyRecommendation rejects unknown id", () => {
      expect(applyRecommendation(db, "ghost").reason).toBe("not_found");
    });

    it("applyRecommendation rejects non-pending", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const [first] = listRecommendations(db, { status: "pending" });
      applyRecommendation(db, first.id);
      const again = applyRecommendation(db, first.id);
      expect(again.applied).toBe(false);
      expect(again.reason).toBe("not_pending");
    });

    it("dismissRecommendation transitions to dismissed", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const [first] = listRecommendations(db, { status: "pending" });
      const r = dismissRecommendation(db, first.id, { note: "intentional" });
      expect(r.dismissed).toBe(true);
      const after = listRecommendations(db, { limit: 100 }).find(
        (x) => x.id === first.id,
      );
      expect(after.status).toBe("dismissed");
    });

    it("dismissRecommendation rejects unknown", () => {
      expect(dismissRecommendation(db, "ghost").reason).toBe("not_found");
    });
  });

  describe("history & alerts & stats", () => {
    const hotSample = () => ({
      ts: Date.now(),
      cpuPercent: 99,
      memoryPercent: 95,
      heapPercent: 99,
      loadPerCore: 2.5,
      load1: 20,
      heapUsed: 100,
      heapTotal: 100,
      rss: 100,
      freeMem: 0,
      totalMem: 100,
      extra: { slowQueries: 30 },
    });

    it("listHistory records trigger and apply actions", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const [first] = listRecommendations(db, { status: "pending" });
      applyRecommendation(db, first.id);
      const h = listHistory(db, { limit: 100 });
      expect(h.some((r) => r.action === "trigger")).toBe(true);
      expect(h.some((r) => r.action === "apply")).toBe(true);
    });

    it("listHistory filters by ruleId", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const mem = listHistory(db, { ruleId: "memory-pressure" });
      expect(mem.every((r) => r.ruleId === "memory-pressure")).toBe(true);
    });

    it("getAlerts returns threshold violations", () => {
      db.data.set("perf_samples", []);
      // Insert a hot sample directly
      collectSample(db);
      // Patch the row to violate thresholds
      const row = db.data.get("perf_samples")[0];
      row.cpu_percent = 99;
      row.memory_percent = 99;
      row.heap_percent = 99;
      row.load_per_core = 3;
      const alerts = getAlerts(db);
      const metrics = alerts.map((a) => a.metric).sort();
      expect(metrics).toContain("cpuPercent");
      expect(metrics).toContain("memoryPercent");
      expect(metrics).toContain("heapPercent");
      expect(metrics).toContain("loadPerCore");
    });

    it("getAlerts returns [] when no sample", () => {
      expect(getAlerts(db)).toEqual([]);
    });

    it("getAlerts honors threshold overrides", () => {
      setPerfConfig(db, { thresholds: { cpuPercent: 10 } });
      collectSample(db);
      db.data.get("perf_samples")[0].cpu_percent = 20;
      const a = getAlerts(db);
      expect(a.some((x) => x.metric === "cpuPercent")).toBe(true);
    });

    it("getPerfStats sums rule triggers and averages samples", () => {
      collectSample(db);
      db.data.get("perf_samples")[0].cpu_percent = 50;
      db.data.get("perf_samples")[0].memory_percent = 40;
      db.data.get("perf_samples")[0].heap_percent = 30;
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const s = getPerfStats(db);
      expect(s.samples).toBeGreaterThan(0);
      expect(s.rules.total).toBe(5);
      expect(s.rules.enabled).toBe(5);
      expect(s.rules.triggered).toBeGreaterThan(0);
      expect(s.recommendations.pending).toBeGreaterThan(0);
      expect(s.historyEntries).toBeGreaterThan(0);
      expect(s.averages.cpuPercent).toBe(50);
    });

    it("getPerformanceReport aggregates full snapshot", () => {
      for (let i = 0; i < 6; i++) evaluateRules(db, { sample: hotSample() });
      const r = getPerformanceReport(db);
      expect(r.generatedAt).toBeTruthy();
      expect(r.stats).toBeTruthy();
      expect(r.pendingRecommendations.length).toBeGreaterThan(0);
      expect(r.recentHistory.length).toBeGreaterThan(0);
    });

    it("report.sample is null when no samples", () => {
      const r = getPerformanceReport(db);
      expect(r.sample).toBeNull();
      expect(r.alerts).toEqual([]);
    });
  });
});
