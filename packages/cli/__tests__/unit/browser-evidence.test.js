import { describe, expect, it } from "vitest";
import {
  BROWSER_EVIDENCE_SCHEMA,
  CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA,
  authorizeBrowserAction,
  authorizeBrowserReplay,
  browserEvidenceDigest,
  canonicalBrowserEvidenceJson,
  createBrowserEvidenceEnvelope,
  createClaudeIncrementAuditFragment,
  describeBrowserAction,
  issueBrowserOriginGrant,
  verifyBrowserEvidenceEnvelope,
  verifyBrowserOriginGrant,
} from "../../src/lib/browser-evidence.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const DIFF_DIGEST = `sha256:${"c".repeat(64)}`;
const NOW = Date.parse("2026-08-21T00:00:00.000Z");

function binding(overrides = {}) {
  return {
    sessionId: "session-browser-1",
    sessionRevision: 7,
    diff: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      digest: DIFF_DIGEST,
    },
    testRun: { id: "browser-evidence-journey", attempt: 2 },
    ...overrides,
  };
}

function grant(origin, revision, scopes, overrides = {}) {
  return issueBrowserOriginGrant({
    grantId: `grant-${revision}`,
    binding: binding(),
    origin,
    revision,
    scopes,
    credentialBoundary: "session-bound",
    issuedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T01:00:00.000Z",
    ...overrides,
  });
}

describe("browser origin authority", () => {
  it("binds same-origin and cross-origin actions to exact grant revisions", () => {
    const first = grant("http://127.0.0.1:41001", 3, [
      "act",
      "navigate",
      "observe",
      "upload",
      "download",
    ]);
    const second = grant("http://127.0.0.1:41002", 9, ["navigate"]);
    const revisions = {
      [first.origin]: 3,
      [second.origin]: 9,
    };

    expect(
      authorizeBrowserAction({
        binding: binding(),
        grants: [first, second],
        expectedGrantRevisions: revisions,
        action: { type: "click", selector: "#go" },
        currentUrl: `${first.origin}/app?token=secret`,
        now: NOW + 1,
      }),
    ).toMatchObject({
      origin: first.origin,
      revision: 3,
      scope: "act",
      crossOrigin: false,
    });

    expect(
      authorizeBrowserAction({
        binding: binding(),
        grants: [first, second],
        expectedGrantRevisions: revisions,
        action: { type: "navigate", url: `${second.origin}/target` },
        currentUrl: `${first.origin}/app`,
        now: NOW + 1,
      }),
    ).toMatchObject({
      origin: second.origin,
      revision: 9,
      scope: "navigate",
      crossOrigin: true,
      sourceGrantId: first.grantId,
      sourceGrantDigest: first.grantDigest,
      sourceOrigin: first.origin,
      sourceRevision: 3,
    });
  });

  it("fails closed for an absent cross-origin grant, stale revision, or credential boundary", () => {
    const origin = "http://127.0.0.1:42001";
    const first = grant(origin, 4, ["act", "navigate", "upload"]);
    expect(() =>
      authorizeBrowserAction({
        binding: binding(),
        grants: [first],
        expectedGrantRevisions: { [origin]: 4 },
        action: { type: "navigate", url: "http://127.0.0.1:42002/other" },
        currentUrl: `${origin}/app`,
        now: NOW + 1,
      }),
    ).toThrow(/not granted/u);
    expect(() =>
      authorizeBrowserAction({
        binding: binding(),
        grants: [first],
        expectedGrantRevisions: { [origin]: 3 },
        action: { type: "click", selector: "#go" },
        currentUrl: `${origin}/app`,
        now: NOW + 1,
      }),
    ).toThrow(/revision mismatch/u);

    const noCredentials = grant(origin, 5, ["upload"], {
      grantId: "grant-no-credentials",
      credentialBoundary: "none",
    });
    expect(() =>
      authorizeBrowserAction({
        binding: binding(),
        grants: [noCredentials],
        expectedGrantRevisions: { [origin]: 5 },
        action: { type: "upload", artifactId: "art_upload" },
        currentUrl: `${origin}/app`,
        now: NOW + 1,
      }),
    ).toThrow(/session-bound credential grant/u);

    expect(() => verifyBrowserOriginGrant(first, { now: NOW - 1 })).toThrow(
      /not active yet/u,
    );

    const noNavigateCredentials = grant(origin, 6, ["navigate"], {
      grantId: "grant-no-navigate-credentials",
      credentialBoundary: "none",
    });
    expect(() =>
      authorizeBrowserAction({
        binding: binding(),
        grants: [noNavigateCredentials],
        expectedGrantRevisions: { [origin]: 6 },
        action: { type: "navigate", url: `${origin}/?token=opaque` },
        currentUrl: `${origin}/app`,
        now: NOW + 1,
      }),
    ).toThrow(/session-bound credential grant/u);
  });
});

describe("canonical browser evidence envelope", () => {
  function envelope() {
    const permission = {
      grantId: "grant-1",
      grantDigest: `sha256:${"d".repeat(64)}`,
      origin: "http://127.0.0.1:43001",
      revision: 1,
      scope: "observe",
      credentialBoundary: "session-bound",
      crossOrigin: false,
    };
    return createBrowserEvidenceEnvelope({
      binding: binding(),
      originPermissions: [permission],
      actions: [
        describeBrowserAction(
          { type: "screenshot" },
          {
            ok: true,
            durationMs: 12,
            detail: "captured",
            screenshotSha256: `sha256:${"e".repeat(64)}`,
          },
          permission,
          0,
        ),
        describeBrowserAction(
          { type: "assertText", selector: "h1", expected: "journey ready" },
          { ok: true, durationMs: 4, detail: "assertText passed: h1" },
          permission,
          1,
        ),
      ],
      consoleEntries: [{ type: "error", text: "Bearer abcdefghijklmnop" }],
      networkEntries: [
        {
          kind: "http-error",
          url: "http://127.0.0.1:43001/api?token=[REDACTED]",
          status: 500,
        },
      ],
      pageUrl: "http://127.0.0.1:43001/app",
      pageTitle: "Browser journey",
      domSnapshot: {
        html: "<html><body>safe</body></html>",
        sourceChars: 50000,
        cap: 32,
        truncated: true,
        captureSucceeded: true,
      },
      screenshots: [{ actionIndex: 0, digest: `sha256:${"e".repeat(64)}` }],
      downloads: [],
      observationCaptureAvailable: true,
      capturedAt: "2026-08-21T00:05:00.000Z",
    });
  }

  it("binds action, origin, observations, screenshot, DOM, session/diff/test and redacts secrets", () => {
    const record = envelope();
    expect(record.schema).toBe(BROWSER_EVIDENCE_SCHEMA);
    expect(record.binding).toMatchObject({
      session: { id: "session-browser-1", revision: 7 },
      diff: { headSha: HEAD_SHA, digest: DIFF_DIGEST },
      testRun: { id: "browser-evidence-journey", attempt: 2 },
    });
    expect(record.originPermissions[0]).toMatchObject({
      origin: "http://127.0.0.1:43001",
      revision: 1,
    });
    expect(record.domSnapshot).toMatchObject({
      truncated: true,
      capturedChars: 30,
      sourceChars: 50000,
      contentRetained: false,
    });
    expect(record.screenshots[0].digest).toBe(`sha256:${"e".repeat(64)}`);
    expect(record.actions[1]).toMatchObject({
      type: "assertText",
      intent: {
        selector: "h1",
        expectedLength: 13,
      },
    });
    expect(record.actions[1].intent.expectedDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(record.observations.console.records[0].text).toBe(
      "Bearer [REDACTED]",
    );
    expect(canonicalBrowserEvidenceJson(record)).not.toContain(
      "abcdefghijklmnop",
    );
    expect(verifyBrowserEvidenceEnvelope(record).envelopeDigest).toBe(
      record.envelopeDigest,
    );
  });

  it("detects tampering and enforces replay side-effect/credential boundaries", () => {
    const source = envelope();
    expect(() =>
      verifyBrowserEvidenceEnvelope({
        ...source,
        observations: {
          ...source.observations,
          page: { ...source.observations.page, title: "tampered" },
        },
      }),
    ).toThrow(/digest mismatch/u);

    const malformed = JSON.parse(JSON.stringify(source));
    malformed.actions[0].intent.type = "click";
    const malformedBody = { ...malformed };
    delete malformedBody.envelopeDigest;
    malformed.envelopeDigest = browserEvidenceDigest(malformedBody);
    expect(() => verifyBrowserEvidenceEnvelope(malformed)).toThrow(
      /intent requires a selector|action 0 is invalid/u,
    );

    expect(
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding(),
        actions: [{ type: "screenshot" }],
      }),
    ).toMatchObject({
      sourceEnvelopeDigest: source.envelopeDigest,
      sideEffectBoundary: "deny",
      credentialBoundary: "deny",
    });
    expect(() =>
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding(),
        actions: [{ type: "click", selector: "#submit" }],
      }),
    ).toThrow(/side-effect boundary denied/u);
    expect(() =>
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding(),
        actions: [{ type: "type", selector: "#password", text: "secret" }],
        allowSideEffects: true,
      }),
    ).toThrow(/credential boundary denied/u);
    expect(() =>
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding({ sessionRevision: 8 }),
        actions: [{ type: "screenshot" }],
      }),
    ).toThrow(/binding does not match/u);
    expect(
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding(),
        actions: [
          { type: "assertText", selector: "h1", expected: "journey ready" },
        ],
      }),
    ).toBeTruthy();
    expect(() =>
      authorizeBrowserReplay({
        sourceEnvelope: source,
        binding: binding(),
        actions: [
          { type: "assertText", selector: "h1", expected: "different" },
        ],
      }),
    ).toThrow(/not represented/u);
  });
});

describe("increment audit fragment", () => {
  it("emits the standard required producer schema", () => {
    const fragment = createClaudeIncrementAuditFragment({
      commitmentId: "BROWSER-EVIDENCE",
      headSha: HEAD_SHA,
      os: "linux",
      runtime: { name: "node", version: "22.12.0", arch: "x64" },
      profileVersion: "browser-evidence-local-two-origin-v1",
      thresholds: { secretScanHits: 0 },
      measurements: { secretScanHits: 0, screenshotDiffs: 1 },
      testIds: ["browser-evidence.local-two-origin"],
      producerDigests: {
        "packages/cli/src/lib/browser-evidence.js":
          browserEvidenceDigest("evidence"),
      },
      disposition: "required",
      outcome: "passed",
      source: {
        workflowId: "ide-extensions",
        runId: "123",
        jobId: "browser-evidence-linux",
        artifactName: "browser-evidence-linux-1",
      },
    });
    expect(fragment.schema).toBe(CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA);
    expect(fragment).toMatchObject({
      commitmentId: "BROWSER-EVIDENCE",
      headSha: HEAD_SHA,
      disposition: "required",
      outcome: "passed",
      measurements: { secretScanHits: 0, screenshotDiffs: 1 },
    });
    expect(() =>
      createClaudeIncrementAuditFragment({
        ...fragment,
        outcome: "failed",
      }),
    ).toThrow(/required audit fragments must have a passed outcome/u);
    expect(() =>
      createClaudeIncrementAuditFragment({
        ...fragment,
        producerDigests: {
          "packages\\cli\\src\\lib\\browser-evidence.js":
            browserEvidenceDigest("evidence"),
        },
      }),
    ).toThrow(/repository-relative POSIX path/u);
  });
});
