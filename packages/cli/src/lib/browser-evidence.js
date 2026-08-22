import crypto from "node:crypto";
import { redactSecrets } from "./secret-scan.js";

export const BROWSER_EVIDENCE_SCHEMA =
  "chainlesschain.browser-evidence-envelope.v1";
export const BROWSER_ORIGIN_GRANT_SCHEMA =
  "chainlesschain.browser-origin-grant.v1";
export const CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";

export const BROWSER_ORIGIN_SCOPES = Object.freeze([
  "observe",
  "act",
  "navigate",
  "upload",
  "download",
]);

const EXACT_SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SIDE_EFFECT_BY_ACTION = Object.freeze({
  assertText: "none",
  screenshot: "none",
  waitForSelector: "none",
  click: "page",
  navigate: "page",
  press: "page",
  type: "page",
  upload: "credential",
  download: "filesystem",
});
const SCOPE_BY_ACTION = Object.freeze({
  assertText: "observe",
  screenshot: "observe",
  waitForSelector: "observe",
  click: "act",
  press: "act",
  type: "act",
  navigate: "navigate",
  upload: "upload",
  download: "download",
});

function actionCarriesCredentialMaterial(action) {
  const type = String(action?.type || "");
  if (["type", "upload"].includes(type)) return true;
  if (type !== "navigate") return false;
  const target = new URL(String(action.url));
  return target.search.length > 0 || target.hash.length > 0;
}

export function canonicalBrowserEvidenceJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalBrowserEvidenceJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalBrowserEvidenceJson(value[key])}`,
    )
    .join(",")}}`;
}

export function browserEvidenceDigest(value) {
  const bytes =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : canonicalBrowserEvidenceJson(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(`${label} must be JSON serializable: ${error.message}`);
  }
}

function compareCanonicalText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeId(value, label) {
  const normalized = String(value || "").trim();
  if (!SAFE_ID_RE.test(normalized)) {
    throw new Error(`${label} must be a stable non-secret identifier`);
  }
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function exactSha(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!EXACT_SHA_RE.test(normalized)) {
    throw new Error(`${label} must be an exact 40- or 64-character commit SHA`);
  }
  return normalized;
}

function sha256(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw new Error(`${label} must be a canonical sha256 digest`);
  }
  return normalized;
}

function repositoryRelativePosixPath(value, label) {
  const raw = String(value || "");
  const normalized = raw.trim();
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized !== raw ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a repository-relative POSIX path`);
  }
  return normalized;
}

function isoTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return date.toISOString();
}

function safeText(value, cap = 500) {
  const redacted = [...redactSecrets(String(value || ""))]
    .filter((character) => {
      const code = character.codePointAt(0);
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join("")
    .trim();
  return redacted.slice(0, cap);
}

export function browserOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("browser origin must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("browser origin must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("browser origin must not contain credentials");
  }
  return parsed.origin;
}

export function normalizeBrowserEvidenceBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("browser evidence requires a binding object");
  }
  const diff = binding.diff;
  const testRun = binding.testRun;
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) {
    throw new Error("browser evidence binding requires diff authority");
  }
  if (!testRun || typeof testRun !== "object" || Array.isArray(testRun)) {
    throw new Error("browser evidence binding requires testRun authority");
  }
  return Object.freeze({
    session: Object.freeze({
      id: safeId(binding.sessionId ?? binding.session?.id, "session id"),
      revision: positiveInteger(
        binding.sessionRevision ?? binding.session?.revision,
        "session revision",
      ),
    }),
    diff: Object.freeze({
      baseSha: exactSha(diff.baseSha, "diff base SHA"),
      headSha: exactSha(diff.headSha, "diff head SHA"),
      digest: sha256(diff.digest, "diff digest"),
    }),
    testRun: Object.freeze({
      id: safeId(testRun.id, "test run id"),
      attempt: positiveInteger(testRun.attempt, "test run attempt"),
    }),
  });
}

export function issueBrowserOriginGrant({
  grantId,
  binding,
  origin,
  revision,
  scopes,
  credentialBoundary = "none",
  issuedAt,
  expiresAt,
} = {}) {
  const normalizedBinding = normalizeBrowserEvidenceBinding(binding);
  const normalizedScopes = [
    ...new Set((Array.isArray(scopes) ? scopes : []).map(String)),
  ].sort();
  if (
    normalizedScopes.length === 0 ||
    normalizedScopes.some((scope) => !BROWSER_ORIGIN_SCOPES.includes(scope))
  ) {
    throw new Error("browser origin grant scopes are missing or unsupported");
  }
  if (!["none", "session-bound"].includes(credentialBoundary)) {
    throw new Error(
      "browser origin grant credentialBoundary must be none or session-bound",
    );
  }
  const normalizedIssuedAt = isoTimestamp(issuedAt, "grant issuedAt");
  const normalizedExpiresAt = isoTimestamp(expiresAt, "grant expiresAt");
  if (Date.parse(normalizedExpiresAt) <= Date.parse(normalizedIssuedAt)) {
    throw new Error("browser origin grant must expire after it is issued");
  }
  const body = {
    schema: BROWSER_ORIGIN_GRANT_SCHEMA,
    grantId: safeId(grantId, "origin grant id"),
    session: normalizedBinding.session,
    origin: browserOrigin(origin),
    revision: positiveInteger(revision, "origin grant revision"),
    scopes: normalizedScopes,
    credentialBoundary,
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
  };
  return Object.freeze({
    ...body,
    grantDigest: browserEvidenceDigest(body),
  });
}

export function verifyBrowserOriginGrant(grant, { now = Date.now() } = {}) {
  if (!grant || grant.schema !== BROWSER_ORIGIN_GRANT_SCHEMA) {
    throw new Error("browser origin grant schema is invalid");
  }
  const binding = normalizeBrowserEvidenceBinding({
    session: grant.session,
    diff: {
      baseSha: "0".repeat(40),
      headSha: "0".repeat(40),
      digest: `sha256:${"0".repeat(64)}`,
    },
    testRun: { id: "grant-verification", attempt: 1 },
  });
  const body = {
    schema: BROWSER_ORIGIN_GRANT_SCHEMA,
    grantId: safeId(grant.grantId, "origin grant id"),
    session: binding.session,
    origin: browserOrigin(grant.origin),
    revision: positiveInteger(grant.revision, "origin grant revision"),
    scopes: [...new Set((grant.scopes || []).map(String))].sort(),
    credentialBoundary: grant.credentialBoundary,
    issuedAt: isoTimestamp(grant.issuedAt, "grant issuedAt"),
    expiresAt: isoTimestamp(grant.expiresAt, "grant expiresAt"),
  };
  if (
    body.scopes.length === 0 ||
    body.scopes.some((scope) => !BROWSER_ORIGIN_SCOPES.includes(scope))
  ) {
    throw new Error("browser origin grant scopes are invalid");
  }
  if (!["none", "session-bound"].includes(body.credentialBoundary)) {
    throw new Error("browser origin grant credential boundary is invalid");
  }
  if (Date.parse(body.expiresAt) <= Date.parse(body.issuedAt)) {
    throw new Error("browser origin grant validity window is invalid");
  }
  if (browserEvidenceDigest(body) !== grant.grantDigest) {
    throw new Error("browser origin grant digest mismatch");
  }
  if (Date.parse(body.issuedAt) > Number(now)) {
    throw new Error("browser origin grant is not active yet");
  }
  if (Date.parse(body.expiresAt) <= Number(now)) {
    throw new Error("browser origin grant is expired");
  }
  return Object.freeze({ ...body, grantDigest: grant.grantDigest });
}

function grantForOrigin(grants, origin, options) {
  const matches = (Array.isArray(grants) ? grants : [])
    .map((grant) => verifyBrowserOriginGrant(grant, options))
    .filter((grant) => grant.origin === origin);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `browser origin ${origin} is not granted`
        : `browser origin ${origin} has ambiguous grants`,
    );
  }
  return matches[0];
}

export function authorizeBrowserAction({
  binding,
  grants,
  expectedGrantRevisions,
  action,
  currentUrl,
  now = Date.now(),
} = {}) {
  const normalizedBinding = normalizeBrowserEvidenceBinding(binding);
  const type = String(action?.type || "");
  const requiredScope = SCOPE_BY_ACTION[type];
  if (!requiredScope) throw new Error(`unsupported browser action: ${type}`);
  const currentOrigin = browserOrigin(currentUrl);
  const currentGrant = grantForOrigin(grants, currentOrigin, { now });
  const assertGrant = (grant) => {
    if (
      grant.session.id !== normalizedBinding.session.id ||
      grant.session.revision !== normalizedBinding.session.revision
    ) {
      throw new Error("browser origin grant session/revision mismatch");
    }
    const expected = Number(expectedGrantRevisions?.[grant.origin]);
    if (!Number.isSafeInteger(expected) || expected !== grant.revision) {
      throw new Error(
        `browser origin grant revision mismatch for ${grant.origin}`,
      );
    }
    if (!grant.scopes.includes(requiredScope)) {
      throw new Error(
        `browser origin grant for ${grant.origin} lacks ${requiredScope} scope`,
      );
    }
  };
  assertGrant(currentGrant);

  let targetGrant = currentGrant;
  if (type === "navigate") {
    const targetOrigin = browserOrigin(action.url);
    if (targetOrigin !== currentOrigin) {
      targetGrant = grantForOrigin(grants, targetOrigin, { now });
      assertGrant(targetGrant);
    }
  }
  const credentialGrant = type === "navigate" ? targetGrant : currentGrant;
  if (
    actionCarriesCredentialMaterial(action) &&
    credentialGrant.credentialBoundary !== "session-bound"
  ) {
    throw new Error(
      `browser action ${type} requires a session-bound credential grant`,
    );
  }
  return Object.freeze({
    grantId: targetGrant.grantId,
    grantDigest: targetGrant.grantDigest,
    origin: targetGrant.origin,
    revision: targetGrant.revision,
    scope: requiredScope,
    credentialBoundary: targetGrant.credentialBoundary,
    crossOrigin: targetGrant.origin !== currentOrigin,
    ...(targetGrant.origin !== currentOrigin
      ? {
          sourceGrantId: currentGrant.grantId,
          sourceGrantDigest: currentGrant.grantDigest,
          sourceOrigin: currentGrant.origin,
          sourceRevision: currentGrant.revision,
          sourceCredentialBoundary: currentGrant.credentialBoundary,
        }
      : {}),
  });
}

function browserActionIntent(action) {
  const type = String(action?.type || "");
  if (!SCOPE_BY_ACTION[type]) {
    throw new Error(`unsupported browser action: ${type}`);
  }
  const intent = { type };
  if (action?.selector) intent.selector = safeText(action.selector, 500);
  if (action?.key) intent.key = safeText(action.key, 80);
  if (type === "navigate") {
    const target = new URL(String(action.url));
    intent.targetOrigin = browserOrigin(target);
    intent.targetPath = safeText(target.pathname, 500) || "/";
    intent.queryKeys = [
      ...new Set(
        [...target.searchParams.keys()]
          .map((key) => safeText(key, 120))
          .filter(Boolean),
      ),
    ].sort();
    intent.queryValuesRetained = false;
    intent.fragmentPresent = target.hash.length > 0;
    intent.fragmentValueRetained = false;
  }
  if (type === "type") intent.textLength = String(action.text || "").length;
  if (type === "assertText") {
    intent.expectedDigest = browserEvidenceDigest(
      String(action.expected || ""),
    );
    intent.expectedLength = String(action.expected || "").length;
  }
  if (type === "upload") {
    intent.artifactId = safeId(action.artifactId, "upload artifact id");
  }
  if (type === "waitForSelector") {
    intent.timeoutMs = Math.max(1, Number(action.timeoutMs) || 1);
  }
  return Object.freeze(intent);
}

function normalizeRecordedBrowserActionIntent(intent) {
  const type = String(intent?.type || "");
  if (!SCOPE_BY_ACTION[type]) {
    throw new Error(`unsupported browser action: ${type}`);
  }
  const normalized = { type };
  if (
    [
      "assertText",
      "click",
      "download",
      "type",
      "upload",
      "waitForSelector",
    ].includes(type)
  ) {
    normalized.selector = safeText(intent.selector, 500);
    if (!normalized.selector) {
      throw new Error(`${type} intent requires a selector`);
    }
  }
  if (type === "press") {
    normalized.key = safeText(intent.key, 80);
    if (!normalized.key) throw new Error("press intent requires a key");
  }
  if (type === "navigate") {
    normalized.targetOrigin = browserOrigin(intent.targetOrigin);
    normalized.targetPath = safeText(intent.targetPath, 500) || "/";
    if (!normalized.targetPath.startsWith("/")) {
      throw new Error("navigate intent target path is invalid");
    }
    normalized.queryKeys = [
      ...new Set(
        (Array.isArray(intent.queryKeys) ? intent.queryKeys : [])
          .map((key) => safeText(key, 120))
          .filter(Boolean),
      ),
    ].sort();
    normalized.queryValuesRetained = false;
    if (intent.queryValuesRetained !== false) {
      throw new Error("navigate intent query value boundary is invalid");
    }
    normalized.fragmentPresent = intent.fragmentPresent === true;
    normalized.fragmentValueRetained = false;
    if (intent.fragmentValueRetained !== false) {
      throw new Error("navigate intent fragment boundary is invalid");
    }
  }
  if (type === "type") {
    normalized.textLength = Number(intent.textLength);
    if (
      !Number.isSafeInteger(normalized.textLength) ||
      normalized.textLength < 0
    ) {
      throw new Error("type intent length is invalid");
    }
  }
  if (type === "assertText") {
    normalized.expectedDigest = sha256(
      intent.expectedDigest,
      "browser action expected digest",
    );
    normalized.expectedLength = positiveInteger(
      intent.expectedLength,
      "browser action expected length",
    );
  }
  if (type === "upload") {
    normalized.artifactId = safeId(intent.artifactId, "upload artifact id");
  }
  if (type === "waitForSelector") {
    normalized.timeoutMs = positiveInteger(
      intent.timeoutMs,
      "browser action timeout",
    );
  }
  return normalized;
}

export function describeBrowserAction(action, step, authority, index) {
  const type = String(action?.type || "");
  if (!SCOPE_BY_ACTION[type])
    throw new Error(`unsupported browser action: ${type}`);
  const intent = browserActionIntent(action);
  const row = {
    index: Number(index),
    type,
    intent,
    intentDigest: browserEvidenceDigest(intent),
    sideEffect: SIDE_EFFECT_BY_ACTION[type],
    credentialBoundary: actionCarriesCredentialMaterial(action)
      ? "session-bound-payload-not-retained"
      : "none",
    authority: cloneJson(authority, "browser action authority"),
    outcome: {
      ok: step?.ok === true,
      durationMs: Math.max(0, Number(step?.durationMs) || 0),
      detail: safeText(step?.detail, 500),
    },
  };
  if (action?.selector) row.selector = safeText(action.selector, 500);
  if (action?.key) row.key = safeText(action.key, 80);
  if (type === "navigate") row.targetOrigin = browserOrigin(action.url);
  if (type === "type") row.textLength = String(action.text || "").length;
  if (type === "upload") {
    row.uploadArtifact = {
      id: safeId(
        step?.uploadArtifact?.id || action.artifactId,
        "upload artifact id",
      ),
      ...(step?.uploadArtifact?.sha256
        ? {
            sha256: sha256(
              step.uploadArtifact.sha256,
              "upload artifact digest",
            ),
            size: Math.max(0, Number(step.uploadArtifact.size) || 0),
          }
        : {}),
    };
  }
  for (const kind of ["screenshot", "download"]) {
    const digest = step?.[`${kind}Sha256`];
    if (digest) {
      row[`${kind}Digest`] = sha256(digest, `${kind} digest`);
    }
  }
  return Object.freeze(row);
}

function normalizeObservationRows(rows, kind, captureAvailable = false) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .slice(0, 200)
    .map((row) => {
      if (kind === "console") {
        return {
          type: safeText(row?.type, 40),
          text: safeText(row?.text, 500),
        };
      }
      const normalizedRow = {
        kind: safeText(row?.kind, 40),
        url: safeText(row?.url, 500),
      };
      if (row?.status != null) normalizedRow.status = Number(row.status);
      if (row?.error) normalizedRow.error = safeText(row.error, 300);
      return normalizedRow;
    });
  return Object.freeze({
    captureAvailable: captureAvailable === true,
    count: normalized.length,
    digest: browserEvidenceDigest(normalized),
    records: Object.freeze(normalized),
  });
}

function nonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeDomSnapshot({
  html,
  sourceChars,
  cap,
  truncated,
  redaction,
  captureSucceeded,
} = {}) {
  const safeHtml = String(html || "");
  const normalizedCap = Math.max(0, Number(cap) || safeHtml.length);
  const normalizedSourceChars = Math.max(
    safeHtml.length,
    Number(sourceChars) || safeHtml.length,
  );
  return Object.freeze({
    digest: browserEvidenceDigest(safeHtml),
    capturedChars: safeHtml.length,
    sourceChars: normalizedSourceChars,
    cap: normalizedCap,
    truncated: truncated === true || normalizedSourceChars > normalizedCap,
    captureSucceeded: captureSucceeded === true,
    redaction: Object.freeze({
      applied: redaction?.applied === true,
      sensitiveFieldValues: nonNegativeInteger(
        redaction?.sensitiveFieldValues ?? 0,
        "DOM sensitive field redaction count",
      ),
      urlQueryValues: nonNegativeInteger(
        redaction?.urlQueryValues ?? 0,
        "DOM URL query redaction count",
      ),
      secretPatterns: nonNegativeInteger(
        redaction?.secretPatterns ?? 0,
        "DOM secret pattern redaction count",
      ),
    }),
    contentRetained: false,
  });
}

export function createBrowserEvidenceEnvelope({
  binding,
  originPermissions,
  actions,
  consoleEntries,
  networkEntries,
  pageUrl,
  pageTitle,
  domSnapshot,
  screenshots,
  downloads,
  replay = null,
  observationCaptureAvailable = false,
  capturedAt = new Date().toISOString(),
} = {}) {
  const normalizedBinding = normalizeBrowserEvidenceBinding(binding);
  const permissionInputs = (
    Array.isArray(originPermissions) ? originPermissions : []
  ).flatMap((permission) => [
    permission,
    ...(permission?.crossOrigin
      ? [
          {
            grantId: permission.sourceGrantId,
            grantDigest: permission.sourceGrantDigest,
            origin: permission.sourceOrigin,
            revision: permission.sourceRevision,
            scope: permission.scope,
            credentialBoundary: permission.sourceCredentialBoundary || "none",
            crossOrigin: false,
          },
        ]
      : []),
  ]);
  const permissionRows = permissionInputs.map((permission) => ({
    grantId: safeId(permission.grantId, "origin permission grant id"),
    grantDigest: sha256(
      permission.grantDigest,
      "origin permission grant digest",
    ),
    origin: browserOrigin(permission.origin),
    revision: positiveInteger(
      permission.revision,
      "origin permission revision",
    ),
    scope: String(permission.scope || ""),
    credentialBoundary: String(permission.credentialBoundary || "none"),
    crossOrigin: permission.crossOrigin === true,
  }));
  const normalizedPermissions = [
    ...new Map(
      permissionRows.map((permission) => [
        canonicalBrowserEvidenceJson(permission),
        permission,
      ]),
    ).values(),
  ].sort((left, right) =>
    compareCanonicalText(
      `${left.origin}:${left.scope}:${left.revision}:${canonicalBrowserEvidenceJson(left)}`,
      `${right.origin}:${right.scope}:${right.revision}:${canonicalBrowserEvidenceJson(right)}`,
    ),
  );
  for (const permission of normalizedPermissions) {
    if (!BROWSER_ORIGIN_SCOPES.includes(permission.scope)) {
      throw new Error("browser evidence origin permission scope is invalid");
    }
    if (!["none", "session-bound"].includes(permission.credentialBoundary)) {
      throw new Error(
        "browser evidence origin permission credential boundary is invalid",
      );
    }
  }
  const normalizedActions = cloneJson(
    actions || [],
    "browser evidence actions",
  );
  if (!Array.isArray(normalizedActions) || normalizedActions.length === 0) {
    throw new Error("browser evidence requires at least one action result");
  }
  const normalizedScreenshots = (Array.isArray(screenshots) ? screenshots : [])
    .map((row, index) => ({
      index,
      digest: sha256(row.digest, "screenshot digest"),
      actionIndex: Number(row.actionIndex),
    }))
    .sort((left, right) => left.actionIndex - right.actionIndex);
  const normalizedDownloads = (Array.isArray(downloads) ? downloads : [])
    .map((row, index) => ({
      index,
      digest: sha256(row.digest, "download digest"),
      actionIndex: Number(row.actionIndex),
      suggestedName: safeText(row.suggestedName, 200),
    }))
    .sort((left, right) => left.actionIndex - right.actionIndex);
  const replayRecord = replay
    ? {
        sourceEnvelopeDigest: sha256(
          replay.sourceEnvelopeDigest,
          "replay source envelope digest",
        ),
        sideEffectBoundary: String(replay.sideEffectBoundary),
        credentialBoundary: String(replay.credentialBoundary),
        actionCount: positiveInteger(
          replay.actionCount,
          "browser replay action count",
        ),
      }
    : {
        sourceEnvelopeDigest: null,
        sideEffectBoundary: "recorded-not-authorized-for-replay",
        credentialBoundary: "payloads-not-retained",
        actionCount: 0,
      };
  if (
    ![
      "recorded-not-authorized-for-replay",
      "deny",
      "explicitly-approved",
    ].includes(replayRecord.sideEffectBoundary) ||
    !["payloads-not-retained", "deny", "explicitly-approved"].includes(
      replayRecord.credentialBoundary,
    )
  ) {
    throw new Error("browser evidence replay boundary is invalid");
  }
  const body = {
    schema: BROWSER_EVIDENCE_SCHEMA,
    version: 1,
    binding: normalizedBinding,
    originPermissions: normalizedPermissions,
    actions: normalizedActions,
    observations: {
      page: {
        origin: browserOrigin(pageUrl),
        title: safeText(pageTitle, 500),
        queryValueRedactions: [...new URL(String(pageUrl)).searchParams.keys()]
          .length,
        credentialMaterialRetained: false,
      },
      console: normalizeObservationRows(
        consoleEntries,
        "console",
        observationCaptureAvailable,
      ),
      network: normalizeObservationRows(
        networkEntries,
        "network",
        observationCaptureAvailable,
      ),
    },
    domSnapshot: normalizeDomSnapshot(domSnapshot),
    screenshots: normalizedScreenshots,
    downloads: normalizedDownloads,
    replay: replayRecord,
    capturedAt: isoTimestamp(capturedAt, "browser evidence capturedAt"),
  };
  return Object.freeze({
    ...body,
    envelopeDigest: browserEvidenceDigest(body),
  });
}

export function verifyBrowserEvidenceEnvelope(envelope) {
  if (!envelope || envelope.schema !== BROWSER_EVIDENCE_SCHEMA) {
    throw new Error("browser evidence envelope schema is invalid");
  }
  const body = { ...cloneJson(envelope, "browser evidence envelope") };
  const digest = body.envelopeDigest;
  delete body.envelopeDigest;
  if (browserEvidenceDigest(body) !== digest) {
    throw new Error("browser evidence envelope digest mismatch");
  }
  if (body.version !== 1) {
    throw new Error("browser evidence envelope version is invalid");
  }
  const envelopeKeys = [
    "actions",
    "binding",
    "capturedAt",
    "domSnapshot",
    "downloads",
    "observations",
    "originPermissions",
    "replay",
    "schema",
    "screenshots",
    "version",
  ];
  if (
    canonicalBrowserEvidenceJson(Object.keys(body).sort()) !==
    canonicalBrowserEvidenceJson(envelopeKeys)
  ) {
    throw new Error("browser evidence envelope fields are invalid");
  }
  const normalizedBinding = normalizeBrowserEvidenceBinding({
    session: body.binding?.session,
    diff: body.binding?.diff,
    testRun: body.binding?.testRun,
  });
  if (
    canonicalBrowserEvidenceJson(normalizedBinding) !==
    canonicalBrowserEvidenceJson(body.binding)
  ) {
    throw new Error("browser evidence binding is not canonical");
  }

  if (!Array.isArray(body.originPermissions)) {
    throw new Error("browser evidence origin permissions are invalid");
  }
  const permissionKeys = new Set();
  for (const permission of body.originPermissions) {
    const canonicalPermission = {
      grantId: safeId(permission?.grantId, "origin permission grant id"),
      grantDigest: sha256(
        permission?.grantDigest,
        "origin permission grant digest",
      ),
      origin: browserOrigin(permission?.origin),
      revision: positiveInteger(
        permission?.revision,
        "origin permission revision",
      ),
      scope: String(permission?.scope || ""),
      credentialBoundary: String(permission?.credentialBoundary || "none"),
      crossOrigin: permission?.crossOrigin === true,
    };
    if (
      !BROWSER_ORIGIN_SCOPES.includes(canonicalPermission.scope) ||
      !["none", "session-bound"].includes(
        canonicalPermission.credentialBoundary,
      ) ||
      canonicalBrowserEvidenceJson(canonicalPermission) !==
        canonicalBrowserEvidenceJson(permission)
    ) {
      throw new Error("browser evidence origin permission is invalid");
    }
    const key = canonicalBrowserEvidenceJson(canonicalPermission);
    if (permissionKeys.has(key)) {
      throw new Error("browser evidence origin permission is duplicated");
    }
    permissionKeys.add(key);
  }
  const sortedPermissions = [...body.originPermissions].sort((left, right) =>
    compareCanonicalText(
      `${left.origin}:${left.scope}:${left.revision}:${canonicalBrowserEvidenceJson(left)}`,
      `${right.origin}:${right.scope}:${right.revision}:${canonicalBrowserEvidenceJson(right)}`,
    ),
  );
  if (
    canonicalBrowserEvidenceJson(sortedPermissions) !==
    canonicalBrowserEvidenceJson(body.originPermissions)
  ) {
    throw new Error("browser evidence origin permissions are not canonical");
  }

  if (!Array.isArray(body.actions) || body.actions.length === 0) {
    throw new Error("browser evidence actions are invalid");
  }
  for (const [index, action] of body.actions.entries()) {
    const normalizedIntent = normalizeRecordedBrowserActionIntent(
      action?.intent,
    );
    const actionKeys = [
      "authority",
      "credentialBoundary",
      "index",
      "intent",
      "intentDigest",
      "outcome",
      "sideEffect",
      "type",
      ...(normalizedIntent.selector ? ["selector"] : []),
      ...(normalizedIntent.key ? ["key"] : []),
      ...(normalizedIntent.targetOrigin ? ["targetOrigin"] : []),
      ...(normalizedIntent.textLength != null ? ["textLength"] : []),
      ...(action?.type === "upload" ? ["uploadArtifact"] : []),
      ...(action?.screenshotDigest ? ["screenshotDigest"] : []),
      ...(action?.downloadDigest ? ["downloadDigest"] : []),
    ].sort();
    if (
      action?.index !== index ||
      !SCOPE_BY_ACTION[action?.type] ||
      action.sideEffect !== SIDE_EFFECT_BY_ACTION[action.type] ||
      !action.intent ||
      action.intent.type !== action.type ||
      canonicalBrowserEvidenceJson(normalizedIntent) !==
        canonicalBrowserEvidenceJson(action.intent) ||
      browserEvidenceDigest(normalizedIntent) !== action.intentDigest ||
      action.credentialBoundary !==
        (["type", "upload"].includes(action.type) ||
        (action.type === "navigate" &&
          (normalizedIntent.queryKeys.length > 0 ||
            normalizedIntent.fragmentPresent))
          ? "session-bound-payload-not-retained"
          : "none") ||
      (normalizedIntent.selector || undefined) !==
        (action.selector || undefined) ||
      (normalizedIntent.key || undefined) !== (action.key || undefined) ||
      (normalizedIntent.targetOrigin || undefined) !==
        (action.targetOrigin || undefined) ||
      (normalizedIntent.textLength ?? undefined) !==
        (action.textLength ?? undefined) ||
      (normalizedIntent.artifactId || undefined) !==
        (action.uploadArtifact?.id || undefined) ||
      canonicalBrowserEvidenceJson(Object.keys(action).sort()) !==
        canonicalBrowserEvidenceJson(actionKeys) ||
      (action.screenshotDigest != null && action.type !== "screenshot") ||
      (action.downloadDigest != null && action.type !== "download") ||
      action.text != null ||
      action.expected != null ||
      action.url != null
    ) {
      throw new Error(`browser evidence action ${index} is invalid`);
    }
    if (action.screenshotDigest) {
      sha256(action.screenshotDigest, "browser action screenshot digest");
    }
    if (action.downloadDigest) {
      sha256(action.downloadDigest, "browser action download digest");
    }
    if (action.type === "upload") {
      const canonicalUpload = {
        id: safeId(action.uploadArtifact?.id, "upload artifact id"),
        ...(action.uploadArtifact?.sha256
          ? {
              sha256: sha256(
                action.uploadArtifact.sha256,
                "upload artifact digest",
              ),
              size: nonNegativeInteger(
                action.uploadArtifact.size,
                "upload artifact size",
              ),
            }
          : {}),
      };
      if (
        canonicalBrowserEvidenceJson(canonicalUpload) !==
        canonicalBrowserEvidenceJson(action.uploadArtifact)
      ) {
        throw new Error(
          `browser evidence action ${index} upload record is not canonical`,
        );
      }
    }
    if (action.intent.expectedDigest) {
      sha256(action.intent.expectedDigest, "browser action expected digest");
    }
    if (action.intent.targetOrigin) browserOrigin(action.intent.targetOrigin);
    const canonicalOutcome = {
      ok: action.outcome?.ok === true,
      durationMs: Math.max(0, Number(action.outcome?.durationMs) || 0),
      detail: safeText(action.outcome?.detail, 500),
    };
    if (
      typeof action.outcome?.ok !== "boolean" ||
      !Number.isFinite(Number(action.outcome?.durationMs)) ||
      Number(action.outcome.durationMs) < 0 ||
      canonicalBrowserEvidenceJson(canonicalOutcome) !==
        canonicalBrowserEvidenceJson(action.outcome)
    ) {
      throw new Error(`browser evidence action ${index} outcome is invalid`);
    }
    if (action.outcome.ok && !action.authority) {
      throw new Error(
        `browser evidence action ${index} successful outcome lacks authority`,
      );
    }
    if (action.authority) {
      const authority = action.authority;
      const authorityPermission = {
        grantId: safeId(authority?.grantId, "browser action grant id"),
        grantDigest: sha256(
          authority?.grantDigest,
          "browser action grant digest",
        ),
        origin: browserOrigin(authority?.origin),
        revision: positiveInteger(
          authority?.revision,
          "browser action grant revision",
        ),
        scope: String(authority?.scope || ""),
        credentialBoundary: String(authority?.credentialBoundary || "none"),
        crossOrigin: authority?.crossOrigin === true,
      };
      const authorityKey = canonicalBrowserEvidenceJson(authorityPermission);
      if (
        !permissionKeys.has(authorityKey) ||
        authorityPermission.scope !== SCOPE_BY_ACTION[action.type]
      ) {
        throw new Error(
          `browser evidence action ${index} authority is invalid`,
        );
      }
      const canonicalAuthority = { ...authorityPermission };
      if (authority.crossOrigin) {
        const sourceGrantId = safeId(
          authority.sourceGrantId,
          "browser cross-origin source grant id",
        );
        const sourceOrigin = browserOrigin(authority.sourceOrigin);
        const sourceGrantDigest = sha256(
          authority.sourceGrantDigest,
          "browser cross-origin source grant digest",
        );
        const sourceRevision = positiveInteger(
          authority.sourceRevision,
          "browser cross-origin source revision",
        );
        const sourceCredentialBoundary = String(
          authority.sourceCredentialBoundary || "none",
        );
        Object.assign(canonicalAuthority, {
          sourceGrantId,
          sourceGrantDigest,
          sourceOrigin,
          sourceRevision,
          sourceCredentialBoundary,
        });
        if (sourceOrigin === authorityPermission.origin) {
          throw new Error(
            `browser evidence action ${index} cross-origin authority is invalid`,
          );
        }
        const sourcePermissionFound = body.originPermissions.some(
          (permission) =>
            permission.grantId === authority.sourceGrantId &&
            permission.grantDigest === authority.sourceGrantDigest &&
            permission.origin === sourceOrigin &&
            permission.revision === authority.sourceRevision &&
            permission.scope === authority.scope &&
            permission.credentialBoundary === sourceCredentialBoundary &&
            permission.crossOrigin === false,
        );
        if (!sourcePermissionFound) {
          throw new Error(
            `browser evidence action ${index} source authority is missing`,
          );
        }
      }
      if (
        canonicalBrowserEvidenceJson(canonicalAuthority) !==
        canonicalBrowserEvidenceJson(authority)
      ) {
        throw new Error(
          `browser evidence action ${index} authority is not canonical`,
        );
      }
      if (action.type !== "upload" && action.uploadArtifact != null) {
        throw new Error(
          `browser evidence action ${index} upload is unexpected`,
        );
      }
    }
    if (
      action.outcome.ok &&
      action.type === "upload" &&
      (!action.uploadArtifact?.sha256 ||
        !Number.isFinite(Number(action.uploadArtifact?.size)))
    ) {
      throw new Error(
        `browser evidence action ${index} upload record is invalid`,
      );
    }
  }

  for (const kind of ["console", "network"]) {
    const observation = body.observations?.[kind];
    const normalizedObservation = normalizeObservationRows(
      observation?.records,
      kind,
      observation?.captureAvailable === true,
    );
    if (
      !observation ||
      !Array.isArray(observation.records) ||
      canonicalBrowserEvidenceJson(normalizedObservation) !==
        canonicalBrowserEvidenceJson(observation) ||
      (observation.captureAvailable !== true && observation.count > 0)
    ) {
      throw new Error(`browser evidence ${kind} observation is invalid`);
    }
  }
  const canonicalPage = {
    origin: browserOrigin(body.observations?.page?.origin),
    title: safeText(body.observations?.page?.title, 500),
    queryValueRedactions: nonNegativeInteger(
      body.observations?.page?.queryValueRedactions,
      "page query redaction count",
    ),
    credentialMaterialRetained: false,
  };
  if (
    body.observations?.page?.credentialMaterialRetained !== false ||
    canonicalBrowserEvidenceJson(canonicalPage) !==
      canonicalBrowserEvidenceJson(body.observations?.page)
  ) {
    throw new Error("browser evidence page observation is invalid");
  }
  const dom = body.domSnapshot;
  const canonicalRedaction = {
    applied: dom?.redaction?.applied === true,
    sensitiveFieldValues: nonNegativeInteger(
      dom?.redaction?.sensitiveFieldValues,
      "DOM sensitive field redaction count",
    ),
    urlQueryValues: nonNegativeInteger(
      dom?.redaction?.urlQueryValues,
      "DOM URL query redaction count",
    ),
    secretPatterns: nonNegativeInteger(
      dom?.redaction?.secretPatterns,
      "DOM secret pattern redaction count",
    ),
  };
  const canonicalDom = {
    digest: sha256(dom?.digest, "DOM snapshot digest"),
    capturedChars: nonNegativeInteger(
      dom?.capturedChars,
      "DOM captured character count",
    ),
    sourceChars: nonNegativeInteger(
      dom?.sourceChars,
      "DOM source character count",
    ),
    cap: nonNegativeInteger(dom?.cap, "DOM capture cap"),
    truncated: dom?.truncated === true,
    captureSucceeded: dom?.captureSucceeded === true,
    redaction: canonicalRedaction,
    contentRetained: false,
  };
  if (
    !dom ||
    !SHA256_RE.test(String(dom.digest || "")) ||
    !Number.isSafeInteger(dom.capturedChars) ||
    !Number.isSafeInteger(dom.sourceChars) ||
    !Number.isSafeInteger(dom.cap) ||
    dom.capturedChars < 0 ||
    dom.sourceChars < dom.capturedChars ||
    dom.cap < dom.capturedChars ||
    typeof dom.truncated !== "boolean" ||
    typeof dom.captureSucceeded !== "boolean" ||
    canonicalBrowserEvidenceJson(canonicalRedaction) !==
      canonicalBrowserEvidenceJson(dom.redaction) ||
    dom.contentRetained !== false ||
    canonicalBrowserEvidenceJson(canonicalDom) !==
      canonicalBrowserEvidenceJson(dom)
  ) {
    throw new Error("browser evidence DOM snapshot metadata is invalid");
  }
  for (const [collection, actionType, digestField] of [
    [body.screenshots, "screenshot", "screenshotDigest"],
    [body.downloads, "download", "downloadDigest"],
  ]) {
    if (!Array.isArray(collection)) {
      throw new Error(`browser evidence ${actionType} records are invalid`);
    }
    for (const [index, record] of collection.entries()) {
      const action = body.actions[record?.actionIndex];
      const canonicalRecord = {
        index,
        digest: sha256(record?.digest, `${actionType} digest`),
        actionIndex: nonNegativeInteger(
          record?.actionIndex,
          `${actionType} action index`,
        ),
        ...(actionType === "download"
          ? { suggestedName: safeText(record?.suggestedName, 200) }
          : {}),
      };
      if (
        record?.index !== index ||
        !action ||
        action.type !== actionType ||
        canonicalRecord.digest !== action[digestField] ||
        canonicalBrowserEvidenceJson(canonicalRecord) !==
          canonicalBrowserEvidenceJson(record)
      ) {
        throw new Error(`browser evidence ${actionType} record is invalid`);
      }
    }
    for (const [actionIndex, action] of body.actions.entries()) {
      const records = collection.filter(
        (record) => record.actionIndex === actionIndex,
      );
      if (
        action.type === actionType &&
        action.outcome.ok &&
        (records.length !== 1 || !action[digestField])
      ) {
        throw new Error(
          `browser evidence ${actionType} action record is incomplete`,
        );
      }
      if (
        (action.type !== actionType || !action.outcome.ok) &&
        records.length > 0
      ) {
        throw new Error(
          `browser evidence ${actionType} action record is unexpected`,
        );
      }
    }
  }
  const replay = body.replay;
  const canonicalReplay = {
    sourceEnvelopeDigest:
      replay?.sourceEnvelopeDigest === null
        ? null
        : sha256(replay?.sourceEnvelopeDigest, "replay source envelope digest"),
    sideEffectBoundary: String(replay?.sideEffectBoundary || ""),
    credentialBoundary: String(replay?.credentialBoundary || ""),
    actionCount: nonNegativeInteger(replay?.actionCount, "replay action count"),
  };
  if (
    !replay ||
    !Number.isSafeInteger(replay.actionCount) ||
    replay.actionCount < 0 ||
    ![
      "recorded-not-authorized-for-replay",
      "deny",
      "explicitly-approved",
    ].includes(replay.sideEffectBoundary) ||
    !["payloads-not-retained", "deny", "explicitly-approved"].includes(
      replay.credentialBoundary,
    ) ||
    canonicalBrowserEvidenceJson(canonicalReplay) !==
      canonicalBrowserEvidenceJson(replay)
  ) {
    throw new Error("browser evidence replay record is invalid");
  }
  if (replay.sourceEnvelopeDigest !== null) {
    sha256(replay.sourceEnvelopeDigest, "replay source envelope digest");
    if (
      replay.actionCount < 1 ||
      replay.sideEffectBoundary === "recorded-not-authorized-for-replay" ||
      replay.credentialBoundary === "payloads-not-retained"
    ) {
      throw new Error("browser evidence replay authority is invalid");
    }
  } else if (
    replay.actionCount !== 0 ||
    replay.sideEffectBoundary !== "recorded-not-authorized-for-replay" ||
    replay.credentialBoundary !== "payloads-not-retained"
  ) {
    throw new Error("browser evidence replay default boundary is invalid");
  }
  if (
    isoTimestamp(body.capturedAt, "browser evidence capturedAt") !==
    body.capturedAt
  ) {
    throw new Error("browser evidence capturedAt is not canonical");
  }
  return Object.freeze(cloneJson(envelope, "browser evidence envelope"));
}

export function authorizeBrowserReplay({
  sourceEnvelope,
  binding,
  actions,
  allowSideEffects = false,
  allowCredentials = false,
} = {}) {
  const source = verifyBrowserEvidenceEnvelope(sourceEnvelope);
  const normalizedBinding = normalizeBrowserEvidenceBinding(binding);
  if (
    canonicalBrowserEvidenceJson(source.binding) !==
    canonicalBrowserEvidenceJson(normalizedBinding)
  ) {
    throw new Error("browser replay binding does not match source evidence");
  }
  const requested = Array.isArray(actions) ? actions : [];
  if (requested.length === 0) throw new Error("browser replay has no actions");
  for (const action of requested) {
    const effect = SIDE_EFFECT_BY_ACTION[String(action?.type || "")];
    if (!effect)
      throw new Error("browser replay contains an unsupported action");
    if (effect !== "none" && !allowSideEffects) {
      throw new Error(
        `browser replay side-effect boundary denied ${action.type}`,
      );
    }
    if (
      ["type", "upload"].includes(action.type) ||
      (action.type === "navigate" && actionCarriesCredentialMaterial(action))
    ) {
      if (!allowCredentials) {
        throw new Error(
          `browser replay credential boundary denied ${action.type}`,
        );
      }
      throw new Error(
        `browser replay cannot reconstruct ${action.type} payloads because evidence never retains credentials`,
      );
    }
    const intentDigest = browserEvidenceDigest(browserActionIntent(action));
    const represented = source.actions.some(
      (sourceAction) => sourceAction.intentDigest === intentDigest,
    );
    if (!represented) {
      throw new Error(
        `browser replay action ${action.type} is not represented by source evidence`,
      );
    }
  }
  return Object.freeze({
    sourceEnvelopeDigest: source.envelopeDigest,
    sideEffectBoundary: allowSideEffects ? "explicitly-approved" : "deny",
    credentialBoundary: allowCredentials ? "explicitly-approved" : "deny",
    actionCount: requested.length,
  });
}

export function createClaudeIncrementAuditFragment({
  commitmentId,
  headSha,
  os,
  runtime,
  profileVersion,
  thresholds,
  measurements,
  testIds,
  producerDigests,
  disposition = "required",
  outcome = "passed",
  source,
} = {}) {
  if (!["required", "advisory"].includes(disposition)) {
    throw new Error("audit fragment disposition is invalid");
  }
  if (!["passed", "failed"].includes(outcome)) {
    throw new Error("audit fragment outcome is invalid");
  }
  if (disposition === "required" && outcome !== "passed") {
    throw new Error("required audit fragments must have a passed outcome");
  }
  const normalizedDigests = {};
  for (const [file, digest] of Object.entries(producerDigests || {}).sort()) {
    normalizedDigests[
      repositoryRelativePosixPath(file, "producer digest path")
    ] = sha256(digest, `producer digest for ${file}`);
  }
  if (Object.keys(normalizedDigests).length === 0) {
    throw new Error("audit fragment requires producer digests");
  }
  return Object.freeze({
    schema: CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA,
    commitmentId: safeId(commitmentId, "commitment id"),
    headSha: exactSha(headSha, "fragment head SHA"),
    os: safeId(os, "fragment OS"),
    runtime: {
      name: safeId(runtime?.name, "runtime name"),
      version: safeText(runtime?.version, 100),
      arch: safeId(runtime?.arch, "runtime architecture"),
    },
    profileVersion: safeId(profileVersion, "profile version"),
    thresholds: cloneJson(thresholds || {}, "fragment thresholds"),
    measurements: cloneJson(measurements || {}, "fragment measurements"),
    testIds: (Array.isArray(testIds) ? testIds : []).map((id) =>
      safeId(id, "test id"),
    ),
    producerDigests: normalizedDigests,
    disposition,
    outcome,
    source: {
      workflowId: safeId(source?.workflowId, "workflow id"),
      runId: safeId(source?.runId, "run id"),
      jobId: safeId(source?.jobId, "job id"),
      artifactName: safeId(source?.artifactName, "artifact name"),
    },
  });
}
