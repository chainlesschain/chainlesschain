/**
 * App-Preview auto-validation core (P1-3 "App Preview 自动验证" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no fs /
 * clock / RNG — dev-server detection, launch-config validation (fail-closed,
 * env-by-name-only), risk-based verification tier, secret-safe evidence
 * artifacts, fail-closed login-state scope.
 */
import { describe, it, expect } from "vitest";
import {
  VERIFICATION_TIER,
  EVIDENCE_KIND,
  LOGIN_SCOPE,
  detectDevServer,
  normalizeLaunchConfig,
  validateLaunchConfig,
  selectVerificationTier,
  buildEvidenceArtifact,
  resolveLoginStateScope,
} from "../../src/lib/app-preview.js";

describe("detectDevServer", () => {
  it("detects a framework by dependency and supplies its default port + script", () => {
    const out = detectDevServer({
      dependencies: { vite: "^5", react: "^18" },
      scripts: { dev: "vite", build: "vite build" },
    });
    expect(out.framework).toBe("vite");
    expect(out.port).toBe(5173);
    expect(out.script).toBe("dev");
    expect(out.startCommand).toBe("npm run dev");
    expect(out.source).toBe("dependency");
  });

  it("reads devDependencies too and picks framework default port", () => {
    const out = detectDevServer({
      devDependencies: { next: "14" },
      scripts: { start: "next start", dev: "next dev" },
    });
    expect(out.framework).toBe("next");
    expect(out.port).toBe(3000);
    // 'dev' preferred over 'start'
    expect(out.script).toBe("dev");
  });

  it("falls back to a dev script with NO framework and never invents a port", () => {
    const out = detectDevServer({ scripts: { serve: "node server.js" } });
    expect(out.framework).toBeNull();
    expect(out.port).toBeNull();
    expect(out.script).toBe("serve");
    expect(out.source).toBe("script");
  });

  it("returns null when nothing is recognizable", () => {
    expect(detectDevServer({ scripts: { build: "tsc" } })).toBeNull();
    expect(detectDevServer({})).toBeNull();
    expect(detectDevServer(null)).toBeNull();
  });

  it("dependency match with no dev script still suggests framework but no command", () => {
    const out = detectDevServer({ dependencies: { vite: "^5" }, scripts: {} });
    expect(out.framework).toBe("vite");
    expect(out.port).toBe(5173);
    expect(out.script).toBeNull();
    expect(out.startCommand).toBeNull();
  });
});

describe("normalizeLaunchConfig", () => {
  it("keeps env as reference NAMES only, dropping values", () => {
    const cfg = normalizeLaunchConfig({
      startCommand: "npm run dev",
      env: { API_URL: "http://secret", TOKEN: "sk-abc" },
    });
    expect(cfg.envRefs.sort()).toEqual(["API_URL", "TOKEN"]);
    // no values survive anywhere
    expect(JSON.stringify(cfg)).not.toContain("secret");
    expect(JSON.stringify(cfg)).not.toContain("sk-abc");
  });

  it("accepts env as an array of names", () => {
    const cfg = normalizeLaunchConfig({
      startCommand: "x",
      env: ["A", "B", ""],
    });
    expect(cfg.envRefs).toEqual(["A", "B"]);
  });

  it("coerces an out-of-range port to null and defaults shutdown to graceful", () => {
    expect(
      normalizeLaunchConfig({ startCommand: "x", port: 70000 }).port,
    ).toBeNull();
    expect(
      normalizeLaunchConfig({ startCommand: "x", port: 0 }).port,
    ).toBeNull();
    expect(normalizeLaunchConfig({ startCommand: "x", port: 3000 }).port).toBe(
      3000,
    );
    expect(normalizeLaunchConfig({ startCommand: "x" }).shutdown).toBe(
      "graceful",
    );
    expect(
      normalizeLaunchConfig({ startCommand: "x", shutdown: "kill" }).shutdown,
    ).toBe("kill");
  });

  it("normalizes a health check with url alias and default timeout", () => {
    const cfg = normalizeLaunchConfig({
      startCommand: "x",
      healthCheck: { url: "/healthz" },
    });
    expect(cfg.healthCheck).toEqual({ path: "/healthz", timeoutMs: 30000 });
  });
});

describe("validateLaunchConfig (fail-closed)", () => {
  it("passes a clean config", () => {
    const r = validateLaunchConfig({
      startCommand: "npm run dev",
      port: 5173,
      env: ["API_URL"],
      healthCheck: { path: "/" },
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("flags a missing start command", () => {
    const r = validateLaunchConfig({ port: 3000 });
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("missing-start-command");
  });

  it("flags an env entry that carries a value/secret (env must be by name)", () => {
    const r = validateLaunchConfig({
      startCommand: "x",
      env: { TOKEN: { value: "sk-live-123" } },
    });
    expect(r.violations).toContain("env-value-present");
  });

  it("flags a health check supplied with no target", () => {
    const r = validateLaunchConfig({ startCommand: "x", healthCheck: {} });
    expect(r.violations).toContain("health-check-missing-target");
  });

  it("flags a secret embedded in the start command", () => {
    const r = validateLaunchConfig({
      startCommand: "TOKEN=sk-ant-api03-abcdefghijklmnopqrstuvwxyz npm run dev",
    });
    expect(r.violations).toContain("secret-in-command");
  });

  it("collects multiple violations exhaustively", () => {
    const r = validateLaunchConfig({
      env: { A: { secret: "x" } },
      healthCheck: {},
    });
    expect(r.violations).toContain("missing-start-command");
    expect(r.violations).toContain("env-value-present");
    expect(r.violations).toContain("health-check-missing-target");
  });
});

describe("selectVerificationTier (risk-based, not every change needs a browser)", () => {
  it("defaults to the cheapest tier for a change with no signal", () => {
    const r = selectVerificationTier({});
    expect(r.tier).toBe(VERIFICATION_TIER.STATIC);
  });

  it("escalates server/API changes to api-probe", () => {
    expect(selectVerificationTier({ touchesApi: true }).tier).toBe(
      VERIFICATION_TIER.API_PROBE,
    );
    expect(selectVerificationTier({ touchesServer: true }).tier).toBe(
      VERIFICATION_TIER.API_PROBE,
    );
  });

  it("escalates UI changes to dom-assert", () => {
    const r = selectVerificationTier({ touchesUi: true });
    expect(r.tier).toBe(VERIFICATION_TIER.DOM_ASSERT);
    expect(r.reasons).toContain("ui-change");
  });

  it("escalates high risk or explicit visual concern to visual-screenshot", () => {
    expect(selectVerificationTier({ risk: "high" }).tier).toBe(
      VERIFICATION_TIER.VISUAL,
    );
    expect(selectVerificationTier({ visual: true }).tier).toBe(
      VERIFICATION_TIER.VISUAL,
    );
  });

  it("takes the highest applicable tier across multiple signals", () => {
    const r = selectVerificationTier({ touchesApi: true, touchesUi: true });
    expect(r.tier).toBe(VERIFICATION_TIER.DOM_ASSERT);
  });

  it("an explicit minTier can only raise the floor, never lower it", () => {
    expect(
      selectVerificationTier({}, { minTier: VERIFICATION_TIER.API_PROBE }).tier,
    ).toBe(VERIFICATION_TIER.API_PROBE);
    // minTier below the computed floor is ignored
    expect(
      selectVerificationTier(
        { touchesUi: true },
        { minTier: VERIFICATION_TIER.STATIC },
      ).tier,
    ).toBe(VERIFICATION_TIER.DOM_ASSERT);
  });
});

describe("buildEvidenceArtifact (secret-safe)", () => {
  it("rejects an unknown kind", () => {
    expect(buildEvidenceArtifact("nope", {})).toBeNull();
  });

  it("builds a screenshot record with opaque ref + dimensions", () => {
    const a = buildEvidenceArtifact(EVIDENCE_KIND.SCREENSHOT, {
      ref: "art://123",
      width: 1280,
      height: 720,
      tier: VERIFICATION_TIER.VISUAL,
    });
    expect(a.kind).toBe("screenshot");
    expect(a.ref).toBe("art://123");
    expect(a.width).toBe(1280);
    expect(a.tier).toBe(VERIFICATION_TIER.VISUAL);
  });

  it("redacts secrets from a DOM summary and action steps", () => {
    const dom = buildEvidenceArtifact(EVIDENCE_KIND.DOM_SUMMARY, {
      summary: "logged in with Authorization: Bearer sk-ant-api03-abcdefghij",
    });
    expect(dom.summary).not.toContain("sk-ant-api03-abcdefghij");

    const seq = buildEvidenceArtifact(EVIDENCE_KIND.ACTION_SEQUENCE, {
      steps: ["type token sk-ant-api03-abcdefghijklmnop", "click submit"],
    });
    expect(seq.steps.join(" ")).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(seq.steps).toHaveLength(2);
  });

  it("builds a test-result record and redacts its output", () => {
    const a = buildEvidenceArtifact(EVIDENCE_KIND.TEST_RESULT, {
      passed: true,
      total: 10,
      failed: 0,
      output: "OK — token sk-ant-api03-deadbeefdeadbeefdeadbeef printed",
    });
    expect(a.passed).toBe(true);
    expect(a.total).toBe(10);
    expect(a.output).not.toContain("sk-ant-api03-deadbeefdeadbeefdeadbeef");
  });
});

describe("resolveLoginStateScope (fail-closed, explicit scope required)", () => {
  it("does not persist by default", () => {
    const r = resolveLoginStateScope({});
    expect(r.persist).toBe(false);
    expect(r.reason).toBe("not-enabled");
  });

  it("enabled but unscoped does not persist", () => {
    const r = resolveLoginStateScope({ enabled: true });
    expect(r.persist).toBe(false);
    expect(r.reason).toBe("scope-unspecified");
  });

  it("enabled with an unknown scope does not persist", () => {
    const r = resolveLoginStateScope({ enabled: true, scope: "global" });
    expect(r.persist).toBe(false);
    expect(r.reason).toBe("scope-unspecified");
  });

  it("persists only when enabled AND given an explicit valid scope", () => {
    for (const scope of Object.values(LOGIN_SCOPE)) {
      const r = resolveLoginStateScope({ enabled: true, scope });
      expect(r.persist).toBe(true);
      expect(r.scope).toBe(scope);
      expect(r.reason).toBeNull();
    }
  });

  it("truthy-but-not-true enabled is fail-closed", () => {
    expect(
      resolveLoginStateScope({ enabled: "yes", scope: "user" }).persist,
    ).toBe(false);
  });
});
